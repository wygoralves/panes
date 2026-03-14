use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Context;
use async_trait::async_trait;
use serde::Deserialize;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{process_utils, runtime_env};

use super::{
    normalize_approval_response_for_engine, ActionResult, ActionType, Engine, EngineEvent,
    EngineThread, ModelInfo, OutputStream, ReasoningEffortOption, SandboxPolicy, ThreadScope,
    TurnCompletionStatus, TurnInput,
};

// ── Sidecar event protocol ────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent {
    Ready,
    SessionInit {
        id: Option<String>,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    TurnStarted {
        id: Option<String>,
    },
    TextDelta {
        id: Option<String>,
        content: String,
    },
    ThinkingDelta {
        id: Option<String>,
        content: String,
    },
    ActionStarted {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        #[serde(rename = "actionType")]
        action_type: String,
        summary: String,
        details: Option<serde_json::Value>,
    },
    ActionOutputDelta {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        stream: String,
        content: String,
    },
    ActionProgressUpdated {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        message: String,
    },
    ActionCompleted {
        id: Option<String>,
        #[serde(rename = "actionId")]
        action_id: String,
        success: bool,
        output: Option<String>,
        error: Option<String>,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u64>,
    },
    ApprovalRequested {
        id: Option<String>,
        #[serde(rename = "approvalId")]
        approval_id: String,
        #[serde(rename = "actionType")]
        action_type: String,
        summary: String,
        details: Option<serde_json::Value>,
    },
    TurnCompleted {
        id: Option<String>,
        status: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        #[serde(rename = "tokenUsage")]
        token_usage: Option<SidecarTokenUsage>,
        #[serde(rename = "stopReason")]
        stop_reason: Option<String>,
    },
    Notice {
        id: Option<String>,
        kind: String,
        level: String,
        title: String,
        message: String,
    },
    UsageLimitsUpdated {
        id: Option<String>,
        usage: SidecarUsageLimits,
    },
    Error {
        id: Option<String>,
        message: String,
        recoverable: Option<bool>,
        #[serde(rename = "errorType")]
        error_type: Option<String>,
        #[serde(rename = "isAuthError")]
        is_auth_error: Option<bool>,
    },
    Version {
        id: Option<String>,
        #[serde(rename = "version")]
        _version: String,
    },
}

