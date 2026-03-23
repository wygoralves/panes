use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Context;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader},
    net::TcpListener,
    sync::RwLock,
};
use uuid::Uuid;

use crate::{models::TerminalNotificationDto, runtime_env};

const PANES_NOTIFY_ADDR_ENV: &str = "PANES_NOTIFY_ADDR";
const PANES_NOTIFY_TOKEN_ENV: &str = "PANES_NOTIFY_TOKEN";
const PANES_SESSION_ID_ENV: &str = "PANES_SESSION_ID";
const PANES_WORKSPACE_ID_ENV: &str = "PANES_WORKSPACE_ID";
const CODEX_NOTIFY_SUBCOMMAND: &str = "codex-notify";
const TERMINAL_NOTIFY_SUBCOMMAND: &str = "notify";
const CODEX_NOTIFICATION_TITLE: &str = "Codex";
const CODEX_NOTIFICATION_KIND_TURN_COMPLETE: &str = "agent-turn-complete";
const NOTIFICATION_DEFAULT_TITLE: &str = "Panes";
const NOTIFICATION_DEFAULT_BODY: &str = "Notification";
const NOTIFICATION_EVENT_PREFIX: &str = "terminal-notification-";
const NOTIFICATION_CLEARED_EVENT_PREFIX: &str = "terminal-notification-cleared-";
const MAX_TITLE_CHARS: usize = 80;
const MAX_BODY_CHARS: usize = 240;

#[derive(Default)]
pub struct TerminalNotificationManager {
    runtime: RwLock<Option<NotificationIngressRuntime>>,
    notifications: RwLock<HashMap<String, HashMap<String, TerminalNotificationDto>>>,
    focus: RwLock<NotificationFocusState>,
}

#[derive(Debug, Clone)]
struct NotificationIngressRuntime {
    addr: String,
    token: String,
    cli_bin_dir: PathBuf,
}

