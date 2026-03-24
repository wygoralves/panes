use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};

use anyhow::Context;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
const CODEX_WRAPPER_SUBCOMMAND: &str = "codex-wrapper";
const CODEX_NOTIFY_CONFIG_OVERRIDE: &str = r#"notify=["panes","codex-notify"]"#;
const CLAUDE_HOOK_SUBCOMMAND: &str = "claude-hook";
const CLAUDE_WRAPPER_SUBCOMMAND: &str = "claude-wrapper";
const CLEAR_NOTIFICATION_SUBCOMMAND: &str = "clear-notification";
const TERMINAL_NOTIFY_SUBCOMMAND: &str = "notify";
const CODEX_NOTIFICATION_TITLE: &str = "Codex";
const CODEX_NOTIFICATION_KIND_TURN_COMPLETE: &str = "agent-turn-complete";
const CLAUDE_NOTIFICATION_TITLE: &str = "Claude";
const CLAUDE_NOTIFICATION_ERROR_TITLE: &str = "Claude Error";
const CLAUDE_NOTIFICATION_KIND_DEFAULT: &str = "notification";
const CLAUDE_TURN_COMPLETE_BODY: &str = "Turn complete";
const CLAUDE_TURN_FAILED_BODY: &str = "Turn failed";
const CLAUDE_STOP_HOOK_EVENT: &str = "Stop";
const CLAUDE_STOP_FAILURE_HOOK_EVENT: &str = "StopFailure";
const CLAUDE_NOTIFICATION_HOOK_EVENT: &str = "Notification";
const CLAUDE_SESSION_END_HOOK_EVENT: &str = "SessionEnd";
const CLAUDE_SESSION_START_HOOK_EVENT: &str = "SessionStart";
const CLAUDE_HOOK_COMMAND: &str = "panes claude-hook";
const NOTIFICATION_DEFAULT_TITLE: &str = "Panes";
const NOTIFICATION_DEFAULT_BODY: &str = "Notification";
const NOTIFICATION_EVENT_PREFIX: &str = "terminal-notification-";
const NOTIFICATION_CLEARED_EVENT_PREFIX: &str = "terminal-notification-cleared-";
const MAX_TITLE_CHARS: usize = 80;
const MAX_BODY_CHARS: usize = 240;
const CLAUDE_PASSTHROUGH_SUBCOMMANDS: &[&str] = &[
    "agents",
    "auth",
    "auto-mode",
    "doctor",
    "install",
    "mcp",
    "plugin",
    "plugins",
    "setup-token",
    "update",
    "upgrade",
];

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
}

