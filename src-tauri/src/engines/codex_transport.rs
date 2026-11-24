use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::Context;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, oneshot, Mutex},
};

use super::instance::EngineInstanceSettings;
use crate::{process_utils, runtime_env};

use super::codex_protocol::{
    notification_payload, parse_incoming, request_payload, response_error_payload,
    response_success_payload, IncomingMessage, RpcResponse,
};
use super::trim_action_output_delta_content;

// This channel is only a live fan-out for active Codex subscribers. Tokio's
// broadcast ring retains every slot until it is overwritten, so keeping a large
// history here can pin already-delivered protocol payloads while Panes is idle.
// A lagged subscriber tears the transport down and fails the turn, so the ring
// must also absorb a burst of streamed deltas without dropping any.
const INCOMING_EVENT_BUFFER_CAPACITY: usize = 256;
const TRANSPORT_ERROR_LINE_MAX_CHARS: usize = 16 * 1024;
const TRANSPORT_ERROR_LINE_TRUNCATED_PREFIX: &str = "... [protocol line truncated; showing tail]\n";
/// Lines of app-server stderr kept so a crash can say why it happened.
const STDERR_TAIL_MAX_LINES: usize = 50;
/// How long the stdout reader waits for stderr to finish after the
/// app-server closes stdout, so the exit error carries its last words.
const STDERR_DRAIN_GRACE: Duration = Duration::from_millis(500);
const APP_SERVER_EXITED_MESSAGE: &str = "codex app-server exited";

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<RpcResponse>>>>;

/// A request that ended without a reply from the app-server: the process
/// exited, its pipes failed, or the reply did not arrive in time. The message
/// is for people and can carry the app-server's stderr tail, so code that
/// classifies reply errors by their text must check `is_transport_failure`
/// first and never read this text.
#[derive(Debug)]
pub struct TransportFailure(String);

impl std::fmt::Display for TransportFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for TransportFailure {}

fn transport_failure(message: impl Into<String>) -> anyhow::Error {
    anyhow::Error::new(TransportFailure(message.into()))
}

/// True when `error`, or anything it wraps, is a `TransportFailure`.
pub fn is_transport_failure(error: &anyhow::Error) -> bool {
    error
        .chain()
        .any(|cause| cause.downcast_ref::<TransportFailure>().is_some())
}
type StderrTail = Arc<std::sync::Mutex<VecDeque<String>>>;

pub struct CodexTransport {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: PendingRequests,
    incoming_tx: broadcast::Sender<IncomingMessage>,
    next_request_id: std::sync::atomic::AtomicU64,
    /// Set once stdout is closed; no response can arrive after that.
    closed: Arc<AtomicBool>,
    stderr_tail: StderrTail,
}

impl Drop for CodexTransport {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.start_kill();
        }
    }
}

