use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs::{self, File},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, UNIX_EPOCH},
};

use anyhow::Context;
use async_trait::async_trait;
use flate2::read::GzDecoder;
use serde::Deserialize;
use tokio::time::timeout;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{process_utils, runtime_env};

use super::{
    normalize_approval_response_for_engine, trim_action_output_delta_content, ActionResult,
    ActionType, ApprovalRequestRoute, Engine, EngineEvent, EngineThread, ModelInfo, OutputStream,
    ReasoningEffortOption, SandboxPolicy, ThreadScope, TurnCompletionStatus, TurnInput,
};

const LOGIN_SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const NODE_RUNTIME_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const CLAUDE_MODEL_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(12);
const CLAUDE_RUNTIME_INFO_TIMEOUT: Duration = Duration::from_secs(5);
const ARCHIVED_CLAUDE_SDK_NODE_MODULES: &str = "claude-sdk-node_modules.tar.gz";
const SIDECAR_EVENT_BUFFER_CAPACITY: usize = 1024;
const MINIMUM_NODE_VERSION: &str = "20.5";
const NODE_RUNTIME_PROBE_SCRIPT: &str = r#"
const version = process.versions.node;
const explicitResourceManagement =
  typeof Symbol.dispose === "symbol" &&
  typeof Symbol.asyncDispose === "symbol";
