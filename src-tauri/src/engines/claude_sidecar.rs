use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    ActionResult, ActionType, Engine, EngineEvent, EngineThread, ModelInfo, OutputStream,
    ReasoningEffortOption, SandboxPolicy, ThreadScope, TokenUsage, TurnCompletionStatus, TurnInput,
};

/// Stores thread-level state needed across turns (session ID, cwd, sandbox config).
#[derive(Debug, Clone)]
struct ClaudeThreadState {
    /// The Claude Code `--session-id` for conversation continuity.
    session_id: String,
    /// Working directory for the subprocess.
    cwd: String,
    /// Model to use.
    model: String,
    /// Sandbox policy.
    sandbox: SandboxPolicy,
    /// Active child process PID (for interrupt).
    child_id: Option<u32>,
}

pub struct ClaudeSidecarEngine {
    threads: Arc<RwLock<HashMap<String, ClaudeThreadState>>>,
}

impl Default for ClaudeSidecarEngine {
    fn default() -> Self {
        Self {
            threads: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl ClaudeSidecarEngine {
    /// Resolve the `claude` CLI binary path.
    fn cli_path() -> Option<String> {
        which::which("claude")
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    }

    /// Build the argument list for a `claude -p` invocation.
    fn build_args(
        message: &str,
        session_id: &str,
        model: &str,
        sandbox: &SandboxPolicy,
    ) -> Vec<String> {
        let mut args = vec![
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--include-partial-messages".to_string(),
            "--session-id".to_string(),
            session_id.to_string(),
            "--model".to_string(),
            model.to_string(),
        ];

        // Permission mode based on sandbox policy
        if let Some(ref policy) = sandbox.approval_policy {
            if policy == "untrusted" {
                args.push("--permission-mode".to_string());
                args.push("plan".to_string());
            }
        }

        // Reasoning effort
        if let Some(ref effort) = sandbox.reasoning_effort {
            args.push("--effort".to_string());
            args.push(effort.clone());
        }

        // Writable directories
        for root in &sandbox.writable_roots {
            args.push("--add-dir".to_string());
            args.push(root.clone());
        }

        // The prompt itself
        args.push(message.to_string());

        args
    }
}

#[async_trait]
impl Engine for ClaudeSidecarEngine {
    fn id(&self) -> &str {
        "claude"
    }

    fn name(&self) -> &str {
        "Claude Code"
    }

    fn models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "claude-sonnet-4-6".to_string(),
                display_name: "Claude Sonnet 4.6".to_string(),
                description: "Fast and intelligent, great for most coding tasks".to_string(),
                hidden: false,
                is_default: true,
                upgrade: None,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick responses, less deliberation".to_string(),
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
            ModelInfo {
                id: "claude-opus-4-6".to_string(),
                display_name: "Claude Opus 4.6".to_string(),
                description: "Most capable model for complex reasoning and code".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                default_reasoning_effort: "high".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick responses".to_string(),
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
            ModelInfo {
                id: "claude-haiku-4-5".to_string(),
                display_name: "Claude Haiku 4.5".to_string(),
                description: "Fastest model, best for simple tasks".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                default_reasoning_effort: "low".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Quick responses".to_string(),
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
        Self::cli_path().is_some()
    }

    async fn version(&self) -> Option<String> {
        let cli = Self::cli_path()?;
        let output = Command::new(&cli)
            .arg("--version")
            .env_remove("CLAUDECODE")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .ok()?;
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() {
            None
        } else {
            Some(version)
        }
    }

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error> {
        let engine_thread_id = resume_engine_thread_id
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("claude-{}", Uuid::new_v4()));

        let cwd = match &scope {
            ThreadScope::Repo { repo_path } => repo_path.clone(),
            ThreadScope::Workspace { root_path, .. } => root_path.clone(),
        };

        // Extract session_id from existing state or create new one
        let session_id = if let Some(existing) = resume_engine_thread_id {
            let threads = self.threads.read().await;
            if let Some(state) = threads.get(existing) {
                state.session_id.clone()
            } else {
                Uuid::new_v4().to_string()
            }
        } else {
            Uuid::new_v4().to_string()
        };

        let state = ClaudeThreadState {
            session_id,
            cwd,
            model: model.to_string(),
            sandbox,
            child_id: None,
        };

        self.threads
            .write()
            .await
            .insert(engine_thread_id.clone(), state);

        Ok(EngineThread { engine_thread_id })
    }

    async fn send_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        let cli =
            Self::cli_path().ok_or_else(|| anyhow::anyhow!("claude CLI not found in PATH"))?;

        let thread_state = {
            let threads = self.threads.read().await;
            threads
                .get(engine_thread_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("thread not found: {engine_thread_id}"))?
        };

        let args = Self::build_args(
            &input.message,
            &thread_state.session_id,
            &thread_state.model,
            &thread_state.sandbox,
        );

        log::debug!(
            "claude: spawning CLI in {} with session {}",
            thread_state.cwd,
            thread_state.session_id
        );

        let mut child = Command::new(&cli)
            .args(&args)
            .current_dir(&thread_state.cwd)
            .env_remove("CLAUDECODE")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| anyhow::anyhow!("failed to spawn claude CLI: {e}"))?;

        // Store child PID for interrupt
        if let Some(pid) = child.id() {
            let mut threads = self.threads.write().await;
            if let Some(state) = threads.get_mut(engine_thread_id) {
                state.child_id = Some(pid);
            }
        }

        event_tx.send(EngineEvent::TurnStarted).await.ok();

        let result = process_claude_output(&mut child, &event_tx, &cancellation).await;

        // Clear child PID
        {
            let mut threads = self.threads.write().await;
            if let Some(state) = threads.get_mut(engine_thread_id) {
                state.child_id = None;
            }
        }

        match result {
            Ok(turn_result) => {
                let failed = matches!(turn_result.status, TurnCompletionStatus::Failed);
                event_tx
                    .send(EngineEvent::TurnCompleted {
                        token_usage: turn_result.token_usage,
                        status: turn_result.status,
                    })
                    .await
                    .ok();
                if failed {
                    if let Some(error_msg) = turn_result.error_message {
                        return Err(anyhow::anyhow!("{error_msg}"));
                    }
                }
                Ok(())
            }
            Err(e) => {
                event_tx
                    .send(EngineEvent::TurnCompleted {
                        token_usage: None,
                        status: TurnCompletionStatus::Failed,
                    })
                    .await
                    .ok();
                Err(e)
            }
        }
    }

    async fn respond_to_approval(
        &self,
        _approval_id: &str,
        _response: Value,
    ) -> Result<(), anyhow::Error> {
        // Claude Code CLI handles approvals in interactive mode.
        // In --print mode we use --permission-mode to pre-configure policy.
        Ok(())
    }

    async fn interrupt(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let threads = self.threads.read().await;
        if let Some(state) = threads.get(engine_thread_id) {
            if let Some(pid) = state.child_id {
                log::debug!("claude: sending SIGTERM to PID {pid}");
                #[cfg(unix)]
                {
                    // SAFETY: sending a signal to a known child PID.
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }
                }
                #[cfg(not(unix))]
                {
                    let _ = pid;
                    log::warn!("claude: interrupt not implemented on this platform");
                }
            }
        }
        Ok(())
    }
}