impl CodexTransport {
    pub async fn spawn(
        codex_executable: &str,
        instance: &EngineInstanceSettings,
    ) -> anyhow::Result<Self> {
        let mut command = Command::new(codex_executable);
        process_utils::configure_tokio_command(&mut command);
        runtime_env::apply_missing_login_shell_env(&mut command).await;
        if let Some(augmented_path) = codex_augmented_path(codex_executable).await {
            command.env("PATH", augmented_path);
        }
        for (key, value) in instance.process_env("codex") {
            command.env(key, value);
        }

        let mut child = command
            .arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .args(&instance.launch_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| {
                format!("failed to spawn `codex app-server` using `{codex_executable}`")
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("codex app-server stdin not available"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("codex app-server stdout not available"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("codex app-server stderr not available"))?;

        let (incoming_tx, _) = broadcast::channel(INCOMING_EVENT_BUFFER_CAPACITY);
        let pending: PendingRequests = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let stderr_tail: StderrTail = Arc::new(std::sync::Mutex::new(VecDeque::new()));
        let (stderr_done_tx, stderr_done_rx) = oneshot::channel::<()>();

        {
            let pending = pending.clone();
            let incoming_tx = incoming_tx.clone();
            let closed = closed.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();

                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => match parse_incoming(&line) {
                            Ok(IncomingMessage::Response(response)) => {
                                let sender = pending.lock().await.remove(&response.id);
                                if let Some(sender) = sender {
                                    let _ = sender.send(response);
                                }
                            }
                            Ok(other) => {
                                let _ = incoming_tx.send(trim_buffered_incoming_message(other));
                            }
                            Err(error) => {
                                log::warn!("codex stdout parse error: {error}");
                                let _ = incoming_tx.send(IncomingMessage::Notification {
                                    method: "transport/parse_error".to_string(),
                                    params: transport_parse_error_payload(
                                        &error.to_string(),
                                        &line,
                                    ),
                                });
                            }
                        },
                        Ok(None) => {
                            let _ = incoming_tx.send(IncomingMessage::Notification {
                                method: "transport/eof".to_string(),
                                params: serde_json::value::RawValue::from_string("{}".to_string())
                                    .expect("\"{}\" is valid json"),
                            });
                            break;
                        }
                        Err(error) => {
                            log::warn!("codex stdout read error: {error}");
                            let _ = incoming_tx.send(IncomingMessage::Notification {
                                method: "transport/read_error".to_string(),
                                params: serde_json::value::to_raw_value(&serde_json::json!({
                                  "error": error.to_string(),
                                }))
                                .expect("internal error payload is valid json"),
                            });
                            break;
                        }
                    }
                }

                // No response can arrive any more: fail every waiting request
                // now instead of letting each one run into its timeout.
                let _ = tokio::time::timeout(STDERR_DRAIN_GRACE, stderr_done_rx).await;
                closed.store(true, Ordering::SeqCst);
                fail_pending_requests(&pending).await;
            });
        }

        {
            let stderr_tail = stderr_tail.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if !line.trim().is_empty() {
                                log::warn!("codex stderr: {line}");
                                push_stderr_line(&stderr_tail, line);
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            log::debug!("codex stderr read error: {error}");
                            break;
                        }
                    }
                }
                let _ = stderr_done_tx.send(());
            });
        }

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            incoming_tx,
            next_request_id: std::sync::atomic::AtomicU64::new(1),
            closed,
            stderr_tail,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<IncomingMessage> {
        self.incoming_tx.subscribe()
    }

    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> anyhow::Result<serde_json::Value> {
        self.ensure_alive().await?;

        let id = self
            .next_request_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            .to_string();

        let payload = request_payload(&id, method, params);
        let (sender, receiver) = oneshot::channel::<RpcResponse>();
        self.pending.lock().await.insert(id.clone(), sender);
        // The stdout reader sets `closed` before it drains `pending`, so a
        // request registered after that drain is caught here.
        if self.closed.load(Ordering::SeqCst) {
            self.pending.lock().await.remove(&id);
            return Err(transport_failure(app_server_exited_message(
                &self.stderr_tail,
            )));
        }

        if let Err(error) = self.write_payload(&payload).await {
            self.pending.lock().await.remove(&id);
            return Err(transport_failure(format!("{error:#}")));
        }

        let response = match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                // The stdout reader drops every waiting sender once the
                // app-server has exited.
                if self.closed.load(Ordering::SeqCst) {
                    return Err(transport_failure(app_server_exited_message(
                        &self.stderr_tail,
                    )));
                }
                return Err(transport_failure(format!(
                    "codex response channel closed for method `{method}`"
                )));
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(transport_failure(format!(
                    "codex request timeout for method `{method}`"
                )));
            }
        };

        if let Some(error) = response.error {
            anyhow::bail!("{}", error);
        }

        Ok(response.result.unwrap_or(serde_json::Value::Null))
    }

    pub async fn notify(&self, method: &str, params: serde_json::Value) -> anyhow::Result<()> {
        self.ensure_alive().await?;
        self.write_payload(&notification_payload(method, params))
            .await
    }

    pub async fn respond_success(
        &self,
        request_id: &serde_json::Value,
        result: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.ensure_alive().await?;
        self.write_payload(&response_success_payload(request_id, result))
            .await
    }

    pub async fn respond_error(
        &self,
        request_id: &serde_json::Value,
        code: i64,
        message: &str,
        data: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        self.ensure_alive().await?;
        self.write_payload(&response_error_payload(request_id, code, message, data))
            .await
    }

    pub async fn is_alive(&self) -> bool {
        self.ensure_alive().await.is_ok()
    }

    pub async fn shutdown(&self) -> anyhow::Result<()> {
        let mut child = self.child.lock().await;
        if child.try_wait()?.is_none() {
            child.kill().await.ok();
            child.wait().await.ok();
        }
        Ok(())
    }

    async fn write_payload(&self, payload: &serde_json::Value) -> anyhow::Result<()> {
        let serialized = serde_json::to_vec(payload)?;
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&serialized)
            .await
            .context("failed writing payload to codex stdin")?;
        stdin
            .write_all(b"\n")
            .await
            .context("failed writing line terminator to codex stdin")?;
        stdin.flush().await.context("failed flushing codex stdin")?;
        Ok(())
    }

    async fn ensure_alive(&self) -> anyhow::Result<()> {
        let mut child = self.child.lock().await;
        let status = child.try_wait().map_err(|error| {
            transport_failure(format!("failed to query codex process status: {error}"))
        })?;
        if let Some(status) = status {
            return Err(transport_failure(format!(
                "codex app-server exited with status {status}{}",
                stderr_tail_suffix(&self.stderr_tail)
            )));
        }
        Ok(())
    }
}

