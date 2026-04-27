use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose, Engine as _};
use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{broadcast, mpsc, Mutex},
    time::{sleep, timeout},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::models::{
    OpenCodeAgentDto, OpenCodeCommandDto, OpenCodeMcpServerDto, OpenCodeRuntimeCatalogDto,
};
use crate::{process_utils, runtime_env};

use super::{
    normalize_approval_response_for_engine, trim_action_output_delta_content, ActionResult,
    ActionType, ApprovalRequestRoute, DiffScope, Engine, EngineEvent, EngineThread, ModelInfo,
    ModelLimits, OpenCodeRemoteSessionSummary, OutputStream, ReasoningEffortOption, SandboxPolicy,
    ThreadScope, TokenUsage, TurnCompletionStatus, TurnInput,
};

const OPENCODE_STARTUP_TIMEOUT: Duration = Duration::from_secs(8);
const OPENCODE_HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const OPENCODE_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const OPENCODE_RECONCILE_MESSAGE_LIMIT: usize = 128;
const SSE_IDLE_TIMEOUT: Duration = Duration::from_secs(900);
const SERVER_READY_PREFIX: &str = "opencode server listening";
const DEFAULT_HOST: &str = "127.0.0.1";
const OPENCODE_MESSAGE_ID_RANDOM_LEN: usize = 14;
const OPENCODE_ID_COUNTER_STEP: u64 = 0x1000;
const OPENCODE_ID_TIME_MASK: u64 = 0x0000_FFFF_FFFF_FFFF;

static LAST_OPENCODE_MESSAGE_SORT_VALUE: AtomicU64 = AtomicU64::new(0);

pub struct OpenCodeEngine {
    state: Arc<Mutex<OpenCodeState>>,
    http: reqwest::Client,
}

#[derive(Default)]
struct OpenCodeState {
    servers: HashMap<String, Arc<OpenCodeServer>>,
    sessions: HashMap<String, OpenCodeSession>,
    pending_requests: HashMap<String, PendingOpenCodeRequest>,
    runtime_model_cache: Option<Vec<ModelInfo>>,
}

#[derive(Clone)]
struct OpenCodeSession {
    cwd: String,
    model_id: String,
    reasoning_effort: Option<String>,
    agent: Option<String>,
    permission_mode: OpenCodePermissionMode,
    server: Arc<OpenCodeServer>,
}

struct OpenCodeServer {
    cwd: String,
    base_url: String,
    password: String,
    child: Mutex<Child>,
    event_bus: broadcast::Sender<Arc<OpenCodeBusEvent>>,
    pump_cancel: CancellationToken,
}

impl Drop for OpenCodeServer {
    fn drop(&mut self) {
        self.pump_cancel.cancel();
    }
}

#[derive(Clone)]
enum PendingOpenCodeRequest {
    Permission {
        request_id: String,
        server: Arc<OpenCodeServer>,
    },
    Question {
        request_id: String,
        questions: Vec<OpenCodeQuestionInfo>,
        server: Arc<OpenCodeServer>,
    },
}