// ── Stream-JSON output processing ───────────────────────────────────

struct TurnResult {
    token_usage: Option<TokenUsage>,
    status: TurnCompletionStatus,
    error_message: Option<String>,
}

/// Tracks an in-progress tool_use content block during streaming.
#[derive(Debug, Clone)]
struct ToolUseState {
    tool_id: String,
    tool_name: String,
    input_json: String,
    action_id: String,
}

/// Process JSONL output from `claude --print --output-format stream-json`.
///
/// Each line from stdout is a JSON object. Key event types:
/// - `{"type":"system","subtype":"init",...}`
/// - `{"type":"content_block_start","index":N,"content_block":{...}}`
/// - `{"type":"content_block_delta","index":N,"delta":{...}}`
/// - `{"type":"content_block_stop","index":N}`
/// - `{"type":"assistant","message":{...}}`
/// - `{"type":"tool_result","tool_use_id":"...","content":"..."}`
/// - `{"type":"result","subtype":"success"|"error",...}`
async fn process_claude_output(
    child: &mut Child,
    event_tx: &mpsc::Sender<EngineEvent>,
    cancellation: &CancellationToken,
) -> Result<TurnResult, anyhow::Error> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("failed to capture claude stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("failed to capture claude stderr"))?;

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr);

    // Collect stderr in background
    let stderr_handle = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut buf).await;
        buf
    });

    let mut turn_result = TurnResult {
        token_usage: None,
        status: TurnCompletionStatus::Completed,
        error_message: None,
    };

    let mut active_tool_uses: HashMap<u64, ToolUseState> = HashMap::new();

    loop {
        tokio::select! {
            _ = cancellation.cancelled() => {
                let _ = child.kill().await;
                turn_result.status = TurnCompletionStatus::Interrupted;
                break;
            }
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let parsed: Value = match serde_json::from_str(&line) {
                            Ok(v) => v,
                            Err(e) => {
                                log::debug!("claude: ignoring unparseable line: {e}");
                                continue;
                            }
                        };
                        process_stream_json_event(
                            &parsed,
                            event_tx,
                            &mut turn_result,
                            &mut active_tool_uses,
                        )
                        .await;
                    }
                    Ok(None) => break,
                    Err(e) => {
                        log::warn!("claude: error reading stdout: {e}");
                        break;
                    }
                }
            }
        }
    }

    // Wait for process to finish
    let exit_status = child.wait().await;

    let stderr_content = stderr_handle.await.unwrap_or_default();
    if !stderr_content.trim().is_empty() {
        log::debug!("claude stderr: {}", stderr_content.trim());
    }

    if let Ok(status) = exit_status {
        if !status.success() && matches!(turn_result.status, TurnCompletionStatus::Completed) {
            turn_result.status = TurnCompletionStatus::Failed;
            if turn_result.error_message.is_none() {
                let error = if stderr_content.trim().is_empty() {
                    format!("claude exited with status {status}")
                } else {
                    stderr_content.trim().to_string()
                };
                turn_result.error_message = Some(error.clone());
                event_tx
                    .send(EngineEvent::Error {
                        message: error,
                        recoverable: false,
                    })
                    .await
                    .ok();
            }
        }
    }

    Ok(turn_result)
}