let disposableChildProcess = false;
let child;
try {
  const { spawn } = require("node:child_process");
  child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const dispose =
    typeof Symbol.dispose === "symbol" ? child[Symbol.dispose] : undefined;
  if (typeof dispose === "function") {
    dispose.call(child);
    disposableChildProcess = true;
  }
} catch {}
finally {
  if (child && !child.killed) child.kill();
}
process.stdout.write(JSON.stringify({
  version,
  explicitResourceManagement,
  disposableChildProcess,
}));
"#;

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
    Models {
        id: Option<String>,
        models: Vec<SidecarModelInfo>,
        #[serde(rename = "runtimeSource")]
        runtime_source: Option<String>,
        #[serde(rename = "runtimeExecutable")]
        runtime_executable: Option<String>,
        #[serde(rename = "sdkVersion")]
        sdk_version: Option<String>,
        #[serde(rename = "bundledClaudeCodeVersion")]
        bundled_claude_code_version: Option<String>,
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
        version: String,
        #[serde(rename = "runtimeSource")]
        runtime_source: Option<String>,
        #[serde(rename = "runtimeExecutable")]
        runtime_executable: Option<String>,
        #[serde(rename = "sdkVersion")]
        sdk_version: Option<String>,
        #[serde(rename = "bundledClaudeCodeVersion")]
        bundled_claude_code_version: Option<String>,
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
            | SidecarEvent::Models { id, .. }
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
    fable_weekly_percent: Option<u8>,
    opus_weekly_percent: Option<u8>,
    sonnet_weekly_percent: Option<u8>,
    five_hour_resets_at: Option<i64>,
    weekly_resets_at: Option<i64>,
    fable_weekly_resets_at: Option<i64>,
    opus_weekly_resets_at: Option<i64>,
    sonnet_weekly_resets_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarModelInfo {
    value: String,
    display_name: String,
    description: String,
    #[serde(default)]
    supports_effort: bool,
    #[serde(default)]
    supported_effort_levels: Vec<String>,
    resolved_model: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ClaudeRuntimeInfo {
    runtime_source: Option<String>,
    runtime_executable: Option<String>,
    sdk_version: Option<String>,
    bundled_claude_code_version: Option<String>,
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
        let sdk_module_specifier = Self::prepare_bundled_sdk_module_specifier(&sidecar_dir).await?;

        let mut command = Command::new(&node);
        process_utils::configure_tokio_command(&mut command);
        runtime_env::apply_missing_login_shell_env(&mut command).await;
        if let Some(augmented_path) = executable_augmented_path(&node) {
            command.env("PATH", augmented_path);
        }
        if let Some(module_specifier) = sdk_module_specifier {
            command.env("CLAUDE_AGENT_SDK_MODULE", module_specifier);
        }
        if let Some(claude_executable) = resolve_system_claude_executable() {
            log::info!(
                "claude sidecar: using system Claude Code runtime at {}",
                claude_executable.display()
            );
            command.env("PANES_CLAUDE_CODE_EXECUTABLE", claude_executable);
        } else {
            log::info!("claude sidecar: system Claude Code not found, using bundled runtime");
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

        let (event_tx, _) = broadcast::channel(SIDECAR_EVENT_BUFFER_CAPACITY);

        // Stdout reader: parse JSON lines → broadcast SidecarEvents
        {
            let tx = event_tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => match serde_json::from_str::<SidecarEvent>(&line) {
                            Ok(event) => {
                                let _ = tx.send(trim_sidecar_event_for_buffer(event));
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

    async fn prepare_bundled_sdk_module_specifier(
        sidecar_dir: &Path,
    ) -> anyhow::Result<Option<String>> {
        if Self::bundled_sdk_module_path(sidecar_dir).exists() {
            return Ok(None);
        }

        let archive_path = Self::archived_sdk_bundle_path(sidecar_dir);
        if !archive_path.exists() {
            return Ok(None);
        }

        let extracted_module = Self::extract_archived_sdk_module(archive_path).await?;
        Ok(Some(extracted_module.to_string_lossy().into_owned()))
    }

    fn bundled_sdk_module_path(sidecar_dir: &Path) -> PathBuf {
        sidecar_dir
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-agent-sdk")
            .join("sdk.mjs")
    }

    fn archived_sdk_bundle_path(sidecar_dir: &Path) -> PathBuf {
        sidecar_dir.join(ARCHIVED_CLAUDE_SDK_NODE_MODULES)
    }

    async fn extract_archived_sdk_module(archive_path: PathBuf) -> anyhow::Result<PathBuf> {
        let cache_root = runtime_env::app_data_dir().join("claude-sidecar-sdk");
        tokio::task::spawn_blocking(move || {
            Self::extract_archived_sdk_module_blocking(&archive_path, &cache_root)
        })
        .await
        .context("failed to join archived Claude SDK extraction task")?
    }

    fn extract_archived_sdk_module_blocking(
        archive_path: &Path,
        cache_root: &Path,
    ) -> anyhow::Result<PathBuf> {
        let metadata = fs::metadata(archive_path).with_context(|| {
            format!(
                "failed to read archived Claude SDK metadata from {}",
                archive_path.display()
            )
        })?;
        let modified_secs = metadata
            .modified()
            .ok()
            .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        let extraction_root = cache_root.join(format!("{}-{}", metadata.len(), modified_secs));
        let extracted_module = Self::bundled_sdk_module_path(&extraction_root);
        if extracted_module.exists() {
            return Ok(extracted_module);
        }

        fs::create_dir_all(cache_root).with_context(|| {
            format!(
                "failed to create Claude SDK extraction cache at {}",
                cache_root.display()
            )
        })?;

        let staging_root = cache_root.join(format!(".extract-{}", Uuid::new_v4()));
        fs::create_dir_all(&staging_root).with_context(|| {
            format!(
                "failed to create Claude SDK staging directory at {}",
                staging_root.display()
            )
        })?;

        let unpack_result = (|| -> anyhow::Result<()> {
            let archive_file = File::open(archive_path).with_context(|| {
                format!(
                    "failed to open archived Claude SDK bundle at {}",
                    archive_path.display()
                )
            })?;
            let decoder = GzDecoder::new(archive_file);
            let mut archive = tar::Archive::new(decoder);
            archive.unpack(&staging_root).with_context(|| {
                format!(
                    "failed to unpack archived Claude SDK bundle into {}",
                    staging_root.display()
                )
            })?;
            Ok(())
        })();

        if let Err(error) = unpack_result {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error);
        }

        let staged_module = Self::bundled_sdk_module_path(&staging_root);
        if !staged_module.exists() {
            let _ = fs::remove_dir_all(&staging_root);
            anyhow::bail!(
                "archived Claude SDK bundle is missing {}",
                staged_module.display()
            );
        }

        match fs::rename(&staging_root, &extraction_root) {
            Ok(()) => {}
            Err(rename_error) if extraction_root.exists() => {
                let _ = fs::remove_dir_all(&staging_root);
                log::debug!(
                    "claude sidecar: reusing archived SDK extraction at {} after concurrent extract: {}",
                    extraction_root.display(),
                    rename_error
                );
            }
            Err(rename_error) => {
                let _ = fs::remove_dir_all(&staging_root);
                return Err(rename_error).with_context(|| {
                    format!(
                        "failed to finalize archived Claude SDK extraction at {}",
                        extraction_root.display()
                    )
                });
            }
        }

        Ok(extracted_module)
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
    runtime_model_cache: Option<Vec<ModelInfo>>,
    runtime_info: Option<ClaudeRuntimeInfo>,
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
    rejected_executables: Vec<NodeExecutableCandidate>,
}

#[derive(Debug, Clone)]
struct NodeExecutableCandidate {
    path: PathBuf,
    version: Option<String>,
    compatible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeRuntimeProbe {
    version: String,
    explicit_resource_management: bool,
    disposable_child_process: bool,
}

impl ClaudeSidecarEngine {
    pub fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        let mut state = self.state.blocking_lock();
        state.resource_dir = resource_dir;
    }

    pub async fn prewarm(&self) -> anyhow::Result<()> {
        self.ensure_transport().await.map(|_| ())
    }

    /// Two-phase transport initialization to avoid holding the state mutex
    /// during the blocking sidecar spawn + 15-second ready-wait window.
    ///
    /// Race resolution: if two callers both see `transport == None` and spawn
    /// concurrently, the first to re-acquire the lock stores its transport.
    /// The second sees an alive transport at the re-check (line below) and
    /// kills its redundant sidecar. If both fail the ready-wait, each kills
    /// its own transport and returns an error — no leak.
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

    pub async fn list_models_runtime(&self) -> Vec<ModelInfo> {
        match self.fetch_models_from_runtime().await {
            Ok(models) if !models.is_empty() => {
                let models = with_legacy_claude_models(models);
                let mut state = self.state.lock().await;
                state.runtime_model_cache = Some(models.clone());
                models
            }
            Ok(_) => self.runtime_model_fallback().await,
            Err(error) => {
                log::warn!(
                    "failed to discover Claude models from the active runtime, using fallback: {error}"
                );
                self.runtime_model_fallback().await
            }
        }
    }

    pub async fn runtime_model_fallback(&self) -> Vec<ModelInfo> {
        let state = self.state.lock().await;
        state
            .runtime_model_cache
            .clone()
            .unwrap_or_else(|| self.models())
    }

    pub async fn usage_limits_snapshot(&self) -> anyhow::Result<super::UsageLimitsSnapshot> {
        let transport = self.ensure_transport().await?;
        let request_id = Uuid::new_v4().to_string();
        let mut receiver = transport.subscribe();
        transport
            .send_command(&serde_json::json!({
                "id": request_id,
                "method": "get_usage_limits",
            }))
            .await?;

        timeout(Duration::from_secs(7), async {
            loop {
                match receiver.recv().await {
                    Ok(SidecarEvent::UsageLimitsUpdated { id, usage })
                        if id.as_deref() == Some(request_id.as_str()) =>
                    {
                        return Ok(super::UsageLimitsSnapshot {
                            current_tokens: usage.current_tokens,
                            max_context_tokens: usage.max_context_tokens,
                            context_window_percent: usage.context_window_percent,
                            five_hour_percent: usage.five_hour_percent,
                            weekly_percent: usage.weekly_percent,
                            fable_weekly_percent: usage.fable_weekly_percent,
                            opus_weekly_percent: usage.opus_weekly_percent,
                            sonnet_weekly_percent: usage.sonnet_weekly_percent,
                            five_hour_resets_at: usage.five_hour_resets_at,
                            weekly_resets_at: usage.weekly_resets_at,
                            fable_weekly_resets_at: usage.fable_weekly_resets_at,
                            opus_weekly_resets_at: usage.opus_weekly_resets_at,
                            sonnet_weekly_resets_at: usage.sonnet_weekly_resets_at,
                        });
                    }
                    Ok(SidecarEvent::Error { id, message, .. })
                        if id.as_deref() == Some(request_id.as_str()) =>
                    {
                        anyhow::bail!(message);
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        anyhow::bail!("Claude sidecar closed while reading usage limits");
                    }
                }
            }
        })
        .await
        .context("timed out reading Claude usage limits")?
    }

    async fn fetch_models_from_runtime(&self) -> anyhow::Result<Vec<ModelInfo>> {
        let transport = self.ensure_transport().await?;
        let request_id = Uuid::new_v4().to_string();
        let mut receiver = transport.subscribe();
        transport
            .send_command(&serde_json::json!({
                "id": request_id,
                "method": "list_models",
                "params": {},
            }))
            .await?;

        timeout(CLAUDE_MODEL_DISCOVERY_TIMEOUT, async {
            loop {
                match receiver.recv().await {
                    Ok(SidecarEvent::Models {
                        id,
                        models,
                        runtime_source,
                        runtime_executable,
                        sdk_version,
                        bundled_claude_code_version,
                    }) if id.as_deref() == Some(request_id.as_str()) => {
                        let mut state = self.state.lock().await;
                        state.runtime_info = Some(ClaudeRuntimeInfo {
                            runtime_source,
                            runtime_executable,
                            sdk_version,
                            bundled_claude_code_version,
                        });
                        return Ok(map_claude_models(models));
                    }
                    Ok(SidecarEvent::Error { id, message, .. })
                        if id.as_deref() == Some(request_id.as_str()) =>
                    {
                        anyhow::bail!(message);
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        anyhow::bail!("Claude sidecar closed during model discovery");
                    }
                }
            }
        })
        .await
        .context("timed out discovering Claude models")?
    }

    async fn runtime_info(&self) -> anyhow::Result<ClaudeRuntimeInfo> {
        if let Some(runtime_info) = self.state.lock().await.runtime_info.clone() {
            return Ok(runtime_info);
        }

        let transport = self.ensure_transport().await?;
        let request_id = Uuid::new_v4().to_string();
        let mut receiver = transport.subscribe();
        transport
            .send_command(&serde_json::json!({
                "id": request_id,
                "method": "version",
            }))
            .await?;

        let runtime_info = timeout(CLAUDE_RUNTIME_INFO_TIMEOUT, async {
            loop {
                match receiver.recv().await {
                    Ok(SidecarEvent::Version {
                        id,
                        version,
                        runtime_source,
                        runtime_executable,
                        sdk_version,
                        bundled_claude_code_version,
                    }) if id.as_deref() == Some(request_id.as_str()) => {
                        log::debug!("claude sidecar protocol version: {version}");
                        return Ok(ClaudeRuntimeInfo {
                            runtime_source,
                            runtime_executable,
                            sdk_version,
                            bundled_claude_code_version,
                        });
                    }
                    Ok(SidecarEvent::Error { id, message, .. })
                        if id.as_deref() == Some(request_id.as_str()) =>
                    {
                        anyhow::bail!(message);
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        anyhow::bail!("Claude sidecar closed while reading runtime information");
                    }
                }
            }
        })
        .await
        .context("timed out reading Claude runtime information")??;

        self.state.lock().await.runtime_info = Some(runtime_info.clone());
        Ok(runtime_info)
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
        let system_claude = resolve_system_claude_executable();
        let system_claude_version = match system_claude.as_deref() {
            Some(executable) => probe_claude_version(executable).await,
            None => None,
        };
        let runtime_info = if node_available && sidecar_exists {
            self.runtime_info().await.ok()
        } else {
            None
        };

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
            checks.extend(
                node_resolution
                    .rejected_executables
                    .iter()
                    .map(|candidate| {
                        format!(
                            "Ignored incompatible Node.js {} at `{}`",
                            candidate
                                .version
                                .as_deref()
                                .unwrap_or("with unknown version"),
                            candidate.path.display()
                        )
                    }),
            );
        } else {
            warnings.push(node_unavailable_details(&node_resolution));
            fixes.extend(node_fix_commands(&node_resolution));
            fixes.push("Install Node.js 20.5+ from https://nodejs.org".to_string());
        }

        if sidecar_exists {
            checks.push("Agent SDK sidecar script found".to_string());
        } else {
            warnings.push("Agent SDK sidecar script not found".to_string());
        }

        if let Some(claude_path) = system_claude.as_ref() {
            checks.push(format!(
                "System Claude Code runtime resolved at `{}`",
                claude_path.display()
            ));
        } else if sidecar_exists {
            checks.push("Using the Claude Code runtime bundled with the Agent SDK".to_string());
        }

        if let Some(sdk_version) = runtime_info
            .as_ref()
            .and_then(|runtime| runtime.sdk_version.as_deref())
        {
            checks.push(format!("Claude Agent SDK version: {sdk_version}"));
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
        let runtime_source = runtime_info
            .as_ref()
            .and_then(|runtime| runtime.runtime_source.as_deref())
            .unwrap_or(if system_claude.is_some() {
                "system"
            } else {
                "bundled"
            });
        let runtime_version = if runtime_source == "system" {
            system_claude_version.clone()
        } else {
            runtime_info
                .as_ref()
                .and_then(|runtime| runtime.bundled_claude_code_version.clone())
        };
        let runtime_path = runtime_info
            .as_ref()
            .and_then(|runtime| runtime.runtime_executable.as_deref())
            .or_else(|| system_claude.as_deref().and_then(Path::to_str));
        let runtime_details = match (
            runtime_source,
            runtime_version.as_deref(),
            runtime_path,
            runtime_info
                .as_ref()
                .and_then(|runtime| runtime.sdk_version.as_deref()),
        ) {
            ("system", Some(version), Some(path), Some(sdk_version)) => {
                format!("Claude Code {version} from `{path}` via Agent SDK {sdk_version}")
            }
            ("system", Some(version), _, Some(sdk_version)) => {
                format!("Claude Code {version} from the system runtime via Agent SDK {sdk_version}")
            }
            ("system", Some(version), _, _) => {
                format!("Claude Code {version} from the system runtime")
            }
            ("bundled", Some(version), _, Some(sdk_version)) => {
                format!("Bundled Claude Code {version} via Agent SDK {sdk_version}")
            }
            ("bundled", _, _, Some(sdk_version)) => {
                format!("Bundled Claude Code runtime via Agent SDK {sdk_version}")
            }
            _ => "Claude Agent SDK engine is ready".to_string(),
        };

        ClaudeHealthReport {
            available,
            version: available.then_some(runtime_version).flatten(),
            details: if available {
                runtime_details
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
    let app_candidate = match runtime_env::resolve_executable("node") {
        Some(path) => Some(probe_node_executable(path).await),
        None => None,
    };

    if app_candidate
        .as_ref()
        .map(|candidate| candidate.compatible)
        .unwrap_or(false)
    {
        return resolve_node_candidates(app_path, app_candidate, None);
    }

    let login_shell_candidate = match detect_node_via_login_shell().await {
        Some(path)
            if app_candidate
                .as_ref()
                .map(|candidate| !paths_match(&candidate.path, &path))
                .unwrap_or(true) =>
        {
            Some(probe_node_executable(path).await)
        }
        _ => None,
    };

    resolve_node_candidates(app_path, app_candidate, login_shell_candidate)
}

fn resolve_node_candidates(
    app_path: Option<String>,
    app_candidate: Option<NodeExecutableCandidate>,
    login_shell_candidate: Option<NodeExecutableCandidate>,
) -> NodeExecutableResolution {
    let app_executable = app_candidate
        .as_ref()
        .filter(|candidate| candidate.compatible)
        .map(|candidate| candidate.path.clone());
    let login_shell_compatible_executable = login_shell_candidate
        .as_ref()
        .filter(|candidate| candidate.compatible)
        .map(|candidate| candidate.path.clone());
    let mut rejected_executables = Vec::new();

    if let Some(candidate) = app_candidate.filter(|candidate| !candidate.compatible) {
        rejected_executables.push(candidate);
    }
    if let Some(candidate) = login_shell_candidate.filter(|candidate| !candidate.compatible) {
        rejected_executables.push(candidate);
    }

    let (executable, source) = if let Some(executable) = app_executable {
        (Some(executable), "app-path")
    } else if let Some(executable) = login_shell_compatible_executable {
        (Some(executable), "login-shell")
    } else {
        (None, "unavailable")
    };

    NodeExecutableResolution {
        executable,
        source,
        app_path,
        rejected_executables,
    }
}

async fn probe_node_executable(path: PathBuf) -> NodeExecutableCandidate {
    let mut command = Command::new(&path);
    process_utils::configure_tokio_command(&mut command);
    let probe = timeout(
        NODE_RUNTIME_PROBE_TIMEOUT,
        command.arg("-e").arg(NODE_RUNTIME_PROBE_SCRIPT).output(),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .and_then(|output| serde_json::from_slice::<NodeRuntimeProbe>(&output.stdout).ok());

    NodeExecutableCandidate {
        path,
        version: probe.as_ref().map(|probe| probe.version.clone()),
        compatible: probe
            .as_ref()
            .map(node_runtime_is_compatible)
            .unwrap_or(false),
    }
}

fn node_runtime_is_compatible(probe: &NodeRuntimeProbe) -> bool {
    let mut version_parts = probe
        .version
        .trim_start_matches('v')
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok());
    let major = version_parts.next().unwrap_or_default();
    let minor = version_parts.next().unwrap_or_default();
    let supports_disposable_child_process = major > 20 || (major == 20 && minor >= 5);

    supports_disposable_child_process
        && probe.explicit_resource_management
        && probe.disposable_child_process
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
    let incompatible_runtimes = resolution
        .rejected_executables
        .iter()
        .map(|candidate| {
            format!(
                "Node.js {} at `{}`",
                candidate
                    .version
                    .as_deref()
                    .unwrap_or("with unknown version"),
                candidate.path.display()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    if !incompatible_runtimes.is_empty() {
        let platform_guidance = if platform == "windows" {
            " Verify that a compatible Node.js install directory is in PATH."
        } else {
            ""
        };
        return format!(
            "Claude requires Node.js {MINIMUM_NODE_VERSION}+ with disposable child process support. Found incompatible {incompatible_runtimes}.{platform_guidance} App PATH: `{path_preview}`"
        );
    }

    match platform {
        "windows" => format!(
            "Node.js executable not found for the Claude engine. App PATH: `{}`. On Windows, verify that the Node.js install directory is in PATH.",
            path_preview
        ),
        _ => format!(
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
        let _ = resolution;
        return vec![
            "/bin/zsh -lic 'command -v node && node --version'".to_string(),
            "open -a Panes".to_string(),
        ];
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

fn trim_sidecar_event_for_buffer(mut event: SidecarEvent) -> SidecarEvent {
    if let SidecarEvent::ActionOutputDelta { content, .. } = &mut event {
        *content = trim_action_output_delta_content(content);
    }
    event
}

fn executable_augmented_path(executable: &Path) -> Option<OsString> {
    runtime_env::augmented_path_with_prepend(
        executable
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    )
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

fn resolve_system_claude_executable() -> Option<PathBuf> {
    if std::env::var("PANES_CLAUDE_CODE_USE_BUNDLED")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return None;
    }

    if let Some(explicit) = std::env::var_os("PANES_CLAUDE_CODE_EXECUTABLE") {
        let explicit = PathBuf::from(explicit);
        if runtime_env::is_executable_file(&explicit) {
            return Some(explicit);
        }
    }

    let shim_dir = runtime_env::app_data_dir().join("bin");
    let mut path_entries = runtime_env::augmented_path_entries();
    path_entries.retain(|entry| !paths_match(entry, &shim_dir));
    let search_path = std::env::join_paths(path_entries).ok()?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    which::which_in("claude", Some(search_path), cwd).ok()
}

async fn probe_claude_version(executable: &Path) -> Option<String> {
    let mut command = Command::new(executable);
    process_utils::configure_tokio_command(&mut command);
    let output = timeout(Duration::from_secs(5), command.arg("--version").output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn effort_description(effort: &str) -> String {
    match effort {
        "low" => "Quick, efficient responses",
        "medium" => "Balanced reasoning",
        "high" => "Deep, thorough reasoning",
        "xhigh" => "Extended exploration for agentic coding",
        "max" => "Highest available reasoning effort",
        _ => "Claude runtime effort level",
    }
    .to_string()
}

fn claude_model_info(
    id: &str,
    display_name: &str,
    description: &str,
    hidden: bool,
    is_default: bool,
    default_reasoning_effort: &str,
    supported_reasoning_efforts: &[&str],
) -> ModelInfo {
    ModelInfo {
        id: id.to_string(),
        display_name: display_name.to_string(),
        description: description.to_string(),
        hidden,
        is_default,
        upgrade: None,
        availability_nux: None,
        upgrade_info: None,
        input_modalities: vec!["text".to_string(), "image".to_string()],
        attachment_modalities: vec!["text".to_string(), "image".to_string()],
        limits: None,
        supports_personality: false,
        default_reasoning_effort: default_reasoning_effort.to_string(),
        supported_reasoning_efforts: supported_reasoning_efforts
            .iter()
            .map(|reasoning_effort| ReasoningEffortOption {
                reasoning_effort: (*reasoning_effort).to_string(),
                description: effort_description(reasoning_effort),
            })
            .collect(),
    }
}

fn legacy_claude_models() -> Vec<ModelInfo> {
    vec![
        claude_model_info(
            "claude-opus-4-7",
            "Claude Opus 4.7",
            "Legacy model retained for existing threads",
            true,
            false,
            "xhigh",
            &["low", "medium", "high", "xhigh", "max"],
        ),
        claude_model_info(
            "claude-opus-4-6",
            "Claude Opus 4.6",
            "Legacy model retained for existing threads",
            true,
            false,
            "high",
            &["low", "medium", "high"],
        ),
        claude_model_info(
            "claude-sonnet-4-6",
            "Claude Sonnet 4.6",
            "Legacy model retained for existing threads",
            true,
            false,
            "medium",
            &["low", "medium", "high"],
        ),
        claude_model_info(
            "claude-haiku-4-5",
            "Claude Haiku 4.5",
            "Legacy model retained for existing threads",
            true,
            false,
            "low",
            &["low", "medium", "high"],
        ),
    ]
}

fn with_legacy_claude_models(mut models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    for legacy_model in legacy_claude_models() {
        if !models.iter().any(|model| model.id == legacy_model.id) {
            models.push(legacy_model);
        }
    }
    models
}

fn default_effort_for_claude_model(
    model: &SidecarModelInfo,
    supported_efforts: &[String],
) -> String {
    if supported_efforts.is_empty() {
        return String::new();
    }

    let identity = format!(
        "{} {} {} {}",
        model.value,
        model.display_name,
        model.description,
        model.resolved_model.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    let preferred = if identity.contains("haiku") {
        "low"
    } else if identity.contains("sonnet") {
        "medium"
    } else {
        "high"
    };

    supported_efforts
        .iter()
        .find(|effort| effort.as_str() == preferred)
        .or_else(|| {
            supported_efforts
                .iter()
                .find(|effort| effort.as_str() == "medium")
        })
        .or_else(|| supported_efforts.first())
        .cloned()
        .unwrap_or_default()
}

fn inferred_claude_model_name(model: &SidecarModelInfo) -> String {
    let identity = format!(
        "{} {} {}",
        model.description,
        model.resolved_model.as_deref().unwrap_or_default(),
        model.value
    )
    .to_lowercase();

    if identity.contains("fable") {
        "Fable"
    } else if identity.contains("opus") {
        "Opus"
    } else if identity.contains("sonnet") {
        "Sonnet"
    } else if identity.contains("haiku") {
        "Haiku"
    } else {
        "Claude"
    }
    .to_string()
}

fn map_claude_model(model: SidecarModelInfo) -> Option<ModelInfo> {
    let id = model.value.trim().to_string();
    if id.is_empty() {
        return None;
    }

    let supported_efforts = if model.supports_effort {
        model
            .supported_effort_levels
            .iter()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .fold(Vec::new(), |mut efforts, effort| {
                if !efforts.contains(&effort) {
                    efforts.push(effort);
                }
                efforts
            })
    } else {
        Vec::new()
    };
    let default_reasoning_effort = default_effort_for_claude_model(&model, &supported_efforts);

    let display_name = if id == "default"
        && model
            .display_name
            .trim()
            .to_lowercase()
            .starts_with("default")
    {
        inferred_claude_model_name(&model)
    } else {
        model.display_name.trim().to_string()
    };

    Some(ModelInfo {
        display_name,
        description: model.description.trim().to_string(),
        hidden: false,
        is_default: id == "default",
        upgrade: None,
        availability_nux: None,
        upgrade_info: None,
        input_modalities: vec!["text".to_string(), "image".to_string()],
        attachment_modalities: vec!["text".to_string(), "image".to_string()],
        limits: None,
        supports_personality: false,
        default_reasoning_effort,
        supported_reasoning_efforts: supported_efforts
            .into_iter()
            .map(|reasoning_effort| ReasoningEffortOption {
                description: effort_description(&reasoning_effort),
                reasoning_effort,
            })
            .collect(),
        id,
    })
}

fn map_claude_models(models: Vec<SidecarModelInfo>) -> Vec<ModelInfo> {
    let default_resolved_model = models
        .iter()
        .find(|model| model.value.trim() == "default")
        .and_then(|model| model.resolved_model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let concrete_default_id = default_resolved_model.and_then(|resolved_model| {
        models
            .iter()
            .find(|model| {
                model.value.trim() != "default"
                    && model.resolved_model.as_deref().map(str::trim) == Some(resolved_model)
            })
            .map(|model| model.value.trim().to_string())
    });

    models
        .into_iter()
        .filter(|model| !(model.value.trim() == "default" && concrete_default_id.is_some()))
        .filter_map(map_claude_model)
        .map(|mut model| {
            if concrete_default_id.as_deref() == Some(model.id.as_str()) {
                model.is_default = true;
            }
            model
        })
        .collect()
}

async fn detect_node_via_login_shell() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        for powershell in runtime_env::windows_login_probe_shells() {
            let mut cmd = Command::new(&powershell);
            cmd.args([
                "-NoLogo",
                "-Command",
                "(Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source",
            ]);
            process_utils::configure_tokio_command(&mut cmd);

            let Ok(Ok(output)) = timeout(Duration::from_secs(10), cmd.output()).await else {
                continue;
            };
            if !output.status.success() {
                continue;
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let Some(path) = runtime_env::parse_windows_single_path_output(&stdout) else {
                continue;
            };

            let path = PathBuf::from(path);
            if path.is_file() {
                return Some(path);
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        for shell in runtime_env::login_probe_shells() {
            let output = match timeout(
                LOGIN_SHELL_PROBE_TIMEOUT,
                Command::new(&shell)
                    .args(runtime_env::login_probe_shell_args(
                        &shell,
                        "command -v node",
                    ))
                    .output(),
            )
            .await
            {
                Err(_) => {
                    log::warn!(
                        "timed out probing Node.js via login shell `{}`",
                        shell.display()
                    );
                    continue;
                }
                Ok(Ok(output)) if output.status.success() => output,
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
        with_legacy_claude_models(vec![claude_model_info(
            "default",
            "Claude",
            "Model selected by the active Claude Code runtime",
            false,
            true,
            "",
            &[],
        )])
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
                                            content: trim_action_output_delta_content(&content),
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
                                    // Emit non-trivial stop reason BEFORE TurnCompleted so it
                                    // lands in the current assistant message, not a new shell.
                                    // Skip "end_turn" — that is the normal completion case.
                                    if let Some(ref stop_reason) = stop_reason {
                                        if stop_reason != "end_turn" {
                                            event_tx
                                                .send(EngineEvent::Notice {
                                                    kind: "claude_stop_reason".to_string(),
                                                    level: "info".to_string(),
                                                    title: "Claude stop reason".to_string(),
                                                    message: stop_reason.clone(),
                                                })
                                                .await
                                                .ok();
                                        }
                                    }
                                    event_tx
                                        .send(EngineEvent::TurnCompleted {
                                            token_usage: token_usage.map(|usage| super::TokenUsage {
                                                input: usage.input,
                                                output: usage.output,
                                                reasoning: None,
                                                cache_read: None,
                                                cache_write: None,
                                                cost_usd: None,
                                            }),
                                            status: completion_status,
                                        })
                                        .await
                                        .ok();
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
                                                fable_weekly_percent: usage.fable_weekly_percent,
                                                opus_weekly_percent: usage.opus_weekly_percent,
                                                sonnet_weekly_percent: usage.sonnet_weekly_percent,
                                                five_hour_resets_at: usage.five_hour_resets_at,
                                                weekly_resets_at: usage.weekly_resets_at,
                                                fable_weekly_resets_at: usage
                                                    .fable_weekly_resets_at,
                                                opus_weekly_resets_at: usage.opus_weekly_resets_at,
                                                sonnet_weekly_resets_at: usage
                                                    .sonnet_weekly_resets_at,
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
                                SidecarEvent::Ready
                                | SidecarEvent::Models { .. }
                                | SidecarEvent::Version { .. } => {}
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("claude sidecar: event receiver lagged by {n} messages");
                            let message = format!(
                                "Claude sidecar event stream skipped {n} messages under load."
                            );
                            event_tx
                                .send(EngineEvent::Notice {
                                    kind: "claude_event_lag".to_string(),
                                    level: "warning".to_string(),
                                    title: "Claude event lag".to_string(),
                                    message: message.clone(),
                                })
                                .await
                                .ok();
                            event_tx
                                .send(EngineEvent::Error {
                                    message,
                                    recoverable: true,
                                })
                                .await
                                .ok();
                            event_tx
                                .send(EngineEvent::TurnCompleted {
                                    token_usage: None,
                                    status: TurnCompletionStatus::Failed,
                                })
                                .await
                                .ok();
                            let mut state = state_ref.lock().await;
                            if let Some(config) = state.threads.get_mut(&engine_thread_id_owned) {
                                config.active_request_id = None;
                            }
                            break;
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
        _route: Option<ApprovalRequestRoute>,
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
                action_id, message, ..
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
                "fableWeeklyPercent": 40,
                "fableWeeklyResetsAt": 1740100000,
            },
        }))
        .expect("usage_limits_updated should deserialize");

        match event {
            SidecarEvent::UsageLimitsUpdated { usage, .. } => {
                assert_eq!(usage.five_hour_percent, Some(87));
                assert_eq!(usage.five_hour_resets_at, Some(1_740_000_000));
                assert_eq!(usage.fable_weekly_percent, Some(40));
                assert_eq!(usage.fable_weekly_resets_at, Some(1_740_100_000));
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn maps_runtime_model_aliases_and_effort_levels() {
        let model = map_claude_model(SidecarModelInfo {
            value: "claude-fable-5[1m]".to_string(),
            display_name: "Fable".to_string(),
            description: "Fable 5".to_string(),
            supports_effort: true,
            supported_effort_levels: vec![
                "low".to_string(),
                "medium".to_string(),
                "high".to_string(),
                "xhigh".to_string(),
                "max".to_string(),
            ],
            resolved_model: Some("claude-fable-5".to_string()),
        })
        .expect("runtime model should map");

        assert_eq!(model.id, "claude-fable-5[1m]");
        assert_eq!(model.display_name, "Fable");
        assert_eq!(model.default_reasoning_effort, "high");
        assert_eq!(
            model
                .supported_reasoning_efforts
                .iter()
                .map(|effort| effort.reasoning_effort.as_str())
                .collect::<Vec<_>>(),
            vec!["low", "medium", "high", "xhigh", "max"]
        );
    }

    #[test]
    fn collapses_default_alias_into_matching_concrete_model() {
        let models = map_claude_models(vec![
            SidecarModelInfo {
                value: "default".to_string(),
                display_name: "Default (recommended)".to_string(),
                description: "Opus 4.8 with 1M context".to_string(),
                supports_effort: true,
                supported_effort_levels: vec!["high".to_string()],
                resolved_model: Some("claude-opus-4-8[1m]".to_string()),
            },
            SidecarModelInfo {
                value: "opus[1m]".to_string(),
                display_name: "Opus".to_string(),
                description: "Opus 4.8 with 1M context".to_string(),
                supports_effort: true,
                supported_effort_levels: vec!["high".to_string()],
                resolved_model: Some("claude-opus-4-8[1m]".to_string()),
            },
            SidecarModelInfo {
                value: "sonnet".to_string(),
                display_name: "Sonnet".to_string(),
                description: "Sonnet 5".to_string(),
                supports_effort: true,
                supported_effort_levels: vec!["medium".to_string()],
                resolved_model: Some("claude-sonnet-5".to_string()),
            },
        ]);

        assert_eq!(
            models
                .iter()
                .map(|model| model.display_name.as_str())
                .collect::<Vec<_>>(),
            vec!["Opus", "Sonnet"]
        );
        assert!(models[0].is_default);
        assert!(!models[1].is_default);
    }

    #[test]
    fn renames_unresolved_default_alias_to_inferred_family() {
        let model = map_claude_model(SidecarModelInfo {
            value: "default".to_string(),
            display_name: "Default (recommended)".to_string(),
            description: "Opus 4.6, most capable for complex work".to_string(),
            supports_effort: true,
            supported_effort_levels: vec!["high".to_string()],
            resolved_model: None,
        })
        .expect("default model should map");

        assert_eq!(model.id, "default");
        assert_eq!(model.display_name, "Opus");
        assert!(model.is_default);
    }

    #[test]
    fn runtime_models_without_effort_support_do_not_invent_effort_levels() {
        let model = map_claude_model(SidecarModelInfo {
            value: "haiku".to_string(),
            display_name: "Haiku".to_string(),
            description: "Fastest for quick answers".to_string(),
            supports_effort: false,
            supported_effort_levels: vec!["low".to_string()],
            resolved_model: None,
        })
        .expect("runtime model should map");

        assert!(model.default_reasoning_effort.is_empty());
        assert!(model.supported_reasoning_efforts.is_empty());
    }

    #[tokio::test]
    async fn runtime_model_fallback_prefers_cached_catalog() {
        let engine = ClaudeSidecarEngine::default();
        let cached = vec![ModelInfo {
            id: "claude-fable-5[1m]".to_string(),
            display_name: "Fable".to_string(),
            description: "Fable 5".to_string(),
            hidden: false,
            is_default: false,
            upgrade: None,
            availability_nux: None,
            upgrade_info: None,
            input_modalities: vec!["text".to_string(), "image".to_string()],
            attachment_modalities: vec!["text".to_string(), "image".to_string()],
            limits: None,
            supports_personality: false,
            default_reasoning_effort: "high".to_string(),
            supported_reasoning_efforts: Vec::new(),
        }];
        engine.state.lock().await.runtime_model_cache = Some(cached.clone());

        assert_eq!(
            engine
                .runtime_model_fallback()
                .await
                .into_iter()
                .map(|model| model.id)
                .collect::<Vec<_>>(),
            cached.into_iter().map(|model| model.id).collect::<Vec<_>>()
        );
    }

    #[test]
    fn fallback_catalog_preserves_legacy_thread_model_ids() {
        let models = ClaudeSidecarEngine::default().models();
        let default_model = models
            .iter()
            .find(|model| model.id == "default")
            .expect("fallback catalog should retain the runtime default");

        assert!(default_model.is_default);
        assert!(!default_model.hidden);

        for legacy_id in [
            "claude-opus-4-7",
            "claude-opus-4-6",
            "claude-sonnet-4-6",
            "claude-haiku-4-5",
        ] {
            let legacy_model = models
                .iter()
                .find(|model| model.id == legacy_id)
                .unwrap_or_else(|| panic!("fallback catalog should retain {legacy_id}"));
            assert!(legacy_model.hidden);
            assert!(!legacy_model.is_default);
        }
    }

    #[test]
    fn discovered_legacy_model_is_not_duplicated_or_hidden() {
        let discovered = claude_model_info(
            "claude-sonnet-4-6",
            "Sonnet",
            "Discovered from the active runtime",
            false,
            true,
            "medium",
            &["low", "medium", "high"],
        );
        let models = with_legacy_claude_models(vec![discovered]);
        let matching_models = models
            .iter()
            .filter(|model| model.id == "claude-sonnet-4-6")
            .collect::<Vec<_>>();

        assert_eq!(matching_models.len(), 1);
        assert!(!matching_models[0].hidden);
        assert!(matching_models[0].is_default);
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
    fn node_resolution_falls_back_from_incompatible_app_path_to_login_shell() {
        let resolution = resolve_node_candidates(
            Some("/usr/local/bin:/usr/bin".to_string()),
            Some(NodeExecutableCandidate {
                path: PathBuf::from("/usr/local/bin/node"),
                version: Some("16.15.1".to_string()),
                compatible: false,
            }),
            Some(NodeExecutableCandidate {
                path: PathBuf::from("/Users/test/.fnm/node"),
                version: Some("25.6.1".to_string()),
                compatible: true,
            }),
        );

        assert_eq!(
            resolution.executable,
            Some(PathBuf::from("/Users/test/.fnm/node"))
        );
        assert_eq!(resolution.source, "login-shell");
        assert_eq!(resolution.rejected_executables.len(), 1);
        assert_eq!(
            resolution.rejected_executables[0].version.as_deref(),
            Some("16.15.1")
        );
    }

    #[test]
    fn node_runtime_rejects_versions_before_disposable_child_process_support() {
        for version in ["20.0.0", "20.4.0", "18.20.0"] {
            assert!(!node_runtime_is_compatible(&NodeRuntimeProbe {
                version: version.to_string(),
                explicit_resource_management: true,
                disposable_child_process: true,
            }));
        }
    }

    #[test]
    fn node_runtime_requires_a_disposable_child_process() {
        assert!(!node_runtime_is_compatible(&NodeRuntimeProbe {
            version: "20.5.0".to_string(),
            explicit_resource_management: true,
            disposable_child_process: false,
        }));
        assert!(node_runtime_is_compatible(&NodeRuntimeProbe {
            version: "20.5.0".to_string(),
            explicit_resource_management: true,
            disposable_child_process: true,
        }));
        assert!(node_runtime_is_compatible(&NodeRuntimeProbe {
            version: "25.6.1".to_string(),
            explicit_resource_management: true,
            disposable_child_process: true,
        }));
    }

    #[test]
    fn incompatible_node_runtime_is_reported_as_unavailable() {
        let resolution = resolve_node_candidates(
            Some("/usr/local/bin:/usr/bin".to_string()),
            Some(NodeExecutableCandidate {
                path: PathBuf::from("/usr/local/bin/node"),
                version: Some("16.15.1".to_string()),
                compatible: false,
            }),
            None,
        );

        assert!(resolution.executable.is_none());
        let details = node_unavailable_details_for_platform("macos", &resolution);
        assert!(details.contains("Node.js 20.5+"));
        assert!(details.contains("Node.js 16.15.1"));
        assert!(details.contains("/usr/local/bin/node"));
    }

    #[test]
    fn node_unavailable_details_for_windows_mentions_path_guidance() {
        let details = node_unavailable_details_for_platform(
            "windows",
            &NodeExecutableResolution {
                executable: None,
                source: "unavailable",
                app_path: Some(r"C:\Windows\System32".to_string()),
                rejected_executables: Vec::new(),
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
                rejected_executables: Vec::new(),
            },
        );

        assert!(fixes.contains(&"where node".to_string()));
        assert!(fixes.contains(&"echo %PATH%".to_string()));
        assert!(fixes.iter().any(|fix| fix.contains("restart Panes")));
    }
}