#[derive(Debug, Clone, Default)]
struct NotificationFocusState {
    window_focused: bool,
    workspace_id: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TerminalNotificationSessionEnv {
    pub ingress_addr: String,
    pub ingress_token: String,
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalNotificationIntegrationKind {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalNotificationIntegrationStatusDto {
    pub configured: bool,
    pub config_path: Option<String>,
    pub config_exists: bool,
    pub conflict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentNotificationSettingsStatusDto {
    pub chat_enabled: bool,
    pub terminal_enabled: bool,
    pub terminal_setup_complete: bool,
    pub notification_sound: Option<String>,
    pub claude: TerminalNotificationIntegrationStatusDto,
    pub codex: TerminalNotificationIntegrationStatusDto,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationIngressRequest {
    token: String,
    workspace_id: String,
    session_id: String,
    #[serde(default)]
    kind: NotificationIngressRequestKind,
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

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum NotificationIngressRequestKind {
    #[default]
    Notify,
    Clear,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct NotifyCliArgs {
    title: Option<String>,
    body: Option<String>,
    workspace_id: Option<String>,
    session_id: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ClearNotificationCliArgs {
    workspace_id: Option<String>,
    session_id: Option<String>,
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

#[derive(Debug, Deserialize)]
struct ClaudeHookPayload {
    hook_event_name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    notification_type: Option<String>,
    #[serde(default)]
    last_assistant_message: Option<String>,
    #[serde(default)]
    stop_hook_active: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_details: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum ClaudeHookAction {
    Notify {
        title: String,
        body: String,
        source: String,
    },
    Clear,
}

impl TerminalNotificationManager {
    pub async fn start(self: &Arc<Self>, app: AppHandle) -> anyhow::Result<()> {
        if self.runtime.read().await.is_some() {
            return Ok(());
        }

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

    pub async fn publish_for_session(
        &self,
        app: &AppHandle,
        workspace_id: &str,
        session_id: &str,
        title: String,
        body: String,
        source: String,
    ) -> anyhow::Result<Option<TerminalNotificationDto>> {
        self.publish_request(
            app,
            NotificationIngressRequest {
                token: String::new(),
                workspace_id: workspace_id.to_string(),
                session_id: session_id.to_string(),
                kind: NotificationIngressRequestKind::Notify,
                title: Some(title),
                body: Some(body),
                source: Some(source),
            },
        )
        .await
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
        if request.kind == NotificationIngressRequestKind::Clear {
            self.clear_for_session(app, &workspace_id, &session_id)
                .await;
            return Ok(None);
        }

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

        if !terminal_notifications_enabled() {
            self.clear_for_session(app, &workspace_id, &session_id)
                .await;
            return Ok(None);
        }

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

        log::info!(
            "terminal notification published workspace={} session={} source={} title={}",
            notification.workspace_id,
            notification.session_id,
            notification.source,
            notification.title
        );
        if let Err(error) =
            show_desktop_notification_content(app, &notification.title, &notification.body)
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

pub fn parse_terminal_notification_integration_kind(
    raw: &str,
) -> anyhow::Result<TerminalNotificationIntegrationKind> {
    match raw.trim() {
        "claude" => Ok(TerminalNotificationIntegrationKind::Claude),
        "codex" => Ok(TerminalNotificationIntegrationKind::Codex),
        other => anyhow::bail!("unknown terminal notification integration: {other}"),
    }
}

pub fn agent_notification_settings_status() -> anyhow::Result<AgentNotificationSettingsStatusDto> {
    let config = crate::config::app_config::AppConfig::load_or_create()
        .context("failed to load Panes config")?;
    let claude = inspect_claude_notification_integration();
    let codex = inspect_codex_notification_integration();
    Ok(AgentNotificationSettingsStatusDto {
        chat_enabled: config.chat_notifications_enabled(),
        terminal_enabled: config.terminal_notifications_enabled(),
        terminal_setup_complete: claude.configured || codex.configured,
        notification_sound: config.notification_sound().map(|s| s.to_string()),
        claude,
        codex,
    })
}

pub fn install_terminal_notification_integration(
    integration: TerminalNotificationIntegrationKind,
) -> anyhow::Result<AgentNotificationSettingsStatusDto> {
    match integration {
        TerminalNotificationIntegrationKind::Claude => install_claude_notification_integration()?,
        TerminalNotificationIntegrationKind::Codex => install_codex_notification_integration()?,
    }
    agent_notification_settings_status()
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
        CLEAR_NOTIFICATION_SUBCOMMAND => {
            let Some(cli_args) = parse_clear_notification_cli_args(args.collect())? else {
                return Ok(true);
            };
            let (addr, request) = build_clear_request_from_cli(cli_args)?;
            send_notify_request(&addr, &request)?;
            Ok(true)
        }
        CODEX_NOTIFY_SUBCOMMAND => {
            let Some(payload_json) = parse_codex_notify_args(args.collect())? else {
                return Ok(true);
            };
            if !panes_notification_env_available() {
                return Ok(true);
            }
            let Some((addr, request)) = build_notify_request_from_codex_payload(&payload_json)?
            else {
                return Ok(true);
            };
            send_notify_request(&addr, &request)?;
            Ok(true)
        }
        CODEX_WRAPPER_SUBCOMMAND => {
            run_codex_wrapper(args.collect())?;
            Ok(true)
        }
        CLAUDE_HOOK_SUBCOMMAND => {
            handle_claude_hook(args.collect())?;
            Ok(true)
        }
        CLAUDE_WRAPPER_SUBCOMMAND => {
            run_claude_wrapper(args.collect())?;
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

fn parse_clear_notification_cli_args(
    args: Vec<String>,
) -> anyhow::Result<Option<ClearNotificationCliArgs>> {
    let mut parsed = ClearNotificationCliArgs::default();
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
                print_clear_notification_help();
                return Ok(None);
            }
            "--workspace-id" => parsed.workspace_id = value,
            "--session-id" => parsed.session_id = value,
            other => anyhow::bail!("unknown panes clear-notification argument: {other}"),
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

fn build_clear_request_from_cli(
    args: ClearNotificationCliArgs,
) -> anyhow::Result<(SocketAddr, NotificationIngressRequest)> {
    build_clear_request(args.workspace_id, args.session_id)
}

fn build_notify_request(
    workspace_id: Option<String>,
    session_id: Option<String>,
    title: Option<String>,
    body: Option<String>,
    source: Option<String>,
) -> anyhow::Result<(SocketAddr, NotificationIngressRequest)> {
    let ingress = build_ingress_target(workspace_id, session_id)?;
    Ok((
        ingress.addr,
        NotificationIngressRequest {
            token: ingress.token,
            workspace_id: ingress.workspace_id,
            session_id: ingress.session_id,
            kind: NotificationIngressRequestKind::Notify,
            title,
            body,
            source,
        },
    ))
}

fn build_clear_request(
    workspace_id: Option<String>,
    session_id: Option<String>,
) -> anyhow::Result<(SocketAddr, NotificationIngressRequest)> {
    let ingress = build_ingress_target(workspace_id, session_id)?;
    Ok((
        ingress.addr,
        NotificationIngressRequest {
            token: ingress.token,
            workspace_id: ingress.workspace_id,
            session_id: ingress.session_id,
            kind: NotificationIngressRequestKind::Clear,
            title: None,
            body: None,
            source: None,
        },
    ))
}

#[derive(Debug)]
struct NotificationIngressTarget {
    addr: SocketAddr,
    token: String,
    workspace_id: String,
    session_id: String,
}

fn build_ingress_target(
    workspace_id: Option<String>,
    session_id: Option<String>,
) -> anyhow::Result<NotificationIngressTarget> {
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
    Ok(NotificationIngressTarget {
        addr: parsed_addr,
        token,
        workspace_id,
        session_id,
    })
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

fn handle_claude_hook(args: Vec<String>) -> anyhow::Result<()> {
    if matches!(args.as_slice(), [flag] if matches!(flag.as_str(), "--help" | "-h")) {
        print_claude_hook_help();
        return Ok(());
    }
    if !args.is_empty() {
        anyhow::bail!("panes claude-hook does not accept arguments");
    }
    if !panes_notification_env_available() {
        return Ok(());
    }

    let mut payload = String::new();
    std::io::stdin()
        .read_to_string(&mut payload)
        .context("failed to read Claude hook payload from stdin")?;
    if payload.trim().is_empty() {
        return Ok(());
    }

    let Some(action) = claude_hook_action_from_payload(&payload)? else {
        return Ok(());
    };

    let (addr, request) = match action {
        ClaudeHookAction::Notify {
            title,
            body,
            source,
        } => build_notify_request(None, None, Some(title), Some(body), Some(source))?,
        ClaudeHookAction::Clear => build_clear_request(None, None)?,
    };
    send_notify_request(&addr, &request)
}

fn run_claude_wrapper(args: Vec<String>) -> anyhow::Result<()> {
    let shim_dir = runtime_env::app_data_dir().join("bin");
    let claude_binary = resolve_wrapped_binary("claude", &shim_dir)?;
    let forwarded_args = build_claude_forwarded_args(args)?;
    let status = Command::new(&claude_binary)
        .args(&forwarded_args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to launch Claude at {}", claude_binary.display()))?;
    std::process::exit(exit_code_from_status(status));
}

fn run_codex_wrapper(args: Vec<String>) -> anyhow::Result<()> {
    let shim_dir = runtime_env::app_data_dir().join("bin");
    let codex_binary = resolve_wrapped_binary("codex", &shim_dir)?;
    let forwarded_args = build_codex_forwarded_args(args)?;
    let status = Command::new(&codex_binary)
        .args(&forwarded_args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to launch Codex at {}", codex_binary.display()))?;
    std::process::exit(exit_code_from_status(status));
}

fn build_codex_forwarded_args(args: Vec<String>) -> anyhow::Result<Vec<String>> {
    if current_panes_session_id_if_available().is_none() {
        return Ok(args);
    }
    build_codex_forwarded_args_with_notify(args)
}

fn build_codex_forwarded_args_with_notify(args: Vec<String>) -> anyhow::Result<Vec<String>> {
    if should_passthrough_codex_invocation(&args) || has_notify_config_override(&args) {
        return Ok(args);
    }
    let mut forwarded = vec!["-c".to_string(), CODEX_NOTIFY_CONFIG_OVERRIDE.to_string()];
    forwarded.extend(args);
    Ok(forwarded)
}

fn build_claude_forwarded_args(args: Vec<String>) -> anyhow::Result<Vec<String>> {
    let Some(session_id) = current_panes_session_id_if_available() else {
        return Ok(args);
    };
    build_claude_forwarded_args_with_session(args, &session_id)
}

fn build_claude_forwarded_args_with_session(
    args: Vec<String>,
    session_id: &str,
) -> anyhow::Result<Vec<String>> {
    if should_passthrough_claude_invocation(&args) {
        return Ok(args);
    }
    let mut forwarded = args;
    let has_bare = forwarded.iter().any(|arg| matches!(arg.as_str(), "--bare"));
    let has_session_id = has_cli_option(&forwarded, "--session-id");
    let explicit_settings = if has_bare {
        None
    } else {
        take_cli_option_value(&mut forwarded, "--settings")?
    };

    let mut injected = Vec::new();
    if !has_bare {
        injected.push("--settings".to_string());
        injected.push(merge_claude_settings(explicit_settings.as_deref())?);
    }
    if !has_session_id {
        injected.push("--session-id".to_string());
        injected.push(session_id.to_string());
    }
    if injected.is_empty() {
        return Ok(forwarded);
    }

    injected.extend(forwarded);
    Ok(injected)
}

fn current_panes_session_id_if_available() -> Option<String> {
    panes_notification_env_available()
        .then(|| read_non_empty_env(PANES_SESSION_ID_ENV))
        .flatten()
}

fn should_passthrough_claude_invocation(args: &[String]) -> bool {
    args.iter()
        .any(|arg| matches!(arg.as_str(), "-h" | "--help" | "-v" | "--version"))
        || first_claude_positional(args)
            .map(|value| CLAUDE_PASSTHROUGH_SUBCOMMANDS.contains(&value))
            .unwrap_or(false)
}

fn should_passthrough_codex_invocation(args: &[String]) -> bool {
    args.iter()
        .any(|arg| matches!(arg.as_str(), "-h" | "--help" | "-V" | "--version"))
}

fn first_claude_positional(args: &[String]) -> Option<&str> {
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--" {
            return args.get(index + 1).map(String::as_str);
        }
        if !arg.starts_with('-') || arg == "-" {
            return Some(arg);
        }

        let consumes_value = matches!(
            arg.split('=').next().unwrap_or(arg),
            "--agent"
                | "--agents"
                | "--append-system-prompt"
                | "-d"
                | "--debug"
                | "--debug-file"
                | "--effort"
                | "--fallback-model"
                | "--from-pr"
                | "--input-format"
                | "--json-schema"
                | "--max-budget-usd"
                | "--model"
                | "-n"
                | "--name"
                | "--output-format"
                | "--permission-mode"
                | "-r"
                | "--resume"
                | "--session-id"
                | "--setting-sources"
                | "--settings"
                | "--system-prompt"
                | "-w"
                | "--worktree"
        ) && !arg.contains('=');
        index += if consumes_value { 2 } else { 1 };
    }
    None
}

fn has_cli_option(args: &[String], option: &str) -> bool {
    let inline = format!("{option}=");
    args.iter()
        .any(|arg| arg == option || arg.starts_with(&inline))
}

fn has_notify_config_override(args: &[String]) -> bool {
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        if matches!(arg, "-c" | "--config") {
            if let Some(value) = args.get(index + 1) {
                if config_override_targets_notify(value) {
                    return true;
                }
            }
            index += 2;
            continue;
        }

        if let Some(value) = arg.strip_prefix("--config=") {
            if config_override_targets_notify(value) {
                return true;
            }
        }
        index += 1;
    }
    false
}

fn config_override_targets_notify(value: &str) -> bool {
    value
        .split_once('=')
        .map(|(key, _)| key.trim() == "notify")
        .unwrap_or(false)
}

fn take_cli_option_value(args: &mut Vec<String>, option: &str) -> anyhow::Result<Option<String>> {
    let inline_prefix = format!("{option}=");
    let mut value = None;
    let mut index = 0;
    while index < args.len() {
        if args[index] == option {
            let next = args
                .get(index + 1)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing value for {option}"))?;
            args.drain(index..=index + 1);
            value = Some(next);
            continue;
        }
        if let Some(inline_value) = args[index].strip_prefix(&inline_prefix) {
            value = Some(inline_value.to_string());
            args.remove(index);
            continue;
        }
        index += 1;
    }

    Ok(value)
}

fn merge_claude_settings(existing: Option<&str>) -> anyhow::Result<String> {
    let merged = merge_claude_settings_value(existing, CLAUDE_HOOK_COMMAND)?;
    serde_json::to_string(&merged).context("failed to serialize merged Claude settings")
}

fn merge_claude_settings_value(existing: Option<&str>, command: &str) -> anyhow::Result<Value> {
    let mut merged = match existing {
        Some(value) => parse_claude_settings_value(value)?,
        None => json!({}),
    };
    merge_json_values(&mut merged, claude_hook_settings_for_command(command));
    Ok(merged)
}

fn parse_claude_settings_value(raw: &str) -> anyhow::Result<Value> {
    let trimmed = raw.trim();
    let json_text = if trimmed.starts_with('{') {
        trimmed.to_string()
    } else {
        std::fs::read_to_string(trimmed)
            .with_context(|| format!("failed to read Claude settings file at {trimmed}"))?
    };
    let parsed: Value =
        serde_json::from_str(&json_text).context("failed to parse Claude settings JSON")?;
    if !parsed.is_object() {
        anyhow::bail!("Claude settings must be a JSON object");
    }
    Ok(parsed)
}

fn merge_json_values(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            for (key, overlay_value) in overlay_map {
                match base_map.get_mut(&key) {
                    Some(base_value) => merge_json_values(base_value, overlay_value),
                    None => {
                        base_map.insert(key, overlay_value);
                    }
                }
            }
        }
        (Value::Array(base_items), Value::Array(overlay_items)) => {
            for item in overlay_items {
                if !base_items.contains(&item) {
                    base_items.push(item);
                }
            }
        }
        (base_slot, overlay_value) => *base_slot = overlay_value,
    }
}

fn claude_hook_settings_for_command(command: &str) -> Value {
    let hook_group = json!({
        "matcher": ".*",
        "hooks": [
            {
                "type": "command",
                "command": command,
                "timeout": 10
            }
        ]
    });
    json!({
        "hooks": {
            CLAUDE_NOTIFICATION_HOOK_EVENT: [hook_group.clone()],
            CLAUDE_STOP_HOOK_EVENT: [hook_group.clone()],
            CLAUDE_STOP_FAILURE_HOOK_EVENT: [hook_group.clone()],
            CLAUDE_SESSION_START_HOOK_EVENT: [hook_group.clone()],
            CLAUDE_SESSION_END_HOOK_EVENT: [hook_group],
        }
    })
}

fn inspect_claude_notification_integration() -> TerminalNotificationIntegrationStatusDto {
    let settings_path = match claude_settings_path() {
        Ok(path) => path,
        Err(error) => {
            return TerminalNotificationIntegrationStatusDto {
                configured: false,
                config_path: None,
                config_exists: false,
                conflict: false,
                detail: Some(error.to_string()),
            };
        }
    };
    let config_exists = settings_path.exists();
    let config_path = Some(settings_path.to_string_lossy().to_string());
    if !config_exists {
        return TerminalNotificationIntegrationStatusDto {
            configured: false,
            config_path,
            config_exists: false,
            conflict: false,
            detail: None,
        };
    }

    match std::fs::read_to_string(&settings_path)
        .with_context(|| format!("failed to read {}", settings_path.display()))
        .and_then(|raw| parse_claude_settings_value(&raw))
    {
        Ok(settings) => TerminalNotificationIntegrationStatusDto {
            configured: claude_settings_contains_managed_hook(&settings),
            config_path,
            config_exists: true,
            conflict: false,
            detail: None,
        },
        Err(error) => TerminalNotificationIntegrationStatusDto {
            configured: false,
            config_path,
            config_exists: true,
            conflict: false,
            detail: Some(error.to_string()),
        },
    }
}

fn inspect_codex_notification_integration() -> TerminalNotificationIntegrationStatusDto {
    let config_path = match codex_config_path() {
        Ok(path) => path,
        Err(error) => {
            return TerminalNotificationIntegrationStatusDto {
                configured: false,
                config_path: None,
                config_exists: false,
                conflict: false,
                detail: Some(error.to_string()),
            };
        }
    };
    let config_exists = config_path.exists();
    let serialized_path = Some(config_path.to_string_lossy().to_string());
    if !config_exists {
        return TerminalNotificationIntegrationStatusDto {
            configured: false,
            config_path: serialized_path,
            config_exists: false,
            conflict: false,
            detail: None,
        };
    }

    match std::fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))
        .and_then(|raw| {
            raw.parse::<toml::Value>()
                .context("failed to parse Codex config TOML")
        }) {
        Ok(doc) => match codex_notify_setting_status(&doc) {
            CodexNotifySettingStatus::Configured => TerminalNotificationIntegrationStatusDto {
                configured: true,
                config_path: serialized_path,
                config_exists: true,
                conflict: false,
                detail: None,
            },
            CodexNotifySettingStatus::Conflict => TerminalNotificationIntegrationStatusDto {
                configured: false,
                config_path: serialized_path,
                config_exists: true,
                conflict: true,
                detail: Some(
                    "Codex already has a different notify command configured.".to_string(),
                ),
            },
            CodexNotifySettingStatus::Missing => TerminalNotificationIntegrationStatusDto {
                configured: false,
                config_path: serialized_path,
                config_exists: true,
                conflict: false,
                detail: None,
            },
        },
        Err(error) => TerminalNotificationIntegrationStatusDto {
            configured: false,
            config_path: serialized_path,
            config_exists: true,
            conflict: false,
            detail: Some(error.to_string()),
        },
    }
}

fn install_claude_notification_integration() -> anyhow::Result<()> {
    let settings_path = claude_settings_path()?;
    let existing = std::fs::read_to_string(&settings_path).ok();
    let hook_command = claude_hook_command_for_config()?;
    let merged = merge_claude_settings_value(existing.as_deref(), &hook_command)?;
    let rendered =
        serde_json::to_string_pretty(&merged).context("failed to serialize Claude settings")?;
    write_text_file(&settings_path, &rendered)
}

fn install_codex_notification_integration() -> anyhow::Result<()> {
    let config_path = codex_config_path()?;
    let mut doc = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .with_context(|| format!("failed to read {}", config_path.display()))?
            .parse::<toml::Value>()
            .context("failed to parse Codex config TOML")?
    } else {
        toml::Value::Table(toml::map::Map::new())
    };
    let Some(table) = doc.as_table_mut() else {
        anyhow::bail!("Codex config root must be a TOML table");
    };
    let notify_value = codex_notify_config_value()?;
    table.insert("notify".to_string(), notify_value);
    let rendered = toml::to_string_pretty(&doc).context("failed to serialize Codex config")?;
    write_text_file(&config_path, &rendered)
}

fn claude_settings_contains_managed_hook(settings: &Value) -> bool {
    settings
        .get("hooks")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|events| events.values())
        .filter_map(Value::as_array)
        .flat_map(|groups| groups.iter())
        .filter_map(|group| group.get("hooks").and_then(Value::as_array))
        .flat_map(|hooks| hooks.iter())
        .filter_map(|hook| hook.get("command").and_then(Value::as_str))
        .any(is_managed_claude_hook_command)
}

fn is_managed_claude_hook_command(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed == CLAUDE_HOOK_COMMAND {
        return true;
    }
    trimmed.contains(CLAUDE_HOOK_SUBCOMMAND) && trimmed.contains(&managed_panes_cli_path_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexNotifySettingStatus {
    Missing,
    Configured,
    Conflict,
}

fn codex_notify_setting_status(doc: &toml::Value) -> CodexNotifySettingStatus {
    let Some(table) = doc.as_table() else {
        return CodexNotifySettingStatus::Conflict;
    };
    let Some(notify_value) = table.get("notify") else {
        return CodexNotifySettingStatus::Missing;
    };
    if is_managed_codex_notify_value(notify_value) {
        CodexNotifySettingStatus::Configured
    } else {
        CodexNotifySettingStatus::Conflict
    }
}

fn is_managed_codex_notify_value(value: &toml::Value) -> bool {
    let Some(items) = value.as_array() else {
        return false;
    };
    if items.len() < 2 {
        return false;
    }
    let Some(command) = items.first().and_then(toml::Value::as_str) else {
        return false;
    };
    let Some(subcommand) = items.get(1).and_then(toml::Value::as_str) else {
        return false;
    };
    subcommand == CODEX_NOTIFY_SUBCOMMAND
        && (command == "panes" || command == managed_panes_cli_path_string())
}

fn claude_settings_path() -> anyhow::Result<PathBuf> {
    let home = runtime_env::home_dir()
        .ok_or_else(|| anyhow::anyhow!("home directory is not available"))?;
    Ok(home.join(".claude").join("settings.json"))
}

fn codex_config_path() -> anyhow::Result<PathBuf> {
    let home = runtime_env::home_dir()
        .ok_or_else(|| anyhow::anyhow!("home directory is not available"))?;
    Ok(home.join(".codex").join("config.toml"))
}

fn managed_panes_cli_path() -> anyhow::Result<PathBuf> {
    Ok(install_cli_shims()?.join(panes_cli_shim_name()))
}

fn managed_panes_cli_path_string() -> String {
    runtime_env::app_data_dir()
        .join("bin")
        .join(panes_cli_shim_name())
        .to_string_lossy()
        .to_string()
}

fn claude_hook_command_for_config() -> anyhow::Result<String> {
    let panes_cli_path = managed_panes_cli_path()?;
    let path = panes_cli_path.to_string_lossy();
    #[cfg(windows)]
    {
        return Ok(format!(r#""{}" {}"#, path, CLAUDE_HOOK_SUBCOMMAND));
    }

    #[cfg(not(windows))]
    {
        Ok(format!(
            "{} {}",
            shell_single_quote_escape(&path),
            CLAUDE_HOOK_SUBCOMMAND
        ))
    }
}

fn codex_notify_config_value() -> anyhow::Result<toml::Value> {
    let panes_cli_path = managed_panes_cli_path()?;
    Ok(toml::Value::Array(vec![
        toml::Value::String(panes_cli_path.to_string_lossy().to_string()),
        toml::Value::String(CODEX_NOTIFY_SUBCOMMAND.to_string()),
    ]))
}

fn write_text_file(path: &Path, contents: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    std::fs::write(path, contents).with_context(|| format!("failed to write {}", path.display()))
}

fn claude_hook_action_from_payload(raw_payload: &str) -> anyhow::Result<Option<ClaudeHookAction>> {
    let payload: ClaudeHookPayload =
        serde_json::from_str(raw_payload).context("failed to parse Claude hook payload")?;

    let action = match payload.hook_event_name.as_str() {
        CLAUDE_NOTIFICATION_HOOK_EVENT => {
            let title = payload
                .title
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| CLAUDE_NOTIFICATION_TITLE.to_string());
            let body = payload
                .message
                .filter(|value| !value.trim().is_empty())
                .or_else(|| payload.notification_type.map(humanize_notification_kind))
                .unwrap_or_else(|| NOTIFICATION_DEFAULT_BODY.to_string());
            Some(ClaudeHookAction::Notify {
                title,
                body,
                source: "claude".to_string(),
            })
        }
        CLAUDE_STOP_HOOK_EVENT => {
            if payload.stop_hook_active {
                None
            } else {
                Some(ClaudeHookAction::Notify {
                    title: CLAUDE_NOTIFICATION_TITLE.to_string(),
                    body: payload
                        .last_assistant_message
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| CLAUDE_TURN_COMPLETE_BODY.to_string()),
                    source: "claude".to_string(),
                })
            }
        }
        CLAUDE_STOP_FAILURE_HOOK_EVENT => Some(ClaudeHookAction::Notify {
            title: CLAUDE_NOTIFICATION_ERROR_TITLE.to_string(),
            body: payload
                .last_assistant_message
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    payload
                        .error_details
                        .filter(|value| !value.trim().is_empty())
                })
                .or_else(|| payload.error.filter(|value| !value.trim().is_empty()))
                .unwrap_or_else(|| CLAUDE_TURN_FAILED_BODY.to_string()),
            source: "claude".to_string(),
        }),
        CLAUDE_SESSION_START_HOOK_EVENT | CLAUDE_SESSION_END_HOOK_EVENT => {
            Some(ClaudeHookAction::Clear)
        }
        _ => None,
    };
    Ok(action)
}

fn humanize_notification_kind(kind: String) -> String {
    let cleaned = kind.trim();
    if cleaned.is_empty() {
        return NOTIFICATION_DEFAULT_BODY.to_string();
    }
    let out = cleaned.replace('_', " ");
    if out.trim().is_empty() {
        CLAUDE_NOTIFICATION_KIND_DEFAULT.to_string()
    } else {
        out
    }
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

fn install_cli_shims() -> anyhow::Result<PathBuf> {
    let bin_dir = runtime_env::app_data_dir().join("bin");
    std::fs::create_dir_all(&bin_dir).with_context(|| {
        format!(
            "failed to create panes shim directory at {}",
            bin_dir.display()
        )
    })?;

    let current_exe =
        std::env::current_exe().context("failed to resolve current Panes executable")?;
    write_cli_shim(
        &bin_dir.join(panes_cli_shim_name()),
        &panes_cli_shim_contents(&current_exe),
        "panes",
    )?;
    write_cli_shim(
        &bin_dir.join(claude_cli_shim_name()),
        &claude_cli_shim_contents(&current_exe),
        "claude",
    )?;
    write_cli_shim(
        &bin_dir.join(codex_cli_shim_name()),
        &codex_cli_shim_contents(&current_exe),
        "codex",
    )?;

    Ok(bin_dir)
}

fn write_cli_shim(shim_path: &Path, contents: &str, label: &str) -> anyhow::Result<()> {
    let should_write = std::fs::read_to_string(shim_path)
        .map(|existing| existing != contents)
        .unwrap_or(true);
    if should_write {
        std::fs::write(&shim_path, contents.as_bytes())
            .with_context(|| format!("failed to write {label} shim at {}", shim_path.display()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let permissions = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&shim_path, permissions).with_context(|| {
            format!(
                "failed to mark {label} shim executable at {}",
                shim_path.display()
            )
        })?;
    }

    Ok(())
}

#[cfg(windows)]
fn panes_cli_shim_name() -> &'static str {
    "panes.cmd"
}

#[cfg(not(windows))]
fn panes_cli_shim_name() -> &'static str {
    "panes"
}

#[cfg(windows)]
fn claude_cli_shim_name() -> &'static str {
    "claude.cmd"
}

#[cfg(not(windows))]
fn claude_cli_shim_name() -> &'static str {
    "claude"
}

#[cfg(windows)]
fn codex_cli_shim_name() -> &'static str {
    "codex.cmd"
}

#[cfg(not(windows))]
fn codex_cli_shim_name() -> &'static str {
    "codex"
}

#[cfg(windows)]
fn panes_cli_shim_contents(current_exe: &Path) -> String {
    format!("@echo off\r\n\"{}\" %*\r\n", current_exe.to_string_lossy())
}

#[cfg(not(windows))]
fn panes_cli_shim_contents(current_exe: &Path) -> String {
    format!(
        "#!/bin/sh\nexec {} \"$@\"\n",
        shell_single_quote_escape(&current_exe.to_string_lossy())
    )
}

#[cfg(windows)]
fn claude_cli_shim_contents(current_exe: &Path) -> String {
    format!(
        "@echo off\r\n\"{}\" {} %*\r\n",
        current_exe.to_string_lossy(),
        CLAUDE_WRAPPER_SUBCOMMAND
    )
}

#[cfg(not(windows))]
fn claude_cli_shim_contents(current_exe: &Path) -> String {
    format!(
        "#!/bin/sh\nexec {} {} \"$@\"\n",
        shell_single_quote_escape(&current_exe.to_string_lossy()),
        CLAUDE_WRAPPER_SUBCOMMAND
    )
}

#[cfg(windows)]
fn codex_cli_shim_contents(current_exe: &Path) -> String {
    format!(
        "@echo off\r\n\"{}\" {} %*\r\n",
        current_exe.to_string_lossy(),
        CODEX_WRAPPER_SUBCOMMAND
    )
}

#[cfg(not(windows))]
fn codex_cli_shim_contents(current_exe: &Path) -> String {
    format!(
        "#!/bin/sh\nexec {} {} \"$@\"\n",
        shell_single_quote_escape(&current_exe.to_string_lossy()),
        CODEX_WRAPPER_SUBCOMMAND
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

fn resolved_notification_sound() -> Option<String> {
    let config = crate::config::app_config::AppConfig::load_or_create().ok()?;
    config.notification_sound().map(|s| s.to_string())
}

fn show_desktop_notification_content(
    app: &AppHandle,
    title: &str,
    body: &str,
) -> anyhow::Result<()> {
    let mut desktop_notification = app.notification().builder().title(title).body(body);
    if let Some(sound) = resolved_notification_sound() {
        desktop_notification = desktop_notification.sound(sound);
    }
    desktop_notification.show().map_err(Into::into)
}

pub fn show_agent_desktop_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
) -> anyhow::Result<()> {
    let normalized_title =
        normalize_notification_text(Some(title), NOTIFICATION_DEFAULT_TITLE, MAX_TITLE_CHARS);
    let normalized_body =
        normalize_notification_text(Some(body), NOTIFICATION_DEFAULT_BODY, MAX_BODY_CHARS);
    show_desktop_notification_content(app, &normalized_title, &normalized_body)
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

fn panes_notification_env_available() -> bool {
    read_non_empty_env(PANES_NOTIFY_ADDR_ENV).is_some()
        && read_non_empty_env(PANES_NOTIFY_TOKEN_ENV).is_some()
        && read_non_empty_env(PANES_WORKSPACE_ID_ENV).is_some()
        && read_non_empty_env(PANES_SESSION_ID_ENV).is_some()
}

fn terminal_notifications_enabled() -> bool {
    crate::config::app_config::AppConfig::load_or_create()
        .map(|config| config.terminal_notifications_enabled())
        .unwrap_or(false)
}

fn resolve_wrapped_binary(binary: &str, shim_dir: &Path) -> anyhow::Result<PathBuf> {
    let path_var = std::env::var_os("PATH").ok_or_else(|| anyhow::anyhow!("PATH is not set"))?;
    let mut entries = std::env::split_paths(&path_var).collect::<Vec<_>>();
    entries.retain(|entry| !paths_match(entry, shim_dir));
    let filtered = std::env::join_paths(entries).context("failed to rebuild PATH without shims")?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    which::which_in(binary, Some(filtered), cwd)
        .with_context(|| format!("failed to find the real {binary} binary outside Panes shims"))
}

fn paths_match(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize().ok(), right.canonicalize().ok()) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn exit_code_from_status(status: std::process::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        return status.signal().map(|signal| 128 + signal).unwrap_or(1);
    }

    #[cfg(not(unix))]
    {
        1
    }
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

fn print_clear_notification_help() {
    println!("Usage: panes clear-notification [--workspace-id ID] [--session-id ID]");
}

fn print_codex_notify_help() {
    println!("Usage: panes codex-notify '<codex notify JSON payload>'");
}

fn print_claude_hook_help() {
    println!("Usage: panes claude-hook");
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use uuid::Uuid;

    const APP_DATA_ENV_VARS: [&str; 4] = ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];

    fn with_temp_app_data_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("env lock poisoned");
        let previous: Vec<(&str, Option<std::ffi::OsString>)> = APP_DATA_ENV_VARS
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        let root =
            std::env::temp_dir().join(format!("panes-terminal-notify-home-{}", Uuid::new_v4()));
        let local_app_data = root.join("AppData").join("Local");
        let roaming_app_data = root.join("AppData").join("Roaming");
        fs::create_dir_all(&local_app_data).expect("temp local app data should exist");
        fs::create_dir_all(&roaming_app_data).expect("temp roaming app data should exist");
        std::env::set_var("HOME", &root);
        std::env::set_var("USERPROFILE", &root);
        std::env::set_var("LOCALAPPDATA", &local_app_data);
        std::env::set_var("APPDATA", &roaming_app_data);
        let result = f();
        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let _ = fs::remove_dir_all(&root);
        result
    }

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
    fn parse_clear_notification_cli_args_reads_supported_flags() {
        let parsed = parse_clear_notification_cli_args(vec![
            "--workspace-id".to_string(),
            "ws-1".to_string(),
            "--session-id".to_string(),
            "term-1".to_string(),
        ])
        .expect("clear args should parse");

        assert_eq!(
            parsed,
            Some(ClearNotificationCliArgs {
                workspace_id: Some("ws-1".to_string()),
                session_id: Some("term-1".to_string()),
            })
        );
    }

    #[test]
    fn parse_clear_notification_cli_args_returns_none_for_help() {
        let parsed = parse_clear_notification_cli_args(vec!["--help".to_string()])
            .expect("clear help args should parse");

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
    fn build_claude_forwarded_args_injects_settings_and_session_id() {
        let forwarded = build_claude_forwarded_args_with_session(
            vec!["review this diff".to_string()],
            "session-1",
        )
        .unwrap();

        assert_eq!(forwarded[0], "--settings");
        let settings: Value =
            serde_json::from_str(&forwarded[1]).expect("settings should be valid JSON");
        assert_eq!(
            settings["hooks"][CLAUDE_STOP_HOOK_EVENT]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            settings["hooks"][CLAUDE_STOP_HOOK_EVENT][0]["matcher"],
            Value::String(".*".to_string())
        );
        assert_eq!(
            settings["hooks"][CLAUDE_STOP_HOOK_EVENT][0]["hooks"][0]["timeout"],
            Value::Number(10.into())
        );
        assert_eq!(forwarded[2], "--session-id");
        assert_eq!(forwarded[3], "session-1");
        assert_eq!(forwarded[4], "review this diff");
    }

    #[test]
    fn build_codex_forwarded_args_injects_notify_override() {
        let forwarded =
            build_codex_forwarded_args_with_notify(vec!["fix this".to_string()]).unwrap();

        assert_eq!(
            forwarded,
            vec![
                "-c".to_string(),
                CODEX_NOTIFY_CONFIG_OVERRIDE.to_string(),
                "fix this".to_string(),
            ]
        );
    }

    #[test]
    fn build_codex_forwarded_args_respects_existing_notify_override() {
        let forwarded = build_codex_forwarded_args_with_notify(vec![
            "--config".to_string(),
            r#"notify=["custom","notify"]"#.to_string(),
            "fix this".to_string(),
        ])
        .unwrap();

        assert_eq!(
            forwarded,
            vec![
                "--config".to_string(),
                r#"notify=["custom","notify"]"#.to_string(),
                "fix this".to_string(),
            ]
        );
    }

    #[test]
    fn build_codex_forwarded_args_passthroughs_help() {
        let forwarded = build_codex_forwarded_args_with_notify(vec!["--help".to_string()]).unwrap();

        assert_eq!(forwarded, vec!["--help".to_string()]);
    }

    #[test]
    fn build_claude_forwarded_args_merges_existing_settings() {
        let existing = json!({
            "hooks": {
                "Stop": [
                    {
                        "hooks": [
                            {
                                "type": "command",
                                "command": "echo custom"
                            }
                        ]
                    }
                ]
            }
        })
        .to_string();
        let forwarded = build_claude_forwarded_args_with_session(
            vec![
                "--settings".to_string(),
                existing,
                "review this diff".to_string(),
            ],
            "session-1",
        )
        .unwrap();
        let settings: Value =
            serde_json::from_str(&forwarded[1]).expect("settings should be valid JSON");
        assert_eq!(
            settings["hooks"][CLAUDE_STOP_HOOK_EVENT]
                .as_array()
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn build_claude_forwarded_args_respects_bare_mode() {
        let forwarded =
            build_claude_forwarded_args_with_session(vec!["--bare".to_string()], "session-1")
                .unwrap();

        assert_eq!(
            forwarded,
            vec![
                "--session-id".to_string(),
                "session-1".to_string(),
                "--bare".to_string(),
            ]
        );
    }

    #[test]
    fn build_claude_forwarded_args_preserves_settings_in_bare_mode() {
        let forwarded = build_claude_forwarded_args_with_session(
            vec![
                "--bare".to_string(),
                "--settings".to_string(),
                r#"{"env":{"FOO":"bar"}}"#.to_string(),
            ],
            "session-1",
        )
        .unwrap();

        assert_eq!(
            forwarded,
            vec![
                "--session-id".to_string(),
                "session-1".to_string(),
                "--bare".to_string(),
                "--settings".to_string(),
                r#"{"env":{"FOO":"bar"}}"#.to_string(),
            ]
        );
    }

    #[test]
    fn build_claude_forwarded_args_passthroughs_subcommands() {
        let forwarded = build_claude_forwarded_args_with_session(
            vec!["auth".to_string(), "status".to_string()],
            "session-1",
        )
        .unwrap();

        assert_eq!(forwarded, vec!["auth".to_string(), "status".to_string()]);
    }

    #[test]
    fn build_claude_forwarded_args_passthroughs_help() {
        let forwarded =
            build_claude_forwarded_args_with_session(vec!["--help".to_string()], "session-1")
                .unwrap();

        assert_eq!(forwarded, vec!["--help".to_string()]);
    }

    #[test]
    fn claude_hook_action_from_payload_maps_notification() {
        let action = claude_hook_action_from_payload(
            r#"{"hook_event_name":"Notification","title":"Claude needs you","message":"Approve this command","notification_type":"permission_prompt"}"#,
        )
        .expect("Claude notification payload should parse");

        assert_eq!(
            action,
            Some(ClaudeHookAction::Notify {
                title: "Claude needs you".to_string(),
                body: "Approve this command".to_string(),
                source: "claude".to_string(),
            })
        );
    }

    #[test]
    fn claude_hook_action_from_payload_maps_stop_completion() {
        let action = claude_hook_action_from_payload(
            r#"{"hook_event_name":"Stop","last_assistant_message":"All set","stop_hook_active":false}"#,
        )
        .expect("Claude stop payload should parse");

        assert_eq!(
            action,
            Some(ClaudeHookAction::Notify {
                title: "Claude".to_string(),
                body: "All set".to_string(),
                source: "claude".to_string(),
            })
        );
    }

    #[test]
    fn claude_hook_action_from_payload_ignores_active_stop_hook() {
        let action = claude_hook_action_from_payload(
            r#"{"hook_event_name":"Stop","last_assistant_message":"All set","stop_hook_active":true}"#,
        )
        .expect("Claude stop payload should parse");

        assert_eq!(action, None);
    }

    #[test]
    fn claude_hook_action_from_payload_maps_stop_failure() {
        let action = claude_hook_action_from_payload(
            r#"{"hook_event_name":"StopFailure","error":"rate_limit","last_assistant_message":"API Error: Rate limit reached"}"#,
        )
        .expect("Claude stop failure payload should parse");

        assert_eq!(
            action,
            Some(ClaudeHookAction::Notify {
                title: "Claude Error".to_string(),
                body: "API Error: Rate limit reached".to_string(),
                source: "claude".to_string(),
            })
        );
    }

    #[test]
    fn claude_hook_action_from_payload_clears_on_session_lifecycle() {
        let start = claude_hook_action_from_payload(r#"{"hook_event_name":"SessionStart"}"#)
            .expect("Claude session-start payload should parse");
        let end = claude_hook_action_from_payload(r#"{"hook_event_name":"SessionEnd"}"#)
            .expect("Claude session-end payload should parse");

        assert_eq!(start, Some(ClaudeHookAction::Clear));
        assert_eq!(end, Some(ClaudeHookAction::Clear));
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
        let contents = panes_cli_shim_contents(Path::new("/tmp/Panes' Dev"));
        assert!(contents.contains("'/tmp/Panes'\\'' Dev'"));
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_claude_cli_shim_invokes_wrapper_subcommand() {
        let contents = claude_cli_shim_contents(Path::new("/tmp/Panes' Dev"));
        assert!(contents.contains(CLAUDE_WRAPPER_SUBCOMMAND));
    }

    #[test]
    fn install_claude_notification_integration_merges_existing_hooks() {
        with_temp_app_data_env(|| {
            let settings_path =
                claude_settings_path().expect("Claude settings path should resolve");
            fs::create_dir_all(settings_path.parent().expect("Claude parent should exist"))
                .expect("Claude dir should exist");
            fs::write(
                &settings_path,
                serde_json::to_string_pretty(&json!({
                    "hooks": {
                        "Stop": [
                            {
                                "hooks": [
                                    {
                                        "type": "command",
                                        "command": "echo custom"
                                    }
                                ]
                            }
                        ]
                    }
                }))
                .expect("seed Claude settings should serialize"),
            )
            .expect("seed Claude settings should write");

            let status = install_terminal_notification_integration(
                TerminalNotificationIntegrationKind::Claude,
            )
            .expect("Claude integration should install");

            assert!(status.claude.configured);
            let saved = fs::read_to_string(&settings_path).expect("Claude settings should read");
            let parsed: Value =
                serde_json::from_str(&saved).expect("Claude settings should remain valid JSON");
            let stop_groups = parsed["hooks"][CLAUDE_STOP_HOOK_EVENT]
                .as_array()
                .expect("Stop hooks should be an array");
            assert_eq!(stop_groups.len(), 2);
            assert!(claude_settings_contains_managed_hook(&parsed));
        });
    }

    #[test]
    fn install_codex_notification_integration_writes_absolute_notify_command() {
        with_temp_app_data_env(|| {
            let status = install_terminal_notification_integration(
                TerminalNotificationIntegrationKind::Codex,
            )
            .expect("Codex integration should install");

            assert!(status.codex.configured);
            let config_path = codex_config_path().expect("Codex config path should resolve");
            let saved = fs::read_to_string(&config_path).expect("Codex config should read");
            let parsed: toml::Value = saved.parse().expect("Codex config should parse");
            assert!(is_managed_codex_notify_value(
                parsed
                    .as_table()
                    .and_then(|table| table.get("notify"))
                    .expect("notify should be set")
            ));
        });
    }

    #[test]
    fn codex_notification_status_reports_conflict_for_custom_notify() {
        with_temp_app_data_env(|| {
            let config_path = codex_config_path().expect("Codex config path should resolve");
            fs::create_dir_all(config_path.parent().expect("Codex parent should exist"))
                .expect("Codex dir should exist");
            fs::write(
                &config_path,
                r#"notify = ["custom-notifier", "--flag"]
"#,
            )
            .expect("Codex config should write");

            let status = inspect_codex_notification_integration();
            assert!(!status.configured);
            assert!(status.conflict);
        });
    }
}