impl SidecarEvent {
    fn request_id(&self) -> Option<&str> {
        match self {
            SidecarEvent::Ready => None,
            SidecarEvent::SessionInit { id, .. }
            | SidecarEvent::TurnStarted { id, .. }
            | SidecarEvent::TextDelta { id, .. }
            | SidecarEvent::ThinkingDelta { id, .. }
            | SidecarEvent::ActionStarted { id, .. }
            | SidecarEvent::ActionOutputDelta { id, .. }
            | SidecarEvent::ActionProgressUpdated { id, .. }
            | SidecarEvent::ActionCompleted { id, .. }
            | SidecarEvent::ApprovalRequested { id, .. }
            | SidecarEvent::TurnCompleted { id, .. }
            | SidecarEvent::Notice { id, .. }
            | SidecarEvent::UsageLimitsUpdated { id, .. }
            | SidecarEvent::Error { id, .. }
            | SidecarEvent::Version { id, .. } => id.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarTokenUsage {
    input: u64,
    output: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarUsageLimits {
    current_tokens: Option<u64>,
    max_context_tokens: Option<u64>,
    context_window_percent: Option<u8>,
    five_hour_percent: Option<u8>,
    weekly_percent: Option<u8>,
    five_hour_resets_at: Option<i64>,
    weekly_resets_at: Option<i64>,
}

// ── Transport ─────────────────────────────────────────────────────────

struct ClaudeTransport {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    event_tx: broadcast::Sender<SidecarEvent>,
}

impl ClaudeTransport {
    async fn spawn(sidecar_path: PathBuf) -> anyhow::Result<Self> {
        let node_resolution = resolve_node_executable().await;
        let node = node_resolution
            .executable
            .clone()
            .with_context(|| node_unavailable_details(&node_resolution))?;

        let sidecar_dir = sidecar_path
            .parent()
            .map(|path| path.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let mut command = Command::new(&node);
        process_utils::configure_tokio_command(&mut command);
        if let Some(augmented_path) = executable_augmented_path(&node) {
            command.env("PATH", augmented_path);
        }
        let mut child = command
            .arg(&sidecar_path)
            .current_dir(&sidecar_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .with_context(|| {
                format!(
                    "failed to spawn claude agent sidecar at {}",
                    sidecar_path.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .context("claude sidecar stdin not available")?;
        let stdout = child
            .stdout
            .take()
            .context("claude sidecar stdout not available")?;
        let stderr = child
            .stderr
            .take()
            .context("claude sidecar stderr not available")?;

        let (event_tx, _) = broadcast::channel(1024);

        // Stdout reader: parse JSON lines → broadcast SidecarEvents
        {
            let tx = event_tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => match serde_json::from_str::<SidecarEvent>(&line) {
                            Ok(event) => {
                                let _ = tx.send(event);
                            }
                            Err(e) => {
                                log::warn!(
                                    "claude sidecar: failed to parse event: {e} — line: {line}"
                                );
                            }
                        },
                        Ok(None) => {
                            log::info!("claude sidecar stdout EOF");
                            break;
                        }
                        Err(e) => {
                            log::warn!("claude sidecar stdout read error: {e}");
                            break;
                        }
                    }
                }
            });
        }

        // Stderr reader: log only
        {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if !line.trim().is_empty() {
                                log::debug!("claude sidecar stderr: {line}");
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            });
        }

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            event_tx,
        })
    }

    fn resolve_sidecar_path(resource_dir: Option<&PathBuf>) -> anyhow::Result<PathBuf> {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("sidecar")
            .join("claude-agent-sdk-server.mjs");

        if dev_path.exists() {
            return Ok(dev_path);
        }

        if let Some(resource_dir) = resource_dir {
            let bundled_candidates = [
                resource_dir.join("claude-agent-sdk-server.mjs"),
                resource_dir
                    .join("sidecar-dist")
                    .join("claude-agent-sdk-server.mjs"),
            ];
            for candidate in bundled_candidates {
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }

        anyhow::bail!("claude agent sidecar script not found in dev or bundled resources")
    }

    async fn send_command(&self, command: &serde_json::Value) -> anyhow::Result<()> {
        let mut stdin = self.stdin.lock().await;
        let payload = serde_json::to_string(command)? + "\n";
        stdin
            .write_all(payload.as_bytes())
            .await
            .context("failed to write to claude sidecar stdin")?;
        stdin
            .flush()
            .await
            .context("failed to flush claude sidecar stdin")?;
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<SidecarEvent> {
        self.event_tx.subscribe()
    }

    async fn is_alive(&self) -> bool {
        let mut child = self.child.lock().await;
        matches!(child.try_wait(), Ok(None))
    }

    async fn kill(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

// ── Per-thread config ─────────────────────────────────────────────────

#[derive(Clone)]
struct ThreadConfig {
    scope: ThreadScope,
    model_id: String,
    sandbox: SandboxPolicy,
    agent_session_id: Option<String>,
    active_request_id: Option<String>,
}

// ── Engine ─────────────────────────────────────────────────────────────

#[derive(Default)]
struct ClaudeState {
    transport: Option<Arc<ClaudeTransport>>,
    threads: HashMap<String, ThreadConfig>,
    resource_dir: Option<PathBuf>,
}

#[derive(Default)]
pub struct ClaudeSidecarEngine {
    state: Arc<Mutex<ClaudeState>>,
}

#[derive(Debug, Clone)]
struct NodeExecutableResolution {
    executable: Option<PathBuf>,
    source: &'static str,
    app_path: Option<String>,
    login_shell_executable: Option<PathBuf>,
}

impl ClaudeSidecarEngine {
    pub fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        let mut state = self.state.blocking_lock();
        state.resource_dir = resource_dir;
    }

    pub async fn prewarm(&self) -> anyhow::Result<()> {
        self.ensure_transport().await.map(|_| ())
    }

    async fn ensure_transport(&self) -> anyhow::Result<Arc<ClaudeTransport>> {
        let (existing_transport, resource_dir) = {
            let state = self.state.lock().await;
            (state.transport.clone(), state.resource_dir.clone())
        };

        if let Some(transport) = existing_transport {
            if transport.is_alive().await {
                return Ok(transport);
            }

            log::warn!("claude sidecar process died, restarting…");
            let mut state = self.state.lock().await;
            if state
                .transport
                .as_ref()
                .map(|current| Arc::ptr_eq(current, &transport))
                .unwrap_or(false)
            {
                state.transport = None;
            }
        }

        let sidecar_path = ClaudeTransport::resolve_sidecar_path(resource_dir.as_ref())?;
        let transport = Arc::new(ClaudeTransport::spawn(sidecar_path).await?);

        // Wait for the "ready" event from the sidecar
        let mut rx = transport.subscribe();
        let ready = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                match rx.recv().await {
                    Ok(SidecarEvent::Ready) => return Ok::<(), anyhow::Error>(()),
                    Ok(SidecarEvent::Error { message, .. }) => {
                        anyhow::bail!("claude sidecar startup error: {message}");
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        anyhow::bail!("claude sidecar process terminated during startup");
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
        })
        .await;

        match ready {
            Ok(Ok(())) => log::info!("claude agent sidecar is ready"),
            Ok(Err(e)) => {
                transport.kill().await;
                return Err(e);
            }
            Err(_) => {
                transport.kill().await;
                anyhow::bail!("claude sidecar did not become ready within 15 seconds");
            }
        }

        let mut state = self.state.lock().await;
        if let Some(existing) = state.transport.clone() {
            if existing.is_alive().await {
                transport.kill().await;
                return Ok(existing);
            }
        }

        state.transport = Some(Arc::clone(&transport));
        Ok(transport)
    }

    fn parse_action_type(s: &str) -> ActionType {
        match s {
            "file_read" => ActionType::FileRead,
            "file_write" => ActionType::FileWrite,
            "file_edit" => ActionType::FileEdit,
            "file_delete" => ActionType::FileDelete,
            "command" => ActionType::Command,
            "git" => ActionType::Git,
            "search" => ActionType::Search,
            _ => ActionType::Other,
        }
    }

    fn parse_output_stream(s: &str) -> OutputStream {
        match s {
            "stderr" => OutputStream::Stderr,
            _ => OutputStream::Stdout,
        }
    }

    fn is_claude_auth_error(message: &str, error_type: Option<&str>, is_auth_error: bool) -> bool {
        if is_auth_error {
            return true;
        }

        if error_type == Some("authentication_failed") {
            return true;
        }

        let normalized = message.to_lowercase();
        normalized.contains("authentication failed")
            || normalized.contains("sign in again")
            || normalized.contains("refresh your credentials")
    }

    pub async fn health_report(&self) -> ClaudeHealthReport {
        let resource_dir = {
            let state = self.state.lock().await;
            state.resource_dir.clone()
        };
        let node_resolution = resolve_node_executable().await;
        let node_available = node_resolution.executable.is_some();
        let sidecar_exists = ClaudeTransport::resolve_sidecar_path(resource_dir.as_ref()).is_ok();
        let api_key_set = std::env::var("ANTHROPIC_API_KEY").is_ok();

        let mut checks = Vec::new();
        let mut warnings = Vec::new();
        let mut fixes = Vec::new();

        checks.extend(node_health_checks_for_platform(runtime_env::platform_id()));

        if let Some(node_path) = node_resolution.executable.as_ref() {
            checks.push(format!(
                "Node.js resolved via {} at `{}`",
                node_resolution.source,
                node_path.display()
            ));
        } else {
            warnings.push(node_unavailable_details(&node_resolution));
            fixes.extend(node_fix_commands(&node_resolution));
            fixes.push("Install Node.js 20+ from https://nodejs.org".to_string());
        }

        if sidecar_exists {
            checks.push("Agent SDK sidecar script found".to_string());
        } else {
            warnings.push("Agent SDK sidecar script not found".to_string());
        }

        if api_key_set {
            checks.push("ANTHROPIC_API_KEY is set".to_string());
        } else {
            warnings.push(
                "ANTHROPIC_API_KEY is not set. Claude may still work via Claude Code login or auth token."
                    .to_string(),
            );
            fixes.push(
                "Optional: set ANTHROPIC_API_KEY, or sign in with Claude Code so the SDK can use existing auth."
                    .to_string(),
            );
        }

        let available = node_available && sidecar_exists;

        ClaudeHealthReport {
            available,
            version: if available {
                Some("agent-sdk".to_string())
            } else {
                None
            },
            details: if available {
                "Claude Agent SDK engine is ready".to_string()
            } else if !node_available {
                node_unavailable_details(&node_resolution)
            } else if !sidecar_exists {
                "Claude Agent SDK sidecar script not found in bundled resources".to_string()
            } else {
                "Claude Agent SDK engine has missing prerequisites".to_string()
            },
            warnings,
            checks,
            fixes,
        }
    }
}

async fn resolve_node_executable() -> NodeExecutableResolution {
    let app_path = std::env::var("PATH").ok();

    if let Some(path) = runtime_env::resolve_executable("node") {
        return NodeExecutableResolution {
            executable: Some(path),
            source: "app-path",
            app_path,
            login_shell_executable: None,
        };
    }

    let login_shell_executable = detect_node_via_login_shell().await;
    let executable = login_shell_executable.clone();

    NodeExecutableResolution {
        executable,
        source: if login_shell_executable.is_some() {
            "login-shell"
        } else {
            "unavailable"
        },
        app_path,
        login_shell_executable,
    }
}

fn node_unavailable_details(resolution: &NodeExecutableResolution) -> String {
    node_unavailable_details_for_platform(runtime_env::platform_id(), resolution)
}

fn node_fix_commands(resolution: &NodeExecutableResolution) -> Vec<String> {
    node_fix_commands_for_platform(runtime_env::platform_id(), resolution)
}

fn node_unavailable_details_for_platform(
    platform: &str,
    resolution: &NodeExecutableResolution,
) -> String {
    let path_preview = app_path_preview(resolution.app_path.as_deref());

    match (platform, resolution.login_shell_executable.as_ref()) {
        ("macos", Some(shell_path)) => format!(
            "Node.js was found in your login shell at `{}`, but Panes does not see it in the app PATH. This is common when launching the app from Finder on macOS. App PATH: `{}`",
            shell_path.display(),
            path_preview
        ),
        ("windows", _) => format!(
            "Node.js executable not found for the Claude engine. App PATH: `{}`. On Windows, verify that the Node.js install directory is in PATH.",
            path_preview
        ),
        (_, Some(shell_path)) => format!(
            "Node.js was found in your login shell at `{}`, but Panes does not see it in the app PATH. App PATH: `{}`",
            shell_path.display(),
            path_preview
        ),
        (_, None) => format!(
            "Node.js executable not found for the Claude engine. App PATH: `{}`",
            path_preview
        ),
    }
}

fn node_fix_commands_for_platform(
    platform: &str,
    resolution: &NodeExecutableResolution,
) -> Vec<String> {
    if platform == "macos" {
        let mut fixes = Vec::new();
        match resolution.login_shell_executable.as_ref() {
            Some(shell_path) => {
                if let Some(bin_dir) = shell_path.parent() {
                    fixes.push(format!(
                        "launchctl setenv PATH \"{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\"",
                        bin_dir.display()
                    ));
                    fixes.push("open -a Panes".to_string());
                }
            }
            None => {
                fixes.push("/bin/zsh -lic 'command -v node && node --version'".to_string());
                fixes.push("open -a Panes".to_string());
            }
        }

        return fixes;
    }

    if platform == "windows" {
        let _ = resolution;
        return vec![
            "where node".to_string(),
            "echo %PATH%".to_string(),
            "Ensure your Node.js install directory is present in PATH, then restart Panes."
                .to_string(),
        ];
    }

    let _ = resolution;
    Vec::new()
}

fn node_health_checks_for_platform(platform: &str) -> Vec<String> {
    let mut checks = vec!["node --version".to_string()];

    match platform {
        "windows" => {
            checks.push("where node".to_string());
            checks.push("echo %PATH%".to_string());
        }
        "macos" => {
            checks.push("command -v node".to_string());
            checks.push("echo \"$PATH\"".to_string());
            checks.push("/bin/zsh -lic 'command -v node && node --version'".to_string());
        }
        _ => {
            checks.push("command -v node".to_string());
        }
    }

    checks
}

fn app_path_preview(path: Option<&str>) -> String {
    path.filter(|value| !value.trim().is_empty())
        .unwrap_or("(empty)")
        .to_string()
}

fn executable_augmented_path(executable: &Path) -> Option<OsString> {
    runtime_env::augmented_path_with_prepend(
        executable
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    )
}

async fn detect_node_via_login_shell() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        for shell in runtime_env::login_probe_shells() {
            let output = match Command::new(&shell)
                .args(runtime_env::login_probe_shell_args(
                    &shell,
                    "command -v node",
                ))
                .output()
                .await
            {
                Ok(output) if output.status.success() => output,
                _ => continue,
            };

            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(path) = stdout
                .lines()
                .map(str::trim)
                .find(|line| line.starts_with('/'))
                .map(PathBuf::from)
                .filter(|path| runtime_env::is_executable_file(path))
            {
                return Some(path);
            }
        }

        None
    }
}

pub struct ClaudeHealthReport {
    pub available: bool,
    pub version: Option<String>,
    pub details: String,
    pub warnings: Vec<String>,
    pub checks: Vec<String>,
    pub fixes: Vec<String>,
}

#[async_trait]
impl Engine for ClaudeSidecarEngine {
    fn id(&self) -> &str {
        "claude"
    }

    fn name(&self) -> &str {
        "Claude"
    }

    fn models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "claude-opus-4-6".to_string(),
                display_name: "Claude Opus 4.6".to_string(),
                description: "Most intelligent model for agents and coding".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "high".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick, efficient responses".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balanced reasoning".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Deep, thorough reasoning".to_string(),
                    },
                ],
            },
            ModelInfo {
                id: "claude-sonnet-4-6".to_string(),
                display_name: "Claude Sonnet 4.6".to_string(),
                description: "Best balance of speed and intelligence".to_string(),
                hidden: false,
                is_default: true,
                upgrade: Some("claude-opus-4-6".to_string()),
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick, efficient responses".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balanced reasoning".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Deep, thorough reasoning".to_string(),
                    },
                ],
            },
            ModelInfo {
                id: "claude-haiku-4-5".to_string(),
                display_name: "Claude Haiku 4.5".to_string(),
                description: "Fastest and most cost-effective".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("claude-sonnet-4-6".to_string()),
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "low".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick, efficient responses".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balanced reasoning".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Thorough reasoning".to_string(),
                    },
                ],
            },
        ]
    }

    async fn is_available(&self) -> bool {
        resolve_node_executable().await.executable.is_some() && {
            let state = self.state.lock().await;
            ClaudeTransport::resolve_sidecar_path(state.resource_dir.as_ref()).is_ok()
        }
    }

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error> {
        let (engine_thread_id, existing_session) = {
            let state = self.state.lock().await;
            let session_id = resume_engine_thread_id.and_then(|id| {
                state
                    .threads
                    .get(id)
                    .and_then(|config| config.agent_session_id.clone())
                    .or_else(|| {
                        if Uuid::parse_str(id).is_ok() {
                            Some(id.to_string())
                        } else {
                            None
                        }
                    })
            });
            let engine_thread_id = session_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            (engine_thread_id, session_id)
        };

        let config = ThreadConfig {
            scope,
            model_id: model.to_string(),
            sandbox,
            agent_session_id: existing_session,
            active_request_id: None,
        };

        let mut state = self.state.lock().await;
        state.threads.insert(engine_thread_id.clone(), config);

        Ok(EngineThread { engine_thread_id })
    }

    async fn send_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_transport().await?;

        let thread_config = {
            let state = self.state.lock().await;
            state
                .threads
                .get(engine_thread_id)
                .cloned()
                .context("no thread config found — was start_thread called?")?
        };

        let request_id = Uuid::new_v4().to_string();
        {
            let mut state = self.state.lock().await;
            if let Some(config) = state.threads.get_mut(engine_thread_id) {
                config.active_request_id = Some(request_id.clone());
            }
        }

        let cwd = match &thread_config.scope {
            ThreadScope::Repo { repo_path } => repo_path.clone(),
            ThreadScope::Workspace { root_path, .. } => root_path.clone(),
        };

        let TurnInput {
            message,
            attachments,
            plan_mode,
            input_items: _,
        } = input;

        let mut params = serde_json::json!({
            "prompt": message,
            "attachments": attachments
                .iter()
                .map(|attachment| {
                    serde_json::json!({
                        "fileName": attachment.file_name,
                        "filePath": attachment.file_path,
                        "sizeBytes": attachment.size_bytes,
                        "mimeType": attachment.mime_type,
                    })
                })
                .collect::<Vec<_>>(),
            "cwd": cwd,
            "model": thread_config.model_id,
            "approvalPolicy": thread_config
                .sandbox
                .approval_policy
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            "allowNetwork": thread_config.sandbox.allow_network,
            "writableRoots": thread_config.sandbox.writable_roots.clone(),
            "sandboxMode": thread_config.sandbox.sandbox_mode.clone(),
            "reasoningEffort": thread_config.sandbox.reasoning_effort.clone(),
            "planMode": plan_mode,
        });

        if let Some(ref session_id) = thread_config.agent_session_id {
            params["resume"] = serde_json::Value::String(session_id.clone());
        } else {
            params["sessionId"] = serde_json::Value::String(engine_thread_id.to_string());
        }

        let command = serde_json::json!({
            "id": request_id,
            "method": "query",
            "params": params,
        });

        let mut rx = transport.subscribe();
        transport.send_command(&command).await?;

        let engine_thread_id_owned = engine_thread_id.to_string();
        let state_ref = Arc::clone(&self.state);
        let mut auth_invalidated_transport = false;

        loop {
            tokio::select! {
                _ = cancellation.cancelled() => {
                    let cancel_cmd = serde_json::json!({
                        "method": "cancel",
                        "params": { "requestId": request_id.clone() },
                    });
                    let _ = transport.send_command(&cancel_cmd).await;
                    let mut state = self.state.lock().await;
                    if let Some(config) = state.threads.get_mut(engine_thread_id) {
                        config.active_request_id = None;
                    }
                    return Ok(());
                }
                event = rx.recv() => {
                    match event {
                        Ok(sidecar_event) => {
                            // Filter events by request ID
                            if let Some(eid) = sidecar_event.request_id() {
                                if eid != request_id {
                                    continue;
                                }
                            }

                            match sidecar_event {
                                SidecarEvent::TurnStarted { .. } => {
                                    event_tx
                                        .send(EngineEvent::TurnStarted {
                                            client_turn_id: None,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::SessionInit { session_id, .. } => {
                                    let mut state = state_ref.lock().await;
                                    if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                        config.agent_session_id = Some(session_id);
                                    }
                                }
                                SidecarEvent::TextDelta { content, .. } => {
                                    event_tx
                                        .send(EngineEvent::TextDelta { content })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ThinkingDelta { content, .. } => {
                                    event_tx
                                        .send(EngineEvent::ThinkingDelta { content })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionStarted {
                                    action_id,
                                    action_type,
                                    summary,
                                    details,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionStarted {
                                            action_id: action_id.clone(),
                                            engine_action_id: None,
                                            action_type: Self::parse_action_type(&action_type),
                                            summary,
                                            details: details.unwrap_or(serde_json::json!({})),
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionOutputDelta {
                                    action_id,
                                    stream,
                                    content,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionOutputDelta {
                                            action_id,
                                            stream: Self::parse_output_stream(&stream),
                                            content,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionProgressUpdated {
                                    action_id,
                                    message,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionProgressUpdated {
                                            action_id,
                                            message,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ActionCompleted {
                                    action_id,
                                    success,
                                    output,
                                    error,
                                    duration_ms,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ActionCompleted {
                                            action_id,
                                            result: ActionResult {
                                                success,
                                                output,
                                                error,
                                                diff: None,
                                                duration_ms: duration_ms.unwrap_or(0),
                                            },
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::ApprovalRequested {
                                    approval_id,
                                    action_type,
                                    summary,
                                    details,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::ApprovalRequested {
                                            approval_id,
                                            action_type: Self::parse_action_type(&action_type),
                                            summary,
                                            details: details.unwrap_or(serde_json::json!({})),
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::TurnCompleted {
                                    status,
                                    session_id,
                                    token_usage,
                                    stop_reason,
                                    ..
                                } => {
                                    if let Some(sid) = session_id {
                                        let mut state = state_ref.lock().await;
                                        if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                            config.agent_session_id = Some(sid);
                                        }
                                    }

                                    let completion_status = match status.as_str() {
                                        "completed" => TurnCompletionStatus::Completed,
                                        "interrupted" => TurnCompletionStatus::Interrupted,
                                        _ => TurnCompletionStatus::Failed,
                                    };
                                    event_tx
                                        .send(EngineEvent::TurnCompleted {
                                            token_usage: token_usage.map(|usage| super::TokenUsage {
                                                input: usage.input,
                                                output: usage.output,
                                            }),
                                            status: completion_status,
                                        })
                                        .await
                                        .ok();
                                    if let Some(stop_reason) = stop_reason {
                                        event_tx
                                            .send(EngineEvent::Notice {
                                                kind: "claude_stop_reason".to_string(),
                                                level: "info".to_string(),
                                                title: "Claude stop reason".to_string(),
                                                message: stop_reason,
                                            })
                                            .await
                                            .ok();
                                    }
                                    let mut state = self.state.lock().await;
                                    if let Some(config) = state.threads.get_mut(engine_thread_id) {
                                        config.active_request_id = None;
                                    }
                                    break;
                                }
                                SidecarEvent::Notice {
                                    kind,
                                    level,
                                    title,
                                    message,
                                    ..
                                } => {
                                    event_tx
                                        .send(EngineEvent::Notice {
                                            kind,
                                            level,
                                            title,
                                            message,
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::UsageLimitsUpdated { usage, .. } => {
                                    event_tx
                                        .send(EngineEvent::UsageLimitsUpdated {
                                            usage: super::UsageLimitsSnapshot {
                                                current_tokens: usage.current_tokens,
                                                max_context_tokens: usage.max_context_tokens,
                                                context_window_percent: usage.context_window_percent,
                                                five_hour_percent: usage.five_hour_percent,
                                                weekly_percent: usage.weekly_percent,
                                                five_hour_resets_at: usage.five_hour_resets_at,
                                                weekly_resets_at: usage.weekly_resets_at,
                                            },
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::Error {
                                    message,
                                    recoverable,
                                    error_type,
                                    is_auth_error,
                                    ..
                                } => {
                                    if Self::is_claude_auth_error(
                                        &message,
                                        error_type.as_deref(),
                                        is_auth_error.unwrap_or(false),
                                    ) {
                                        auth_invalidated_transport = true;
                                        let mut state = self.state.lock().await;
                                        if state
                                            .transport
                                            .as_ref()
                                            .map(|current| Arc::ptr_eq(current, &transport))
                                            .unwrap_or(false)
                                        {
                                            state.transport = None;
                                        }
                                        drop(state);
                                        transport.kill().await;
                                    }
                                    event_tx
                                        .send(EngineEvent::Error {
                                            message,
                                            recoverable: recoverable.unwrap_or(false),
                                        })
                                        .await
                                        .ok();
                                }
                                SidecarEvent::Ready | SidecarEvent::Version { .. } => {}
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("claude sidecar: event receiver lagged by {n} messages");
                            event_tx
                                .send(EngineEvent::Notice {
                                    kind: "claude_event_lag".to_string(),
                                    level: "warning".to_string(),
                                    title: "Claude event lag".to_string(),
                                    message: format!(
                                        "Claude sidecar event stream skipped {n} messages under load."
                                    ),
                                })
                                .await
                                .ok();
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            if !auth_invalidated_transport {
                                event_tx
                                    .send(EngineEvent::Error {
                                        message: "Claude sidecar process terminated unexpectedly"
                                            .to_string(),
                                        recoverable: false,
                                    })
                                    .await
                                    .ok();
                            }
                            event_tx
                                .send(EngineEvent::TurnCompleted {
                                    token_usage: None,
                                    status: TurnCompletionStatus::Failed,
                                })
                                .await
                                .ok();
                            // Mark transport as dead so it restarts on next use
                            let mut state = state_ref.lock().await;
                            if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                config.active_request_id = None;
                            }
                            state.transport = None;
                            break;
                        }
                    }
                }
            }
        }

        let mut state = self.state.lock().await;
        if let Some(config) = state.threads.get_mut(engine_thread_id) {
            config.active_request_id = None;
        }

        Ok(())
    }

    async fn steer_message(
        &self,
        _engine_thread_id: &str,
        _input: TurnInput,
    ) -> Result<(), anyhow::Error> {
        anyhow::bail!("Claude does not support mid-turn steering")
    }

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
    ) -> Result<(), anyhow::Error> {
        let normalized_response = normalize_approval_response_for_engine("claude", response)
            .map_err(anyhow::Error::msg)?;
        let state = self.state.lock().await;
        if let Some(ref transport) = state.transport {
            let approval_cmd = serde_json::json!({
                "method": "approval_response",
                "params": {
                    "approvalId": approval_id,
                    "response": normalized_response,
                },
            });
            transport.send_command(&approval_cmd).await?;
        }
        Ok(())
    }

    async fn interrupt(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let state = self.state.lock().await;
        let Some(ref transport) = state.transport else {
            return Ok(());
        };
        let request_id = state
            .threads
            .get(engine_thread_id)
            .and_then(|config| config.active_request_id.clone());
        if let Some(request_id) = request_id {
            let cancel_cmd = serde_json::json!({
                "method": "cancel",
                "params": { "requestId": request_id },
            });
            transport.send_command(&cancel_cmd).await?;
        }
        Ok(())
    }

    async fn archive_thread(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let mut state = self.state.lock().await;
        state.threads.remove(engine_thread_id);
        Ok(())
    }

    async fn unarchive_thread(&self, _engine_thread_id: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_action_output_delta_events() {
        let event: SidecarEvent = serde_json::from_value(serde_json::json!({
            "type": "action_output_delta",
            "id": "request-1",
            "actionId": "action-1",
            "stream": "stderr",
            "content": "permission denied",
        }))
        .expect("action_output_delta should deserialize");

        assert_eq!(event.request_id(), Some("request-1"));
        match event {
            SidecarEvent::ActionOutputDelta {
                action_id,
                stream,
                content,
                ..
            } => {
                assert_eq!(action_id, "action-1");
                assert_eq!(stream, "stderr");
                assert_eq!(content, "permission denied");
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn deserializes_action_progress_events() {
        let event: SidecarEvent = serde_json::from_value(serde_json::json!({
            "type": "action_progress_updated",
            "id": "request-1",
            "actionId": "action-1",
            "message": "Claude finished preparing tool input.",
        }))
        .expect("action_progress_updated should deserialize");

        match event {
            SidecarEvent::ActionProgressUpdated {
                action_id,
                message,
                ..
            } => {
                assert_eq!(action_id, "action-1");
                assert_eq!(message, "Claude finished preparing tool input.");
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn parses_output_stream_names() {
        assert!(matches!(
            ClaudeSidecarEngine::parse_output_stream("stderr"),
            OutputStream::Stderr
        ));
        assert!(matches!(
            ClaudeSidecarEngine::parse_output_stream("stdout"),
            OutputStream::Stdout
        ));
        assert!(matches!(
            ClaudeSidecarEngine::parse_output_stream("unknown"),
            OutputStream::Stdout
        ));
    }

    #[test]
    fn deserializes_turn_completed_token_usage() {
        let event: SidecarEvent = serde_json::from_value(serde_json::json!({
            "type": "turn_completed",
            "id": "request-1",
            "status": "completed",
            "sessionId": "session-1",
            "tokenUsage": {
                "input": 42,
                "output": 24,
            },
            "stopReason": "end_turn",
        }))
        .expect("turn_completed should deserialize");

        match event {
            SidecarEvent::TurnCompleted {
                status,
                session_id,
                token_usage,
                stop_reason,
                ..
            } => {
                assert_eq!(status, "completed");
                assert_eq!(session_id.as_deref(), Some("session-1"));
                let usage = token_usage.expect("token usage");
                assert_eq!(usage.input, 42);
                assert_eq!(usage.output, 24);
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn deserializes_usage_limits_events() {
        let event: SidecarEvent = serde_json::from_value(serde_json::json!({
            "type": "usage_limits_updated",
            "id": "request-1",
            "usage": {
                "fiveHourPercent": 87,
                "fiveHourResetsAt": 1740000000,
            },
        }))
        .expect("usage_limits_updated should deserialize");

        match event {
            SidecarEvent::UsageLimitsUpdated { usage, .. } => {
                assert_eq!(usage.five_hour_percent, Some(87));
                assert_eq!(usage.five_hour_resets_at, Some(1_740_000_000));
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn claude_auth_error_detection_uses_structured_fields() {
        assert!(ClaudeSidecarEngine::is_claude_auth_error(
            "anything",
            Some("authentication_failed"),
            false,
        ));
        assert!(ClaudeSidecarEngine::is_claude_auth_error(
            "Claude authentication failed. Sign in again.",
            None,
            false,
        ));
        assert!(!ClaudeSidecarEngine::is_claude_auth_error(
            "Claude rate limit reached",
            Some("rate_limit"),
            false,
        ));
    }

    #[test]
    fn node_health_checks_use_windows_commands() {
        let checks = node_health_checks_for_platform("windows");

        assert!(checks.contains(&"where node".to_string()));
        assert!(checks.contains(&"echo %PATH%".to_string()));
        assert!(!checks.iter().any(|check| check == "command -v node"));
    }

    #[test]
    fn node_unavailable_details_for_windows_mentions_path_guidance() {
        let details = node_unavailable_details_for_platform(
            "windows",
            &NodeExecutableResolution {
                executable: None,
                source: "unavailable",
                app_path: Some(r"C:\Windows\System32".to_string()),
                login_shell_executable: None,
            },
        );

        assert!(details.contains("install directory is in PATH"));
        assert!(details.contains("App PATH"));
    }

    #[test]
    fn node_fix_commands_for_windows_cover_where_and_restart() {
        let fixes = node_fix_commands_for_platform(
            "windows",
            &NodeExecutableResolution {
                executable: None,
                source: "unavailable",
                app_path: Some(r"C:\Windows\System32".to_string()),
                login_shell_executable: None,
            },
        );

        assert!(fixes.contains(&"where node".to_string()));
        assert!(fixes.contains(&"echo %PATH%".to_string()));
        assert!(fixes.iter().any(|fix| fix.contains("restart Panes")));
    }
}