async fn process_stream_json_event(
    event: &Value,
    event_tx: &mpsc::Sender<EngineEvent>,
    turn_result: &mut TurnResult,
    active_tool_uses: &mut HashMap<u64, ToolUseState>,
) {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");

    match event_type {
        "content_block_start" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
            let block = event.get("content_block").unwrap_or(&Value::Null);
            let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");

            if block_type == "tool_use" {
                let tool_id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let tool_name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();

                let action_id = Uuid::new_v4().to_string();
                let action_type = classify_tool_action(&tool_name);
                let summary = format_tool_summary(&tool_name);

                event_tx
                    .send(EngineEvent::ActionStarted {
                        action_id: action_id.clone(),
                        engine_action_id: Some(tool_id.clone()),
                        action_type,
                        summary,
                        details: serde_json::json!({"tool": tool_name}),
                    })
                    .await
                    .ok();

                active_tool_uses.insert(
                    index,
                    ToolUseState {
                        tool_id,
                        tool_name,
                        input_json: String::new(),
                        action_id,
                    },
                );
            }
        }

        "content_block_delta" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
            let delta = event.get("delta").unwrap_or(&Value::Null);
            let delta_type = delta.get("type").and_then(Value::as_str).unwrap_or("");

            match delta_type {
                "text_delta" => {
                    if let Some(text) = delta.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            event_tx
                                .send(EngineEvent::TextDelta {
                                    content: text.to_string(),
                                })
                                .await
                                .ok();
                        }
                    }
                }
                "thinking_delta" => {
                    if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                        if !thinking.is_empty() {
                            event_tx
                                .send(EngineEvent::ThinkingDelta {
                                    content: thinking.to_string(),
                                })
                                .await
                                .ok();
                        }
                    }
                }
                "input_json_delta" => {
                    if let Some(partial) = delta.get("partial_json").and_then(Value::as_str) {
                        if let Some(tool_state) = active_tool_uses.get_mut(&index) {
                            tool_state.input_json.push_str(partial);
                        }
                    }
                }
                _ => {}
            }
        }

        "content_block_stop" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
            if let Some(tool_state) = active_tool_uses.get(&index) {
                if !tool_state.input_json.is_empty() {
                    let display =
                        if let Ok(parsed) = serde_json::from_str::<Value>(&tool_state.input_json) {
                            serde_json::to_string_pretty(&parsed)
                                .unwrap_or_else(|_| tool_state.input_json.clone())
                        } else {
                            tool_state.input_json.clone()
                        };
                    event_tx
                        .send(EngineEvent::ActionOutputDelta {
                            action_id: tool_state.action_id.clone(),
                            stream: OutputStream::Stdout,
                            content: display,
                        })
                        .await
                        .ok();
                }
            }
        }

        "assistant" => {
            if let Some(message) = event.get("message") {
                // Handle tool_use blocks that weren't streamed via content_block_start
                if let Some(content) = message.get("content").and_then(Value::as_array) {
                    for block in content {
                        let block_type =
                            block.get("type").and_then(Value::as_str).unwrap_or("");
                        if block_type == "tool_use" {
                            let tool_id = block
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();

                            let already_tracked = active_tool_uses
                                .values()
                                .any(|ts| ts.tool_id == tool_id);

                            if !already_tracked {
                                let tool_name = block
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .unwrap_or("unknown")
                                    .to_string();
                                let input =
                                    block.get("input").cloned().unwrap_or(Value::Null);
                                let new_action_id = Uuid::new_v4().to_string();
                                let action_type = classify_tool_action(&tool_name);
                                let summary = format_tool_summary(&tool_name);

                                event_tx
                                    .send(EngineEvent::ActionStarted {
                                        action_id: new_action_id.clone(),
                                        engine_action_id: Some(tool_id),
                                        action_type,
                                        summary,
                                        details: serde_json::json!({"tool": tool_name, "input": input}),
                                    })
                                    .await
                                    .ok();

                                if let Ok(display) = serde_json::to_string_pretty(&input) {
                                    event_tx
                                        .send(EngineEvent::ActionOutputDelta {
                                            action_id: new_action_id,
                                            stream: OutputStream::Stdout,
                                            content: display,
                                        })
                                        .await
                                        .ok();
                                }
                            }
                        }
                    }
                }

                // Extract token usage
                if let Some(usage) = message.get("usage") {
                    let input = usage
                        .get("input_tokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    let output = usage
                        .get("output_tokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    turn_result.token_usage = Some(TokenUsage { input, output });
                }
            }
        }

        "tool_result" => {
            let tool_use_id = event
                .get("tool_use_id")
                .and_then(Value::as_str)
                .unwrap_or("");
            let subtype = event
                .get("subtype")
                .and_then(Value::as_str)
                .unwrap_or("success");
            let content = event
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("");

            if let Some(tool_state) = active_tool_uses
                .values()
                .find(|ts| ts.tool_id == tool_use_id)
            {
                let action_id = tool_state.action_id.clone();
                let success = subtype != "error";

                if !content.is_empty() {
                    event_tx
                        .send(EngineEvent::ActionOutputDelta {
                            action_id: action_id.clone(),
                            stream: if success {
                                OutputStream::Stdout
                            } else {
                                OutputStream::Stderr
                            },
                            content: content.to_string(),
                        })
                        .await
                        .ok();
                }

                event_tx
                    .send(EngineEvent::ActionCompleted {
                        action_id,
                        result: ActionResult {
                            success,
                            output: if success {
                                Some(content.to_string())
                            } else {
                                None
                            },
                            error: if !success {
                                Some(content.to_string())
                            } else {
                                None
                            },
                            diff: None,
                            duration_ms: 0,
                        },
                    })
                    .await
                    .ok();
            }
        }

        "result" => {
            let subtype = event
                .get("subtype")
                .and_then(Value::as_str)
                .unwrap_or("success");
            let is_error = event
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            if is_error || subtype == "error" {
                let error_msg = event
                    .get("error")
                    .and_then(Value::as_str)
                    .or_else(|| event.get("result").and_then(Value::as_str))
                    .unwrap_or("Unknown error")
                    .to_string();

                turn_result.status = TurnCompletionStatus::Failed;
                turn_result.error_message = Some(error_msg.clone());

                event_tx
                    .send(EngineEvent::Error {
                        message: error_msg,
                        recoverable: false,
                    })
                    .await
                    .ok();
            }

            // Extract cost/usage info
            if let Some(usage) = event.get("usage") {
                let input = usage
                    .get("input_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let output = usage
                    .get("output_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                if input > 0 || output > 0 {
                    turn_result.token_usage = Some(TokenUsage { input, output });
                }
            }
        }

        "system" => {
            log::debug!(
                "claude system event: subtype={}",
                event
                    .get("subtype")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
            );
        }

        _ => {
            log::debug!("claude: unhandled event type: {event_type}");
        }
    }
}

fn classify_tool_action(tool_name: &str) -> ActionType {
    match tool_name {
        "Read" => ActionType::FileRead,
        "Glob" | "Grep" | "WebSearch" => ActionType::Search,
        "Write" => ActionType::FileWrite,
        "Edit" | "NotebookEdit" => ActionType::FileEdit,
        "Bash" => ActionType::Command,
        _ => ActionType::Other,
    }
}

fn format_tool_summary(tool_name: &str) -> String {
    match tool_name {
        "Read" => "Reading file".to_string(),
        "Write" => "Writing file".to_string(),
        "Edit" => "Editing file".to_string(),
        "Glob" => "Searching files".to_string(),
        "Grep" => "Searching content".to_string(),
        "Bash" => "Running command".to_string(),
        "WebFetch" => "Fetching web page".to_string(),
        "WebSearch" => "Searching the web".to_string(),
        "Task" => "Running subagent".to_string(),
        "NotebookEdit" => "Editing notebook".to_string(),
        _ => format!("Running {tool_name}"),
    }
}