fn push_stderr_line(tail: &StderrTail, line: String) {
    let mut tail = tail
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if tail.len() == STDERR_TAIL_MAX_LINES {
        tail.pop_front();
    }
    tail.push_back(line);
}

fn stderr_tail_suffix(tail: &StderrTail) -> String {
    let tail = tail
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if tail.is_empty() {
        String::new()
    } else {
        format!(
            "; last stderr output:\n{}",
            tail.iter().cloned().collect::<Vec<_>>().join("\n")
        )
    }
}

fn app_server_exited_message(tail: &StderrTail) -> String {
    format!("{APP_SERVER_EXITED_MESSAGE}{}", stderr_tail_suffix(tail))
}

/// Drops every waiting sender. Each waiter then sees `closed` set and fails
/// with the exit message, typed as a transport failure rather than a reply.
async fn fail_pending_requests(pending: &PendingRequests) {
    pending.lock().await.drain();
}

fn trim_buffered_incoming_message(message: IncomingMessage) -> IncomingMessage {
    match message {
        IncomingMessage::Notification { method, params } => IncomingMessage::Notification {
            params: trim_large_output_params(&method, params),
            method,
        },
        IncomingMessage::Request {
            id,
            raw_id,
            method,
            params,
        } => IncomingMessage::Request {
            id,
            raw_id,
            params: trim_large_output_params(&method, params),
            method,
        },
        IncomingMessage::Response(response) => IncomingMessage::Response(response),
    }
}

fn transport_parse_error_payload(error: &str, line: &str) -> Box<serde_json::value::RawValue> {
    serde_json::value::to_raw_value(&serde_json::json!({
        "error": error,
        "line": trim_transport_error_line(line),
    }))
    .expect("internal error payload is valid json")
}

fn trim_transport_error_line(line: &str) -> String {
    if line.chars().count() <= TRANSPORT_ERROR_LINE_MAX_CHARS {
        return line.to_string();
    }

    let tail_chars = TRANSPORT_ERROR_LINE_MAX_CHARS
        .saturating_sub(TRANSPORT_ERROR_LINE_TRUNCATED_PREFIX.len())
        .max(1);
    let mut tail = line.chars().rev().take(tail_chars).collect::<Vec<_>>();
    tail.reverse();

    format!(
        "{}{}",
        TRANSPORT_ERROR_LINE_TRUNCATED_PREFIX,
        tail.into_iter().collect::<String>()
    )
}

