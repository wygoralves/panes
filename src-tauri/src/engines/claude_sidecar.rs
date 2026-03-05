use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

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

use super::{
    ActionResult, ActionType, Engine, EngineEvent, EngineThread, ModelInfo, ReasoningEffortOption,
    SandboxPolicy, ThreadScope, TurnCompletionStatus, TurnInput,
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
    },
    Error {
        id: Option<String>,
        message: String,
        recoverable: Option<bool>,
    },
    Version {
        id: Option<String>,
        version: String,
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
            | SidecarEvent::ActionCompleted { id, .. }
            | SidecarEvent::ApprovalRequested { id, .. }
            | SidecarEvent::TurnCompleted { id, .. }
            | SidecarEvent::Error { id, .. }
            | SidecarEvent::Version { id, .. } => id.as_deref(),
        }
    }
}

// ── Transport ─────────────────────────────────────────────────────────

struct ClaudeTransport {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    event_tx: broadcast::Sender<SidecarEvent>,
}

impl ClaudeTransport {
    async fn spawn(sidecar_path: PathBuf) -> anyhow::Result<Self> {
        let node =
            which::which("node").context("node executable not found in PATH — required for the Claude engine")?;

        let sidecar_dir = sidecar_path
            .parent()
            .map(|path| path.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let mut child = Command::new(node)
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

        let (event_tx, _) = broadcast::channel(256);

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
                resource_dir.join("sidecar-dist").join("claude-agent-sdk-server.mjs"),
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

impl ClaudeSidecarEngine {
    pub fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        let mut state = self.state.blocking_lock();
        state.resource_dir = resource_dir;
    }

    async fn ensure_transport(&self) -> anyhow::Result<Arc<ClaudeTransport>> {
        let mut state = self.state.lock().await;

        if let Some(ref transport) = state.transport {
            if transport.is_alive().await {
                return Ok(Arc::clone(transport));
            }
            log::warn!("claude sidecar process died, restarting…");
            state.transport = None;
        }

        let sidecar_path = ClaudeTransport::resolve_sidecar_path(state.resource_dir.as_ref())?;
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

    pub async fn health_report(&self) -> ClaudeHealthReport {
        let resource_dir = {
            let state = self.state.lock().await;
            state.resource_dir.clone()
        };
        let node_available = which::which("node").is_ok();
        let sidecar_exists = ClaudeTransport::resolve_sidecar_path(resource_dir.as_ref()).is_ok();
        let api_key_set = std::env::var("ANTHROPIC_API_KEY").is_ok();

        let mut checks = Vec::new();
        let mut warnings = Vec::new();
        let mut fixes = Vec::new();

        if node_available {
            checks.push("Node.js found in PATH".to_string());
        } else {
            warnings.push("Node.js not found in PATH".to_string());
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
            } else {
                "Claude Agent SDK engine has missing prerequisites".to_string()
            },
            warnings,
            checks,
            fixes,
        }
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
        which::which("node").is_ok()
            && {
                let state = self.state.lock().await;
                ClaudeTransport::resolve_sidecar_path(state.resource_dir.as_ref()).is_ok()
            }
    }

    async fn version(&self) -> Option<String> {
        Some("agent-sdk".to_string())
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
            "approvalPolicy": thread_config.sandbox.approval_policy.clone(),
            "allowNetwork": thread_config.sandbox.allow_network,
            "writableRoots": thread_config.sandbox.writable_roots.clone(),
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
                                    event_tx.send(EngineEvent::TurnStarted).await.ok();
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
                                            token_usage: None,
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
                                SidecarEvent::Error {
                                    message,
                                    recoverable,
                                    ..
                                } => {
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
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            event_tx
                                .send(EngineEvent::Error {
                                    message: "Claude sidecar process terminated unexpectedly"
                                        .to_string(),
                                    recoverable: false,
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

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
    ) -> Result<(), anyhow::Error> {
        let state = self.state.lock().await;
        if let Some(ref transport) = state.transport {
            let approval_cmd = serde_json::json!({
                "method": "approval_response",
                "params": {
                    "approvalId": approval_id,
                    "response": response,
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
}