struct OpenCodePromptBody {
    message_id: String,
    body: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenCodePermissionMode {
    Ask,
    Allow,
    Deny,
}

#[derive(Debug, Clone)]
pub struct OpenCodeHealthReport {
    pub available: bool,
    pub version: Option<String>,
    pub details: Option<String>,
    pub warnings: Vec<String>,
    pub checks: Vec<String>,
    pub fixes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeHealthResponse {
    healthy: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeSessionInfo {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeSessionRecord {
    id: String,
    title: Option<String>,
    directory: String,
    permission: Option<Value>,
    time: OpenCodeSessionTime,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeSessionTime {
    created: i64,
    updated: i64,
    archived: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeAgentModelRef {
    #[serde(rename = "providerID")]
    provider_id: String,
    #[serde(rename = "modelID")]
    model_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeRuntimeAgent {
    name: String,
    description: Option<String>,
    mode: String,
    native: Option<bool>,
    hidden: Option<bool>,
    model: Option<OpenCodeAgentModelRef>,
    variant: Option<String>,
    steps: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeRuntimeCommand {
    name: String,
    description: Option<String>,
    agent: Option<String>,
    model: Option<String>,
    source: Option<String>,
    subtask: Option<bool>,
    #[serde(default)]
    hints: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeProviderList {
    all: Vec<OpenCodeProvider>,
    connected: Vec<String>,
    #[allow(dead_code)]
    default: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeProvider {
    id: String,
    name: String,
    models: HashMap<String, OpenCodeProviderModel>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeProviderModel {
    id: String,
    name: String,
    status: Option<String>,
    limit: Option<OpenCodeModelLimit>,
    capabilities: Option<OpenCodeModelCapabilities>,
    #[serde(default)]
    variants: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeVerboseModel {
    id: String,
    #[serde(rename = "providerID")]
    provider_id: String,
    name: String,
    status: Option<String>,
    limit: Option<OpenCodeModelLimit>,
    capabilities: Option<OpenCodeModelCapabilities>,
    #[serde(default)]
    variants: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeModelCapabilities {
    #[serde(default)]
    attachment: bool,
    input: Option<OpenCodeModelInputCapabilities>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenCodeModelLimit {
    context: Option<u64>,
    input: Option<u64>,
    output: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenCodeModelInputCapabilities {
    #[serde(default)]
    text: bool,
    #[serde(default)]
    image: bool,
    #[serde(default)]
    pdf: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeBusEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    properties: Value,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodePartEnvelope {
    part: OpenCodePart,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OpenCodePart {
    id: String,
    #[serde(rename = "messageID")]
    message_id: String,
    #[serde(rename = "type")]
    part_type: String,
    #[serde(rename = "sessionID")]
    session_id: Option<String>,
    #[serde(rename = "callID")]
    call_id: Option<String>,
    name: Option<String>,
    source: Option<Value>,
    metadata: Option<Value>,
    text: Option<String>,
    tool: Option<String>,
    state: Option<OpenCodeToolState>,
    reason: Option<String>,
    cost: Option<f64>,
    tokens: Option<OpenCodeStepTokenUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeMessageWithParts {
    info: OpenCodeMessageInfo,
    #[serde(default)]
    parts: Vec<OpenCodePart>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeMessageInfo {
    id: String,
    role: String,
    #[serde(rename = "parentID")]
    parent_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct OpenCodeStepTokenUsage {
    #[serde(default)]
    input: u64,
    #[serde(default)]
    output: u64,
    #[serde(default)]
    reasoning: u64,
    #[serde(default)]
    cache: OpenCodeStepTokenCache,
    #[allow(dead_code)]
    total: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct OpenCodeStepTokenCache {
    #[serde(default)]
    read: u64,
    #[serde(default)]
    write: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OpenCodeToolState {
    status: String,
    input: Option<Value>,
    raw: Option<String>,
    title: Option<String>,
    output: Option<String>,
    error: Option<String>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeQuestionInfo {
    question: String,
    header: String,
    #[serde(default)]
    options: Vec<OpenCodeQuestionOption>,
    multiple: Option<bool>,
    custom: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenCodeQuestionOption {
    label: String,
    description: String,
}

#[derive(Debug, Clone)]
struct PendingOpenCodeTextPart {
    message_id: String,
    text: String,
}

struct OpenCodeTurnMapper {
    prompt_message_id: String,
    message_roles: HashMap<String, String>,
    message_parents: HashMap<String, String>,
    emitted_text_by_part_id: HashMap<String, String>,
    pending_text_by_part_id: HashMap<String, PendingOpenCodeTextPart>,
    part_type_by_id: HashMap<String, String>,
    started_actions: HashSet<String>,
    completed_actions: HashSet<String>,
    latest_token_usage: Option<TokenUsage>,
    busy_seen: bool,
    content_seen: bool,
    completed: bool,
    failed: bool,
}

impl OpenCodeTurnMapper {
    fn new(prompt_message_id: String) -> Self {
        Self {
            prompt_message_id,
            message_roles: HashMap::new(),
            message_parents: HashMap::new(),
            emitted_text_by_part_id: HashMap::new(),
            pending_text_by_part_id: HashMap::new(),
            part_type_by_id: HashMap::new(),
            started_actions: HashSet::new(),
            completed_actions: HashSet::new(),
            latest_token_usage: None,
            busy_seen: false,
            content_seen: false,
            completed: false,
            failed: false,
        }
    }

    fn record_message(&mut self, message_id: &str, role: &str, parent_id: Option<&str>) {
        let role = role.trim().to_lowercase();
        self.message_roles
            .insert(message_id.to_string(), role.clone());
        if let Some(parent_id) = parent_id.filter(|value| !value.trim().is_empty()) {
            self.message_parents
                .insert(message_id.to_string(), parent_id.to_string());
        }
        if role == "user" {
            self.remove_pending_text_for_message(message_id);
        }
    }

    fn is_prompt_user_message(&self, message_id: &str) -> bool {
        message_id == self.prompt_message_id || is_user_message(&self.message_roles, message_id)
    }

    fn should_process_part_for_message(&self, message_id: &str) -> bool {
        if self.is_prompt_user_message(message_id) {
            return false;
        }
        self.message_parents
            .get(message_id)
            .map(|parent_id| parent_id == &self.prompt_message_id)
            .unwrap_or(true)
    }

    fn store_pending_text(&mut self, part_id: &str, message_id: &str, text: &str) {
        self.pending_text_by_part_id
            .entry(part_id.to_string())
            .and_modify(|pending| {
                pending.message_id = message_id.to_string();
                pending.text.push_str(text);
            })
            .or_insert_with(|| PendingOpenCodeTextPart {
                message_id: message_id.to_string(),
                text: text.to_string(),
            });
    }

    fn remove_pending_text_for_message(&mut self, message_id: &str) {
        self.pending_text_by_part_id
            .retain(|_, pending| pending.message_id != message_id);
    }
}

async fn emit_opencode_part_delta(
    mapper: &mut OpenCodeTurnMapper,
    event_tx: &mpsc::Sender<EngineEvent>,
    part_id: &str,
    part_type: &str,
    delta: &str,
) {
    if delta.is_empty() {
        return;
    }

    mapper.content_seen = true;
    mapper
        .emitted_text_by_part_id
        .entry(part_id.to_string())
        .and_modify(|existing| existing.push_str(delta))
        .or_insert_with(|| delta.to_string());

    let event = if part_type == "reasoning" {
        EngineEvent::ThinkingDelta {
            content: delta.to_string(),
        }
    } else {
        EngineEvent::TextDelta {
            content: delta.to_string(),
        }
    };
    event_tx.send(event).await.ok();
}

async fn emit_opencode_part_snapshot(
    mapper: &mut OpenCodeTurnMapper,
    event_tx: &mpsc::Sender<EngineEvent>,
    part_id: &str,
    part_type: &str,
    text: &str,
) {
    let previous = mapper
        .emitted_text_by_part_id
        .get(part_id)
        .map(String::as_str)
        .unwrap_or("");
    let Some(delta) = text.strip_prefix(previous) else {
        if !previous.is_empty() {
            log::debug!(
                "ignoring non-append OpenCode text snapshot for part {part_id}; previous_len={}, next_len={}",
                previous.len(),
                text.len()
            );
            return;
        }
        return emit_opencode_part_delta(mapper, event_tx, part_id, part_type, text).await;
    };
    if delta.is_empty() {
        return;
    }
    mapper
        .emitted_text_by_part_id
        .insert(part_id.to_string(), text.to_string());
    mapper.content_seen = true;
    let event = if part_type == "reasoning" {
        EngineEvent::ThinkingDelta {
            content: delta.to_string(),
        }
    } else {
        EngineEvent::TextDelta {
            content: delta.to_string(),
        }
    };
    event_tx.send(event).await.ok();
}

async fn flush_pending_opencode_text_for_part(
    mapper: &mut OpenCodeTurnMapper,
    event_tx: &mpsc::Sender<EngineEvent>,
    part_id: &str,
) {
    let Some(pending) = mapper.pending_text_by_part_id.remove(part_id) else {
        return;
    };
    if mapper.is_prompt_user_message(&pending.message_id) {
        return;
    }
    let Some(part_type) = mapper.part_type_by_id.get(part_id).cloned() else {
        mapper
            .pending_text_by_part_id
            .insert(part_id.to_string(), pending);
        return;
    };
    emit_opencode_part_delta(mapper, event_tx, part_id, &part_type, &pending.text).await;
}

async fn emit_turn_completed(
    mapper: &mut OpenCodeTurnMapper,
    event_tx: &mpsc::Sender<EngineEvent>,
    status: TurnCompletionStatus,
) {
    if mapper.completed {
        return;
    }

    mapper.completed = true;
    let token_usage = if status == TurnCompletionStatus::Completed {
        mapper.latest_token_usage.clone()
    } else {
        None
    };
    event_tx
        .send(EngineEvent::TurnCompleted {
            token_usage,
            status,
        })
        .await
        .ok();
}

impl Default for OpenCodeEngine {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(OpenCodeState::default())),
            http: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl Engine for OpenCodeEngine {
    fn id(&self) -> &str {
        "opencode"
    }

    fn name(&self) -> &str {
        "OpenCode"
    }

    fn models(&self) -> Vec<ModelInfo> {
        vec![model_info(
            "opencode/big-pickle",
            "OpenCode Big Pickle",
            "Default OpenCode-hosted coding model.",
            true,
            reasoning_efforts_from_variant_names(&["high", "max"]),
            vec!["text".to_string()],
        )]
    }

    async fn is_available(&self) -> bool {
        resolve_opencode_executable().is_some()
    }

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread> {
        let cwd = scope_cwd(&scope);
        let parsed_model = parse_model_slug(model)
            .with_context(|| format!("OpenCode model `{model}` must use provider/model format"))?;
        let _ = parsed_model;
        let permission_mode = permission_mode_from_policy(sandbox.approval_policy.as_ref());
        let reasoning_effort = self
            .resolve_session_reasoning_effort(model, sandbox.reasoning_effort.as_deref())
            .await;
        let agent = normalize_opencode_agent(sandbox.opencode_agent.as_deref());

        if let Some(existing_id) = resume_engine_thread_id {
            let mut state = self.state.lock().await;
            if let Some(existing) = state.sessions.get(existing_id).cloned() {
                if existing.cwd == cwd && existing.permission_mode == permission_mode {
                    if let Some(existing) = state.sessions.get_mut(existing_id) {
                        existing.model_id = model.to_string();
                        existing.reasoning_effort = reasoning_effort.clone();
                        existing.agent = agent.clone();
                    }
                    return Ok(EngineThread {
                        engine_thread_id: existing_id.to_string(),
                    });
                }

                if existing.cwd == cwd {
                    state.sessions.remove(existing_id);
                    drop(state);
                    let engine_thread_id = self
                        .create_session(existing.server.as_ref(), permission_mode)
                        .await?;
                    self.state.lock().await.sessions.insert(
                        engine_thread_id.clone(),
                        OpenCodeSession {
                            cwd,
                            model_id: model.to_string(),
                            reasoning_effort,
                            agent,
                            permission_mode,
                            server: existing.server,
                        },
                    );
                    return Ok(EngineThread { engine_thread_id });
                }
            }
        }

        let server = self.ensure_server(&cwd).await?;
        let engine_thread_id = match resume_engine_thread_id {
            Some(existing_id) => match self.get_session(server.as_ref(), existing_id).await {
                Ok(session) if session_permission_matches(&session, permission_mode) => {
                    existing_id.to_string()
                }
                Ok(_) => {
                    log::warn!(
                        "opencode session {existing_id} permission rules differ from requested mode; creating a new session"
                    );
                    self.create_session(server.as_ref(), permission_mode)
                        .await?
                }
                Err(error) => {
                    log::warn!(
                        "opencode session resume failed for {existing_id}, creating a new session: {error}"
                    );
                    self.create_session(server.as_ref(), permission_mode)
                        .await?
                }
            },
            None => {
                self.create_session(server.as_ref(), permission_mode)
                    .await?
            }
        };

        let previous = {
            let mut state = self.state.lock().await;
            state.sessions.insert(
                engine_thread_id.clone(),
                OpenCodeSession {
                    cwd: cwd.clone(),
                    model_id: model.to_string(),
                    reasoning_effort,
                    agent,
                    permission_mode,
                    server,
                },
            )
        };
        if let Some(previous) = previous {
            self.stop_server_if_unused(&previous.cwd).await;
        }

        Ok(EngineThread { engine_thread_id })
    }

    async fn send_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<()> {
        let session = {
            let state = self.state.lock().await;
            state
                .sessions
                .get(engine_thread_id)
                .cloned()
                .context("no OpenCode session found; was start_thread called?")?
        };

        // Subscribe to the persistent event bus BEFORE firing the prompt.
        // broadcast::Receiver does not replay history; it only delivers events
        // emitted after subscribe(). This eliminates the cross-turn replay race
        // that caused follow-up turns to immediately complete with no content
        // when a fresh `/event` HTTP connection delivered the prior turn's
        // buffered busy/idle events into the new turn's mapper.
        let mut events = session.server.event_bus.subscribe();

        let prompt = build_prompt_body(
            &session.model_id,
            session.reasoning_effort.as_deref(),
            session.agent.as_deref(),
            input,
        )?;
        let prompt_message_id = prompt.message_id.clone();
        let prompt_request =
            self.prompt_message(engine_thread_id, session.server.as_ref(), prompt.body);
        tokio::pin!(prompt_request);

        let mut mapper = OpenCodeTurnMapper::new(prompt_message_id);
        let mut last_relevant_event_at = Instant::now();

        loop {
            tokio::select! {
                _ = cancellation.cancelled() => {
                    self.interrupt(engine_thread_id).await?;
                    return Ok(());
                }
                result = &mut prompt_request => {
                    match result {
                        Ok(()) => {
                            if !mapper.completed {
                                self.reconcile_session_messages(
                                    engine_thread_id,
                                    &mut mapper,
                                    &event_tx,
                                    session.server.as_ref(),
                                )
                                .await;
                                self.complete_after_idle(&mut mapper, &event_tx).await;
                            }
                            return Ok(());
                        }
                        Err(error) => {
                            if mapper.completed {
                                log::warn!(
                                    "OpenCode /message request finished with an error after turn completion: {error:#}"
                                );
                                return Ok(());
                            }
                            event_tx
                                .send(EngineEvent::Error {
                                    message: format!("failed to send OpenCode prompt: {error:#}"),
                                    recoverable: false,
                                })
                                .await
                                .ok();
                            emit_turn_completed(
                                &mut mapper,
                                &event_tx,
                                TurnCompletionStatus::Failed,
                            )
                            .await;
                            return Err(error);
                        }
                    }
                }
                incoming = timeout(SSE_IDLE_TIMEOUT, events.recv()) => {
                    let event = match incoming.context("timed out waiting for OpenCode events")? {
                        Ok(event) => event,
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            log::warn!(
                                "opencode event bus lagged by {skipped} events for thread {engine_thread_id}"
                            );
                            continue;
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            anyhow::bail!("OpenCode event bus closed before the turn completed");
                        }
                    };
                    if event_matches_session(event.as_ref(), engine_thread_id) {
                        last_relevant_event_at = Instant::now();
                        self.handle_event(
                            engine_thread_id,
                            event.as_ref(),
                            &mut mapper,
                            &event_tx,
                            session.server.clone(),
                        )
                        .await;
                    } else if last_relevant_event_at.elapsed() > SSE_IDLE_TIMEOUT {
                        anyhow::bail!("timed out waiting for OpenCode turn events");
                    }
                    if mapper.completed {
                        match timeout(OPENCODE_COMMAND_TIMEOUT, &mut prompt_request).await {
                            Ok(Ok(())) => {}
                            Ok(Err(error)) => {
                                log::warn!(
                                    "OpenCode /message request errored after turn completion: {error:#}"
                                );
                            }
                            Err(_) => {
                                log::warn!(
                                    "timed out draining OpenCode /message response after turn completion"
                                );
                            }
                        }
                        return Ok(());
                    }
                }
            }
        }
    }

    async fn steer_message(&self, _engine_thread_id: &str, _input: TurnInput) -> Result<()> {
        anyhow::bail!("Mid-turn steering is not supported for OpenCode")
    }

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: Value,
        route: Option<ApprovalRequestRoute>,
    ) -> Result<()> {
        let normalized = normalize_approval_response_for_engine("opencode", response)
            .map_err(anyhow::Error::msg)?;
        let pending = {
            let state = self.state.lock().await;
            state.pending_requests.get(approval_id).cloned()
        };
        let pending = match pending {
            Some(pending) => pending,
            None => self
                .pending_request_from_route(route)
                .await
                .with_context(|| {
                    format!("OpenCode approval request `{approval_id}` was not found")
                })?,
        };

        let server_cwd = match pending {
            PendingOpenCodeRequest::Permission { request_id, server } => {
                let server_cwd = server.cwd.clone();
                let decision = normalized
                    .get("decision")
                    .and_then(Value::as_str)
                    .unwrap_or("decline");
                let reply = match decision {
                    "accept" => "once",
                    "accept_for_session" => "always",
                    "decline" | "cancel" => "reject",
                    _ => "reject",
                };
                self.request(
                    server.as_ref(),
                    reqwest::Method::POST,
                    &format!("/permission/{request_id}/reply"),
                )
                .json(&json!({ "reply": reply }))
                .send()
                .await?
                .error_for_status()
                .context("failed to reply to OpenCode permission request")?;
                server_cwd
            }
            PendingOpenCodeRequest::Question {
                request_id,
                questions,
                server,
            } => {
                let server_cwd = server.cwd.clone();
                if should_reject_question_response(&normalized) {
                    self.request(
                        server.as_ref(),
                        reqwest::Method::POST,
                        &format!("/question/{request_id}/reject"),
                    )
                    .send()
                    .await?
                    .error_for_status()
                    .context("failed to reject OpenCode question request")?;
                } else {
                    let answers = build_question_answers(&questions, normalized.get("answers"));
                    self.request(
                        server.as_ref(),
                        reqwest::Method::POST,
                        &format!("/question/{request_id}/reply"),
                    )
                    .json(&json!({ "answers": answers }))
                    .send()
                    .await?
                    .error_for_status()
                    .context("failed to reply to OpenCode question request")?;
                }
                server_cwd
            }
        };

        self.state.lock().await.pending_requests.remove(approval_id);
        self.stop_server_if_unused(&server_cwd).await;
        Ok(())
    }

    async fn interrupt(&self, engine_thread_id: &str) -> Result<()> {
        let session = {
            let state = self.state.lock().await;
            state.sessions.get(engine_thread_id).cloned()
        };
        let Some(session) = session else {
            return Ok(());
        };

        self.request(
            session.server.as_ref(),
            reqwest::Method::POST,
            &format!("/session/{engine_thread_id}/abort"),
        )
        .send()
        .await?
        .error_for_status()
        .context("failed to abort OpenCode session")?;
        Ok(())
    }

    async fn archive_thread(&self, engine_thread_id: &str) -> Result<()> {
        let removed = self.state.lock().await.sessions.remove(engine_thread_id);
        if let Some(session) = removed {
            self.patch_session_archive(
                session.server.as_ref(),
                engine_thread_id,
                Some(current_unix_time_millis()),
            )
            .await?;
            self.stop_server_if_unused(&session.cwd).await;
        }
        Ok(())
    }

    async fn unarchive_thread(&self, _engine_thread_id: &str) -> Result<()> {
        Ok(())
    }
}

impl OpenCodeEngine {
    async fn ensure_server(&self, cwd: &str) -> Result<Arc<OpenCodeServer>> {
        if let Some(server) = self.state.lock().await.servers.get(cwd).cloned() {
            return Ok(server);
        }

        let created = Arc::new(start_server(cwd).await?);
        let existing = {
            let mut state = self.state.lock().await;
            if let Some(server) = state.servers.get(cwd).cloned() {
                Some(server)
            } else {
                state.servers.insert(cwd.to_string(), created.clone());
                None
            }
        };

        if let Some(existing) = existing {
            created.stop().await;
            Ok(existing)
        } else {
            Ok(created)
        }
    }

    async fn stop_server_if_unused(&self, cwd: &str) {
        let server = {
            let mut state = self.state.lock().await;
            if state.sessions.values().any(|session| session.cwd == cwd) {
                None
            } else {
                state.servers.remove(cwd)
            }
        };
        if let Some(server) = server {
            server.stop().await;
        }
    }

    async fn pending_request_from_route(
        &self,
        route: Option<ApprovalRequestRoute>,
    ) -> Result<PendingOpenCodeRequest> {
        let route = route.context("missing persisted OpenCode approval route")?;
        let details = route
            .raw_request_id
            .as_object()
            .context("invalid persisted OpenCode approval route")?;
        let request_id = details
            .get("requestID")
            .and_then(Value::as_str)
            .map(str::to_string)
            .context("persisted OpenCode approval route is missing requestID")?;
        let cwd = details
            .get("cwd")
            .and_then(Value::as_str)
            .context("persisted OpenCode approval route is missing cwd")?;
        let server = self.ensure_server(cwd).await?;

        match route.server_method.as_str() {
            "opencode/permission" => Ok(PendingOpenCodeRequest::Permission { request_id, server }),
            "opencode/question" => {
                let questions = details
                    .get("questions")
                    .cloned()
                    .and_then(|value| {
                        serde_json::from_value::<Vec<OpenCodeQuestionInfo>>(value).ok()
                    })
                    .unwrap_or_default();
                Ok(PendingOpenCodeRequest::Question {
                    request_id,
                    questions,
                    server,
                })
            }
            method => anyhow::bail!("unsupported OpenCode approval route `{method}`"),
        }
    }

    pub async fn prewarm(&self) -> Result<()> {
        let executable =
            resolve_opencode_executable().context("`opencode` executable not found")?;
        let _ = run_opencode_command(&executable, &["--version"]).await?;
        Ok(())
    }

    pub async fn health_report(&self) -> OpenCodeHealthReport {
        let Some(executable) = resolve_opencode_executable() else {
            return OpenCodeHealthReport {
                available: false,
                version: None,
                details: Some("`opencode` executable not found in PATH".to_string()),
                warnings: vec![],
                checks: vec![],
                fixes: vec!["npm install -g opencode-ai".to_string()],
            };
        };

        let version = match run_opencode_command(&executable, &["--version"]).await {
            Ok(output) => output.lines().next().map(str::trim).map(str::to_string),
            Err(error) => {
                return OpenCodeHealthReport {
                    available: false,
                    version: None,
                    details: Some(format!("failed to run opencode --version: {error}")),
                    warnings: vec![],
                    checks: vec![],
                    fixes: vec![],
                }
            }
        };

        OpenCodeHealthReport {
            available: true,
            version,
            details: Some(format!("OpenCode executable: {}", executable.display())),
            warnings: vec![],
            checks: vec!["opencode --version".to_string()],
            fixes: vec![],
        }
    }

    pub async fn list_models_runtime(&self) -> Vec<ModelInfo> {
        {
            let state = self.state.lock().await;
            if let Some(cache) = state.runtime_model_cache.clone() {
                return cache;
            }
        }

        let models = match self.load_models_from_verbose_command().await {
            Ok(models) if !models.is_empty() => models,
            Ok(_) => match self.load_models_from_command().await {
                Ok(models) if !models.is_empty() => models,
                Ok(_) | Err(_) => self.models(),
            },
            Err(error) => {
                log::warn!(
                    "failed to load verbose opencode models; falling back to basic list: {error}"
                );
                match self.load_models_from_command().await {
                    Ok(models) if !models.is_empty() => models,
                    Ok(_) | Err(_) => self.models(),
                }
            }
        };

        self.state.lock().await.runtime_model_cache = Some(models.clone());
        models
    }

    pub async fn runtime_catalog(&self, cwd: &str) -> Result<OpenCodeRuntimeCatalogDto> {
        let server = self.ensure_server(cwd).await?;
        let result = async {
            let agents = self
                .request(server.as_ref(), reqwest::Method::GET, "/agent")
                .send()
                .await?
                .error_for_status()
                .context("failed to list OpenCode agents")?
                .json::<Vec<OpenCodeRuntimeAgent>>()
                .await
                .context("failed to parse OpenCode agents")?;

            let commands = self
                .request(server.as_ref(), reqwest::Method::GET, "/command")
                .send()
                .await?
                .error_for_status()
                .context("failed to list OpenCode commands")?
                .json::<Vec<OpenCodeRuntimeCommand>>()
                .await
                .context("failed to parse OpenCode commands")?;

            let mcp = self
                .request(server.as_ref(), reqwest::Method::GET, "/mcp")
                .send()
                .await?
                .error_for_status()
                .context("failed to read OpenCode MCP status")?
                .json::<HashMap<String, Value>>()
                .await
                .context("failed to parse OpenCode MCP status")?;

            Ok(OpenCodeRuntimeCatalogDto {
                agents: map_runtime_agents(agents),
                commands: map_runtime_commands(commands),
                mcp_servers: map_runtime_mcp_servers(mcp),
            })
        }
        .await;
        self.stop_server_if_unused(cwd).await;
        result
    }

    pub async fn list_sessions(
        &self,
        cwd: &str,
        search_term: Option<&str>,
        archived: Option<bool>,
    ) -> Result<Vec<OpenCodeRemoteSessionSummary>> {
        let server = self.ensure_server(cwd).await?;
        let result = async {
            let mut query = vec![
                ("directory", cwd.to_string()),
                ("roots", "true".to_string()),
                ("limit", "200".to_string()),
            ];
            if let Some(search_term) = search_term.map(str::trim).filter(|value| !value.is_empty())
            {
                query.push(("search", search_term.to_string()));
            }

            let sessions = self
                .request(server.as_ref(), reqwest::Method::GET, "/session")
                .query(&query)
                .send()
                .await?
                .error_for_status()
                .context("failed to list OpenCode sessions")?
                .json::<Vec<OpenCodeSessionRecord>>()
                .await
                .context("failed to parse OpenCode sessions")?;

            let mut summaries = sessions
                .into_iter()
                .map(map_session_record)
                .filter(|session| {
                    archived
                        .map(|expected| session.archived == expected)
                        .unwrap_or(true)
                })
                .collect::<Vec<_>>();
            summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            Ok(summaries)
        }
        .await;
        self.stop_server_if_unused(cwd).await;
        result
    }

    pub async fn read_session(
        &self,
        cwd: &str,
        session_id: &str,
    ) -> Result<OpenCodeRemoteSessionSummary> {
        let server = self.ensure_server(cwd).await?;
        let result = async {
            let session = self
                .request(
                    server.as_ref(),
                    reqwest::Method::GET,
                    &format!("/session/{session_id}"),
                )
                .query(&[("directory", cwd)])
                .send()
                .await?
                .error_for_status()
                .context("failed to read OpenCode session")?
                .json::<OpenCodeSessionRecord>()
                .await
                .context("failed to parse OpenCode session")?;
            Ok(map_session_record(session))
        }
        .await;
        self.stop_server_if_unused(cwd).await;
        result
    }

    pub async fn set_session_archived(
        &self,
        cwd: &str,
        session_id: &str,
        archived: bool,
    ) -> Result<()> {
        let server = self.ensure_server(cwd).await?;
        let result = self
            .patch_session_archive(
                server.as_ref(),
                session_id,
                Some(if archived {
                    current_unix_time_millis()
                } else {
                    0
                }),
            )
            .await;

        if result.is_ok() {
            let removed = self.state.lock().await.sessions.remove(session_id);
            if let Some(session) = removed {
                self.stop_server_if_unused(&session.cwd).await;
            }
        }
        self.stop_server_if_unused(cwd).await;
        result
    }

    pub async fn forget_session(&self, session_id: &str) {
        let removed = self.state.lock().await.sessions.remove(session_id);
        if let Some(session) = removed {
            self.stop_server_if_unused(&session.cwd).await;
        }
    }

    async fn resolve_session_reasoning_effort(
        &self,
        model_id: &str,
        requested_effort: Option<&str>,
    ) -> Option<String> {
        let models = self.list_models_runtime().await;
        let model = models.iter().find(|model| model.id == model_id)?;
        resolve_model_reasoning_effort(model, requested_effort)
    }

    async fn load_models_from_verbose_command(&self) -> Result<Vec<ModelInfo>> {
        let executable =
            resolve_opencode_executable().context("`opencode` executable not found")?;
        let output = run_opencode_command(&executable, &["models", "--verbose"]).await?;
        let records = parse_verbose_model_records(&output)?;
        let mut models = Vec::new();

        for (index, record) in records.into_iter().enumerate() {
            if record.status.as_deref() == Some("deprecated") {
                continue;
            }
            let slug = format!("{}/{}", record.provider_id, record.id);
            if parse_model_slug(&slug).is_none() {
                continue;
            }
            let modalities = model_modalities_from_capabilities(record.capabilities.as_ref());
            let attachment_modalities =
                attachment_modalities_from_capabilities(record.capabilities.as_ref());
            models.push(model_info_with_metadata(
                &slug,
                &record.name,
                "OpenCode model",
                index == 0,
                reasoning_efforts_from_variants(&record.variants),
                modalities,
                attachment_modalities,
                model_limits(record.limit.as_ref()),
            ));
        }

        Ok(models)
    }

    async fn load_models_from_command(&self) -> Result<Vec<ModelInfo>> {
        let executable =
            resolve_opencode_executable().context("`opencode` executable not found")?;
        let output = run_opencode_command(&executable, &["models"]).await?;
        let mut models = Vec::new();
        for (index, line) in output.lines().enumerate() {
            let slug = line.trim();
            if parse_model_slug(slug).is_none() {
                continue;
            }
            models.push(model_info(
                slug,
                slug,
                "OpenCode model",
                index == 0,
                Vec::new(),
                vec!["text".to_string()],
            ));
        }

        Ok(models)
    }

    #[allow(dead_code)]
    async fn load_models_from_provider_endpoint(
        &self,
        server: &OpenCodeServer,
    ) -> Result<Vec<ModelInfo>> {
        let list = self
            .request(server, reqwest::Method::GET, "/provider")
            .send()
            .await?
            .error_for_status()?
            .json::<OpenCodeProviderList>()
            .await?;
        let connected: HashSet<&str> = list.connected.iter().map(String::as_str).collect();
        let mut models = Vec::new();

        for provider in list.all {
            if !connected.contains(provider.id.as_str()) {
                continue;
            }
            for model in provider.models.values() {
                if model.status.as_deref() == Some("deprecated") {
                    continue;
                }
                let slug = format!("{}/{}", provider.id, model.id);
                let modalities = model_modalities(model);
                let attachment_modalities =
                    attachment_modalities_from_capabilities(model.capabilities.as_ref());
                models.push(model_info_with_metadata(
                    &slug,
                    &model.name,
                    &format!("{} model via OpenCode", provider.name),
                    false,
                    reasoning_efforts_from_variants(&model.variants),
                    modalities,
                    attachment_modalities,
                    model_limits(model.limit.as_ref()),
                ));
            }
        }
        if let Some(first) = models.first_mut() {
            first.is_default = true;
        }
        Ok(models)
    }

    async fn create_session(
        &self,
        server: &OpenCodeServer,
        permission_mode: OpenCodePermissionMode,
    ) -> Result<String> {
        let session = self
            .request(server, reqwest::Method::POST, "/session")
            .json(&json!({
                "permission": permission_rules(permission_mode),
            }))
            .send()
            .await?
            .error_for_status()
            .context("failed to create OpenCode session")?
            .json::<OpenCodeSessionInfo>()
            .await
            .context("failed to parse OpenCode session response")?;
        Ok(session.id)
    }

    async fn get_session(
        &self,
        server: &OpenCodeServer,
        session_id: &str,
    ) -> Result<OpenCodeSessionRecord> {
        let session = self
            .request(
                server,
                reqwest::Method::GET,
                &format!("/session/{session_id}"),
            )
            .send()
            .await?
            .error_for_status()
            .context("failed to read OpenCode session")?
            .json::<OpenCodeSessionRecord>()
            .await
            .context("failed to parse OpenCode session")?;
        Ok(session)
    }

    async fn patch_session_archive(
        &self,
        server: &OpenCodeServer,
        session_id: &str,
        archived: Option<i64>,
    ) -> Result<()> {
        self.request(
            server,
            reqwest::Method::PATCH,
            &format!("/session/{session_id}"),
        )
        .json(&json!({
            "time": {
                "archived": archived,
            },
        }))
        .send()
        .await?
        .error_for_status()
        .context("failed to update OpenCode session archive state")?;
        Ok(())
    }

    async fn prompt_message(
        &self,
        engine_thread_id: &str,
        server: &OpenCodeServer,
        body: Value,
    ) -> Result<()> {
        let response = self
            .request(
                server,
                reqwest::Method::POST,
                &opencode_prompt_message_path(engine_thread_id),
            )
            .json(&body)
            .send()
            .await
            .context("failed to send OpenCode prompt")?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .context("failed to read OpenCode prompt response")?;
        if !status.is_success() {
            let body = String::from_utf8_lossy(&body);
            anyhow::bail!("failed to send OpenCode prompt: HTTP {status}: {body}");
        }
        Ok(())
    }

    fn request(
        &self,
        server: &OpenCodeServer,
        method: reqwest::Method,
        path: &str,
    ) -> reqwest::RequestBuilder {
        let url = format!("{}{}", server.base_url.trim_end_matches('/'), path);
        self.http
            .request(method, url)
            .headers(auth_headers(&server.password))
    }

    async fn handle_event(
        &self,
        engine_thread_id: &str,
        event: &OpenCodeBusEvent,
        mapper: &mut OpenCodeTurnMapper,
        event_tx: &mpsc::Sender<EngineEvent>,
        server: Arc<OpenCodeServer>,
    ) {
        if !event_matches_session(event, engine_thread_id) {
            return;
        }

        match event.event_type.as_str() {
            "message.updated" => {
                if let Some(info) = event.properties.get("info").and_then(Value::as_object) {
                    if let (Some(id), Some(role)) = (
                        info.get("id").and_then(Value::as_str),
                        info.get("role").and_then(Value::as_str),
                    ) {
                        mapper.record_message(
                            id,
                            role,
                            info.get("parentID").and_then(Value::as_str),
                        );
                    }
                }
            }
            "message.part.delta" => {
                let field = event
                    .properties
                    .get("field")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if field != "text" {
                    return;
                }
                let delta = event
                    .properties
                    .get("delta")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if delta.is_empty() {
                    return;
                }
                let part_id = event
                    .properties
                    .get("partID")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let message_id = event
                    .properties
                    .get("messageID")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if part_id.is_empty() || message_id.is_empty() {
                    return;
                }
                if mapper.is_prompt_user_message(message_id) {
                    mapper.pending_text_by_part_id.remove(part_id);
                    return;
                }
                if !mapper.should_process_part_for_message(message_id) {
                    mapper.pending_text_by_part_id.remove(part_id);
                    return;
                }
                let Some(part_type) = mapper.part_type_by_id.get(part_id).cloned() else {
                    mapper.store_pending_text(part_id, message_id, delta);
                    return;
                };
                emit_opencode_part_delta(mapper, event_tx, part_id, &part_type, delta).await;
            }
            "message.part.updated" => {
                let Ok(envelope) =
                    serde_json::from_value::<OpenCodePartEnvelope>(event.properties.clone())
                else {
                    return;
                };
                self.handle_part_updated(&envelope.part, mapper, event_tx)
                    .await;
            }
            "session.status" => {
                let status = event
                    .properties
                    .get("status")
                    .and_then(|value| value.get("type"))
                    .and_then(Value::as_str);
                match status {
                    Some("busy") | Some("retry") => {
                        mapper.busy_seen = true;
                    }
                    Some("idle") if mapper.busy_seen || mapper.content_seen => {
                        self.reconcile_session_messages(
                            engine_thread_id,
                            mapper,
                            event_tx,
                            server.as_ref(),
                        )
                        .await;
                        self.complete_after_idle(mapper, event_tx).await;
                    }
                    _ => {}
                }
            }
            "session.idle" if mapper.busy_seen || mapper.content_seen => {
                self.reconcile_session_messages(
                    engine_thread_id,
                    mapper,
                    event_tx,
                    server.as_ref(),
                )
                .await;
                self.complete_after_idle(mapper, event_tx).await;
            }
            "session.error" => {
                mapper.failed = true;
                mapper.content_seen = true;
                let message = session_error_message(&event.properties);
                event_tx
                    .send(EngineEvent::Error {
                        message,
                        recoverable: false,
                    })
                    .await
                    .ok();
                emit_turn_completed(mapper, event_tx, TurnCompletionStatus::Failed).await;
            }
            "session.diff" => {
                if let Some(diff) = format_session_diff(&event.properties) {
                    mapper.content_seen = true;
                    event_tx
                        .send(EngineEvent::DiffUpdated {
                            diff,
                            scope: DiffScope::Workspace,
                        })
                        .await
                        .ok();
                }
            }
            "permission.asked" => {
                mapper.content_seen = true;
                self.handle_permission_asked(&event.properties, event_tx, server)
                    .await;
            }
            "question.asked" => {
                mapper.content_seen = true;
                self.handle_question_asked(&event.properties, event_tx, server)
                    .await;
            }
            _ => {}
        }
    }

    async fn complete_after_idle(
        &self,
        mapper: &mut OpenCodeTurnMapper,
        event_tx: &mpsc::Sender<EngineEvent>,
    ) {
        if mapper.content_seen {
            emit_turn_completed(mapper, event_tx, TurnCompletionStatus::Completed).await;
            return;
        }

        event_tx
            .send(EngineEvent::Error {
                message: "OpenCode became idle without producing a response for this prompt."
                    .to_string(),
                recoverable: false,
            })
            .await
            .ok();
        emit_turn_completed(mapper, event_tx, TurnCompletionStatus::Failed).await;
    }

    async fn handle_part_updated(
        &self,
        part: &OpenCodePart,
        mapper: &mut OpenCodeTurnMapper,
        event_tx: &mpsc::Sender<EngineEvent>,
    ) {
        if !mapper.should_process_part_for_message(&part.message_id) {
            mapper.pending_text_by_part_id.remove(&part.id);
            return;
        }
        mapper
            .part_type_by_id
            .insert(part.id.clone(), part.part_type.clone());
        match part.part_type.as_str() {
            "text" | "reasoning" => {
                if mapper.is_prompt_user_message(&part.message_id) {
                    mapper.pending_text_by_part_id.remove(&part.id);
                    return;
                }
                let Some(text) = part.text.as_deref() else {
                    flush_pending_opencode_text_for_part(mapper, event_tx, &part.id).await;
                    return;
                };
                mapper.pending_text_by_part_id.remove(&part.id);
                emit_opencode_part_snapshot(mapper, event_tx, &part.id, &part.part_type, text)
                    .await;
            }
            "tool" => {
                self.handle_tool_part(part, mapper, event_tx).await;
            }
            "agent" => {
                self.handle_agent_part(part, mapper, event_tx).await;
            }
            "patch" => {
                mapper.content_seen = true;
                event_tx
                    .send(EngineEvent::DiffUpdated {
                        diff: serde_json::to_string_pretty(part).unwrap_or_default(),
                        scope: DiffScope::Workspace,
                    })
                    .await
                    .ok();
            }
            "step-finish" => {
                if let Some(usage) = token_usage_from_step_finish(part) {
                    mapper.latest_token_usage = Some(usage);
                    mapper.content_seen = true;
                }
            }
            _ => {
                mapper.pending_text_by_part_id.remove(&part.id);
            }
        }
    }

    async fn reconcile_session_messages(
        &self,
        engine_thread_id: &str,
        mapper: &mut OpenCodeTurnMapper,
        event_tx: &mpsc::Sender<EngineEvent>,
        server: &OpenCodeServer,
    ) {
        let result = timeout(OPENCODE_COMMAND_TIMEOUT, async {
            let response = self
                .request(
                    server,
                    reqwest::Method::GET,
                    &format!(
                        "/session/{engine_thread_id}/message?limit={OPENCODE_RECONCILE_MESSAGE_LIMIT}"
                    ),
                )
                .send()
                .await?
                .error_for_status()?;
            response.json::<Vec<OpenCodeMessageWithParts>>().await
        })
        .await;

        let messages = match result {
            Ok(Ok(messages)) => messages,
            Ok(Err(error)) => {
                log::warn!("failed to reconcile OpenCode messages after idle: {error}");
                return;
            }
            Err(_) => {
                log::warn!("timed out reconciling OpenCode messages after idle");
                return;
            }
        };

        for message in messages {
            mapper.record_message(
                &message.info.id,
                &message.info.role,
                message.info.parent_id.as_deref(),
            );
            if message.info.role != "assistant"
                || message.info.parent_id.as_deref() != Some(mapper.prompt_message_id.as_str())
            {
                continue;
            }
            for part in message.parts {
                self.handle_part_updated(&part, mapper, event_tx).await;
            }
        }
    }

    async fn handle_tool_part(
        &self,
        part: &OpenCodePart,
        mapper: &mut OpenCodeTurnMapper,
        event_tx: &mpsc::Sender<EngineEvent>,
    ) {
        let action_id = part.id.clone();
        let tool_name = part.tool.clone().unwrap_or_else(|| "tool".to_string());
        let action_type = action_type_for_tool(&tool_name);
        let state = part.state.clone();
        let summary = state
            .as_ref()
            .and_then(|state| state.title.clone())
            .unwrap_or_else(|| tool_name.clone());

        if mapper.started_actions.insert(action_id.clone()) {
            mapper.content_seen = true;
            event_tx
                .send(EngineEvent::ActionStarted {
                    action_id: action_id.clone(),
                    engine_action_id: Some(part.message_id.clone()),
                    action_type: action_type.clone(),
                    summary: summary.clone(),
                    details: json!({
                        "tool": tool_name,
                        "callID": part.call_id.clone(),
                        "state": state.as_ref().and_then(|value| value.input.clone()),
                        "metadata": part.metadata.clone()
                            .or_else(|| state.as_ref().and_then(|value| value.metadata.clone())),
                    }),
                })
                .await
                .ok();
        }

        let Some(state) = state else {
            return;
        };
        match state.status.as_str() {
            "running" => {
                if let Some(title) = state.title {
                    event_tx
                        .send(EngineEvent::ActionProgressUpdated {
                            action_id,
                            message: title,
                        })
                        .await
                        .ok();
                }
            }
            "completed" | "error" => {
                if !mapper.completed_actions.insert(action_id.clone()) {
                    return;
                }
                if let Some(output) = state.output.clone().or(state.raw.clone()) {
                    let content = trim_action_output_delta_content(&output);
                    if !content.is_empty() {
                        event_tx
                            .send(EngineEvent::ActionOutputDelta {
                                action_id: action_id.clone(),
                                stream: OutputStream::Stdout,
                                content,
                            })
                            .await
                            .ok();
                    }
                }
                event_tx
                    .send(EngineEvent::ActionCompleted {
                        action_id,
                        result: ActionResult {
                            success: state.status == "completed",
                            output: state.output,
                            error: state.error,
                            diff: None,
                            duration_ms: 0,
                        },
                    })
                    .await
                    .ok();
            }
            _ => {}
        }
    }

    async fn handle_agent_part(
        &self,
        part: &OpenCodePart,
        mapper: &mut OpenCodeTurnMapper,
        event_tx: &mpsc::Sender<EngineEvent>,
    ) {
        let action_id = part.id.clone();
        let agent_name = part.name.clone().unwrap_or_else(|| "agent".to_string());
        let summary = format!("OpenCode agent: {agent_name}");

        if mapper.started_actions.insert(action_id.clone()) {
            mapper.content_seen = true;
            event_tx
                .send(EngineEvent::ActionStarted {
                    action_id: action_id.clone(),
                    engine_action_id: Some(part.message_id.clone()),
                    action_type: ActionType::Other,
                    summary,
                    details: json!({
                        "agent": agent_name,
                        "source": part.source.clone(),
                        "sessionID": part.session_id.clone(),
                        "messageID": part.message_id.clone(),
                    }),
                })
                .await
                .ok();
        }

        if mapper.completed_actions.insert(action_id.clone()) {
            event_tx
                .send(EngineEvent::ActionCompleted {
                    action_id,
                    result: ActionResult {
                        success: true,
                        output: None,
                        error: None,
                        diff: None,
                        duration_ms: 0,
                    },
                })
                .await
                .ok();
        }
    }

    async fn handle_permission_asked(
        &self,
        properties: &Value,
        event_tx: &mpsc::Sender<EngineEvent>,
        server: Arc<OpenCodeServer>,
    ) {
        let Some(request_id) = properties.get("id").and_then(Value::as_str) else {
            return;
        };
        let permission = properties
            .get("permission")
            .and_then(Value::as_str)
            .unwrap_or("tool");
        let approval_id = format!("opencode-permission-{request_id}");
        let action_type = action_type_for_permission(permission);
        let patterns = properties
            .get("patterns")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let cwd = server.cwd.clone();

        self.state.lock().await.pending_requests.insert(
            approval_id.clone(),
            PendingOpenCodeRequest::Permission {
                request_id: request_id.to_string(),
                server,
            },
        );

        event_tx
            .send(EngineEvent::ApprovalRequested {
                approval_id,
                action_type,
                summary: format!("OpenCode requests {permission} permission"),
                details: json!({
                    "_serverMethod": "item/permissions/requestApproval",
                    "permission": permission,
                    "patterns": patterns,
                    "metadata": properties.get("metadata").cloned().unwrap_or_else(|| json!({})),
                    "always": properties.get("always").cloned().unwrap_or_else(|| json!([])),
                    "tool": properties.get("tool").cloned(),
                    "_opencodeRequestKind": "permission",
                    "_opencodeRequestID": request_id,
                    "_opencodeSessionID": properties.get("sessionID").cloned().unwrap_or_else(|| json!(null)),
                    "_opencodeCwd": cwd,
                }),
            })
            .await
            .ok();
    }

    async fn handle_question_asked(
        &self,
        properties: &Value,
        event_tx: &mpsc::Sender<EngineEvent>,
        server: Arc<OpenCodeServer>,
    ) {
        let Some(request_id) = properties.get("id").and_then(Value::as_str) else {
            return;
        };
        let questions = properties
            .get("questions")
            .cloned()
            .and_then(|value| serde_json::from_value::<Vec<OpenCodeQuestionInfo>>(value).ok())
            .unwrap_or_default();
        let approval_id = format!("opencode-question-{request_id}");
        let cwd = server.cwd.clone();

        self.state.lock().await.pending_requests.insert(
            approval_id.clone(),
            PendingOpenCodeRequest::Question {
                request_id: request_id.to_string(),
                questions: questions.clone(),
                server,
            },
        );

        let question_details = questions
            .iter()
            .enumerate()
            .map(question_details_json)
            .collect::<Vec<_>>();

        event_tx
            .send(EngineEvent::ApprovalRequested {
                approval_id,
                action_type: ActionType::Other,
                summary: "OpenCode needs input".to_string(),
                details: json!({
                    "_serverMethod": "item/tool/requestUserInput",
                    "questions": question_details,
                    "tool": properties.get("tool").cloned(),
                    "_opencodeRequestKind": "question",
                    "_opencodeRequestID": request_id,
                    "_opencodeSessionID": properties.get("sessionID").cloned().unwrap_or_else(|| json!(null)),
                    "_opencodeCwd": cwd,
                }),
            })
            .await
            .ok();
    }
}

impl OpenCodeServer {
    async fn stop(&self) {
        let mut child = self.child.lock().await;
        if let Err(error) = child.kill().await {
            log::debug!("failed to stop OpenCode server process: {error}");
        }
    }
}

struct ParsedModelSlug {
    provider_id: String,
    model_id: String,
}

fn parse_model_slug(slug: &str) -> Option<ParsedModelSlug> {
    let trimmed = slug.trim();
    let separator = trimmed.find('/')?;
    if separator == 0 || separator + 1 >= trimmed.len() {
        return None;
    }
    Some(ParsedModelSlug {
        provider_id: trimmed[..separator].to_string(),
        model_id: trimmed[separator + 1..].to_string(),
    })
}

fn opencode_prompt_message_path(engine_thread_id: &str) -> String {
    format!("/session/{engine_thread_id}/message")
}

fn build_prompt_body(
    model_id: &str,
    reasoning_effort: Option<&str>,
    agent: Option<&str>,
    input: TurnInput,
) -> Result<OpenCodePromptBody> {
    let model = parse_model_slug(model_id)
        .with_context(|| format!("invalid OpenCode model `{model_id}`"))?;
    let message_id = new_message_id();
    let mut parts = vec![json!({
        "type": "text",
        "text": input.message,
    })];
    for attachment in input.attachments {
        parts.push(json!({
            "type": "file",
            "mime": attachment.mime_type.unwrap_or_else(|| "text/plain".to_string()),
            "filename": attachment.file_name,
            "url": file_url(&attachment.file_path),
        }));
    }

    let mut body = json!({
        "messageID": message_id.clone(),
        "model": {
            "providerID": model.provider_id,
            "modelID": model.model_id,
        },
        "parts": parts,
    });
    if let Some(object) = body.as_object_mut() {
        if let Some(agent) = normalize_opencode_agent(agent) {
            object.insert("agent".to_string(), json!(agent));
        }
        if let Some(variant) = reasoning_effort
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            object.insert("variant".to_string(), json!(variant));
        }
    }

    Ok(OpenCodePromptBody { message_id, body })
}

fn normalize_opencode_agent(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "build")
        .map(ToOwned::to_owned)
}

fn model_info(
    id: &str,
    display_name: &str,
    description: &str,
    is_default: bool,
    supported_reasoning_efforts: Vec<ReasoningEffortOption>,
    input_modalities: Vec<String>,
) -> ModelInfo {
    model_info_with_metadata(
        id,
        display_name,
        description,
        is_default,
        supported_reasoning_efforts,
        input_modalities,
        vec!["text".to_string()],
        None,
    )
}

fn model_info_with_metadata(
    id: &str,
    display_name: &str,
    description: &str,
    is_default: bool,
    supported_reasoning_efforts: Vec<ReasoningEffortOption>,
    input_modalities: Vec<String>,
    attachment_modalities: Vec<String>,
    limits: Option<ModelLimits>,
) -> ModelInfo {
    let default_reasoning_effort =
        default_reasoning_effort(&supported_reasoning_efforts).unwrap_or("medium");
    ModelInfo {
        id: id.to_string(),
        display_name: display_name.to_string(),
        description: description.to_string(),
        hidden: false,
        is_default,
        upgrade: None,
        availability_nux: None,
        upgrade_info: None,
        input_modalities,
        attachment_modalities,
        limits,
        supports_personality: false,
        default_reasoning_effort: default_reasoning_effort.to_string(),
        supported_reasoning_efforts,
    }
}

fn map_runtime_agents(agents: Vec<OpenCodeRuntimeAgent>) -> Vec<OpenCodeAgentDto> {
    agents
        .into_iter()
        .map(|agent| OpenCodeAgentDto {
            name: agent.name,
            description: agent.description,
            mode: agent.mode,
            native: agent.native.unwrap_or(false),
            hidden: agent.hidden.unwrap_or(false),
            model_provider_id: agent.model.as_ref().map(|model| model.provider_id.clone()),
            model_id: agent.model.as_ref().map(|model| model.model_id.clone()),
            variant: agent.variant,
            steps: agent.steps,
        })
        .collect()
}

fn map_runtime_commands(commands: Vec<OpenCodeRuntimeCommand>) -> Vec<OpenCodeCommandDto> {
    commands
        .into_iter()
        .map(|command| OpenCodeCommandDto {
            name: command.name,
            description: command.description,
            agent: command.agent,
            model: command.model,
            source: command.source,
            subtask: command.subtask.unwrap_or(false),
            hints: command.hints,
        })
        .collect()
}

fn map_runtime_mcp_servers(mcp: HashMap<String, Value>) -> Vec<OpenCodeMcpServerDto> {
    let mut servers = mcp
        .into_iter()
        .map(|(name, raw)| {
            let status = raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let detail = raw
                .get("error")
                .and_then(Value::as_str)
                .or_else(|| raw.get("message").and_then(Value::as_str))
                .or_else(|| raw.get("detail").and_then(Value::as_str))
                .map(ToOwned::to_owned);
            OpenCodeMcpServerDto {
                name,
                status,
                detail,
                raw,
            }
        })
        .collect::<Vec<_>>();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    servers
}

fn map_session_record(session: OpenCodeSessionRecord) -> OpenCodeRemoteSessionSummary {
    OpenCodeRemoteSessionSummary {
        engine_thread_id: session.id,
        title: session.title.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }),
        cwd: session.directory,
        created_at: session.time.created,
        updated_at: session.time.updated,
        archived: session.time.archived.unwrap_or(0) > 0,
    }
}

fn current_unix_time_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn default_reasoning_effort(options: &[ReasoningEffortOption]) -> Option<&'static str> {
    for preferred in ["medium", "high", "low", "minimal", "none", "xhigh", "max"] {
        if options
            .iter()
            .any(|option| option.reasoning_effort == preferred)
        {
            return Some(preferred);
        }
    }
    None
}

fn resolve_model_reasoning_effort(
    model: &ModelInfo,
    requested_effort: Option<&str>,
) -> Option<String> {
    if model.supported_reasoning_efforts.is_empty() {
        return None;
    }

    let requested = requested_effort
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    if let Some(requested) = requested.as_ref() {
        if model
            .supported_reasoning_efforts
            .iter()
            .any(|option| option.reasoning_effort == *requested)
        {
            return Some(requested.clone());
        }
    }

    if model
        .supported_reasoning_efforts
        .iter()
        .any(|option| option.reasoning_effort == model.default_reasoning_effort)
    {
        return Some(model.default_reasoning_effort.clone());
    }

    model
        .supported_reasoning_efforts
        .iter()
        .map(|option| option.reasoning_effort.trim())
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn reasoning_efforts_from_variants(
    variants: &HashMap<String, Value>,
) -> Vec<ReasoningEffortOption> {
    let names = variants.keys().map(String::as_str).collect::<Vec<_>>();
    reasoning_efforts_from_variant_names(&names)
}

fn reasoning_efforts_from_variant_names(names: &[&str]) -> Vec<ReasoningEffortOption> {
    const ORDER: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    ORDER
        .iter()
        .copied()
        .filter(|effort| names.iter().any(|name| name.eq_ignore_ascii_case(effort)))
        .map(|effort| ReasoningEffortOption {
            reasoning_effort: effort.to_string(),
            description: format!("OpenCode {effort} variant"),
        })
        .collect()
}

fn model_modalities_from_capabilities(
    capabilities: Option<&OpenCodeModelCapabilities>,
) -> Vec<String> {
    let mut modalities = Vec::new();
    if capabilities
        .and_then(|capabilities| capabilities.input.as_ref())
        .map(|input| input.text)
        .unwrap_or(true)
    {
        modalities.push("text".to_string());
    }
    if capabilities
        .and_then(|capabilities| capabilities.input.as_ref())
        .map(|input| input.image)
        .unwrap_or(false)
    {
        modalities.push("image".to_string());
    }
    if capabilities
        .and_then(|capabilities| capabilities.input.as_ref())
        .map(|input| input.pdf)
        .unwrap_or(false)
    {
        modalities.push("pdf".to_string());
    }
    modalities
}

fn attachment_modalities_from_capabilities(
    capabilities: Option<&OpenCodeModelCapabilities>,
) -> Vec<String> {
    let Some(capabilities) = capabilities else {
        return vec!["text".to_string()];
    };
    if !capabilities.attachment {
        return Vec::new();
    }

    let input = capabilities.input.as_ref();
    let mut modalities = Vec::new();
    if input.map(|input| input.text).unwrap_or(true) {
        modalities.push("text".to_string());
    }
    if input.map(|input| input.image).unwrap_or(false) {
        modalities.push("image".to_string());
    }
    if input.map(|input| input.pdf).unwrap_or(false) {
        modalities.push("pdf".to_string());
    }
    modalities
}

fn model_limits(limit: Option<&OpenCodeModelLimit>) -> Option<ModelLimits> {
    let limit = limit?;
    if limit.context.is_none() && limit.input.is_none() && limit.output.is_none() {
        return None;
    }
    Some(ModelLimits {
        context_tokens: limit.context,
        input_tokens: limit.input,
        output_tokens: limit.output,
    })
}

fn model_modalities(model: &OpenCodeProviderModel) -> Vec<String> {
    model_modalities_from_capabilities(model.capabilities.as_ref())
}

fn scope_cwd(scope: &ThreadScope) -> String {
    match scope {
        ThreadScope::Repo { repo_path } => repo_path.clone(),
        ThreadScope::Workspace { root_path, .. } => root_path.clone(),
    }
}

fn permission_mode_from_policy(policy: Option<&Value>) -> OpenCodePermissionMode {
    let Some(raw) = policy.and_then(Value::as_str) else {
        return OpenCodePermissionMode::Ask;
    };
    match raw.trim().to_lowercase().as_str() {
        "allow" | "trusted" | "never" => OpenCodePermissionMode::Allow,
        "deny" | "restricted" | "untrusted" => OpenCodePermissionMode::Deny,
        _ => OpenCodePermissionMode::Ask,
    }
}

fn permission_rules(mode: OpenCodePermissionMode) -> Value {
    match mode {
        OpenCodePermissionMode::Allow => {
            json!([{ "permission": "*", "pattern": "*", "action": "allow" }])
        }
        OpenCodePermissionMode::Deny => {
            json!([{ "permission": "*", "pattern": "*", "action": "deny" }])
        }
        OpenCodePermissionMode::Ask => json!([
            { "permission": "*", "pattern": "*", "action": "ask" },
            { "permission": "question", "pattern": "*", "action": "allow" }
        ]),
    }
}

fn session_permission_matches(
    session: &OpenCodeSessionRecord,
    mode: OpenCodePermissionMode,
) -> bool {
    let expected_action = match mode {
        OpenCodePermissionMode::Ask => "ask",
        OpenCodePermissionMode::Allow => "allow",
        OpenCodePermissionMode::Deny => "deny",
    };
    session_wildcard_permission_action(session.permission.as_ref()) == Some(expected_action)
}

fn session_wildcard_permission_action(permission: Option<&Value>) -> Option<&str> {
    let rules = permission?.as_array()?;
    rules.iter().find_map(|rule| {
        let permission = rule.get("permission").and_then(Value::as_str)?;
        let pattern = rule.get("pattern").and_then(Value::as_str)?;
        if permission == "*" && pattern == "*" {
            return rule.get("action").and_then(Value::as_str);
        }
        None
    })
}

async fn start_server(cwd: &str) -> Result<OpenCodeServer> {
    let executable = resolve_opencode_executable().context("`opencode` executable not found")?;
    let port = allocate_loopback_port()?;
    let password = Uuid::new_v4().to_string();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<String>();

    let mut command = Command::new(&executable);
    process_utils::configure_tokio_command(&mut command);
    command
        .arg("serve")
        .arg("--hostname")
        .arg(DEFAULT_HOST)
        .arg("--port")
        .arg(port.to_string())
        .current_dir(cwd)
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = executable_augmented_path(&executable) {
        command.env("PATH", path);
    }

    let mut child = command.spawn().with_context(|| {
        format!(
            "failed to spawn OpenCode server at {}",
            executable.display()
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .context("OpenCode stdout not available")?;
    let stderr = child
        .stderr
        .take()
        .context("OpenCode stderr not available")?;

    tokio::spawn(async move {
        let mut ready_tx = Some(ready_tx);
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("opencode stdout: {line}");
            if line.starts_with(SERVER_READY_PREFIX) {
                if let Some(tx) = ready_tx.take() {
                    let url = line
                        .split_whitespace()
                        .last()
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("http://{DEFAULT_HOST}:{port}"));
                    let _ = tx.send(url);
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("opencode stderr: {line}");
        }
    });

    let base_url = timeout(OPENCODE_STARTUP_TIMEOUT, ready_rx)
        .await
        .context("timed out waiting for OpenCode server startup")?
        .context("OpenCode server exited before startup completed")?;

    let (event_bus, _) = broadcast::channel::<Arc<OpenCodeBusEvent>>(1024);
    let pump_cancel = CancellationToken::new();
    let server = OpenCodeServer {
        cwd: cwd.to_string(),
        base_url,
        password,
        child: Mutex::new(child),
        event_bus: event_bus.clone(),
        pump_cancel: pump_cancel.clone(),
    };

    wait_for_server_health(&server).await?;

    let pump_url = server.base_url.clone();
    let pump_password = server.password.clone();
    let pump_http = reqwest::Client::new();
    tokio::spawn(async move {
        run_event_pump(pump_url, pump_password, pump_http, event_bus, pump_cancel).await;
    });

    Ok(server)
}

async fn run_event_pump(
    base_url: String,
    password: String,
    http: reqwest::Client,
    event_bus: broadcast::Sender<Arc<OpenCodeBusEvent>>,
    cancel: CancellationToken,
) {
    let url = format!("{}/event", base_url.trim_end_matches('/'));
    let mut backoff = Duration::from_millis(100);
    let max_backoff = Duration::from_secs(10);

    loop {
        if cancel.is_cancelled() {
            return;
        }

        let response = match http.get(&url).headers(auth_headers(&password)).send().await {
            Ok(response) => response,
            Err(error) => {
                log::warn!("opencode SSE pump connect failed: {error}");
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = sleep(backoff) => {}
                }
                backoff = (backoff * 2).min(max_backoff);
                continue;
            }
        };

        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                log::warn!("opencode SSE pump status error: {error}");
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = sleep(backoff) => {}
                }
                backoff = (backoff * 2).min(max_backoff);
                continue;
            }
        };

        backoff = Duration::from_millis(100);
        let mut bytes = response.bytes_stream();
        let mut buffer = String::new();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => return,
                chunk = bytes.next() => {
                    let Some(chunk) = chunk else { break };
                    let chunk = match chunk {
                        Ok(chunk) => chunk,
                        Err(error) => {
                            log::warn!("opencode SSE pump read failed: {error}");
                            break;
                        }
                    };
                    buffer.push_str(&String::from_utf8_lossy(&chunk));
                    while let Some(line_end) = buffer.find('\n') {
                        let line = buffer[..line_end].trim_end_matches('\r').to_string();
                        buffer = buffer[line_end + 1..].to_string();
                        if let Some(raw_event) = line.strip_prefix("data:") {
                            let raw_event = raw_event.trim();
                            if raw_event.is_empty() {
                                continue;
                            }
                            let event: OpenCodeBusEvent = match serde_json::from_str(raw_event) {
                                Ok(event) => event,
                                Err(error) => {
                                    log::warn!(
                                        "opencode event parse failed: {error}; event={raw_event}"
                                    );
                                    continue;
                                }
                            };
                            let _ = event_bus.send(Arc::new(event));
                        }
                    }
                }
            }
        }
    }
}

async fn wait_for_server_health(server: &OpenCodeServer) -> Result<()> {
    let client = reqwest::Client::new();
    let started = Instant::now();
    loop {
        let result = client
            .get(format!(
                "{}/global/health",
                server.base_url.trim_end_matches('/')
            ))
            .headers(auth_headers(&server.password))
            .send()
            .await;
        if let Ok(response) = result {
            if let Ok(response) = response.error_for_status() {
                let health = response.json::<OpenCodeHealthResponse>().await?;
                if health.healthy {
                    return Ok(());
                }
            }
        }
        if started.elapsed() > OPENCODE_HEALTH_TIMEOUT {
            anyhow::bail!("OpenCode server did not become healthy");
        }
        sleep(Duration::from_millis(100)).await;
    }
}

fn allocate_loopback_port() -> Result<u16> {
    let listener = TcpListener::bind((DEFAULT_HOST, 0))?;
    Ok(listener.local_addr()?.port())
}

fn auth_headers(password: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let token = general_purpose::STANDARD.encode(format!("opencode:{password}"));
    if let Ok(value) = HeaderValue::from_str(&format!("Basic {token}")) {
        headers.insert(AUTHORIZATION, value);
    }
    headers
}

fn resolve_opencode_executable() -> Option<PathBuf> {
    runtime_env::resolve_executable("opencode")
}

async fn run_opencode_command(executable: &Path, args: &[&str]) -> Result<String> {
    let mut command = Command::new(executable);
    process_utils::configure_tokio_command(&mut command);
    command.args(args);
    if let Some(path) = executable_augmented_path(executable) {
        command.env("PATH", path);
    }

    let output = timeout(OPENCODE_COMMAND_TIMEOUT, command.output())
        .await
        .context("timed out running opencode command")?
        .context("failed to run opencode command")?;
    if !output.status.success() {
        anyhow::bail!(
            "opencode command failed with status {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_verbose_model_records(output: &str) -> Result<Vec<OpenCodeVerboseModel>> {
    let mut records = Vec::new();
    let mut pending_slug: Option<String> = None;
    let mut json_buffer = String::new();
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;
    let mut collecting = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if !collecting {
            if parse_model_slug(trimmed).is_some() {
                pending_slug = Some(trimmed.to_string());
                continue;
            }
            if !trimmed.starts_with('{') {
                continue;
            }
            collecting = true;
        }

        json_buffer.push_str(line);
        json_buffer.push('\n');
        for character in line.chars() {
            if escaped {
                escaped = false;
                continue;
            }
            if in_string {
                match character {
                    '\\' => escaped = true,
                    '"' => in_string = false,
                    _ => {}
                }
                continue;
            }
            match character {
                '"' => in_string = true,
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
        }

        if collecting && depth == 0 {
            let mut record: OpenCodeVerboseModel = serde_json::from_str(&json_buffer)
                .context("failed to parse verbose OpenCode model metadata")?;
            if let Some(slug) = pending_slug.take() {
                if let Some(parsed) = parse_model_slug(&slug) {
                    if record.provider_id.trim().is_empty() {
                        record.provider_id = parsed.provider_id;
                    }
                    if record.id.trim().is_empty() {
                        record.id = parsed.model_id;
                    }
                }
            }
            records.push(record);
            json_buffer.clear();
            depth = 0;
            in_string = false;
            escaped = false;
            collecting = false;
        }
    }

    if collecting {
        anyhow::bail!("unterminated verbose OpenCode model JSON object");
    }

    Ok(records)
}

fn executable_augmented_path(executable: &Path) -> Option<OsString> {
    runtime_env::augmented_path_with_prepend(
        executable
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    )
}

fn event_matches_session(event: &OpenCodeBusEvent, session_id: &str) -> bool {
    event
        .properties
        .get("sessionID")
        .and_then(Value::as_str)
        .map(|value| value == session_id)
        .unwrap_or_else(|| {
            event
                .properties
                .get("info")
                .and_then(|value| value.get("sessionID"))
                .and_then(Value::as_str)
                .or_else(|| {
                    event
                        .properties
                        .get("part")
                        .and_then(|value| value.get("sessionID"))
                        .and_then(Value::as_str)
                })
                .map(|value| value == session_id)
                .unwrap_or(false)
        })
}

pub fn extract_persisted_approval_route(details: &Value) -> Option<ApprovalRequestRoute> {
    let kind = details.get("_opencodeRequestKind")?.as_str()?.trim();
    let request_id = details.get("_opencodeRequestID")?.as_str()?.trim();
    let session_id = details.get("_opencodeSessionID")?.as_str()?.trim();
    let cwd = details.get("_opencodeCwd")?.as_str()?.trim();
    if kind.is_empty() || request_id.is_empty() || session_id.is_empty() || cwd.is_empty() {
        return None;
    }

    let server_method = match kind {
        "permission" => "opencode/permission",
        "question" => "opencode/question",
        _ => return None,
    };

    let mut raw_request_id = json!({
        "kind": kind,
        "requestID": request_id,
        "sessionID": session_id,
        "cwd": cwd,
    });
    if kind == "question" {
        if let Some(questions) = details.get("questions") {
            raw_request_id["questions"] = questions.clone();
        }
    }

    Some(ApprovalRequestRoute {
        server_method: server_method.to_string(),
        raw_request_id,
    })
}

fn is_user_message(message_roles: &HashMap<String, String>, message_id: &str) -> bool {
    message_roles
        .get(message_id)
        .map(|role| role == "user")
        .unwrap_or(false)
}

fn session_error_message(properties: &Value) -> String {
    properties
        .get("error")
        .and_then(|value| value.get("data"))
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            properties
                .get("error")
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
        })
        .unwrap_or("OpenCode session failed")
        .to_string()
}

fn format_session_diff(properties: &Value) -> Option<String> {
    let diffs = properties.get("diff")?.as_array()?;
    let mut output = String::new();
    for diff in diffs {
        let file = diff.get("file").and_then(Value::as_str).unwrap_or("file");
        let patch = diff.get("patch").and_then(Value::as_str).unwrap_or("");
        if patch.is_empty() {
            continue;
        }
        output.push_str(&format!("diff -- {file}\n{patch}\n"));
    }
    (!output.is_empty()).then_some(output)
}

fn action_type_for_permission(permission: &str) -> ActionType {
    match permission {
        "bash" => ActionType::Command,
        "edit" => ActionType::FileEdit,
        "read" => ActionType::FileRead,
        "webfetch" | "websearch" | "codesearch" => ActionType::Search,
        _ => ActionType::Other,
    }
}

fn action_type_for_tool(tool: &str) -> ActionType {
    let normalized = tool.to_lowercase();
    if normalized.contains("bash") || normalized.contains("command") {
        ActionType::Command
    } else if normalized.contains("edit") || normalized.contains("write") {
        ActionType::FileEdit
    } else if normalized.contains("read") {
        ActionType::FileRead
    } else if normalized.contains("grep") || normalized.contains("search") {
        ActionType::Search
    } else {
        ActionType::Other
    }
}

fn question_id(index: usize, question: &OpenCodeQuestionInfo) -> String {
    let mut normalized = question
        .header
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    while normalized.contains("--") {
        normalized = normalized.replace("--", "-");
    }
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        format!("question-{index}")
    } else {
        format!("question-{index}-{normalized}")
    }
}

fn question_details_json((index, question): (usize, &OpenCodeQuestionInfo)) -> Value {
    json!({
        "id": question_id(index, question),
        "header": question.header,
        "question": question.question,
        "multiple": question.multiple.unwrap_or(false),
        "custom": question.custom.unwrap_or(true),
        "options": question.options.iter().map(|option| {
            json!({
                "label": option.label,
                "description": option.description,
            })
        }).collect::<Vec<_>>(),
    })
}

fn should_reject_question_response(response: &Value) -> bool {
    matches!(
        response.get("decision").and_then(Value::as_str),
        Some("decline" | "cancel")
    )
}

fn build_question_answers(
    questions: &[OpenCodeQuestionInfo],
    answers: Option<&Value>,
) -> Vec<Vec<String>> {
    let answer_object = answers.and_then(Value::as_object);
    questions
        .iter()
        .enumerate()
        .map(|(index, question)| {
            let candidates = [
                question_id(index, question),
                question.header.clone(),
                question.question.clone(),
            ];
            for candidate in candidates {
                if let Some(answer) = answer_object.and_then(|object| object.get(&candidate)) {
                    return answer_to_vec(answer);
                }
            }
            Vec::new()
        })
        .collect()
}

fn answer_to_vec(value: &Value) -> Vec<String> {
    if let Some(text) = value.as_str() {
        return non_empty_answer(text).into_iter().collect();
    }
    if let Some(array) = value.as_array() {
        return array
            .iter()
            .filter_map(Value::as_str)
            .filter_map(non_empty_answer)
            .collect();
    }
    if let Some(object) = value.as_object() {
        if let Some(array) = object.get("answers").and_then(Value::as_array) {
            return array
                .iter()
                .filter_map(Value::as_str)
                .filter_map(non_empty_answer)
                .collect();
        }
        if let Some(label) = object.get("label").and_then(Value::as_str) {
            return non_empty_answer(label).into_iter().collect();
        }
    }
    Vec::new()
}

fn non_empty_answer(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn token_usage_from_step_finish(part: &OpenCodePart) -> Option<TokenUsage> {
    if part.part_type != "step-finish" {
        return None;
    }

    let tokens = part.tokens.as_ref()?;
    Some(TokenUsage {
        input: tokens.input,
        output: tokens.output,
        reasoning: Some(tokens.reasoning),
        cache_read: Some(tokens.cache.read),
        cache_write: Some(tokens.cache.write),
        cost_usd: part.cost,
    })
}

fn file_url(path: &str) -> String {
    let mut encoded = String::from("file://");
    for byte in path.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                encoded.push(*byte as char)
            }
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}

fn new_message_id() -> String {
    let now_ms = current_unix_time_millis().max(0) as u64;
    let sort_value = next_opencode_message_sort_value(now_ms);
    format!(
        "msg_{:012x}{}",
        sort_value & OPENCODE_ID_TIME_MASK,
        random_base62(OPENCODE_MESSAGE_ID_RANDOM_LEN)
    )
}

fn next_opencode_message_sort_value(now_ms: u64) -> u64 {
    let base = now_ms.saturating_mul(OPENCODE_ID_COUNTER_STEP);

    loop {
        let last = LAST_OPENCODE_MESSAGE_SORT_VALUE.load(Ordering::Relaxed);
        let candidate = if base <= last {
            last.saturating_add(1)
        } else {
            base.saturating_add(1)
        };

        if LAST_OPENCODE_MESSAGE_SORT_VALUE
            .compare_exchange_weak(last, candidate, Ordering::SeqCst, Ordering::Relaxed)
            .is_ok()
        {
            return candidate;
        }
    }
}

fn random_base62(len: usize) -> String {
    const CHARS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    let mut output = String::with_capacity(len);
    while output.len() < len {
        let uuid = Uuid::new_v4();
        for byte in uuid.as_bytes() {
            output.push(CHARS[*byte as usize % CHARS.len()] as char);
            if output.len() == len {
                break;
            }
        }
    }
    output
}

#[cfg(test)]
fn opencode_sort_prefix_for_millis(now_ms: u64, counter: u64) -> String {
    format!(
        "{:012x}",
        now_ms
            .saturating_mul(OPENCODE_ID_COUNTER_STEP)
            .saturating_add(counter)
            & OPENCODE_ID_TIME_MASK
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_model_slug_splits_on_first_slash() {
        let parsed = parse_model_slug("openrouter/anthropic/claude-sonnet-4.5").unwrap();
        assert_eq!(parsed.provider_id, "openrouter");
        assert_eq!(parsed.model_id, "anthropic/claude-sonnet-4.5");
        assert!(parse_model_slug("missing-provider").is_none());
    }

    #[test]
    fn verbose_models_expose_reasoning_variants() {
        let output = r#"opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "status": "active",
  "limit": { "context": 200000, "input": 200000, "output": 100000 },
  "capabilities": {
    "reasoning": true,
    "attachment": false,
    "input": { "text": true, "image": false, "pdf": false }
  },
  "variants": {
    "high": { "thinking": { "type": "enabled" } },
    "max": { "thinking": { "type": "enabled" } }
  }
}
opencode/gpt-5-nano
{
  "id": "gpt-5-nano",
  "providerID": "opencode",
  "name": "GPT-5 Nano",
  "status": "active",
  "limit": { "context": 400000, "input": 200000, "output": 128000 },
  "capabilities": {
    "reasoning": true,
    "attachment": true,
    "input": { "text": true, "image": true, "pdf": true }
  },
  "variants": {
    "minimal": { "reasoningEffort": "minimal" },
    "low": { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" },
    "high": { "reasoningEffort": "high" }
  }
}"#;

        let records = parse_verbose_model_records(output).unwrap();
        assert_eq!(records.len(), 2);
        let big_pickle_efforts = reasoning_efforts_from_variants(&records[0].variants)
            .into_iter()
            .map(|option| option.reasoning_effort)
            .collect::<Vec<_>>();
        assert_eq!(big_pickle_efforts, vec!["high", "max"]);
        let nano_efforts = reasoning_efforts_from_variants(&records[1].variants)
            .into_iter()
            .map(|option| option.reasoning_effort)
            .collect::<Vec<_>>();
        assert_eq!(nano_efforts, vec!["minimal", "low", "medium", "high"]);
        assert_eq!(
            model_modalities_from_capabilities(records[1].capabilities.as_ref()),
            vec!["text".to_string(), "image".to_string(), "pdf".to_string()]
        );
        assert_eq!(
            attachment_modalities_from_capabilities(records[0].capabilities.as_ref()),
            Vec::<String>::new()
        );
        assert_eq!(
            attachment_modalities_from_capabilities(records[1].capabilities.as_ref()),
            vec!["text".to_string(), "image".to_string(), "pdf".to_string()]
        );
        let limits = model_limits(records[1].limit.as_ref()).expect("limits");
        assert_eq!(limits.context_tokens, Some(400000));
        assert_eq!(limits.output_tokens, Some(128000));
        assert_eq!(
            model_limits(records[0].limit.as_ref()).and_then(|limits| limits.input_tokens),
            Some(200000)
        );
    }

    #[test]
    fn prompt_body_includes_selected_opencode_variant() {
        let body = build_prompt_body(
            "opencode/big-pickle",
            Some("max"),
            None,
            TurnInput {
                message: "hello".to_string(),
                attachments: Vec::new(),
                plan_mode: false,
                input_items: Vec::new(),
            },
        )
        .unwrap()
        .body;

        assert_eq!(body.get("variant"), Some(&json!("max")));
        assert_eq!(body["model"]["providerID"], json!("opencode"));
        assert_eq!(body["model"]["modelID"], json!("big-pickle"));
    }

    #[test]
    fn prompt_body_includes_selected_opencode_agent() {
        let body = build_prompt_body(
            "opencode/big-pickle",
            None,
            Some("explore"),
            TurnInput {
                message: "hello".to_string(),
                attachments: Vec::new(),
                plan_mode: false,
                input_items: Vec::new(),
            },
        )
        .unwrap()
        .body;

        assert_eq!(body.get("agent"), Some(&json!("explore")));
    }

    #[test]
    fn prompt_body_ignores_generic_plan_mode_text_for_opencode() {
        let body = build_prompt_body(
            "opencode/big-pickle",
            None,
            Some("explore"),
            TurnInput {
                message: "hello".to_string(),
                attachments: Vec::new(),
                plan_mode: true,
                input_items: Vec::new(),
            },
        )
        .unwrap()
        .body;

        assert_eq!(body.get("agent"), Some(&json!("explore")));
        assert_eq!(body["parts"][0]["text"], json!("hello"));
    }

    #[test]
    fn build_prompt_body_returns_same_message_id_it_sends() {
        let prompt = build_prompt_body(
            "opencode/big-pickle",
            None,
            None,
            TurnInput {
                message: "hello".to_string(),
                attachments: Vec::new(),
                plan_mode: false,
                input_items: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(
            prompt.body.get("messageID").and_then(Value::as_str),
            Some(prompt.message_id.as_str())
        );
        assert!(prompt.body.get("tools").is_none());
        assert!(!json_contains_key(&prompt.body, "eager_input_streaming"));
    }

    fn json_contains_key(value: &Value, key: &str) -> bool {
        match value {
            Value::Object(object) => {
                object.contains_key(key)
                    || object.values().any(|value| json_contains_key(value, key))
            }
            Value::Array(items) => items.iter().any(|value| json_contains_key(value, key)),
            _ => false,
        }
    }

    #[test]
    fn model_reasoning_effort_omits_models_without_variants() {
        let model = model_info(
            "openrouter/example/plain-model",
            "Plain Model",
            "OpenCode model",
            false,
            Vec::new(),
            vec!["text".to_string()],
        );

        assert_eq!(resolve_model_reasoning_effort(&model, Some("medium")), None);
    }

    #[test]
    fn model_reasoning_effort_falls_back_to_supported_default() {
        let model = model_info(
            "opencode/big-pickle",
            "Big Pickle",
            "OpenCode model",
            true,
            reasoning_efforts_from_variant_names(&["high", "max"]),
            vec!["text".to_string()],
        );

        assert_eq!(
            resolve_model_reasoning_effort(&model, Some("medium")).as_deref(),
            Some("high")
        );
        assert_eq!(
            resolve_model_reasoning_effort(&model, Some("max")).as_deref(),
            Some("max")
        );
    }

    #[test]
    fn permission_mode_maps_existing_policy_names() {
        assert_eq!(
            permission_mode_from_policy(Some(&json!("trusted"))),
            OpenCodePermissionMode::Allow
        );
        assert_eq!(
            permission_mode_from_policy(Some(&json!("untrusted"))),
            OpenCodePermissionMode::Deny
        );
        assert_eq!(
            permission_mode_from_policy(Some(&json!("on-request"))),
            OpenCodePermissionMode::Ask
        );
    }

    #[test]
    fn question_answers_follow_opencode_question_order() {
        let questions = vec![
            OpenCodeQuestionInfo {
                question: "Which package manager?".to_string(),
                header: "Package Manager".to_string(),
                options: vec![],
                multiple: None,
                custom: None,
            },
            OpenCodeQuestionInfo {
                question: "Run tests?".to_string(),
                header: "Tests".to_string(),
                options: vec![],
                multiple: None,
                custom: None,
            },
        ];
        let answers = build_question_answers(
            &questions,
            Some(&json!({
                "question-0-package-manager": { "answers": ["pnpm"] },
                "Tests": "yes"
            })),
        );

        assert_eq!(
            answers,
            vec![vec!["pnpm".to_string()], vec!["yes".to_string()]]
        );
    }

    #[test]
    fn question_details_preserve_opencode_selection_flags() {
        let question = OpenCodeQuestionInfo {
            question: "Which checks should OpenCode run?".to_string(),
            header: "Checks".to_string(),
            options: vec![OpenCodeQuestionOption {
                label: "typecheck".to_string(),
                description: "Run TypeScript".to_string(),
            }],
            multiple: Some(true),
            custom: Some(false),
        };

        let details = question_details_json((0, &question));

        assert_eq!(details["id"], json!("question-0-checks"));
        assert_eq!(details["multiple"], json!(true));
        assert_eq!(details["custom"], json!(false));
        assert_eq!(details["options"][0]["label"], json!("typecheck"));
    }

    #[test]
    fn decline_and_cancel_reject_opencode_questions() {
        assert!(should_reject_question_response(
            &json!({ "decision": "decline" })
        ));
        assert!(should_reject_question_response(
            &json!({ "decision": "cancel" })
        ));
        assert!(!should_reject_question_response(&json!({
            "answers": { "question-0-checks": { "answers": ["typecheck"] } }
        })));
    }

    #[test]
    fn step_finish_part_maps_rich_token_usage() {
        let part: OpenCodePart = serde_json::from_value(json!({
            "id": "prt_123",
            "messageID": "msg_123",
            "type": "step-finish",
            "reason": "stop",
            "cost": 0.0123,
            "tokens": {
                "input": 100,
                "output": 25,
                "reasoning": 10,
                "cache": { "read": 7, "write": 3 },
                "total": 145
            }
        }))
        .expect("step-finish part should deserialize");

        let usage = token_usage_from_step_finish(&part).expect("token usage");

        assert_eq!(usage.input, 100);
        assert_eq!(usage.output, 25);
        assert_eq!(usage.reasoning, Some(10));
        assert_eq!(usage.cache_read, Some(7));
        assert_eq!(usage.cache_write, Some(3));
        assert_eq!(usage.cost_usd, Some(0.0123));
    }

    #[test]
    fn session_record_maps_archived_zero_as_active() {
        let session = map_session_record(OpenCodeSessionRecord {
            id: "ses_123".to_string(),
            title: Some("  Existing session  ".to_string()),
            directory: "/workspace".to_string(),
            permission: Some(permission_rules(OpenCodePermissionMode::Ask)),
            time: OpenCodeSessionTime {
                created: 1_777_155_663_506,
                updated: 1_777_155_663_524,
                archived: Some(0),
            },
        });

        assert_eq!(session.engine_thread_id, "ses_123");
        assert_eq!(session.title.as_deref(), Some("Existing session"));
        assert_eq!(session.cwd, "/workspace");
        assert!(!session.archived);
    }

    #[test]
    fn session_permission_match_compares_current_rules() {
        let session = OpenCodeSessionRecord {
            id: "ses_123".to_string(),
            title: None,
            directory: "/workspace".to_string(),
            permission: Some(json!([
                { "permission": "question", "pattern": "*", "action": "allow" },
                { "permission": "*", "pattern": "*", "action": "ask" }
            ])),
            time: OpenCodeSessionTime {
                created: 1,
                updated: 1,
                archived: None,
            },
        };

        assert!(session_permission_matches(
            &session,
            OpenCodePermissionMode::Ask
        ));
        assert!(!session_permission_matches(
            &session,
            OpenCodePermissionMode::Allow
        ));
    }

    #[test]
    fn file_url_escapes_local_paths() {
        assert_eq!(
            file_url("/tmp/panes test/file.txt"),
            "file:///tmp/panes%20test/file.txt"
        );
    }

    #[test]
    fn is_user_message_only_matches_known_user_roles() {
        let mut roles = HashMap::new();
        roles.insert("user-message".to_string(), "user".to_string());
        roles.insert("assistant-message".to_string(), "assistant".to_string());

        assert!(is_user_message(&roles, "user-message"));
        assert!(!is_user_message(&roles, "assistant-message"));
        assert!(!is_user_message(&roles, "unknown"));
    }

    #[tokio::test]
    async fn mapper_ignores_prompt_user_text_parts() {
        let engine = OpenCodeEngine::default();
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let mut mapper = OpenCodeTurnMapper::new("msg_user".to_string());
        mapper.record_message("msg_user", "user", None);
        let part: OpenCodePart = serde_json::from_value(json!({
            "id": "prt_user",
            "messageID": "msg_user",
            "type": "text",
            "text": "hello"
        }))
        .unwrap();

        engine
            .handle_part_updated(&part, &mut mapper, &event_tx)
            .await;

        assert!(!mapper.content_seen);
        assert!(event_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn mapper_flushes_pending_reasoning_after_part_type_is_known() {
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let mut mapper = OpenCodeTurnMapper::new("msg_user".to_string());
        mapper.store_pending_text("prt_reasoning", "msg_assistant", "thinking");

        mapper
            .part_type_by_id
            .insert("prt_reasoning".to_string(), "reasoning".to_string());
        flush_pending_opencode_text_for_part(&mut mapper, &event_tx, "prt_reasoning").await;

        match event_rx
            .try_recv()
            .expect("expected pending reasoning to flush")
        {
            EngineEvent::ThinkingDelta { content } => assert_eq!(content, "thinking"),
            other => panic!("expected thinking delta, got {other:?}"),
        }
        assert!(event_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn mapper_accepts_non_prompt_text_without_message_role() {
        let engine = OpenCodeEngine::default();
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let mut mapper = OpenCodeTurnMapper::new("msg_user".to_string());
        let part: OpenCodePart = serde_json::from_value(json!({
            "id": "prt_text",
            "messageID": "msg_assistant",
            "type": "text",
            "text": "response"
        }))
        .unwrap();

        engine
            .handle_part_updated(&part, &mut mapper, &event_tx)
            .await;

        match event_rx.try_recv().expect("expected text delta") {
            EngineEvent::TextDelta { content } => assert_eq!(content, "response"),
            other => panic!("expected text delta, got {other:?}"),
        }
        assert!(event_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn mapper_ignores_assistant_parts_for_previous_prompt() {
        let engine = OpenCodeEngine::default();
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let mut mapper = OpenCodeTurnMapper::new("msg_current_user".to_string());
        mapper.record_message("msg_old_user", "user", None);
        mapper.record_message("msg_old_assistant", "assistant", Some("msg_old_user"));
        let part: OpenCodePart = serde_json::from_value(json!({
            "id": "prt_old_text",
            "messageID": "msg_old_assistant",
            "type": "text",
            "text": "stale response"
        }))
        .unwrap();

        engine
            .handle_part_updated(&part, &mut mapper, &event_tx)
            .await;

        assert!(!mapper.content_seen);
        assert!(event_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn idle_without_current_prompt_response_fails_turn() {
        let engine = OpenCodeEngine::default();
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let mut mapper = OpenCodeTurnMapper::new("msg_current_user".to_string());
        mapper.busy_seen = true;

        engine.complete_after_idle(&mut mapper, &event_tx).await;

        match event_rx.try_recv().expect("expected error event") {
            EngineEvent::Error {
                message,
                recoverable,
            } => {
                assert!(!recoverable);
                assert!(message.contains("without producing a response"));
            }
            other => panic!("expected error event, got {other:?}"),
        }
        match event_rx.try_recv().expect("expected failed completion") {
            EngineEvent::TurnCompleted { status, .. } => {
                assert_eq!(status, TurnCompletionStatus::Failed);
            }
            other => panic!("expected failed completion, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn mapper_ignores_non_append_text_snapshots() {
        let engine = OpenCodeEngine::default();
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let mut mapper = OpenCodeTurnMapper::new("msg_user".to_string());
        let first_part: OpenCodePart = serde_json::from_value(json!({
            "id": "prt_reasoning",
            "messageID": "msg_assistant",
            "type": "reasoning",
            "text": "first"
        }))
        .unwrap();
        let revised_part: OpenCodePart = serde_json::from_value(json!({
            "id": "prt_reasoning",
            "messageID": "msg_assistant",
            "type": "reasoning",
            "text": "second"
        }))
        .unwrap();

        engine
            .handle_part_updated(&first_part, &mut mapper, &event_tx)
            .await;
        engine
            .handle_part_updated(&revised_part, &mut mapper, &event_tx)
            .await;

        match event_rx.try_recv().expect("expected initial reasoning") {
            EngineEvent::ThinkingDelta { content } => assert_eq!(content, "first"),
            other => panic!("expected thinking delta, got {other:?}"),
        }
        assert!(event_rx.try_recv().is_err());
    }

    #[test]
    fn new_message_id_uses_opencode_ascending_shape() {
        let id = new_message_id();

        assert_eq!(id.len(), "msg_".len() + 26);
        assert!(id.starts_with("msg_"));

        let sortable = &id[4..16];
        let suffix = &id[16..];

        assert_eq!(sortable.len(), 12);
        assert!(sortable
            .chars()
            .all(|ch| ch.is_ascii_digit() || ('a'..='f').contains(&ch)));
        assert_eq!(suffix.len(), 14);
        assert!(suffix.chars().all(|ch| ch.is_ascii_alphanumeric()));
    }

    #[test]
    fn opencode_prompt_message_path_uses_synchronous_message_endpoint() {
        assert_eq!(
            opencode_prompt_message_path("ses_123"),
            "/session/ses_123/message"
        );
    }

    #[test]
    fn new_message_id_is_lexicographically_monotonic() {
        let mut previous = new_message_id();

        for _ in 0..1000 {
            let current = new_message_id();
            assert!(previous < current, "expected {previous} < {current}");
            previous = current;
        }
    }

    #[test]
    fn opencode_sort_prefix_matches_observed_timestamp_formula() {
        assert_eq!(
            opencode_sort_prefix_for_millis(1_777_173_925_808, 1),
            "dc7d20fb0001"
        );
        assert_eq!(
            opencode_sort_prefix_for_millis(1_777_173_926_670, 1),
            "dc7d2130e001"
        );
    }

    #[test]
    fn generated_style_user_id_sorts_between_observed_turn_messages() {
        let prior_assistant = "msg_dc7d20fb0001rH5hSHrepNXLgJ";
        let user_prefix = opencode_sort_prefix_for_millis(1_777_173_926_670, 1);
        let user_id = format!("msg_{user_prefix}00000000000000");
        let next_assistant = "msg_dc7d2132b001iU68RZlw7CFMwn";

        assert!(prior_assistant < user_id.as_str());
        assert!(user_id.as_str() < next_assistant);
    }

    #[test]
    fn event_matching_reads_nested_part_session_id() {
        let event = OpenCodeBusEvent {
            event_type: "message.part.updated".to_string(),
            properties: json!({
                "part": {
                    "sessionID": "ses_1",
                    "id": "part_1"
                }
            }),
        };

        assert!(event_matches_session(&event, "ses_1"));
        assert!(!event_matches_session(&event, "ses_2"));
    }

    #[test]
    fn extracts_persisted_opencode_approval_routes() {
        let route = extract_persisted_approval_route(&json!({
            "_opencodeRequestKind": "question",
            "_opencodeRequestID": "req_1",
            "_opencodeSessionID": "ses_1",
            "_opencodeCwd": "/tmp/project",
            "questions": [{ "id": "question-0", "question": "Run tests?" }]
        }))
        .unwrap();

        assert_eq!(route.server_method, "opencode/question");
        assert_eq!(route.raw_request_id["requestID"], "req_1");
        assert_eq!(route.raw_request_id["questions"][0]["id"], "question-0");
    }
}