fn trim_large_output_params(
    method: &str,
    params: Box<serde_json::value::RawValue>,
) -> Box<serde_json::value::RawValue> {
    if !is_large_output_event(method) {
        return params;
    }

    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(params.get()) else {
        return params;
    };

    if method_signature(method).contains("terminalinteraction") {
        trim_string_field(&mut value, "stdin");
    } else {
        for key in ["delta", "output", "text", "content"] {
            trim_string_field(&mut value, key);
        }
    }

    serde_json::value::to_raw_value(&value).unwrap_or(params)
}

fn trim_string_field(value: &mut serde_json::Value, key: &str) {
    let Some(field) = value.get_mut(key) else {
        return;
    };
    let Some(content) = field.as_str() else {
        return;
    };

    *field = serde_json::Value::String(trim_action_output_delta_content(content));
}

fn is_large_output_event(method: &str) -> bool {
    matches!(
        method_signature(method).as_str(),
        "itemcommandexecutionoutputdelta"
            | "itemfilechangeoutputdelta"
            | "itemcommandexecutionterminalinteraction"
            | "terminalinteraction"
    )
}

fn method_signature(method: &str) -> String {
    method
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

async fn codex_augmented_path(executable: &str) -> Option<OsString> {
    runtime_env::engine_path_with_prepend([Path::new(executable).parent()?.to_path_buf()]).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[cfg(unix)]
    #[tokio::test]
    async fn requests_fail_with_stderr_as_soon_as_the_app_server_exits() {
        use std::os::unix::fs::PermissionsExt;

        let dir =
            std::env::temp_dir().join(format!("panes-codex-transport-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let script = dir.join("codex");
        std::fs::write(
            &script,
            "#!/bin/sh\nread line\necho 'Error loading config.toml: bad key' >&2\nexit 1\n",
        )
        .expect("write fake codex");
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("make fake codex executable");

        let transport = CodexTransport::spawn(
            script.to_str().expect("utf-8 path"),
            &EngineInstanceSettings::default(),
        )
        .await
        .expect("spawn fake codex");
        let started = std::time::Instant::now();
        let error = transport
            .request("initialize", serde_json::json!({}), Duration::from_secs(30))
            .await
            .expect_err("the app-server exited without answering");
        let _ = std::fs::remove_dir_all(&dir);

        assert!(
            started.elapsed() < Duration::from_secs(10),
            "request waited for its timeout instead of failing on exit"
        );
        let message = error.to_string();
        assert!(message.contains("codex app-server exited"), "{message}");
        assert!(message.contains("bad key"), "{message}");
        assert!(is_transport_failure(&error), "{message}");
    }

    #[test]
    fn incoming_event_buffer_capacity_bounds_idle_retention() {
        assert!(
            INCOMING_EVENT_BUFFER_CAPACITY <= 256,
            "Codex incoming events are live fan-out only; raising this can retain large protocol payloads while idle"
        );
    }

    #[test]
    fn transport_parse_error_payload_trims_large_protocol_lines() {
        let line = "x".repeat(TRANSPORT_ERROR_LINE_MAX_CHARS + 2048);

        let payload = transport_parse_error_payload("bad json", &line);
        let parsed: Value = serde_json::from_str(payload.get()).expect("valid json payload");
        let trimmed_line = parsed
            .get("line")
            .and_then(Value::as_str)
            .expect("line should be present");

        assert!(trimmed_line.starts_with(TRANSPORT_ERROR_LINE_TRUNCATED_PREFIX));
        assert!(trimmed_line.chars().count() <= TRANSPORT_ERROR_LINE_MAX_CHARS);
        assert!(trimmed_line.ends_with(&"x".repeat(64)));
        assert_eq!(
            parsed.get("error").and_then(Value::as_str),
            Some("bad json")
        );
    }
}