#[derive(Debug, Clone, Default)]
struct NotificationFocusState {
    window_focused: bool,
    workspace_id: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TerminalNotificationSessionEnv {
    pub cli_bin_dir: PathBuf,
    pub ingress_addr: String,
    pub ingress_token: String,
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationIngressRequest {
    token: String,
    workspace_id: String,
    session_id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationIngressResponse {
    ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalNotificationClearedEvent {
    pub session_id: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct NotifyCliArgs {
    title: Option<String>,
    body: Option<String>,
    workspace_id: Option<String>,
    session_id: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct CodexNotifyPayload {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    last_assistant_message: Option<String>,
    #[serde(default)]
    input_messages: Vec<String>,
}

impl TerminalNotificationManager {
    pub async fn start(self: &Arc<Self>, app: AppHandle) -> anyhow::Result<()> {
        if self.runtime.read().await.is_some() {
            return Ok(());
        }

        let cli_bin_dir = install_cli_shim().context("failed to install panes CLI shim")?;
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .context("failed to bind terminal notification ingress")?;
        let addr = listener
            .local_addr()
            .context("failed to resolve terminal notification ingress address")?
            .to_string();
        let token = Uuid::new_v4().to_string();

        {
            let mut runtime = self.runtime.write().await;
            if runtime.is_some() {
                return Ok(());
            }
            *runtime = Some(NotificationIngressRuntime {
                addr: addr.clone(),
                token: token.clone(),
                cli_bin_dir,
            });
        }

        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            manager.run_listener(app, listener, token).await;
        });

        Ok(())
    }

    pub async fn session_env(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<TerminalNotificationSessionEnv> {
        let runtime = self.runtime.read().await.clone()?;
        Some(TerminalNotificationSessionEnv {
            cli_bin_dir: runtime.cli_bin_dir,
            ingress_addr: runtime.addr,
            ingress_token: runtime.token,
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
        })
    }

    pub async fn list_for_workspace(&self, workspace_id: &str) -> Vec<TerminalNotificationDto> {
        let notifications = self.notifications.read().await;
        let mut items = notifications
            .get(workspace_id)
            .map(|by_session| by_session.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        items.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        items
    }

    pub async fn clear_for_session(
        &self,
        app: &AppHandle,
        workspace_id: &str,
        session_id: &str,
    ) -> bool {
        self.clear(app, workspace_id, Some(session_id)).await
    }

    pub async fn clear_for_workspace(&self, app: &AppHandle, workspace_id: &str) -> bool {
        self.clear(app, workspace_id, None).await
    }

    pub async fn set_focus(
        &self,
        window_focused: bool,
        workspace_id: Option<String>,
        session_id: Option<String>,
    ) {
        let normalized_workspace_id = normalize_optional_value(workspace_id);
        let normalized_session_id = normalize_optional_value(session_id);
        let mut focus = self.focus.write().await;
        focus.window_focused = window_focused;
        focus.workspace_id = if window_focused {
            normalized_workspace_id
        } else {
            None
        };
        focus.session_id = if window_focused && focus.workspace_id.is_some() {
            normalized_session_id
        } else {
            None
        };
    }

    async fn run_listener(self: Arc<Self>, app: AppHandle, listener: TcpListener, token: String) {
        loop {
            let (stream, _addr) = match listener.accept().await {
                Ok(pair) => pair,
                Err(error) => {
                    log::warn!("terminal notification ingress accept failed: {error}");
                    break;
                }
            };

            let manager = Arc::clone(&self);
            let app = app.clone();
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = manager.handle_stream(app, stream, &token).await {
                    log::warn!("terminal notification ingress request failed: {error}");
                }
            });
        }
    }

    async fn handle_stream(
        &self,
        app: AppHandle,
        stream: tokio::net::TcpStream,
        token: &str,
    ) -> anyhow::Result<()> {
        let (reader, mut writer) = stream.into_split();
        let mut reader = AsyncBufReader::new(reader);
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .await
            .context("failed to read ingress payload")?;
        if read == 0 {
            return Ok(());
        }

        let response = match serde_json::from_str::<NotificationIngressRequest>(line.trim()) {
            Ok(request) => {
                if request.token != token {
                    NotificationIngressResponse {
                        ok: false,
                        error: Some("invalid notification token".to_string()),
                    }
                } else {
                    match self.publish_request(&app, request).await {
                        Ok(_) => NotificationIngressResponse {
                            ok: true,
                            error: None,
                        },
                        Err(error) => NotificationIngressResponse {
                            ok: false,
                            error: Some(error.to_string()),
                        },
                    }
                }
            }
            Err(error) => NotificationIngressResponse {
                ok: false,
                error: Some(format!("invalid notification payload: {error}")),
            },
        };

        let rendered =
            serde_json::to_string(&response).context("failed to serialize ingress response")?;
        writer
            .write_all(rendered.as_bytes())
            .await
            .context("failed to write ingress response")?;
        writer
            .write_all(b"\n")
            .await
            .context("failed to finish ingress response")?;

        Ok(())
    }

    async fn publish_request(
        &self,
        app: &AppHandle,
        request: NotificationIngressRequest,
    ) -> anyhow::Result<Option<TerminalNotificationDto>> {
        let workspace_id = normalize_required_value(request.workspace_id, "workspace_id")?;
        let session_id = normalize_required_value(request.session_id, "session_id")?;
        let title = normalize_notification_text(
            request.title.as_deref(),
            NOTIFICATION_DEFAULT_TITLE,
            MAX_TITLE_CHARS,
        );
        let body = normalize_notification_text(
            request.body.as_deref(),
            NOTIFICATION_DEFAULT_BODY,
            MAX_BODY_CHARS,
        );
        let source = request
            .source
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("external")
            .to_string();

        if self
            .notification_target_is_focused(&workspace_id, &session_id)
            .await
        {
            self.clear_for_session(app, &workspace_id, &session_id)
                .await;
            return Ok(None);
        }

        let notification = TerminalNotificationDto {
            id: Uuid::new_v4().to_string(),
            workspace_id: workspace_id.clone(),
            session_id: session_id.clone(),
            source,
            title,
            body,
            created_at: Utc::now().to_rfc3339(),
        };

        {
            let mut notifications = self.notifications.write().await;
            notifications
                .entry(workspace_id.clone())
                .or_default()
                .insert(session_id, notification.clone());
        }

        let event_name = format!("{NOTIFICATION_EVENT_PREFIX}{workspace_id}");
        let _ = app.emit(&event_name, notification.clone());

        if let Err(error) = app
            .notification()
            .builder()
            .title(&notification.title)
            .body(&notification.body)
            .show()
        {
            log::warn!("failed to show desktop notification: {error}");
        }

        Ok(Some(notification))
    }

    async fn notification_target_is_focused(&self, workspace_id: &str, session_id: &str) -> bool {
        let focus = self.focus.read().await;
        focus_matches_target(&focus, workspace_id, session_id)
    }

    async fn clear(&self, app: &AppHandle, workspace_id: &str, session_id: Option<&str>) -> bool {
        let normalized_workspace_id = workspace_id.trim();
        if normalized_workspace_id.is_empty() {
            return false;
        }

        let normalized_session_id = session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let removed = {
            let mut notifications = self.notifications.write().await;
            let Some(by_session) = notifications.get_mut(normalized_workspace_id) else {
                return false;
            };

            let removed = match normalized_session_id.as_deref() {
                Some(session_id) => by_session.remove(session_id).is_some(),
                None => {
                    if by_session.is_empty() {
                        false
                    } else {
                        by_session.clear();
                        true
                    }
                }
            };
            let remove_workspace = by_session.is_empty();
            if remove_workspace {
                notifications.remove(normalized_workspace_id);
            }
            removed
        };

        if !removed {
            return false;
        }

        let event_name = format!("{NOTIFICATION_CLEARED_EVENT_PREFIX}{normalized_workspace_id}");
        let _ = app.emit(
            &event_name,
            TerminalNotificationClearedEvent {
                session_id: normalized_session_id,
            },
        );
        true
    }
}

pub fn maybe_handle_cli_subcommand() -> anyhow::Result<bool> {
    let mut args = std::env::args().skip(1);
    let Some(subcommand) = args.next() else {
        return Ok(false);
    };

    match subcommand.as_str() {
        TERMINAL_NOTIFY_SUBCOMMAND => {
            let Some(cli_args) = parse_notify_cli_args(args.collect())? else {
                return Ok(true);
            };
            let (addr, request) = build_notify_request_from_cli(cli_args)?;
            send_notify_request(&addr, &request)?;
            Ok(true)
        }
        CODEX_NOTIFY_SUBCOMMAND => {
            let Some(payload_json) = parse_codex_notify_args(args.collect())? else {
                return Ok(true);
            };
            let Some((addr, request)) = build_notify_request_from_codex_payload(&payload_json)?
            else {
                return Ok(true);
            };
            send_notify_request(&addr, &request)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn parse_notify_cli_args(args: Vec<String>) -> anyhow::Result<Option<NotifyCliArgs>> {
    let mut parsed = NotifyCliArgs::default();
    let mut index = 0;
    while index < args.len() {
        let flag = args[index].as_str();
        let value = if flag == "--help" || flag == "-h" {
            None
        } else {
            Some(
                args.get(index + 1)
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing value for {flag}"))?,
            )
        };

        match flag {
            "--help" | "-h" => {
                print_notify_help();
                return Ok(None);
            }
            "--title" => parsed.title = value,
            "--body" => parsed.body = value,
            "--workspace-id" => parsed.workspace_id = value,
            "--session-id" => parsed.session_id = value,
            "--source" => parsed.source = value,
            other => anyhow::bail!("unknown panes notify argument: {other}"),
        }

        index += if matches!(flag, "--help" | "-h") {
            1
        } else {
            2
        };
    }

    Ok(Some(parsed))
}

fn build_notify_request_from_cli(
    args: NotifyCliArgs,
) -> anyhow::Result<(SocketAddr, NotificationIngressRequest)> {
    build_notify_request(
        args.workspace_id,
        args.session_id,
        args.title,
        args.body,
        args.source.or_else(|| Some("cli".to_string())),
    )
}

fn build_notify_request_from_codex_payload(
    payload_json: &str,
) -> anyhow::Result<Option<(SocketAddr, NotificationIngressRequest)>> {
    let Some(args) = codex_notify_cli_args_from_payload(payload_json)? else {
        return Ok(None);
    };
    Ok(Some(build_notify_request(
        args.workspace_id,
        args.session_id,
        args.title,
        args.body,
        args.source,
    )?))
}

fn build_notify_request(
    workspace_id: Option<String>,
    session_id: Option<String>,
    title: Option<String>,
    body: Option<String>,
    source: Option<String>,
) -> anyhow::Result<(SocketAddr, NotificationIngressRequest)> {
    let addr = read_required_env(PANES_NOTIFY_ADDR_ENV)
        .context("PANES terminal notification ingress is not available in this shell")?;
    let token = read_required_env(PANES_NOTIFY_TOKEN_ENV)
        .context("PANES terminal notification token is not available in this shell")?;
    let workspace_id = workspace_id
        .or_else(|| read_non_empty_env(PANES_WORKSPACE_ID_ENV))
        .ok_or_else(|| anyhow::anyhow!("workspace id is required"))?;
    let session_id = session_id
        .or_else(|| read_non_empty_env(PANES_SESSION_ID_ENV))
        .ok_or_else(|| anyhow::anyhow!("session id is required"))?;

    let parsed_addr = addr
        .parse::<SocketAddr>()
        .with_context(|| format!("invalid PANES_NOTIFY_ADDR value: {addr}"))?;
    Ok((
        parsed_addr,
        NotificationIngressRequest {
            token,
            workspace_id,
            session_id,
            title,
            body,
            source,
        },
    ))
}

fn parse_codex_notify_args(args: Vec<String>) -> anyhow::Result<Option<String>> {
    match args.as_slice() {
        [] => anyhow::bail!("missing Codex notification payload"),
        [flag] if matches!(flag.as_str(), "--help" | "-h") => {
            print_codex_notify_help();
            Ok(None)
        }
        [payload] => Ok(Some(payload.clone())),
        _ => anyhow::bail!("panes codex-notify expects a single JSON payload argument"),
    }
}

fn codex_notify_cli_args_from_payload(raw_payload: &str) -> anyhow::Result<Option<NotifyCliArgs>> {
    let payload: CodexNotifyPayload =
        serde_json::from_str(raw_payload).context("failed to parse Codex notify payload")?;
    if payload.kind != CODEX_NOTIFICATION_KIND_TURN_COMPLETE {
        return Ok(None);
    }

    let body = payload
        .last_assistant_message
        .or_else(|| payload.input_messages.last().cloned())
        .or_else(|| Some("Turn complete".to_string()));

    Ok(Some(NotifyCliArgs {
        title: Some(CODEX_NOTIFICATION_TITLE.to_string()),
        body,
        workspace_id: None,
        session_id: None,
        source: Some("codex".to_string()),
    }))
}

fn send_notify_request(
    addr: &SocketAddr,
    request: &NotificationIngressRequest,
) -> anyhow::Result<()> {
    let mut stream = TcpStream::connect_timeout(addr, Duration::from_secs(2))
        .with_context(|| format!("failed to connect to Panes notification ingress at {addr}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

    let payload =
        serde_json::to_string(request).context("failed to serialize panes notify request")?;
    stream
        .write_all(payload.as_bytes())
        .context("failed to write panes notify request")?;
    stream
        .write_all(b"\n")
        .context("failed to finish panes notify request")?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .context("failed to read panes notify response")?;
    if line.trim().is_empty() {
        return Ok(());
    }

    let response: NotificationIngressResponse =
        serde_json::from_str(line.trim()).context("failed to parse panes notify response")?;
    if response.ok {
        return Ok(());
    }

    anyhow::bail!(
        "{}",
        response
            .error
            .unwrap_or_else(|| "Panes notification ingress rejected the request".to_string())
    );
}

fn install_cli_shim() -> anyhow::Result<PathBuf> {
    let bin_dir = runtime_env::app_data_dir().join("bin");
    std::fs::create_dir_all(&bin_dir).with_context(|| {
        format!(
            "failed to create panes shim directory at {}",
            bin_dir.display()
        )
    })?;

    let current_exe =
        std::env::current_exe().context("failed to resolve current Panes executable")?;
    let shim_path = bin_dir.join(cli_shim_name());
    let contents = cli_shim_contents(&current_exe);

    let should_write = std::fs::read_to_string(&shim_path)
        .map(|existing| existing != contents)
        .unwrap_or(true);
    if should_write {
        std::fs::write(&shim_path, contents.as_bytes())
            .with_context(|| format!("failed to write panes shim at {}", shim_path.display()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let permissions = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&shim_path, permissions).with_context(|| {
            format!(
                "failed to mark panes shim executable at {}",
                shim_path.display()
            )
        })?;
    }

    Ok(bin_dir)
}

#[cfg(windows)]
fn cli_shim_name() -> &'static str {
    "panes.cmd"
}

#[cfg(not(windows))]
fn cli_shim_name() -> &'static str {
    "panes"
}

#[cfg(windows)]
fn cli_shim_contents(current_exe: &Path) -> String {
    format!("@echo off\r\n\"{}\" %*\r\n", current_exe.to_string_lossy())
}

#[cfg(not(windows))]
fn cli_shim_contents(current_exe: &Path) -> String {
    format!(
        "#!/bin/sh\nexec {} \"$@\"\n",
        shell_single_quote_escape(&current_exe.to_string_lossy())
    )
}

#[cfg(not(windows))]
fn shell_single_quote_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

fn normalize_required_value(value: String, label: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        anyhow::bail!("{label} is required");
    }
    Ok(trimmed.to_string())
}

fn normalize_optional_value(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_notification_text(raw: Option<&str>, fallback: &str, max_chars: usize) -> String {
    let collapsed = raw
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = if collapsed.trim().is_empty() {
        fallback.to_string()
    } else {
        collapsed
    };

    let mut out = String::new();
    for (index, ch) in trimmed.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }
    out
}

fn read_non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn read_required_env(key: &str) -> anyhow::Result<String> {
    read_non_empty_env(key).ok_or_else(|| anyhow::anyhow!("missing {key}"))
}

fn focus_matches_target(
    focus: &NotificationFocusState,
    workspace_id: &str,
    session_id: &str,
) -> bool {
    focus.window_focused
        && focus.workspace_id.as_deref() == Some(workspace_id)
        && focus.session_id.as_deref() == Some(session_id)
}

fn print_notify_help() {
    println!(
        "Usage: panes notify [--title TITLE] [--body BODY] [--workspace-id ID] [--session-id ID] [--source SOURCE]"
    );
}

fn print_codex_notify_help() {
    println!("Usage: panes codex-notify '<codex notify JSON payload>'");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_notify_cli_args_reads_all_supported_flags() {
        let parsed = parse_notify_cli_args(vec![
            "--title".to_string(),
            "Codex".to_string(),
            "--body".to_string(),
            "Turn complete".to_string(),
            "--workspace-id".to_string(),
            "ws-1".to_string(),
            "--session-id".to_string(),
            "term-1".to_string(),
            "--source".to_string(),
            "codex".to_string(),
        ])
        .expect("notify args should parse");

        assert_eq!(
            parsed,
            Some(NotifyCliArgs {
                title: Some("Codex".to_string()),
                body: Some("Turn complete".to_string()),
                workspace_id: Some("ws-1".to_string()),
                session_id: Some("term-1".to_string()),
                source: Some("codex".to_string()),
            })
        );
    }

    #[test]
    fn parse_notify_cli_args_returns_none_for_help() {
        let parsed = parse_notify_cli_args(vec!["--help".to_string()])
            .expect("notify help args should parse");

        assert_eq!(parsed, None);
    }

    #[test]
    fn parse_codex_notify_args_reads_single_payload() {
        let parsed = parse_codex_notify_args(vec![r#"{"type":"agent-turn-complete"}"#.to_string()])
            .expect("Codex notify args should parse");

        assert_eq!(
            parsed,
            Some(r#"{"type":"agent-turn-complete"}"#.to_string())
        );
    }

    #[test]
    fn parse_codex_notify_args_returns_none_for_help() {
        let parsed =
            parse_codex_notify_args(vec!["--help".to_string()]).expect("help should parse");

        assert_eq!(parsed, None);
    }

    #[test]
    fn codex_notify_cli_args_from_payload_maps_agent_turn_complete() {
        let parsed = codex_notify_cli_args_from_payload(
            r#"{"type":"agent-turn-complete","last-assistant-message":"Ship it","input-messages":["please finish"]}"#,
        )
        .expect("Codex payload should parse");

        assert_eq!(
            parsed,
            Some(NotifyCliArgs {
                title: Some("Codex".to_string()),
                body: Some("Ship it".to_string()),
                workspace_id: None,
                session_id: None,
                source: Some("codex".to_string()),
            })
        );
    }

    #[test]
    fn codex_notify_cli_args_from_payload_ignores_other_events() {
        let parsed = codex_notify_cli_args_from_payload(r#"{"type":"approval-requested"}"#)
            .expect("non-terminal Codex payload should parse");

        assert_eq!(parsed, None);
    }

    #[test]
    fn codex_notify_cli_args_from_payload_uses_codex_specific_fallback_body() {
        let parsed = codex_notify_cli_args_from_payload(r#"{"type":"agent-turn-complete"}"#)
            .expect("Codex payload should parse");

        assert_eq!(
            parsed,
            Some(NotifyCliArgs {
                title: Some("Codex".to_string()),
                body: Some("Turn complete".to_string()),
                workspace_id: None,
                session_id: None,
                source: Some("codex".to_string()),
            })
        );
    }

    #[test]
    fn normalize_notification_text_trims_collapses_and_truncates() {
        let normalized =
            normalize_notification_text(Some("  hello\n\nworld  from   panes  "), "fallback", 11);
        assert_eq!(normalized, "hello world…");
    }

    #[test]
    fn normalize_optional_value_rejects_blank_values() {
        assert_eq!(normalize_optional_value(Some("  ".to_string())), None);
        assert_eq!(
            normalize_optional_value(Some(" ws-1 ".to_string())),
            Some("ws-1".to_string())
        );
    }

    #[test]
    fn focus_matches_target_requires_window_workspace_and_session_match() {
        let focus = NotificationFocusState {
            window_focused: true,
            workspace_id: Some("ws-1".to_string()),
            session_id: Some("term-1".to_string()),
        };

        assert!(focus_matches_target(&focus, "ws-1", "term-1"));
        assert!(!focus_matches_target(&focus, "ws-1", "term-2"));
        assert!(!focus_matches_target(&focus, "ws-2", "term-1"));
        assert!(!focus_matches_target(
            &NotificationFocusState::default(),
            "ws-1",
            "term-1"
        ));
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_cli_shim_escapes_single_quotes() {
        let contents = cli_shim_contents(Path::new("/tmp/Panes' Dev"));
        assert!(contents.contains("'/tmp/Panes'\\'' Dev'"));
    }
}
