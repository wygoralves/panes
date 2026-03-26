use std::{
    collections::BTreeSet,
    collections::HashMap,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Context;
use async_trait::async_trait;
use chrono::Utc;
use serde::Deserialize;
use tokio::time::timeout;
use tokio::{
    fs as tokio_fs,
    process::Command,
    sync::{broadcast, mpsc, oneshot, Mutex},
};
use tokio_util::sync::CancellationToken;

use crate::models::{
    CodexAccountLoginCompletedDto, CodexAccountStateDto, CodexAppDto, CodexConfigLayerDto,
    CodexConfigStateDto, CodexConfigWarningDto, CodexExperimentalFeatureDto,
    CodexMcpOauthCompletedDto, CodexMcpServerDto, CodexMethodAvailabilityDto, CodexPluginDto,
    CodexPluginMarketplaceDto, CodexProtocolDiagnosticsDto, CodexSkillDto,
    CodexThreadRealtimeEventDto, CodexWindowsSandboxSetupDto, CodexWindowsWorldWritableWarningDto,
    RuntimeToastDto,
};
use crate::{process_utils, runtime_env};

use super::{
    codex_event_mapper::TurnEventMapper, codex_protocol::IncomingMessage,
    codex_transport::CodexTransport, ActionResult, ApprovalRequestRoute, CodexRemoteThreadSummary,
    Engine, EngineEvent, EngineThread, ModelAvailabilityNux, ModelInfo, ModelUpgradeInfo,
    ReasoningEffortOption, SandboxPolicy, ThreadScope, ThreadSyncSnapshot, TurnAttachment,
    TurnCompletionStatus, TurnInput, TurnInputItem,
};

const INITIALIZE_METHODS: &[&str] = &["initialize"];
const THREAD_START_METHODS: &[&str] = &["thread/start"];
const THREAD_RESUME_METHODS: &[&str] = &["thread/resume"];
const THREAD_READ_METHODS: &[&str] = &["thread/read"];
const THREAD_ARCHIVE_METHODS: &[&str] = &["thread/archive"];
const THREAD_UNARCHIVE_METHODS: &[&str] = &["thread/unarchive"];
const THREAD_SET_NAME_METHODS: &[&str] = &["thread/name/set"];
const THREAD_LIST_METHODS: &[&str] = &["thread/list"];
const THREAD_FORK_METHODS: &[&str] = &["thread/fork"];
const THREAD_ROLLBACK_METHODS: &[&str] = &["thread/rollback"];
const THREAD_COMPACT_START_METHODS: &[&str] = &["thread/compact/start"];
const REVIEW_START_METHODS: &[&str] = &["review/start"];
const EXPERIMENTAL_FEATURE_LIST_METHODS: &[&str] = &["experimentalFeature/list"];
const COLLABORATION_MODE_LIST_METHODS: &[&str] = &["collaborationMode/list"];
const SKILLS_LIST_METHODS: &[&str] = &["skills/list"];
const APP_LIST_METHODS: &[&str] = &["app/list"];
const PLUGIN_LIST_METHODS: &[&str] = &["plugin/list"];
const MCP_SERVER_STATUS_LIST_METHODS: &[&str] = &["mcpServerStatus/list"];
const CONFIG_READ_METHODS: &[&str] = &["config/read"];
const ACCOUNT_READ_METHODS: &[&str] = &["account/read"];
const TURN_START_METHODS: &[&str] = &["turn/start"];
const TURN_STEER_METHODS: &[&str] = &["turn/steer"];
const TURN_INTERRUPT_METHODS: &[&str] = &["turn/interrupt"];
const COMMAND_EXEC_METHODS: &[&str] = &["command/exec"];
const MODEL_LIST_METHODS: &[&str] = &["model/list", "models/list"];
const ACCOUNT_RATE_LIMITS_READ_METHODS: &[&str] = &["account/rateLimits/read"];

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const HEALTH_APP_SERVER_TIMEOUT: Duration = Duration::from_secs(12);
const LOGIN_SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const TRANSPORT_RESTART_MAX_ATTEMPTS: usize = 3;
const TRANSPORT_RESTART_BASE_BACKOFF: Duration = Duration::from_millis(250);
const TRANSPORT_RESTART_MAX_BACKOFF: Duration = Duration::from_secs(2);
const CODEX_MISSING_DEFAULT_DETAILS: &str = "`codex` executable not found in PATH";
const MAX_ATTACHMENTS_PER_TURN: usize = 10;
const MAX_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS: usize = 40_000;
const PLAN_MODE_PROMPT_PREFIX: &str = "Plan the solution first. Do not execute commands or edit files until the plan is complete. Reply with a structured plan using one line per step in the exact format `- [pending] Step`.";

pub struct CodexEngine {
    state: Arc<Mutex<CodexState>>,
    runtime_events: broadcast::Sender<CodexRuntimeEvent>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    raw_request_id: serde_json::Value,
    method: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ThreadRuntime {
    cwd: String,
    model_id: String,
    approval_policy: serde_json::Value,
    sandbox_policy: serde_json::Value,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    personality: Option<String>,
    output_schema: Option<serde_json::Value>,
    native_plan_mode_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlanModeActivation {
    Disabled,
    NativeCollaboration,
    PromptPrefix,
}

struct TurnStartOutcome {
    result: serde_json::Value,
    native_plan_mode_active: bool,
}

#[derive(Default)]
struct CodexState {
    transport: Option<Arc<CodexTransport>>,
    initialized: bool,
    approval_requests: HashMap<String, PendingApproval>,
    active_turn_ids: HashMap<String, String>,
    thread_runtimes: HashMap<String, ThreadRuntime>,
    runtime_model_cache: Option<Vec<ModelInfo>>,
    sandbox_probe_completed: bool,
    force_external_sandbox: bool,
    protocol_diagnostics: Option<CodexProtocolDiagnosticsDto>,
    runtime_monitor_transport_tag: Option<usize>,
}

impl Default for CodexEngine {
    fn default() -> Self {
        let (runtime_events, _) = broadcast::channel(256);
        Self {
            state: Arc::new(Mutex::new(CodexState::default())),
            runtime_events,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CodexExecutableResolution {
    pub executable: Option<PathBuf>,
    pub source: &'static str,
    pub app_path: Option<String>,
    pub login_shell_executable: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct CodexHealthReport {
    pub available: bool,
    pub version: Option<String>,
    pub details: Option<String>,
    pub warnings: Vec<String>,
    pub checks: Vec<String>,
    pub fixes: Vec<String>,
    pub protocol_diagnostics: Option<CodexProtocolDiagnosticsDto>,
}

#[derive(Debug, Clone)]
pub enum CodexRuntimeEvent {
    DiagnosticsUpdated {
        diagnostics: CodexProtocolDiagnosticsDto,
        toast: Option<RuntimeToastDto>,
    },
    ApprovalResolved {
        approval_id: String,
    },
    ThreadStatusChanged {
        engine_thread_id: String,
        status_type: String,
        active_flags: Vec<String>,
    },
    ThreadNameUpdated {
        engine_thread_id: String,
        thread_name: Option<String>,
    },
    ThreadSnapshotUpdated {
        engine_thread_id: String,
        thread_name: Option<String>,
        status_type: Option<String>,
        active_flags: Vec<String>,
        preview: Option<String>,
    },
    ThreadArchived {
        engine_thread_id: String,
    },
    ThreadUnarchived {
        engine_thread_id: String,
    },
}

#[derive(Debug, Clone)]
pub struct CodexForkedThread {
    pub engine_thread_id: String,
    pub model_id: String,
    pub title: Option<String>,
    pub preview: Option<String>,
    pub raw_status: Option<String>,
    pub active_flags: Vec<String>,
}

#[derive(Debug)]
pub struct CodexReviewStarted {
    pub review_thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReconciledTurnCompletion {
    status: TurnCompletionStatus,
    error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnCompletionRecoveryMode {
    CompletionTimeout,
    StreamLost,
}

#[async_trait]
impl Engine for CodexEngine {
    fn id(&self) -> &str {
        "codex"
    }

    fn name(&self) -> &str {
        "Codex"
    }

    fn models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "gpt-5.4".to_string(),
                display_name: "gpt-5.4".to_string(),
                description: "Latest frontier agentic coding model.".to_string(),
                hidden: false,
                is_default: true,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: true,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Fast responses with lighter reasoning".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balances speed and reasoning depth for everyday tasks"
                            .to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Greater reasoning depth for complex problems".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "xhigh".to_string(),
                        description: "Extra high reasoning depth for complex problems".to_string(),
                    },
                ],
            },
            ModelInfo {
                id: "gpt-5.3-codex".to_string(),
                display_name: "gpt-5.3-codex".to_string(),
                description: "Frontier Codex-optimized agentic coding model.".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("gpt-5.4".to_string()),
                availability_nux: None,
                upgrade_info: Some(ModelUpgradeInfo {
                    model: "gpt-5.4".to_string(),
                    upgrade_copy: None,
                    model_link: None,
                    migration_markdown: None,
                }),
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: true,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Fast responses with lighter reasoning".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balanced speed and reasoning depth".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Greater reasoning depth for complex problems".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "xhigh".to_string(),
                        description: "Extra high reasoning depth for complex problems".to_string(),
                    },
                ],
            },
            ModelInfo {
                id: "gpt-5.3-codex-spark".to_string(),
                display_name: "GPT-5.3-Codex-Spark".to_string(),
                description: "Ultra-fast coding model.".to_string(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string()],
                supports_personality: true,
                default_reasoning_effort: "high".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "low".to_string(),
                        description: "Fast responses with lighter reasoning".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Balances speed and reasoning depth for everyday tasks"
                            .to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Greater reasoning depth for complex problems".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "xhigh".to_string(),
                        description: "Extra high reasoning depth for complex problems".to_string(),
                    },
                ],
            },
            ModelInfo {
                id: "gpt-5.1-codex-mini".to_string(),
                display_name: "gpt-5.1-codex-mini".to_string(),
                description: "Optimized for codex. Cheaper, faster, but less capable.".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("gpt-5.4".to_string()),
                availability_nux: None,
                upgrade_info: Some(ModelUpgradeInfo {
                    model: "gpt-5.4".to_string(),
                    upgrade_copy: None,
                    model_link: None,
                    migration_markdown: None,
                }),
                input_modalities: vec!["text".to_string(), "image".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: "medium".to_string(),
                        description: "Dynamically adjusts reasoning based on the task".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: "high".to_string(),
                        description: "Maximizes reasoning depth for complex or ambiguous problems"
                            .to_string(),
                    },
                ],
            },
        ]
    }

    async fn is_available(&self) -> bool {
        resolve_codex_executable().await.executable.is_some()
    }

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error> {
        let cwd = scope_cwd(&scope);
        let approval_policy = sandbox
            .approval_policy
            .clone()
            .unwrap_or_else(|| serde_json::Value::String("on-request".to_string()));
        let mut force_external_sandbox = self.resolve_external_sandbox_mode().await;
        let mut sandbox_mode = sandbox_mode_from_policy(&sandbox, force_external_sandbox);
        let mut sandbox_policy = sandbox_policy_to_json(&sandbox, force_external_sandbox);
        let mut requested_runtime = ThreadRuntime {
            cwd: cwd.clone(),
            model_id: model.to_string(),
            approval_policy: approval_policy.clone(),
            sandbox_policy: sandbox_policy.clone(),
            reasoning_effort: sandbox.reasoning_effort.clone(),
            service_tier: sandbox.service_tier.clone(),
            personality: sandbox.personality.clone(),
            output_schema: sandbox.output_schema.clone(),
            native_plan_mode_active: false,
        };

        let transport = self.ensure_ready_transport().await?;

        if !force_external_sandbox
            && self
                .detect_workspace_write_sandbox_failure(transport.as_ref(), &cwd, &sandbox)
                .await
        {
            force_external_sandbox = true;
            self.set_force_external_sandbox(true).await;
            log::warn!("forcing external sandbox mode after workspaceWrite command probe failed");
            sandbox_mode = sandbox_mode_from_policy(&sandbox, force_external_sandbox);
            sandbox_policy = sandbox_policy_to_json(&sandbox, force_external_sandbox);
            requested_runtime.sandbox_policy = sandbox_policy.clone();
        }

        if let Some(existing_thread_id) = resume_engine_thread_id {
            if self.can_reuse_live_thread(existing_thread_id).await {
                // Codex applies model and effort per `turn/start`, so a live thread can stay put
                // while we swap the requested runtime for the next turn.
                requested_runtime = preserve_live_thread_runtime_flags(
                    requested_runtime,
                    self.thread_runtime(existing_thread_id).await.as_ref(),
                );
                self.store_thread_runtime(existing_thread_id, requested_runtime.clone())
                    .await;
                return Ok(EngineThread {
                    engine_thread_id: existing_thread_id.to_string(),
                });
            }
        }

        if let Some(existing_thread_id) = resume_engine_thread_id {
            let resume_params = build_thread_resume_params(
                existing_thread_id,
                model,
                &cwd,
                &approval_policy,
                &sandbox_mode,
                sandbox.service_tier.as_deref(),
                sandbox.personality.as_deref(),
            );

            match request_with_fallback(
                transport.as_ref(),
                THREAD_RESUME_METHODS,
                resume_params,
                DEFAULT_TIMEOUT,
            )
            .await
            {
                Ok(result) => {
                    let engine_thread_id = extract_thread_id(&result)
                        .unwrap_or_else(|| existing_thread_id.to_string());
                    let runtime = thread_runtime_from_resume_response(&result, &requested_runtime);
                    self.store_thread_runtime(&engine_thread_id, runtime).await;

                    return Ok(EngineThread { engine_thread_id });
                }
                Err(error) => {
                    log::warn!("codex thread resume failed, falling back to thread/start: {error}");
                }
            }
        }

        let start_params = serde_json::json!({
          "model": model,
          "cwd": cwd.clone(),
          "approvalPolicy": approval_policy.clone(),
          "sandbox": sandbox_mode,
          "serviceTier": sandbox.service_tier.clone(),
          "personality": sandbox.personality.clone(),
          "experimentalRawEvents": false,
          "persistExtendedHistory": false,
        });

        let result = request_with_fallback(
            transport.as_ref(),
            THREAD_START_METHODS,
            start_params,
            DEFAULT_TIMEOUT,
        )
        .await;

        let result = match result {
            Ok(result) => result,
            Err(error) => {
                if is_auth_related_error(&error.to_string()) {
                    self.invalidate_transport(
                        "resetting codex transport after auth failure while creating thread",
                    )
                    .await;
                }
                return Err(error).context("failed to create codex thread");
            }
        };

        let engine_thread_id = extract_thread_id(&result)
            .ok_or_else(|| anyhow::anyhow!("missing thread id in thread/start response"))?;
        let runtime = thread_runtime_from_start_response(
            &result,
            &requested_runtime.cwd,
            &requested_runtime.model_id,
            &requested_runtime.approval_policy,
            &requested_runtime.sandbox_policy,
            requested_runtime.reasoning_effort.clone(),
            requested_runtime.service_tier.clone(),
            requested_runtime.personality.clone(),
            requested_runtime.output_schema.clone(),
        );
        self.store_thread_runtime(&engine_thread_id, runtime).await;

        Ok(EngineThread { engine_thread_id })
    }

    async fn send_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_ready_transport().await?;
        if let Some(message) = self.unsupported_external_auth_tokens_message().await {
            return Err(anyhow::anyhow!(message));
        }

        let mut mapper = TurnEventMapper::default();
        let mut subscription = transport.subscribe();
        let thread_id = engine_thread_id.to_string();

        let runtime = self.thread_runtime(&thread_id).await;
        let plan_mode_activation = self
            .resolve_turn_plan_mode_activation(runtime.as_ref(), &input)
            .await;
        validate_turn_attachments(&input.attachments).await?;

        let transport_for_rate_limits = transport.clone();
        let rate_limits_task = tokio::spawn(async move {
            request_with_fallback(
                transport_for_rate_limits.as_ref(),
                ACCOUNT_RATE_LIMITS_READ_METHODS,
                serde_json::Value::Null,
                Duration::from_secs(5),
            )
            .await
        });

        let transport_for_turn = transport.clone();
        let thread_id_for_turn = thread_id.clone();
        let runtime_for_turn = runtime.clone();
        let input_for_turn = input.clone();
        let plan_mode_activation_for_turn = plan_mode_activation;
        let turn_task = tokio::spawn(async move {
            request_turn_start(
                transport_for_turn.as_ref(),
                &thread_id_for_turn,
                runtime_for_turn,
                input_for_turn,
                plan_mode_activation_for_turn,
            )
            .await
        });

        let mut turn_task = turn_task;
        let mut rate_limits_task = rate_limits_task;
        let mut rate_limits_done = false;
        let mut turn_request_done = false;
        let mut completion_seen = false;
        let mut expected_turn_id: Option<String> = None;
        let mut completion_last_progress_at: Option<Instant> = None;
        let completion_inactivity_timeout = completion_inactivity_timeout();

        while !completion_seen || !turn_request_done {
            tokio::select! {
              response = &mut rate_limits_task, if !rate_limits_done => {
                rate_limits_done = true;
                match response {
                  Ok(Ok(snapshot)) => {
                    if let Some(event) = mapper.map_rate_limits_snapshot(&snapshot) {
                      event_tx.send(event).await.ok();
                    }
                  }
                  Ok(Err(error)) => {
                    log::debug!("account/rateLimits/read unavailable: {error}");
                  }
                  Err(error) => {
                    log::debug!("account/rateLimits/read task join failed: {error}");
                  }
                }
              }
              _ = cancellation.cancelled() => {
                turn_task.abort();
                self
                  .interrupt(&thread_id)
                  .await
                  .context("failed to interrupt codex turn on cancellation")?;
                return Ok(());
              }
              response = &mut turn_task, if !turn_request_done => {
                turn_request_done = true;
                let outcome = match response {
                  Ok(Ok(outcome)) => outcome,
                  Ok(Err(error)) => {
                    if is_auth_related_error(&error.to_string()) {
                      self
                        .invalidate_transport(
                          "resetting codex transport after auth failure while starting turn",
                        )
                        .await;
                    }
                    return Err(error).context("turn/start request failed");
                  }
                  Err(error) => {
                    return Err(anyhow::Error::from(error).context("turn/start task join failed"));
                  }
                };
                self
                  .set_thread_native_plan_mode_active(
                    &thread_id,
                    outcome.native_plan_mode_active,
                  )
                  .await;
                let result = outcome.result;

                if let Some(turn_id) = extract_turn_id(&result) {
                  rebind_expected_turn_id(
                    &mut expected_turn_id,
                    &turn_id,
                    &thread_id,
                    "turn/start result",
                  );
                  self.set_active_turn(&thread_id, &turn_id).await;
                }

                for event in mapper.map_turn_result(&result) {
                  if event_indicates_sandbox_denial(&event) {
                    self.force_external_sandbox_for_thread(&thread_id).await;
                  }
                  if event_indicates_auth_failure(&event) {
                    self
                      .invalidate_transport(
                        "resetting codex transport after auth failure during turn result",
                      )
                      .await;
                  }
                  if matches!(event, EngineEvent::TurnCompleted { .. }) {
                    completion_seen = true;
                    self.clear_active_turn(&thread_id).await;
                  }
                  event_tx.send(event).await.ok();
                }

                if !completion_seen {
                  completion_last_progress_at = Some(Instant::now());
                }
              }
              incoming = subscription.recv() => {
                match incoming {
                  Ok(IncomingMessage::Notification { method, params }) => {
                    let normalized_method = normalize_method(&method);
                    if let Some(error_message) =
                      transport_failure_message(normalized_method.as_str(), &params)
                    {
                      self.clear_active_turn(&thread_id).await;
                      self.invalidate_transport(&error_message).await;
                      if turn_request_done
                        && self
                          .try_emit_reconciled_turn_completion(
                            &thread_id,
                            expected_turn_id.as_deref(),
                            &event_tx,
                            "stream failure while waiting for turn events",
                            TurnCompletionRecoveryMode::StreamLost,
                          )
                          .await
                      {
                        completion_seen = true;
                        break;
                      }
                      return Err(anyhow::anyhow!(error_message));
                    }

                    if !belongs_to_thread(&params, &thread_id) {
                      continue;
                    }
                    if normalized_method == "turn/started" {
                      if let Some(turn_id) = extract_turn_id(&params) {
                        rebind_expected_turn_id(
                          &mut expected_turn_id,
                          &turn_id,
                          &thread_id,
                          "turn/started notification",
                        );
                        self.set_active_turn(&thread_id, &turn_id).await;
                      }
                    } else if !belongs_to_turn(&params, expected_turn_id.as_deref()) {
                      continue;
                    }

                    if normalized_method == "turn/completed" {
                      self.clear_active_turn(&thread_id).await;
                    }
                    if turn_request_done && !completion_seen {
                      completion_last_progress_at = Some(Instant::now());
                    }

                    let mapped_events = mapper.map_notification(&method, &params);
                    if mapped_events.is_empty()
                        && !is_known_codex_notification_method(&normalized_method)
                    {
                        log::debug!(
                            "codex notification not mapped: method={method}, normalized={normalized_method}, params_keys={:?}",
                            params.as_object().map(|object| object.keys().collect::<Vec<_>>())
                        );
                    }

                    for event in mapped_events {
                      if event_indicates_sandbox_denial(&event) {
                        self.force_external_sandbox_for_thread(&thread_id).await;
                      }
                      if event_indicates_auth_failure(&event) {
                        self
                          .invalidate_transport(
                            "resetting codex transport after auth failure during streamed turn event",
                          )
                          .await;
                      }
                      if matches!(event, EngineEvent::TurnCompleted { .. }) {
                        completion_seen = true;
                        self.clear_active_turn(&thread_id).await;
                      }
                      event_tx.send(event).await.ok();
                    }
                  }
                  Ok(IncomingMessage::Request { id, raw_id, method, params }) => {
                    log::debug!(
                      "codex server request: method={method}, id={id}, raw_id={raw_id}, params_keys={:?}",
                      params.as_object().map(|o| o.keys().collect::<Vec<_>>())
                    );
                    if !belongs_to_thread(&params, &thread_id) {
                      log::warn!("codex server request dropped by belongs_to_thread: method={method}");
                      continue;
                    }
                    if !belongs_to_turn(&params, expected_turn_id.as_deref()) {
                      log::warn!("codex server request dropped by belongs_to_turn: method={method}");
                      continue;
                    }
                    let normalized_method = normalize_method(&method);
                    if method_signature(&method) == "accountchatgptauthtokensrefresh" {
                        let reason = extract_any_string(&params, &["reason"]);
                        let previous_account_id =
                            extract_any_string(&params, &["previousAccountId", "previous_account_id"]);
                        let message = unsupported_external_auth_tokens_message(
                            previous_account_id.as_deref(),
                            reason.as_deref(),
                        );
                        log::warn!(
                            "codex requested external ChatGPT token refresh, but Panes does not manage chatgptAuthTokens mode"
                        );
                        self
                            .publish_external_auth_tokens_warning(
                                previous_account_id.clone(),
                                reason.clone(),
                            )
                            .await;
                        event_tx
                            .send(EngineEvent::Error {
                                message,
                                recoverable: true,
                            })
                            .await
                            .ok();
                        transport
                        .respond_error(
                          &raw_id,
                          -32601,
                          "`account/chatgptAuthTokens/refresh` is not supported by Panes",
                          Some(serde_json::json!({
                            "method": method,
                            "normalizedMethod": normalized_method,
                          })),
                        )
                        .await
                        .ok();
                      continue;
                    }

                    if let Some(approval) =
                        mapper.map_server_request(&id, &raw_id, &method, &params)
                    {
                      log::info!(
                        "codex approval request mapped: approval_id={}, method={method}",
                        approval.approval_id
                      );
                      if turn_request_done && !completion_seen {
                        completion_last_progress_at = Some(Instant::now());
                      }
                      self
                        .register_approval_request(
                          &approval.approval_id,
                          &raw_id,
                          &approval.server_method,
                        )
                        .await;
                      event_tx.send(approval.event).await.ok();
                    } else {
                      log::warn!(
                        "codex server request not mapped: method={method}, normalized={normalized_method}"
                      );
                      let (message, recoverable) = (
                        format!("Unsupported Codex server request method `{method}`"),
                        true,
                      );

                      event_tx
                        .send(EngineEvent::Error {
                          message: message.clone(),
                          recoverable,
                        })
                        .await
                        .ok();

                      transport
                        .respond_error(
                          &raw_id,
                          -32601,
                          &message,
                          Some(serde_json::json!({
                            "method": method,
                            "normalizedMethod": normalized_method,
                          })),
                        )
                        .await
                        .ok();
                    }
                  }
                  Ok(IncomingMessage::Response(_)) => {
                    // Responses are routed by request ID in the transport pending map.
                  }
                  Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    let error_message = format!(
                        "codex transport lagged while waiting for turn events; skipped {skipped} messages"
                    );
                    self.clear_active_turn(&thread_id).await;
                    self.invalidate_transport(&error_message).await;
                    if turn_request_done
                        && self
                            .try_emit_reconciled_turn_completion(
                                &thread_id,
                                expected_turn_id.as_deref(),
                                &event_tx,
                                "lagged turn-event subscription",
                                TurnCompletionRecoveryMode::StreamLost,
                            )
                            .await
                    {
                        completion_seen = true;
                        break;
                    }
                    return Err(anyhow::anyhow!(error_message));
                  }
                  Err(broadcast::error::RecvError::Closed) => {
                    self.clear_active_turn(&thread_id).await;
                    self
                      .invalidate_transport("codex transport subscription closed while waiting for turn events")
                      .await;
                    if turn_request_done
                        && self
                            .try_emit_reconciled_turn_completion(
                                &thread_id,
                                expected_turn_id.as_deref(),
                                &event_tx,
                                "closed turn-event subscription",
                                TurnCompletionRecoveryMode::StreamLost,
                            )
                            .await
                    {
                        completion_seen = true;
                        break;
                    }
                    return Err(anyhow::anyhow!(
                      "codex transport closed while waiting for turn events"
                    ));
                  }
                }
              }
              _ = tokio::time::sleep(Duration::from_millis(200)), if turn_request_done && !completion_seen && completion_inactivity_timeout.is_some() => {
                if let Some(last_progress_at) = completion_last_progress_at {
                  if Instant::now().duration_since(last_progress_at)
                    >= completion_inactivity_timeout.expect("guarded by is_some")
                  {
                    log::warn!(
                      "codex turn completion inactivity timeout reached for thread {thread_id}; synthesizing completion"
                    );
                    break;
                  }
                }
              }
            }
        }

        if !rate_limits_done {
            rate_limits_task.abort();
        }

        if !completion_seen {
            if !self
                .try_emit_reconciled_turn_completion(
                    &thread_id,
                    expected_turn_id.as_deref(),
                    &event_tx,
                    "completion inactivity timeout",
                    TurnCompletionRecoveryMode::CompletionTimeout,
                )
                .await
            {
                event_tx
                    .send(EngineEvent::Error {
                        message: "Timed out waiting for `turn/completed` from codex app-server"
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
            }
        }

        self.clear_active_turn(&thread_id).await;
        Ok(())
    }

    async fn steer_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_ready_transport().await?;
        validate_turn_attachments(&input.attachments).await?;

        let expected_turn_id = self.active_turn_id(engine_thread_id).await.ok_or_else(|| {
            anyhow::anyhow!(
                "Codex has not reported an active turn id for thread {engine_thread_id} yet"
            )
        })?;

        request_turn_steer(
            transport.as_ref(),
            engine_thread_id,
            &expected_turn_id,
            &input,
        )
        .await
        .context("turn/steer request failed")?;

        Ok(())
    }

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
        route: Option<ApprovalRequestRoute>,
    ) -> Result<(), anyhow::Error> {
        let pending = self.approval_request(approval_id).await;
        let (raw_request_id, method) =
            resolve_approval_response_target(pending.as_ref(), route.as_ref()).map_err(
                |reason| {
                    anyhow::anyhow!(approval_response_target_error_message(reason, approval_id))
                },
            )?;
        let normalized_response = normalize_approval_response(Some(method), response);
        let transport = self.ensure_ready_transport().await?;

        log::info!(
            "sending approval response to codex: approval_id={approval_id}, raw_request_id={raw_request_id}"
        );

        transport
            .respond_success(raw_request_id, normalized_response)
            .await
            .context("failed to send approval response to codex")?;

        self.take_approval_request(approval_id).await;
        Ok(())
    }

    async fn interrupt(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let transport = {
            let state = self.state.lock().await;
            state.transport.clone()
        };

        let Some(transport) = transport else {
            return Ok(());
        };

        let Some(turn_id) = self.active_turn_id(engine_thread_id).await else {
            log::warn!(
                "skipping turn/interrupt because no active turn_id is tracked for thread {engine_thread_id}"
            );
            return Ok(());
        };

        let params = serde_json::json!({
          "threadId": engine_thread_id,
          "turnId": turn_id,
        });

        match request_with_fallback(
            transport.as_ref(),
            TURN_INTERRUPT_METHODS,
            params,
            Duration::from_secs(5),
        )
        .await
        {
            Ok(_) => {
                self.clear_active_turn(engine_thread_id).await;
                Ok(())
            }
            Err(error) => Err(error.context("codex turn interrupt request failed")),
        }
    }

    async fn archive_thread(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let transport = self.ensure_ready_transport().await?;
        let params = serde_json::json!({
            "threadId": engine_thread_id,
        });

        request_with_fallback(
            transport.as_ref(),
            THREAD_ARCHIVE_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to archive codex thread")?;

        Ok(())
    }

    async fn unarchive_thread(&self, engine_thread_id: &str) -> Result<(), anyhow::Error> {
        let transport = self.ensure_ready_transport().await?;
        let params = serde_json::json!({
            "threadId": engine_thread_id,
        });

        request_with_fallback(
            transport.as_ref(),
            THREAD_UNARCHIVE_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to unarchive codex thread")?;

        Ok(())
    }
}

impl CodexEngine {
    pub fn subscribe_runtime_events(&self) -> broadcast::Receiver<CodexRuntimeEvent> {
        self.runtime_events.subscribe()
    }

    pub async fn prewarm(&self) -> anyhow::Result<()> {
        self.ensure_ready_transport().await.map(|_| ())
    }

    pub async fn list_skills(&self, cwd: &str) -> anyhow::Result<Vec<CodexSkillDto>> {
        let transport = self.ensure_ready_transport().await?;
        let response = request_with_fallback(
            transport.as_ref(),
            SKILLS_LIST_METHODS,
            serde_json::json!({
                "cwds": [cwd],
                "forceReload": false,
            }),
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to list codex skills")?;

        let entries = response
            .get("data")
            .and_then(serde_json::Value::as_array)
            .or_else(|| response.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(map_skill_entries(&entries))
    }

    pub async fn list_apps(&self) -> anyhow::Result<Vec<CodexAppDto>> {
        let transport = self.ensure_ready_transport().await?;
        match fetch_apps(transport.as_ref()).await {
            MethodCallOutcome::Available(apps) => Ok(apps),
            MethodCallOutcome::Unsupported(detail) => {
                anyhow::bail!("codex app/list unsupported: {}", detail.unwrap_or_default())
            }
            MethodCallOutcome::Error(detail) => anyhow::bail!(detail),
        }
    }

    pub async fn fork_thread(
        &self,
        engine_thread_id: &str,
        cwd: &str,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> anyhow::Result<CodexForkedThread> {
        let transport = self.ensure_ready_transport().await?;
        let approval_policy = sandbox
            .approval_policy
            .clone()
            .unwrap_or_else(|| serde_json::Value::String("on-request".to_string()));
        let force_external_sandbox = self.resolve_external_sandbox_mode().await;
        let sandbox_mode = sandbox_mode_from_policy(&sandbox, force_external_sandbox);
        let sandbox_policy = sandbox_policy_to_json(&sandbox, force_external_sandbox);
        let requested_runtime = ThreadRuntime {
            cwd: cwd.to_string(),
            model_id: model.to_string(),
            approval_policy: approval_policy.clone(),
            sandbox_policy: sandbox_policy.clone(),
            reasoning_effort: sandbox.reasoning_effort.clone(),
            service_tier: sandbox.service_tier.clone(),
            personality: sandbox.personality.clone(),
            output_schema: sandbox.output_schema.clone(),
            native_plan_mode_active: false,
        };

        let response = request_with_fallback(
            transport.as_ref(),
            THREAD_FORK_METHODS,
            serde_json::json!({
                "threadId": engine_thread_id,
                "cwd": cwd,
                "model": model,
                "approvalPolicy": approval_policy,
                "sandbox": sandbox_mode,
                "serviceTier": sandbox.service_tier,
            }),
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to fork codex thread")?;

        let new_engine_thread_id = extract_thread_id(&response)
            .ok_or_else(|| anyhow::anyhow!("missing thread id in thread/fork response"))?;
        let runtime = thread_runtime_from_start_response(
            &response,
            &requested_runtime.cwd,
            &requested_runtime.model_id,
            &requested_runtime.approval_policy,
            &requested_runtime.sandbox_policy,
            requested_runtime.reasoning_effort.clone(),
            requested_runtime.service_tier.clone(),
            requested_runtime.personality.clone(),
            requested_runtime.output_schema.clone(),
        );
        self.store_thread_runtime(&new_engine_thread_id, runtime)
            .await;

        Ok(CodexForkedThread {
            engine_thread_id: new_engine_thread_id,
            model_id: extract_any_string(&response, &["model"])
                .unwrap_or_else(|| model.to_string()),
            title: extract_thread_title(&response),
            preview: extract_thread_preview(&response),
            raw_status: extract_thread_runtime_status_type(&response),
            active_flags: extract_thread_runtime_active_flags(&response),
        })
    }

    pub async fn rollback_thread(
        &self,
        engine_thread_id: &str,
        num_turns: u32,
    ) -> anyhow::Result<ThreadSyncSnapshot> {
        let transport = self.ensure_ready_transport().await?;
        let response = request_with_fallback(
            transport.as_ref(),
            THREAD_ROLLBACK_METHODS,
            serde_json::json!({
                "threadId": engine_thread_id,
                "numTurns": num_turns,
            }),
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to rollback codex thread")?;

        Ok(ThreadSyncSnapshot {
            title: extract_thread_title(&response),
            preview: extract_thread_preview(&response),
            raw_status: extract_thread_runtime_status_type(&response),
            active_flags: extract_thread_runtime_active_flags(&response),
        })
    }

    pub async fn compact_thread(&self, engine_thread_id: &str) -> anyhow::Result<()> {
        let transport = self.ensure_ready_transport().await?;
        request_with_fallback(
            transport.as_ref(),
            THREAD_COMPACT_START_METHODS,
            serde_json::json!({
                "threadId": engine_thread_id,
            }),
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to start codex thread compaction")?;

        Ok(())
    }

    pub async fn start_review(
        &self,
        source_engine_thread_id: &str,
        target: serde_json::Value,
        delivery: Option<&str>,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
        started_tx: oneshot::Sender<CodexReviewStarted>,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_ready_transport().await?;
        if let Some(message) = self.unsupported_external_auth_tokens_message().await {
            return Err(anyhow::anyhow!(message));
        }

        let mut mapper = TurnEventMapper::default();
        let mut subscription = transport.subscribe();
        let source_thread_id = source_engine_thread_id.to_string();
        let mut active_thread_id = source_thread_id.clone();
        let requested_delivery = delivery.map(str::to_string);

        let transport_for_rate_limits = transport.clone();
        let rate_limits_task = tokio::spawn(async move {
            request_with_fallback(
                transport_for_rate_limits.as_ref(),
                ACCOUNT_RATE_LIMITS_READ_METHODS,
                serde_json::Value::Null,
                Duration::from_secs(5),
            )
            .await
        });

        let transport_for_review = transport.clone();
        let source_thread_id_for_review = source_thread_id.clone();
        let target_for_review = target.clone();
        let review_task = tokio::spawn(async move {
            request_with_fallback(
                transport_for_review.as_ref(),
                REVIEW_START_METHODS,
                serde_json::json!({
                    "threadId": source_thread_id_for_review,
                    "target": target_for_review,
                    "delivery": requested_delivery,
                }),
                TURN_REQUEST_TIMEOUT,
            )
            .await
        });

        let mut review_task = review_task;
        let mut rate_limits_task = rate_limits_task;
        let mut rate_limits_done = false;
        let mut turn_request_done = false;
        let mut completion_seen = false;
        let mut expected_turn_id: Option<String> = None;
        let mut completion_last_progress_at: Option<Instant> = None;
        let mut started_tx = Some(started_tx);
        let completion_inactivity_timeout = completion_inactivity_timeout();

        while !completion_seen || !turn_request_done {
            tokio::select! {
              response = &mut rate_limits_task, if !rate_limits_done => {
                rate_limits_done = true;
                match response {
                  Ok(Ok(snapshot)) => {
                    if let Some(event) = mapper.map_rate_limits_snapshot(&snapshot) {
                      event_tx.send(event).await.ok();
                    }
                  }
                  Ok(Err(error)) => {
                    log::debug!("account/rateLimits/read unavailable: {error}");
                  }
                  Err(error) => {
                    log::debug!("account/rateLimits/read task join failed: {error}");
                  }
                }
              }
              _ = cancellation.cancelled() => {
                review_task.abort();
                drop(started_tx.take());
                self
                  .interrupt(&active_thread_id)
                  .await
                  .context("failed to interrupt codex review on cancellation")?;
                return Ok(());
              }
              response = &mut review_task, if !turn_request_done => {
                turn_request_done = true;
                let result = match response {
                  Ok(Ok(result)) => result,
                  Ok(Err(error)) => {
                    if is_auth_related_error(&error.to_string()) {
                      self
                        .invalidate_transport(
                          "resetting codex transport after auth failure while starting review",
                        )
                        .await;
                    }
                    drop(started_tx.take());
                    return Err(error).context("review/start request failed");
                  }
                  Err(error) => {
                    drop(started_tx.take());
                    return Err(anyhow::Error::from(error).context("review/start task join failed"));
                  }
                };

                let review_thread_id = match extract_any_string(&result, &["reviewThreadId", "review_thread_id"]) {
                    Some(id) => id,
                    None => {
                        drop(started_tx.take());
                        return Err(anyhow::anyhow!("missing review thread id in review/start response"));
                    }
                };
                active_thread_id = review_thread_id.clone();
                if let Some(started_tx) = started_tx.take() {
                    let _ = started_tx.send(CodexReviewStarted {
                        review_thread_id: review_thread_id.clone(),
                    });
                }

                if let Some(turn_id) = extract_turn_id(&result) {
                  rebind_expected_turn_id(
                    &mut expected_turn_id,
                    &turn_id,
                    &active_thread_id,
                    "review/start result",
                  );
                  self.set_active_turn(&active_thread_id, &turn_id).await;
                }

                for event in mapper.map_turn_result(&result) {
                  if event_indicates_sandbox_denial(&event) {
                    self.force_external_sandbox_for_thread(&active_thread_id).await;
                  }
                  if event_indicates_auth_failure(&event) {
                    self
                      .invalidate_transport(
                        "resetting codex transport after auth failure during review result",
                      )
                      .await;
                  }
                  if matches!(event, EngineEvent::TurnCompleted { .. }) {
                    completion_seen = true;
                    self.clear_active_turn(&active_thread_id).await;
                  }
                  event_tx.send(event).await.ok();
                }

                if !completion_seen {
                  completion_last_progress_at = Some(Instant::now());
                }
              }
              incoming = subscription.recv() => {
                match incoming {
                  Ok(IncomingMessage::Notification { method, params }) => {
                    let normalized_method = normalize_method(&method);
                    if let Some(error_message) =
                      transport_failure_message(normalized_method.as_str(), &params)
                    {
                      self.clear_active_turn(&active_thread_id).await;
                      self.invalidate_transport(&error_message).await;
                      if turn_request_done
                        && self
                          .try_emit_reconciled_turn_completion(
                            &active_thread_id,
                            expected_turn_id.as_deref(),
                            &event_tx,
                            "stream failure while waiting for review events",
                            TurnCompletionRecoveryMode::StreamLost,
                          )
                          .await
                      {
                        completion_seen = true;
                        break;
                      }
                      drop(started_tx.take());
                      return Err(anyhow::anyhow!(error_message));
                    }

                    if !belongs_to_thread(&params, &active_thread_id) {
                      continue;
                    }
                    if normalized_method == "turn/started" {
                      if let Some(turn_id) = extract_turn_id(&params) {
                        rebind_expected_turn_id(
                          &mut expected_turn_id,
                          &turn_id,
                          &active_thread_id,
                          "turn/started review notification",
                        );
                        self.set_active_turn(&active_thread_id, &turn_id).await;
                      }
                    } else if !belongs_to_turn(&params, expected_turn_id.as_deref()) {
                      continue;
                    }

                    if normalized_method == "turn/completed" {
                      self.clear_active_turn(&active_thread_id).await;
                    }
                    if turn_request_done && !completion_seen {
                      completion_last_progress_at = Some(Instant::now());
                    }

                    let mapped_events = mapper.map_notification(&method, &params);
                    if mapped_events.is_empty()
                        && !is_known_codex_notification_method(&normalized_method)
                    {
                        log::debug!(
                            "codex notification not mapped during review: method={method}, normalized={normalized_method}, params_keys={:?}",
                            params.as_object().map(|object| object.keys().collect::<Vec<_>>())
                        );
                    }

                    for event in mapped_events {
                      if event_indicates_sandbox_denial(&event) {
                        self.force_external_sandbox_for_thread(&active_thread_id).await;
                      }
                      if event_indicates_auth_failure(&event) {
                        self
                          .invalidate_transport(
                            "resetting codex transport after auth failure during streamed review event",
                          )
                          .await;
                      }
                      if matches!(event, EngineEvent::TurnCompleted { .. }) {
                        completion_seen = true;
                        self.clear_active_turn(&active_thread_id).await;
                      }
                      event_tx.send(event).await.ok();
                    }
                  }
                  Ok(IncomingMessage::Request { id, raw_id, method, params }) => {
                    log::debug!(
                      "codex review server request: method={method}, id={id}, raw_id={raw_id}, params_keys={:?}",
                      params.as_object().map(|o| o.keys().collect::<Vec<_>>())
                    );
                    if !belongs_to_thread(&params, &active_thread_id) {
                      log::warn!("codex review server request dropped by belongs_to_thread: method={method}");
                      continue;
                    }
                    if !belongs_to_turn(&params, expected_turn_id.as_deref()) {
                      log::warn!("codex review server request dropped by belongs_to_turn: method={method}");
                      continue;
                    }
                    let normalized_method = normalize_method(&method);
                    if method_signature(&method) == "accountchatgptauthtokensrefresh" {
                        let reason = extract_any_string(&params, &["reason"]);
                        let previous_account_id =
                            extract_any_string(&params, &["previousAccountId", "previous_account_id"]);
                        let message = unsupported_external_auth_tokens_message(
                            previous_account_id.as_deref(),
                            reason.as_deref(),
                        );
                        log::warn!(
                            "codex requested external ChatGPT token refresh during review, but Panes does not manage chatgptAuthTokens mode"
                        );
                        self
                            .publish_external_auth_tokens_warning(
                                previous_account_id.clone(),
                                reason.clone(),
                            )
                            .await;
                        event_tx
                            .send(EngineEvent::Error {
                                message,
                                recoverable: true,
                            })
                            .await
                            .ok();
                        transport
                        .respond_error(
                          &raw_id,
                          -32601,
                          "`account/chatgptAuthTokens/refresh` is not supported by Panes",
                          Some(serde_json::json!({
                            "method": method,
                            "normalizedMethod": normalized_method,
                          })),
                        )
                        .await
                        .ok();
                      continue;
                    }

                    if let Some(approval) =
                        mapper.map_server_request(&id, &raw_id, &method, &params)
                    {
                      log::info!(
                        "codex review approval request mapped: approval_id={}, method={method}",
                        approval.approval_id
                      );
                      if turn_request_done && !completion_seen {
                        completion_last_progress_at = Some(Instant::now());
                      }
                      self
                        .register_approval_request(
                          &approval.approval_id,
                          &raw_id,
                          &approval.server_method,
                        )
                        .await;
                      event_tx.send(approval.event).await.ok();
                    } else {
                      log::warn!(
                        "codex review server request not mapped: method={method}, normalized={normalized_method}"
                      );
                      let (message, recoverable) = (
                        format!("Unsupported Codex server request method `{method}`"),
                        true,
                      );

                      event_tx
                        .send(EngineEvent::Error {
                          message: message.clone(),
                          recoverable,
                        })
                        .await
                        .ok();

                      transport
                        .respond_error(
                          &raw_id,
                          -32601,
                          &message,
                          Some(serde_json::json!({
                            "method": method,
                            "normalizedMethod": normalized_method,
                          })),
                        )
                        .await
                        .ok();
                    }
                  }
                  Ok(IncomingMessage::Response(_)) => {}
                  Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    let error_message = format!(
                        "codex transport lagged while waiting for review events; skipped {skipped} messages"
                    );
                    self.clear_active_turn(&active_thread_id).await;
                    self.invalidate_transport(&error_message).await;
                    if turn_request_done
                        && self
                            .try_emit_reconciled_turn_completion(
                                &active_thread_id,
                                expected_turn_id.as_deref(),
                                &event_tx,
                                "lagged review-event subscription",
                                TurnCompletionRecoveryMode::StreamLost,
                            )
                            .await
                    {
                        completion_seen = true;
                        break;
                    }
                    drop(started_tx.take());
                    return Err(anyhow::anyhow!(error_message));
                  }
                  Err(broadcast::error::RecvError::Closed) => {
                    self.clear_active_turn(&active_thread_id).await;
                    self
                      .invalidate_transport("codex transport subscription closed while waiting for review events")
                      .await;
                    if turn_request_done
                        && self
                            .try_emit_reconciled_turn_completion(
                                &active_thread_id,
                                expected_turn_id.as_deref(),
                                &event_tx,
                                "closed review-event subscription",
                                TurnCompletionRecoveryMode::StreamLost,
                            )
                            .await
                    {
                        completion_seen = true;
                        break;
                    }
                    drop(started_tx.take());
                    return Err(anyhow::anyhow!(
                      "codex transport closed while waiting for review events"
                    ));
                  }
                }
              }
              _ = tokio::time::sleep(Duration::from_millis(200)), if turn_request_done && !completion_seen && completion_inactivity_timeout.is_some() => {
                if let Some(last_progress_at) = completion_last_progress_at {
                  if Instant::now().duration_since(last_progress_at)
                    >= completion_inactivity_timeout.expect("guarded by is_some")
                  {
                    log::warn!(
                      "codex review completion inactivity timeout reached for thread {active_thread_id}; synthesizing completion"
                    );
                    break;
                  }
                }
              }
            }
        }

        if !rate_limits_done {
            rate_limits_task.abort();
        }

        if !completion_seen {
            if !self
                .try_emit_reconciled_turn_completion(
                    &active_thread_id,
                    expected_turn_id.as_deref(),
                    &event_tx,
                    "review completion inactivity timeout",
                    TurnCompletionRecoveryMode::CompletionTimeout,
                )
                .await
            {
                event_tx
                    .send(EngineEvent::Error {
                        message: "Timed out waiting for `turn/completed` from codex review"
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
            }
        }

        self.clear_active_turn(&active_thread_id).await;
        Ok(())
    }

    pub async fn health_report(&self) -> CodexHealthReport {
        let resolution = resolve_codex_executable().await;
        let version_result = self.probe_version_from_resolution(&resolution).await;
        let transport_result = if version_result.is_ok() {
            self.probe_transport_ready().await
        } else {
            None
        };
        let version = version_result.as_ref().ok().cloned();
        let execution_error = version_result.err().or_else(|| transport_result.clone());
        let available = execution_error.is_none();
        let mut warnings = Vec::new();
        let details = if let Some(error) = execution_error.as_deref() {
            if resolution.executable.is_some() {
                Some(codex_execution_failure_details(&resolution, error))
            } else {
                codex_unavailable_details(&resolution)
            }
        } else {
            codex_unavailable_details(&resolution).or_else(|| codex_resolution_note(&resolution))
        };

        if available {
            if let Some(warning) = self.sandbox_preflight_warning().await {
                warnings.push(warning);
            }
        }

        let protocol_diagnostics = if available {
            self.protocol_diagnostics_snapshot().await
        } else {
            None
        };

        CodexHealthReport {
            available,
            version,
            details,
            warnings,
            checks: codex_health_checks(),
            fixes: codex_fix_commands(&resolution, execution_error.as_deref()),
            protocol_diagnostics,
        }
    }

    pub async fn list_models_runtime(&self) -> Vec<ModelInfo> {
        match self.fetch_models_from_server().await {
            Ok(models) if !models.is_empty() => {
                self.store_runtime_model_cache(models.clone()).await;
                models
            }
            Ok(_) => self.runtime_model_fallback().await,
            Err(error) => {
                log::warn!("failed to load codex models via model/list, using fallback: {error}");
                self.runtime_model_fallback().await
            }
        }
    }

    pub async fn runtime_model_fallback(&self) -> Vec<ModelInfo> {
        self.runtime_model_cache_snapshot()
            .await
            .unwrap_or_else(|| self.models())
    }

    pub async fn uses_external_sandbox(&self) -> bool {
        self.resolve_external_sandbox_mode().await
    }

    pub async fn sandbox_preflight_warning(&self) -> Option<String> {
        if !self.resolve_external_sandbox_mode().await {
            return None;
        }

        if prefer_external_sandbox_by_default() {
            Some(
                "Panes is forcing Codex external sandbox mode on macOS to avoid opaque tool-call failures in local workspace-write mode. Set `PANES_CODEX_PREFER_WORKSPACE_WRITE=1` only for diagnostics."
                    .to_string(),
            )
        } else {
            Some(
                "macOS denied Codex local sandbox (`sandbox-exec`). Commands may fail unless Panes uses external sandbox mode. This is an OS/policy restriction, not a promptable permission.".to_string(),
            )
        }
    }

    async fn probe_version_from_resolution(
        &self,
        resolution: &CodexExecutableResolution,
    ) -> Result<String, String> {
        let executable = resolution
            .executable
            .as_ref()
            .ok_or_else(|| CODEX_MISSING_DEFAULT_DETAILS.to_string())?;
        let output = codex_command(executable)
            .arg("--version")
            .output()
            .await
            .map_err(|error| {
                format!(
                    "failed to execute `{}`: {error}",
                    executable.to_string_lossy()
                )
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let message = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("process exited with status {}", output.status)
            };
            return Err(message);
        }
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() {
            return Err("codex --version returned empty output".to_string());
        }
        Ok(version)
    }

    async fn probe_transport_ready(&self) -> Option<String> {
        match tokio::time::timeout(HEALTH_APP_SERVER_TIMEOUT, self.ensure_ready_transport()).await {
            Ok(Ok(_)) => None,
            Ok(Err(error)) => Some(format!("failed to initialize `codex app-server`: {error}")),
            Err(_) => Some(format!(
                "timed out initializing `codex app-server` after {}s",
                HEALTH_APP_SERVER_TIMEOUT.as_secs()
            )),
        }
    }

    pub async fn read_thread_preview(&self, engine_thread_id: &str) -> Option<String> {
        let transport = self.ensure_ready_transport().await.ok()?;

        let params = serde_json::json!({
          "threadId": engine_thread_id,
          "includeTurns": false,
        });

        let result = request_with_fallback(
            transport.as_ref(),
            THREAD_READ_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .ok()?;

        extract_thread_preview(&result)
    }

    pub async fn list_threads(
        &self,
        search_term: Option<&str>,
        archived: Option<bool>,
    ) -> anyhow::Result<Vec<CodexRemoteThreadSummary>> {
        let transport = self.ensure_ready_transport().await?;
        let search_term = search_term.map(str::to_string);

        let threads =
            fetch_paginated_data(transport.as_ref(), THREAD_LIST_METHODS, move |cursor| {
                serde_json::json!({
                  "cursor": cursor,
                  "limit": 100,
                  "searchTerm": search_term,
                  "archived": archived,
                  "sortKey": "updated_at",
                  "sourceKinds": ["appServer"],
                })
            })
            .await
            .context("failed to list codex threads")?;

        Ok(threads
            .iter()
            .filter_map(|thread| {
                extract_codex_remote_thread_summary(thread, archived == Some(true))
            })
            .collect())
    }

    pub async fn read_remote_thread(
        &self,
        engine_thread_id: &str,
    ) -> anyhow::Result<CodexRemoteThreadSummary> {
        let transport = self.ensure_ready_transport().await?;
        let params = serde_json::json!({
          "threadId": engine_thread_id,
          "includeTurns": false,
        });

        let response = request_with_fallback(
            transport.as_ref(),
            THREAD_READ_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to read codex thread")?;

        extract_codex_remote_thread_summary(&response, false)
            .ok_or_else(|| anyhow::anyhow!("codex thread response missing remote thread summary"))
    }

    pub async fn unarchive_remote_thread(&self, engine_thread_id: &str) -> anyhow::Result<()> {
        self.unarchive_thread(engine_thread_id).await
    }

    pub async fn read_thread_sync_snapshot(
        &self,
        engine_thread_id: &str,
    ) -> anyhow::Result<ThreadSyncSnapshot> {
        let transport = self.ensure_ready_transport().await?;
        let params = serde_json::json!({
          "threadId": engine_thread_id,
          "includeTurns": false,
        });

        let result = request_with_fallback(
            transport.as_ref(),
            THREAD_READ_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to read codex thread metadata")?;

        Ok(ThreadSyncSnapshot {
            title: extract_thread_title(&result),
            preview: extract_thread_preview(&result),
            raw_status: extract_thread_runtime_status_type(&result),
            active_flags: extract_thread_runtime_active_flags(&result),
        })
    }

    async fn reconcile_turn_completion_via_thread_read(
        &self,
        engine_thread_id: &str,
        expected_turn_id: Option<&str>,
    ) -> anyhow::Result<Option<ReconciledTurnCompletion>> {
        let transport = self.ensure_ready_transport().await?;
        let params = serde_json::json!({
          "threadId": engine_thread_id,
          "includeTurns": true,
        });

        let result = request_with_fallback(
            transport.as_ref(),
            THREAD_READ_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to read codex thread turns for reconciliation")?;

        Ok(extract_reconciled_turn_completion(
            &result,
            expected_turn_id,
        ))
    }

    async fn try_emit_reconciled_turn_completion(
        &self,
        engine_thread_id: &str,
        expected_turn_id: Option<&str>,
        event_tx: &mpsc::Sender<EngineEvent>,
        reason: &str,
        mode: TurnCompletionRecoveryMode,
    ) -> bool {
        let Some(expected_turn_id) = expected_turn_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            log::warn!(
                "skipping codex turn reconciliation for thread {engine_thread_id} after {reason}: missing expected turn id"
            );
            return false;
        };

        match self
            .reconcile_turn_completion_via_thread_read(engine_thread_id, Some(expected_turn_id))
            .await
        {
            Ok(Some(reconciled)) => {
                log::warn!(
                    "reconciled codex turn completion for thread {engine_thread_id} after {reason}: status={:?}",
                    reconciled.status
                );
                for event in build_reconciled_turn_completion_events(reconciled, mode) {
                    event_tx.send(event).await.ok();
                }
                self.clear_active_turn(engine_thread_id).await;
                true
            }
            Ok(None) => false,
            Err(error) => {
                log::warn!(
                    "failed to reconcile codex turn completion for thread {engine_thread_id} after {reason}: {error}"
                );
                false
            }
        }
    }

    pub async fn set_thread_name(
        &self,
        engine_thread_id: &str,
        name: &str,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_ready_transport().await?;

        let params = serde_json::json!({
          "threadId": engine_thread_id,
          "name": name,
        });

        request_with_fallback(
            transport.as_ref(),
            THREAD_SET_NAME_METHODS,
            params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to set codex thread name")?;

        Ok(())
    }

    async fn fetch_models_from_server(&self) -> anyhow::Result<Vec<ModelInfo>> {
        if !self.is_available().await {
            return Ok(Vec::new());
        }

        let transport = self.ensure_ready_transport().await?;

        let mut cursor: Option<String> = None;
        let mut output = Vec::new();

        for _ in 0..PAGINATION_MAX_PAGES {
            let params = serde_json::json!({
              "includeHidden": true,
              "limit": 200,
              "cursor": cursor,
            });

            let response = request_with_fallback(
                transport.as_ref(),
                MODEL_LIST_METHODS,
                params,
                DEFAULT_TIMEOUT,
            )
            .await?;

            let parsed: CodexModelListResponse =
                serde_json::from_value(response).context("invalid model/list response payload")?;

            for model in parsed.data {
                output.push(map_codex_model(model));
            }

            if let Some(next_cursor) = parsed.next_cursor {
                cursor = Some(next_cursor);
            } else {
                break;
            }
        }

        Ok(output)
    }

    async fn ensure_transport(&self) -> anyhow::Result<Arc<CodexTransport>> {
        let current = {
            let state = self.state.lock().await;
            state.transport.clone()
        };

        if let Some(transport) = current {
            if transport.is_alive().await {
                return Ok(transport);
            }

            self.invalidate_transport("codex transport is not alive")
                .await;
        }

        let transport = self.spawn_transport_with_backoff().await?;
        let mut state = self.state.lock().await;
        state.transport = Some(transport.clone());
        state.initialized = false;
        Ok(transport)
    }

    async fn ensure_ready_transport(&self) -> anyhow::Result<Arc<CodexTransport>> {
        let mut backoff = TRANSPORT_RESTART_BASE_BACKOFF;
        let mut last_error: Option<anyhow::Error> = None;

        for attempt in 0..TRANSPORT_RESTART_MAX_ATTEMPTS {
            let transport = self.ensure_transport().await?;
            match self.ensure_initialized(&transport).await {
                Ok(()) => {
                    self.ensure_runtime_monitor_started(&transport).await;
                    return Ok(transport);
                }
                Err(error) => {
                    let message = format!(
                        "codex initialize failed (attempt {}/{})",
                        attempt + 1,
                        TRANSPORT_RESTART_MAX_ATTEMPTS
                    );
                    log::warn!("{message}: {error}");
                    last_error = Some(error);
                    self.invalidate_transport(&message).await;

                    if attempt + 1 < TRANSPORT_RESTART_MAX_ATTEMPTS {
                        tokio::time::sleep(backoff).await;
                        backoff =
                            std::cmp::min(backoff.saturating_mul(2), TRANSPORT_RESTART_MAX_BACKOFF);
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            anyhow::anyhow!("unable to initialize codex transport after retries")
        }))
    }

    async fn spawn_transport_with_backoff(&self) -> anyhow::Result<Arc<CodexTransport>> {
        let resolution = resolve_codex_executable().await;
        let codex_executable = resolution.executable.as_ref().ok_or_else(|| {
            anyhow::anyhow!(codex_unavailable_details(&resolution)
                .unwrap_or_else(|| CODEX_MISSING_DEFAULT_DETAILS.to_string()))
        })?;

        let mut backoff = TRANSPORT_RESTART_BASE_BACKOFF;
        let mut last_error: Option<anyhow::Error> = None;

        for attempt in 0..TRANSPORT_RESTART_MAX_ATTEMPTS {
            match CodexTransport::spawn(codex_executable.to_string_lossy().as_ref()).await {
                Ok(transport) => return Ok(Arc::new(transport)),
                Err(error) => {
                    log::warn!(
                        "failed to spawn codex transport (attempt {}/{}): {error}",
                        attempt + 1,
                        TRANSPORT_RESTART_MAX_ATTEMPTS
                    );
                    last_error = Some(error);
                    if attempt + 1 < TRANSPORT_RESTART_MAX_ATTEMPTS {
                        tokio::time::sleep(backoff).await;
                        backoff =
                            std::cmp::min(backoff.saturating_mul(2), TRANSPORT_RESTART_MAX_BACKOFF);
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| anyhow::anyhow!("unable to spawn codex transport after retries")))
    }

    async fn invalidate_transport(&self, reason: &str) {
        let transport = {
            let mut state = self.state.lock().await;
            let transport = state.transport.take();
            state.initialized = false;
            state.approval_requests.clear();
            state.active_turn_ids.clear();
            state.thread_runtimes.clear();
            state.sandbox_probe_completed = false;
            state.force_external_sandbox = false;
            if let Some(diagnostics) = state.protocol_diagnostics.as_mut() {
                diagnostics.stale = true;
            }
            state.runtime_monitor_transport_tag = None;
            transport
        };

        if let Some(transport) = transport {
            log::warn!("resetting codex transport: {reason}");
            transport.shutdown().await.ok();
        }
    }

    async fn ensure_initialized(&self, transport: &CodexTransport) -> anyhow::Result<()> {
        let mut state = self.state.lock().await;
        if state.initialized {
            return Ok(());
        }

        let initialize_params = serde_json::json!({
          "clientInfo": {
            "name": "panes",
            "title": "Panes",
            "version": env!("CARGO_PKG_VERSION"),
          },
          "capabilities": {
            "experimentalApi": true,
          },
        });

        request_with_fallback(
            transport,
            INITIALIZE_METHODS,
            initialize_params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to initialize codex app-server")?;

        transport
            .notify("initialized", serde_json::json!({}))
            .await
            .context("failed to send initialized notification to codex app-server")?;

        state.initialized = true;

        Ok(())
    }

    async fn protocol_diagnostics_snapshot(&self) -> Option<CodexProtocolDiagnosticsDto> {
        let current = {
            let state = self.state.lock().await;
            state.protocol_diagnostics.clone()
        };
        let needs_refresh = current
            .as_ref()
            .map(|diagnostics| diagnostics.stale || diagnostics.fetched_at.is_none())
            .unwrap_or(true);

        if !needs_refresh {
            return current;
        }

        let transport = match self.ensure_ready_transport().await {
            Ok(transport) => transport,
            Err(error) => {
                log::debug!("failed to load codex protocol diagnostics: {error}");
                return current;
            }
        };

        match refresh_protocol_diagnostics_via_transport(transport.as_ref(), current.clone()).await
        {
            Ok(diagnostics) => {
                self.store_protocol_diagnostics(diagnostics.clone()).await;
                Some(diagnostics)
            }
            Err(error) => {
                log::debug!("failed to refresh codex protocol diagnostics: {error}");
                if let Some(mut diagnostics) = current {
                    diagnostics.stale = true;
                    self.store_protocol_diagnostics(diagnostics.clone()).await;
                    Some(diagnostics)
                } else {
                    None
                }
            }
        }
    }

    async fn store_protocol_diagnostics(&self, diagnostics: CodexProtocolDiagnosticsDto) {
        let mut state = self.state.lock().await;
        state.protocol_diagnostics = Some(diagnostics);
    }

    async fn resolve_turn_plan_mode_activation(
        &self,
        runtime: Option<&ThreadRuntime>,
        input: &TurnInput,
    ) -> PlanModeActivation {
        if !input.plan_mode {
            return if runtime
                .map(|thread_runtime| thread_runtime.native_plan_mode_active)
                .unwrap_or(false)
            {
                PlanModeActivation::NativeCollaboration
            } else {
                PlanModeActivation::Disabled
            };
        }

        let cached_diagnostics = {
            let state = self.state.lock().await;
            state.protocol_diagnostics.clone()
        };

        if let Some(diagnostics) = cached_diagnostics.as_ref() {
            if !diagnostics.stale {
                if let Some(activation) = plan_mode_activation_from_diagnostics(Some(diagnostics)) {
                    return activation;
                }
            }
        }

        let refreshed_diagnostics = self.protocol_diagnostics_snapshot().await;
        plan_mode_activation_from_diagnostics(refreshed_diagnostics.as_ref())
            .or_else(|| plan_mode_activation_from_diagnostics(cached_diagnostics.as_ref()))
            .unwrap_or(PlanModeActivation::NativeCollaboration)
    }

    async fn unsupported_external_auth_tokens_message(&self) -> Option<String> {
        let state = self.state.lock().await;
        let auth_mode = state
            .protocol_diagnostics
            .as_ref()
            .and_then(|diagnostics| diagnostics.account.as_ref())
            .and_then(|account| account.auth_mode.as_deref());

        if auth_mode == Some("chatgptAuthTokens") {
            Some(unsupported_external_auth_tokens_message(None, None))
        } else {
            None
        }
    }

    async fn publish_external_auth_tokens_warning(
        &self,
        previous_account_id: Option<String>,
        reason: Option<String>,
    ) {
        let diagnostics = update_protocol_diagnostics_with_account_update(
            self.state.clone(),
            &serde_json::json!({
                "authMode": "chatgptAuthTokens",
            }),
        )
        .await;

        if let Some(diagnostics) = diagnostics {
            let _ = self
                .runtime_events
                .send(CodexRuntimeEvent::DiagnosticsUpdated {
                    diagnostics,
                    toast: Some(RuntimeToastDto {
                        variant: "warning".to_string(),
                        message: unsupported_external_auth_tokens_message(
                            previous_account_id.as_deref(),
                            reason.as_deref(),
                        ),
                    }),
                });
        }
    }

    async fn ensure_runtime_monitor_started(&self, transport: &Arc<CodexTransport>) {
        let transport_tag = Arc::as_ptr(transport) as usize;
        {
            let mut state = self.state.lock().await;
            if state.runtime_monitor_transport_tag == Some(transport_tag) {
                return;
            }
            state.runtime_monitor_transport_tag = Some(transport_tag);
        }

        let transport = transport.clone();
        let state = self.state.clone();
        let runtime_events = self.runtime_events.clone();
        tokio::spawn(async move {
            if let Ok(diagnostics) =
                refresh_protocol_diagnostics_for_runtime_monitor(transport.as_ref(), state.clone())
                    .await
            {
                let _ = runtime_events.send(CodexRuntimeEvent::DiagnosticsUpdated {
                    diagnostics,
                    toast: None,
                });
            }

            let mut subscription = transport.subscribe();
            loop {
                match subscription.recv().await {
                    Ok(IncomingMessage::Notification { method, params }) => {
                        let normalized_method = normalize_method(&method);
                        match normalized_method.as_str() {
                            "thread/started" => {
                                let thread = params.get("thread").unwrap_or(&params);
                                if let Some(engine_thread_id) =
                                    extract_any_string(thread, &["id", "threadId", "thread_id"])
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::ThreadSnapshotUpdated {
                                            engine_thread_id,
                                            thread_name: extract_thread_title(&params),
                                            status_type: extract_thread_runtime_status_type(
                                                &params,
                                            ),
                                            active_flags: extract_thread_runtime_active_flags(
                                                &params,
                                            ),
                                            preview: extract_thread_preview(&params),
                                        },
                                    );
                                }
                            }
                            "thread/status/changed" => {
                                if let Some(engine_thread_id) =
                                    extract_any_string(&params, &["threadId", "thread_id"])
                                {
                                    let status_type =
                                        extract_nested_string(&params, &["status", "type"])
                                            .or_else(|| {
                                                params
                                                    .get("status")
                                                    .and_then(serde_json::Value::as_str)
                                                    .map(str::to_string)
                                            })
                                            .unwrap_or_else(|| "unknown".to_string());
                                    let active_flags =
                                        extract_thread_active_flags_from_status_value(
                                            params.get("status"),
                                        );
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::ThreadStatusChanged {
                                            engine_thread_id,
                                            status_type,
                                            active_flags,
                                        },
                                    );
                                }
                            }
                            "thread/archived" => {
                                if let Some(engine_thread_id) =
                                    extract_any_string(&params, &["threadId", "thread_id"])
                                {
                                    let _ =
                                        runtime_events.send(CodexRuntimeEvent::ThreadArchived {
                                            engine_thread_id,
                                        });
                                }
                            }
                            "thread/unarchived" => {
                                if let Some(engine_thread_id) =
                                    extract_any_string(&params, &["threadId", "thread_id"])
                                {
                                    let _ =
                                        runtime_events.send(CodexRuntimeEvent::ThreadUnarchived {
                                            engine_thread_id,
                                        });
                                }
                            }
                            "thread/closed" => {
                                if let Some(engine_thread_id) =
                                    extract_any_string(&params, &["threadId", "thread_id"])
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::ThreadSnapshotUpdated {
                                            engine_thread_id,
                                            thread_name: None,
                                            status_type: Some("notLoaded".to_string()),
                                            active_flags: Vec::new(),
                                            preview: None,
                                        },
                                    );
                                }
                            }
                            "thread/name/updated" => {
                                if let Some(engine_thread_id) =
                                    extract_any_string(&params, &["threadId", "thread_id"])
                                {
                                    let thread_name =
                                        extract_any_string(&params, &["threadName", "thread_name"]);
                                    let _ =
                                        runtime_events.send(CodexRuntimeEvent::ThreadNameUpdated {
                                            engine_thread_id,
                                            thread_name,
                                        });
                                }
                            }
                            "configwarning" => {
                                if let Some(diagnostics) =
                                    update_protocol_diagnostics_with_config_warning(
                                        state.clone(),
                                        &params,
                                    )
                                    .await
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: build_config_warning_toast(&params),
                                        },
                                    );
                                }
                            }
                            "account/login/completed" => {
                                let updated = update_protocol_diagnostics_with_account_login(
                                    state.clone(),
                                    &params,
                                )
                                .await;
                                if let Some(diagnostics) =
                                    refresh_protocol_diagnostics_with_fallback(
                                        transport.as_ref(),
                                        state.clone(),
                                        "after account/login/completed",
                                        true,
                                    )
                                    .await
                                    .or(updated)
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: build_account_login_toast(&params),
                                        },
                                    );
                                }
                            }
                            "mcpserver/oauthlogin/completed" => {
                                let updated = update_protocol_diagnostics_with_mcp_oauth(
                                    state.clone(),
                                    &params,
                                )
                                .await;
                                if let Some(diagnostics) =
                                    refresh_protocol_diagnostics_with_fallback(
                                        transport.as_ref(),
                                        state.clone(),
                                        "after mcpserver/oauthlogin/completed",
                                        true,
                                    )
                                    .await
                                    .or(updated)
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: build_mcp_oauth_toast(&params),
                                        },
                                    );
                                }
                            }
                            "account/updated" => {
                                let _ = refresh_protocol_diagnostics_with_fallback(
                                    transport.as_ref(),
                                    state.clone(),
                                    "after account/updated",
                                    false,
                                )
                                .await;
                                if let Some(diagnostics) =
                                    update_protocol_diagnostics_with_account_update(
                                        state.clone(),
                                        &params,
                                    )
                                    .await
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: build_account_updated_toast(&params),
                                        },
                                    );
                                }
                            }
                            "skills/changed" | "app/list/updated" => {
                                if let Some(diagnostics) =
                                    refresh_protocol_diagnostics_with_fallback(
                                        transport.as_ref(),
                                        state.clone(),
                                        &format!("after {normalized_method}"),
                                        false,
                                    )
                                    .await
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: None,
                                        },
                                    );
                                }
                            }
                            "thread/realtime/started"
                            | "thread/realtime/closed"
                            | "thread/realtime/error"
                            | "thread/realtime/itemadded"
                            | "thread/realtime/outputaudio/delta"
                            | "thread/realtime/outputaudiodelta" => {
                                if let Some(diagnostics) =
                                    update_protocol_diagnostics_with_thread_realtime(
                                        state.clone(),
                                        normalized_method.as_str(),
                                        &params,
                                    )
                                    .await
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: None,
                                        },
                                    );
                                }
                            }
                            "windows/worldwritablewarning" => {
                                if let Some(diagnostics) =
                                    update_protocol_diagnostics_with_windows_world_writable_warning(
                                        state.clone(),
                                        &params,
                                    )
                                    .await
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: build_windows_world_writable_warning_toast(
                                                &params,
                                            ),
                                        },
                                    );
                                }
                            }
                            "windowssandbox/setupcompleted" | "windows/sandboxsetup/completed" => {
                                if let Some(diagnostics) =
                                    update_protocol_diagnostics_with_windows_sandbox_setup(
                                        state.clone(),
                                        &params,
                                    )
                                    .await
                                {
                                    let _ = runtime_events.send(
                                        CodexRuntimeEvent::DiagnosticsUpdated {
                                            diagnostics,
                                            toast: build_windows_sandbox_setup_toast(&params),
                                        },
                                    );
                                }
                            }
                            "serverrequest/resolved" => {
                                let request_id = params
                                    .get("requestId")
                                    .or_else(|| params.get("request_id"))
                                    .cloned();
                                if let Some(request_id) = request_id {
                                    if let Some(approval_id) =
                                        resolve_pending_approval_request(state.clone(), &request_id)
                                            .await
                                    {
                                        log::debug!(
                                            "codex server request resolved approval: approval_id={approval_id}"
                                        );
                                        let _ = runtime_events.send(
                                            CodexRuntimeEvent::ApprovalResolved { approval_id },
                                        );
                                    } else {
                                        log::debug!(
                                            "codex server request resolved without approval match: request_id={request_id}"
                                        );
                                    }
                                } else {
                                    log::debug!(
                                        "codex server request resolved without request id: params={params}"
                                    );
                                }
                            }
                            _ => {}
                        }
                    }
                    Ok(IncomingMessage::Request { .. }) | Ok(IncomingMessage::Response(_)) => {}
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!(
                            "codex runtime monitor lagged on notifications, skipped {skipped} messages"
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    async fn resolve_external_sandbox_mode(&self) -> bool {
        {
            let state = self.state.lock().await;
            if state.sandbox_probe_completed {
                return state.force_external_sandbox;
            }
        }

        let prefer_external_default = prefer_external_sandbox_by_default();
        if prefer_external_default {
            log::warn!(
                "forcing Codex externalSandbox mode by default on macOS; local workspace-write mode can fail tool calls without diagnostics"
            );
        }

        let preflight_failed = if prefer_external_default {
            false
        } else {
            detect_macos_sandbox_exec_failure().await
        };
        if preflight_failed {
            log::warn!(
                "detected macOS sandbox-exec preflight failure; forcing externalSandbox mode"
            );
        }

        let mut state = self.state.lock().await;
        if !state.sandbox_probe_completed {
            state.sandbox_probe_completed = true;
            if state.force_external_sandbox {
                return true;
            }
            state.force_external_sandbox = prefer_external_default || preflight_failed;
        }

        state.force_external_sandbox
    }

    async fn set_force_external_sandbox(&self, force_external_sandbox: bool) {
        let mut state = self.state.lock().await;
        state.sandbox_probe_completed = true;
        state.force_external_sandbox = force_external_sandbox;
    }

    async fn detect_workspace_write_sandbox_failure(
        &self,
        transport: &CodexTransport,
        cwd: &str,
        sandbox: &SandboxPolicy,
    ) -> bool {
        #[cfg(target_os = "macos")]
        {
            let probe_commands: &[&[&str]] = &[&["/usr/bin/true"], &["/bin/zsh", "-lc", "pwd"]];

            for command in probe_commands {
                let probe_params = serde_json::json!({
                  "command": command,
                  "cwd": cwd,
                  "timeoutMs": 5000,
                  "sandboxPolicy": sandbox_policy_to_json(sandbox, false),
                });

                match request_with_fallback(
                    transport,
                    COMMAND_EXEC_METHODS,
                    probe_params,
                    Duration::from_secs(5),
                )
                .await
                {
                    Ok(result) => {
                        if workspace_probe_result_indicates_failure(&result) {
                            log::warn!(
                                "workspaceWrite command probe returned a failed result payload; forcing externalSandbox fallback (result={result})"
                            );
                            return true;
                        }
                    }
                    Err(error) => {
                        let error_text = error.to_string();
                        if is_sandbox_denied_error(&error_text) {
                            log::warn!(
                                "workspaceWrite command probe detected sandbox denial: {error}"
                            );
                            return true;
                        }
                        if is_opaque_workspace_probe_failure(&error_text) {
                            log::warn!(
                                "workspaceWrite command probe failed without explicit sandbox signature; forcing externalSandbox fallback (probe_error={error_text})"
                            );
                            return true;
                        }
                        log::warn!(
                            "workspaceWrite command probe failed due transport/protocol error; skipping externalSandbox fallback (probe_error={error_text})"
                        );
                        return false;
                    }
                }
            }

            false
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (transport, cwd, sandbox);
            false
        }
    }

    async fn force_external_sandbox_for_thread(&self, engine_thread_id: &str) {
        self.set_force_external_sandbox(true).await;

        let mut state = self.state.lock().await;
        if let Some(runtime) = state.thread_runtimes.get_mut(engine_thread_id) {
            let allow_network = sandbox_policy_network_enabled(&runtime.sandbox_policy);
            runtime.sandbox_policy = serde_json::json!({
              "type": "externalSandbox",
              "networkAccess": if allow_network { "enabled" } else { "restricted" },
            });
        }
    }

    async fn register_approval_request(
        &self,
        approval_id: &str,
        raw_request_id: &serde_json::Value,
        method: &str,
    ) {
        let mut state = self.state.lock().await;
        state.approval_requests.insert(
            approval_id.to_string(),
            PendingApproval {
                raw_request_id: raw_request_id.clone(),
                method: method.to_string(),
            },
        );
    }

    async fn approval_request(&self, approval_id: &str) -> Option<PendingApproval> {
        let state = self.state.lock().await;
        state.approval_requests.get(approval_id).cloned()
    }

    async fn take_approval_request(&self, approval_id: &str) -> Option<PendingApproval> {
        let mut state = self.state.lock().await;
        state.approval_requests.remove(approval_id)
    }

    async fn set_active_turn(&self, engine_thread_id: &str, turn_id: &str) {
        let mut state = self.state.lock().await;
        state
            .active_turn_ids
            .insert(engine_thread_id.to_string(), turn_id.to_string());
    }

    async fn clear_active_turn(&self, engine_thread_id: &str) {
        let mut state = self.state.lock().await;
        state.active_turn_ids.remove(engine_thread_id);
    }

    async fn active_turn_id(&self, engine_thread_id: &str) -> Option<String> {
        let state = self.state.lock().await;
        state.active_turn_ids.get(engine_thread_id).cloned()
    }

    async fn store_thread_runtime(&self, engine_thread_id: &str, runtime: ThreadRuntime) {
        let mut state = self.state.lock().await;
        state
            .thread_runtimes
            .insert(engine_thread_id.to_string(), runtime);
    }

    async fn set_thread_native_plan_mode_active(&self, engine_thread_id: &str, active: bool) {
        let mut state = self.state.lock().await;
        if let Some(runtime) = state.thread_runtimes.get_mut(engine_thread_id) {
            runtime.native_plan_mode_active = active;
        }
    }

    async fn store_runtime_model_cache(&self, models: Vec<ModelInfo>) {
        let mut state = self.state.lock().await;
        state.runtime_model_cache = Some(models);
    }

    async fn runtime_model_cache_snapshot(&self) -> Option<Vec<ModelInfo>> {
        let state = self.state.lock().await;
        state.runtime_model_cache.clone()
    }

    async fn thread_runtime(&self, engine_thread_id: &str) -> Option<ThreadRuntime> {
        let state = self.state.lock().await;
        state.thread_runtimes.get(engine_thread_id).cloned()
    }

    async fn can_reuse_live_thread(&self, engine_thread_id: &str) -> bool {
        let (transport, initialized, known_thread) = {
            let state = self.state.lock().await;
            (
                state.transport.clone(),
                state.initialized,
                state.thread_runtimes.contains_key(engine_thread_id),
            )
        };

        if !initialized || !known_thread {
            return false;
        }

        let Some(transport) = transport else {
            return false;
        };

        transport.is_alive().await
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexModelListResponse {
    data: Vec<CodexModel>,
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexModel {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default)]
    is_default: Option<bool>,
    #[serde(default)]
    upgrade: Option<String>,
    #[serde(default)]
    availability_nux: Option<CodexModelAvailabilityNux>,
    #[serde(default)]
    upgrade_info: Option<CodexModelUpgradeInfo>,
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    supports_personality: Option<bool>,
    #[serde(default)]
    default_reasoning_effort: Option<String>,
    #[serde(default)]
    supported_reasoning_efforts: Vec<CodexReasoningEffortOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexReasoningEffortOption {
    reasoning_effort: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexModelAvailabilityNux {
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexModelUpgradeInfo {
    model: String,
    #[serde(default)]
    upgrade_copy: Option<String>,
    #[serde(default)]
    model_link: Option<String>,
    #[serde(default)]
    migration_markdown: Option<String>,
}

fn map_codex_model(value: CodexModel) -> ModelInfo {
    ModelInfo {
        id: value.id.clone(),
        display_name: value.display_name.unwrap_or_else(|| value.id.clone()),
        description: value.description.unwrap_or_default(),
        hidden: value.hidden.unwrap_or(false),
        is_default: value.is_default.unwrap_or(false),
        upgrade: value.upgrade,
        availability_nux: value.availability_nux.map(|nux| ModelAvailabilityNux {
            message: nux.message,
        }),
        upgrade_info: value.upgrade_info.map(|info| ModelUpgradeInfo {
            model: info.model,
            upgrade_copy: info.upgrade_copy,
            model_link: info.model_link,
            migration_markdown: info.migration_markdown,
        }),
        input_modalities: if value.input_modalities.is_empty() {
            vec!["text".to_string(), "image".to_string()]
        } else {
            value.input_modalities
        },
        supports_personality: value.supports_personality.unwrap_or(false),
        default_reasoning_effort: value
            .default_reasoning_effort
            .unwrap_or_else(|| "medium".to_string()),
        supported_reasoning_efforts: if value.supported_reasoning_efforts.is_empty() {
            vec![ReasoningEffortOption {
                reasoning_effort: "medium".to_string(),
                description: "Balanced reasoning effort".to_string(),
            }]
        } else {
            value
                .supported_reasoning_efforts
                .into_iter()
                .map(|option| ReasoningEffortOption {
                    reasoning_effort: option.reasoning_effort,
                    description: option.description,
                })
                .collect()
        },
    }
}

pub async fn resolve_codex_executable() -> CodexExecutableResolution {
    let app_path = std::env::var("PATH").ok();

    if let Some(path) = runtime_env::resolve_executable("codex") {
        return CodexExecutableResolution {
            executable: Some(path),
            source: "app-path",
            app_path,
            login_shell_executable: None,
        };
    }

    let login_shell_executable = detect_codex_via_login_shell().await;
    let executable = login_shell_executable.clone();

    CodexExecutableResolution {
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

fn codex_unavailable_details(resolution: &CodexExecutableResolution) -> Option<String> {
    codex_unavailable_details_for_platform(runtime_env::platform_id(), resolution)
}

fn codex_unavailable_details_for_platform(
    platform: &str,
    resolution: &CodexExecutableResolution,
) -> Option<String> {
    if resolution.executable.is_some() {
        return None;
    }

    let path_preview = app_path_preview(resolution.app_path.as_deref());

    match (platform, resolution.login_shell_executable.as_ref()) {
        ("macos", Some(shell_path)) => Some(format!(
            "Codex was found in your login shell at `{}`, but Panes does not see this in its app PATH. This is common when launching from Finder on macOS. App PATH: `{}`",
            shell_path.display(),
            path_preview
        )),
        ("windows", _) => Some(format!(
            "{}. App PATH: `{}`. On Windows, Codex is usually installed with `npm install -g @openai/codex` and exposed from `%APPDATA%\\npm`.",
            CODEX_MISSING_DEFAULT_DETAILS, path_preview
        )),
        (_, Some(shell_path)) => Some(format!(
            "Codex was found in your login shell at `{}`, but Panes does not see this in its app PATH. App PATH: `{}`",
            shell_path.display(),
            path_preview
        )),
        (_, None) => Some(format!(
            "{}. App PATH: `{}`",
            CODEX_MISSING_DEFAULT_DETAILS, path_preview
        )),
    }
}

fn codex_execution_failure_details(resolution: &CodexExecutableResolution, error: &str) -> String {
    codex_execution_failure_details_for_platform(runtime_env::platform_id(), resolution, error)
}

fn codex_execution_failure_details_for_platform(
    platform: &str,
    resolution: &CodexExecutableResolution,
    error: &str,
) -> String {
    let path_preview = app_path_preview(resolution.app_path.as_deref());
    let executable = resolution
        .executable
        .as_ref()
        .map(|value| value.display().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    if error
        .to_lowercase()
        .contains("env: node: no such file or directory")
    {
        if platform == "windows" {
            return format!(
                "Codex executable was found at `{executable}`, but Panes could not find `node` when launching it. This usually means Node.js is not installed or its install directory is missing from PATH on Windows. App PATH: `{path_preview}`. Error: {error}"
            );
        }

        if platform != "macos" {
            return format!(
                "Codex executable was found at `{executable}`, but Panes could not find `node` when launching it. App PATH: `{path_preview}`. Error: {error}"
            );
        }

        return format!(
            "Codex executable was found at `{executable}`, but Panes could not find `node` when launching it (Finder-launched apps often have a limited PATH). App PATH: `{path_preview}`. Error: {error}"
        );
    }

    format!(
        "Codex executable was found at `{executable}`, but Panes could not run it. App PATH: `{path_preview}`. Error: {error}"
    )
}

fn codex_resolution_note(resolution: &CodexExecutableResolution) -> Option<String> {
    if resolution.source == "app-path" {
        return None;
    }

    let executable = resolution.executable.as_ref()?;
    Some(format!(
        "Codex detected via {} at `{}`.",
        resolution.source,
        executable.display()
    ))
}

fn codex_health_checks() -> Vec<String> {
    codex_health_checks_for_platform(runtime_env::platform_id())
}

fn codex_health_checks_for_platform(platform: &str) -> Vec<String> {
    let mut checks = vec![
        "codex --version".to_string(),
        "node --version".to_string(),
        "codex app-server --help".to_string(),
    ];

    match platform {
        "windows" => {
            checks.push("where codex".to_string());
            checks.push("where node".to_string());
            checks.push("echo %PATH%".to_string());
        }
        "macos" => {
            checks.push("command -v codex".to_string());
            checks.push("command -v node".to_string());
            checks.push("echo \"$PATH\"".to_string());
            checks.push("/bin/zsh -lic 'command -v codex && codex --version'".to_string());
            checks.push("sandbox-exec -p '(version 1) (allow default)' /usr/bin/true".to_string());
        }
        _ => {
            checks.push("command -v codex".to_string());
            checks.push("command -v node".to_string());
        }
    }

    checks
}

fn codex_fix_commands(
    resolution: &CodexExecutableResolution,
    execution_error: Option<&str>,
) -> Vec<String> {
    codex_fix_commands_for_platform(runtime_env::platform_id(), resolution, execution_error)
}

fn codex_fix_commands_for_platform(
    platform: &str,
    resolution: &CodexExecutableResolution,
    execution_error: Option<&str>,
) -> Vec<String> {
    if platform == "macos" {
        let mut fixes = Vec::new();
        if resolution.executable.is_none() {
            if let Some(shell_path) = &resolution.login_shell_executable {
                if let Some(bin_dir) = shell_path.parent() {
                    fixes.push(format!(
                        "launchctl setenv PATH \"{}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\"",
                        bin_dir.display()
                    ));
                    fixes.push("open -a Panes".to_string());
                }
            } else {
                fixes.push("/bin/zsh -lic 'command -v codex && codex --version'".to_string());
                fixes.push("open -a Panes".to_string());
            }
        } else if execution_error.is_some() {
            if let Some(executable) = resolution.executable.as_ref() {
                if let Some(bin_dir) = executable.parent() {
                    fixes.push(format!(
                        "launchctl setenv PATH \"{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\"",
                        bin_dir.display()
                    ));
                }
            }
            fixes.push(
                "/bin/zsh -lic 'command -v node && command -v codex && codex --version'"
                    .to_string(),
            );
            fixes.push("open -a Panes".to_string());
        }

        return fixes;
    }

    if platform == "windows" {
        let mut fixes = Vec::new();
        if resolution.executable.is_none() {
            fixes.push("npm install -g @openai/codex".to_string());
            fixes.push("where codex".to_string());
            fixes.push("echo %APPDATA%".to_string());
            fixes.push(
                "Ensure `%APPDATA%\\npm` is present in PATH, then restart Panes.".to_string(),
            );
            return fixes;
        }

        if execution_error.is_some() {
            fixes.push("where node".to_string());
            fixes.push("where codex".to_string());
            fixes.push("echo %PATH%".to_string());
            fixes.push(
                "Ensure Node.js 20+ is installed and visible to Panes, then restart the app."
                    .to_string(),
            );
        }
        return fixes;
    }

    let _ = resolution;
    let _ = execution_error;
    Vec::new()
}

fn app_path_preview(path: Option<&str>) -> String {
    path.filter(|value| !value.trim().is_empty())
        .unwrap_or("(empty)")
        .to_string()
}

fn codex_augmented_path(executable: &Path) -> Option<OsString> {
    runtime_env::augmented_path_with_prepend(
        executable
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    )
}

fn codex_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    process_utils::configure_tokio_command(&mut command);
    if let Some(augmented_path) = codex_augmented_path(executable) {
        command.env("PATH", augmented_path);
    }
    command
}

async fn detect_codex_via_login_shell() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        for powershell in runtime_env::windows_login_probe_shells() {
            let mut cmd = Command::new(&powershell);
            cmd.args([
                "-NoLogo",
                "-Command",
                "(Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1).Source",
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
                        "command -v codex",
                    ))
                    .output(),
            )
            .await
            {
                Err(_) => {
                    log::warn!(
                        "timed out probing Codex via login shell `{}`",
                        shell.display()
                    );
                    continue;
                }
                Ok(Ok(output)) if output.status.success() => output,
                Ok(Ok(_)) => continue,
                Ok(Err(_)) => continue,
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

async fn request_turn_start(
    transport: &CodexTransport,
    thread_id: &str,
    runtime: Option<ThreadRuntime>,
    input: TurnInput,
    plan_mode_activation: PlanModeActivation,
) -> anyhow::Result<TurnStartOutcome> {
    let runtime_ref = runtime.as_ref();
    let uses_native_collaboration_mode =
        should_use_native_collaboration_mode(plan_mode_activation, runtime_ref);

    let primary_params =
        build_turn_start_params(thread_id, runtime_ref, &input, plan_mode_activation).await?;
    match request_with_fallback(
        transport,
        TURN_START_METHODS,
        primary_params,
        TURN_REQUEST_TIMEOUT,
    )
    .await
    {
        Ok(result) => Ok(TurnStartOutcome {
            result,
            native_plan_mode_active: input.plan_mode && uses_native_collaboration_mode,
        }),
        Err(error) => {
            if !uses_native_collaboration_mode || !is_plan_mode_protocol_error(&error.to_string()) {
                return Err(error).context("codex turn/start request failed");
            }

            let fallback_activation = if input.plan_mode {
                log::warn!(
                    "native codex plan mode rejected by app-server; retrying with prompt-guided fallback: {error}"
                );
                PlanModeActivation::PromptPrefix
            } else {
                log::warn!(
                    "native codex collaboration-mode reset rejected by app-server; retrying without collaboration mode override: {error}"
                );
                PlanModeActivation::Disabled
            };

            let fallback_params =
                build_turn_start_params(thread_id, runtime_ref, &input, fallback_activation)
                    .await?;
            let result = request_with_fallback(
                transport,
                TURN_START_METHODS,
                fallback_params,
                TURN_REQUEST_TIMEOUT,
            )
            .await
            .context("codex turn/start request failed after plan-mode fallback")?;

            Ok(TurnStartOutcome {
                result,
                native_plan_mode_active: false,
            })
        }
    }
}

async fn request_turn_steer(
    transport: &CodexTransport,
    thread_id: &str,
    expected_turn_id: &str,
    input: &TurnInput,
) -> anyhow::Result<serde_json::Value> {
    let params = serde_json::json!({
      "threadId": thread_id,
      "expectedTurnId": expected_turn_id,
      "input": build_turn_input_items(input, false).await?,
    });

    request_with_fallback(transport, TURN_STEER_METHODS, params, TURN_REQUEST_TIMEOUT)
        .await
        .context("codex turn/steer request failed")
}

async fn build_turn_start_params(
    thread_id: &str,
    runtime: Option<&ThreadRuntime>,
    input: &TurnInput,
    plan_mode_activation: PlanModeActivation,
) -> anyhow::Result<serde_json::Value> {
    let use_native_collaboration_mode =
        should_use_native_collaboration_mode(plan_mode_activation, runtime);
    let mut turn_params = serde_json::json!({
      "threadId": thread_id,
      "input": build_turn_input_items(
          input,
          matches!(plan_mode_activation, PlanModeActivation::PromptPrefix)
              || (input.plan_mode && !use_native_collaboration_mode),
      )
      .await?,
    });

    if let Some(runtime) = runtime {
        if let Some(params) = turn_params.as_object_mut() {
            params.insert(
                "cwd".to_string(),
                serde_json::Value::String(runtime.cwd.clone()),
            );
            params.insert(
                "approvalPolicy".to_string(),
                runtime.approval_policy.clone(),
            );
            params.insert("sandboxPolicy".to_string(), runtime.sandbox_policy.clone());
            params.insert(
                "model".to_string(),
                serde_json::Value::String(runtime.model_id.clone()),
            );
            if let Some(effort) = runtime.reasoning_effort.as_ref() {
                params.insert(
                    "effort".to_string(),
                    serde_json::Value::String(effort.clone()),
                );
            }
            if let Some(service_tier) = runtime.service_tier.as_ref() {
                params.insert(
                    "serviceTier".to_string(),
                    serde_json::Value::String(service_tier.clone()),
                );
            }
            if let Some(personality) = runtime.personality.as_ref() {
                params.insert(
                    "personality".to_string(),
                    serde_json::Value::String(personality.clone()),
                );
            }
            if let Some(output_schema) = runtime.output_schema.as_ref() {
                params.insert("outputSchema".to_string(), output_schema.clone());
            }
            if use_native_collaboration_mode {
                if let Some(collaboration_mode) =
                    collaboration_mode_protocol_payload(runtime, input.plan_mode)
                {
                    params.insert("collaborationMode".to_string(), collaboration_mode);
                    params.insert(
                        "summary".to_string(),
                        if input.plan_mode {
                            serde_json::Value::String("detailed".to_string())
                        } else {
                            serde_json::Value::Null
                        },
                    );
                }
            }
        }
    }

    Ok(turn_params)
}

async fn build_turn_input_items(
    input: &TurnInput,
    force_plan_prompt_prefix: bool,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let base_items = if input.input_items.is_empty() {
        vec![TurnInputItem::Text {
            text: input.message.clone(),
        }]
    } else {
        input.input_items.clone()
    };

    let text_items = apply_plan_prompt_prefix(base_items, force_plan_prompt_prefix);
    let mut items = Vec::with_capacity(text_items.len() + input.attachments.len());
    for item in text_items {
        match item {
            TurnInputItem::Text { text } => {
                items.push(serde_json::json!({
                  "type": "text",
                  "text": text,
                  "text_elements": [],
                }));
            }
            TurnInputItem::Skill { name, path } => {
                items.push(serde_json::json!({
                  "type": "skill",
                  "name": name,
                  "path": path,
                }));
            }
            TurnInputItem::Mention { name, path } => {
                items.push(serde_json::json!({
                  "type": "mention",
                  "name": name,
                  "path": path,
                }));
            }
        }
    }

    for attachment in &input.attachments {
        match attachment_input_kind(attachment) {
            Some(AttachmentInputKind::Image) => {
                items.push(serde_json::json!({
                  "type": "localImage",
                  "path": attachment.file_path,
                }));
            }
            Some(AttachmentInputKind::Text) => {
                let text_payload = read_text_attachment_for_turn_input(attachment).await?;
                items.push(serde_json::json!({
                  "type": "text",
                  "text": text_payload,
                  "text_elements": [],
                }));
            }
            None => {
                anyhow::bail!(
                    "Attachment `{}` is not supported by Codex app-server. Only image and text attachments are currently supported.",
                    attachment.file_name
                );
            }
        }
    }

    Ok(items)
}

fn should_use_native_collaboration_mode(
    plan_mode_activation: PlanModeActivation,
    runtime: Option<&ThreadRuntime>,
) -> bool {
    matches!(
        plan_mode_activation,
        PlanModeActivation::NativeCollaboration
    ) && runtime
        .map(|runtime| !runtime.model_id.trim().is_empty())
        .unwrap_or(false)
}

fn collaboration_mode_protocol_payload(
    runtime: &ThreadRuntime,
    plan_mode: bool,
) -> Option<serde_json::Value> {
    if runtime.model_id.trim().is_empty() {
        return None;
    }

    let mut settings = serde_json::Map::new();
    settings.insert(
        "model".to_string(),
        serde_json::Value::String(runtime.model_id.clone()),
    );
    if let Some(effort) = runtime.reasoning_effort.as_ref() {
        settings.insert(
            "reasoning_effort".to_string(),
            serde_json::Value::String(effort.clone()),
        );
    }

    Some(serde_json::json!({
      "mode": if plan_mode { "plan" } else { "default" },
      "settings": settings,
    }))
}

fn preserve_live_thread_runtime_flags(
    mut requested_runtime: ThreadRuntime,
    existing_runtime: Option<&ThreadRuntime>,
) -> ThreadRuntime {
    if let Some(existing_runtime) = existing_runtime {
        requested_runtime.native_plan_mode_active = existing_runtime.native_plan_mode_active;
    }

    requested_runtime
}

fn plan_mode_activation_from_diagnostics(
    diagnostics: Option<&CodexProtocolDiagnosticsDto>,
) -> Option<PlanModeActivation> {
    let diagnostics = diagnostics?;
    let advertises_plan = diagnostics
        .collaboration_modes
        .iter()
        .any(|mode| mode.eq_ignore_ascii_case("plan"));
    let availability = diagnostics
        .method_availability
        .iter()
        .find(|entry| entry.method == "collaborationMode/list")
        .map(|entry| entry.status.as_str());

    match availability {
        Some("available") => Some(if advertises_plan {
            PlanModeActivation::NativeCollaboration
        } else {
            PlanModeActivation::PromptPrefix
        }),
        Some("unsupported") => Some(PlanModeActivation::PromptPrefix),
        Some("error") => None,
        Some(_) => None,
        None if !diagnostics.collaboration_modes.is_empty() => Some(if advertises_plan {
            PlanModeActivation::NativeCollaboration
        } else {
            PlanModeActivation::PromptPrefix
        }),
        None => None,
    }
}

fn apply_plan_prompt_prefix(items: Vec<TurnInputItem>, include_prefix: bool) -> Vec<TurnInputItem> {
    if !include_prefix {
        return items;
    }

    let mut prefixed = Vec::with_capacity(items.len().saturating_add(1));
    let mut applied = false;
    for item in items {
        match item {
            TurnInputItem::Text { text } if !applied => {
                let text = if text.is_empty() {
                    PLAN_MODE_PROMPT_PREFIX.to_string()
                } else {
                    format!("{}\n\n{}", PLAN_MODE_PROMPT_PREFIX, text)
                };
                prefixed.push(TurnInputItem::Text { text });
                applied = true;
            }
            other => prefixed.push(other),
        }
    }

    if !applied {
        prefixed.insert(
            0,
            TurnInputItem::Text {
                text: PLAN_MODE_PROMPT_PREFIX.to_string(),
            },
        );
    }

    prefixed
}

fn is_plan_mode_protocol_error(error: &str) -> bool {
    let value = error.to_lowercase();
    value.contains("collaborationmode")
        || value.contains("collaboration_mode")
        || value.contains("unknown field `collaboration")
        || (value.contains("unknown field") && value.contains("plan"))
}

async fn validate_turn_attachments(attachments: &[TurnAttachment]) -> anyhow::Result<()> {
    if attachments.len() > MAX_ATTACHMENTS_PER_TURN {
        anyhow::bail!("You can attach at most {MAX_ATTACHMENTS_PER_TURN} files per turn.");
    }

    for attachment in attachments {
        let path = attachment.file_path.trim();
        if path.is_empty() {
            anyhow::bail!("Attachment path cannot be empty.");
        }

        if attachment_input_kind(attachment).is_none() {
            anyhow::bail!(
                "Attachment `{}` is not supported by Codex app-server. Only image and text attachments are currently supported.",
                attachment.file_name
            );
        }

        let metadata = tokio_fs::metadata(path).await.with_context(|| {
            format!(
                "Attachment `{}` could not be read at `{}`",
                attachment.file_name, attachment.file_path
            )
        })?;
        let size_bytes = std::cmp::max(metadata.len(), attachment.size_bytes);
        if size_bytes > MAX_ATTACHMENT_BYTES {
            anyhow::bail!(
                "Attachment `{}` exceeds the 10 MB per-file limit.",
                attachment.file_name
            );
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttachmentInputKind {
    Image,
    Text,
}

fn attachment_input_kind(attachment: &TurnAttachment) -> Option<AttachmentInputKind> {
    if let Some(mime_type) = attachment.mime_type.as_deref() {
        let normalized = mime_type.to_lowercase();
        if normalized.starts_with("image/") {
            return Some(AttachmentInputKind::Image);
        }
        if is_supported_text_mime_type(&normalized) {
            return Some(AttachmentInputKind::Text);
        }
    }

    if is_supported_image_extension(&attachment.file_name)
        || is_supported_image_extension(&attachment.file_path)
    {
        return Some(AttachmentInputKind::Image);
    }

    if is_supported_text_extension(&attachment.file_name)
        || is_supported_text_extension(&attachment.file_path)
    {
        return Some(AttachmentInputKind::Text);
    }

    None
}

fn is_supported_image_extension(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());

    matches!(
        extension.as_deref(),
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("bmp")
            | Some("tif")
            | Some("tiff")
            | Some("svg")
    )
}

fn is_supported_text_mime_type(mime_type: &str) -> bool {
    mime_type.starts_with("text/")
        || mime_type.contains("json")
        || mime_type.contains("xml")
        || mime_type.contains("yaml")
        || mime_type.contains("toml")
        || mime_type.contains("javascript")
        || mime_type.contains("typescript")
        || mime_type.contains("x-rust")
        || mime_type.contains("x-python")
        || mime_type.contains("x-go")
        || mime_type.contains("x-shellscript")
        || mime_type.contains("sql")
        || mime_type.contains("csv")
}

fn is_supported_text_extension(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());

    matches!(
        extension.as_deref(),
        Some("txt")
            | Some("md")
            | Some("json")
            | Some("js")
            | Some("ts")
            | Some("tsx")
            | Some("jsx")
            | Some("py")
            | Some("rs")
            | Some("go")
            | Some("css")
            | Some("html")
            | Some("yaml")
            | Some("yml")
            | Some("toml")
            | Some("xml")
            | Some("sql")
            | Some("sh")
            | Some("csv")
    )
}

async fn read_text_attachment_for_turn_input(
    attachment: &TurnAttachment,
) -> anyhow::Result<String> {
    let bytes = tokio_fs::read(attachment.file_path.trim())
        .await
        .with_context(|| {
            format!(
                "Attachment `{}` could not be read at `{}`",
                attachment.file_name, attachment.file_path
            )
        })?;
    let raw_text = String::from_utf8_lossy(&bytes);
    let (truncated_text, was_truncated) =
        truncate_text_to_max_chars(raw_text.as_ref(), MAX_TEXT_ATTACHMENT_CHARS);
    let mut payload = format!(
        "Attached text file: {} ({})\n<attached-file-content>\n{}\n</attached-file-content>",
        attachment.file_name, attachment.file_path, truncated_text
    );
    if was_truncated {
        payload.push_str(&format!(
            "\n\n[Attachment content was truncated to {MAX_TEXT_ATTACHMENT_CHARS} characters.]"
        ));
    }
    Ok(payload)
}

fn truncate_text_to_max_chars(value: &str, max_chars: usize) -> (String, bool) {
    if value.chars().count() <= max_chars {
        return (value.to_string(), false);
    }

    let truncated: String = value.chars().take(max_chars).collect();
    (truncated, true)
}

async fn request_with_fallback(
    transport: &CodexTransport,
    methods: &[&str],
    params: serde_json::Value,
    timeout: Duration,
) -> anyhow::Result<serde_json::Value> {
    let mut errors = Vec::new();

    for method in methods {
        match transport.request(method, params.clone(), timeout).await {
            Ok(result) => return Ok(result),
            Err(error) => {
                errors.push(format!("{method}: {error}"));
            }
        }
    }

    anyhow::bail!("all rpc methods failed: {}", errors.join(" | "))
}

fn scope_cwd(scope: &ThreadScope) -> String {
    match scope {
        ThreadScope::Repo { repo_path } => repo_path.to_string(),
        ThreadScope::Workspace { root_path, .. } => root_path.to_string(),
    }
}

fn build_thread_resume_params(
    thread_id: &str,
    model: &str,
    cwd: &str,
    approval_policy: &serde_json::Value,
    sandbox_mode: &str,
    service_tier: Option<&str>,
    personality: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
      "threadId": thread_id,
      "model": model,
      "cwd": cwd,
      "approvalPolicy": approval_policy,
      "sandbox": sandbox_mode,
      "serviceTier": service_tier,
      "personality": personality,
      "persistExtendedHistory": false,
    })
}

fn sandbox_mode_from_policy(sandbox: &SandboxPolicy, force_external_sandbox: bool) -> String {
    // `thread/start` only accepts sandbox mode enums. When local workspace sandboxing is broken
    // (common in macOS app contexts), use danger-full-access and enforce external sandboxing on
    // each `turn/start` via `sandboxPolicy`.
    if force_external_sandbox {
        "danger-full-access".to_string()
    } else {
        sandbox
            .sandbox_mode
            .clone()
            .unwrap_or_else(|| "workspace-write".to_string())
    }
}

fn sandbox_policy_to_json(
    sandbox: &SandboxPolicy,
    force_external_sandbox: bool,
) -> serde_json::Value {
    if force_external_sandbox {
        serde_json::json!({
          "type": "externalSandbox",
          "networkAccess": if sandbox.allow_network { "enabled" } else { "restricted" },
        })
    } else {
        match sandbox.sandbox_mode.as_deref().unwrap_or("workspace-write") {
            "read-only" => serde_json::json!({
              "type": "readOnly",
              "access": {
                "type": "restricted",
                "includePlatformDefaults": true,
                "readableRoots": sandbox.writable_roots.clone(),
              },
              "networkAccess": sandbox.allow_network,
            }),
            "danger-full-access" => serde_json::json!({
              "type": "dangerFullAccess",
            }),
            _ => serde_json::json!({
              "type": "workspaceWrite",
              "writableRoots": sandbox.writable_roots.clone(),
              "readOnlyAccess": {
                "type": "restricted",
                "includePlatformDefaults": true,
                "readableRoots": sandbox.writable_roots.clone(),
              },
              "networkAccess": sandbox.allow_network,
              "excludeTmpdirEnvVar": false,
              "excludeSlashTmp": false,
            }),
        }
    }
}

async fn detect_macos_sandbox_exec_failure() -> bool {
    #[cfg(target_os = "macos")]
    {
        let args = ["-p", "(version 1) (allow default)", "/usr/bin/true"];
        let mut probe_errors = Vec::new();

        for executable in ["/usr/bin/sandbox-exec", "sandbox-exec"] {
            match Command::new(executable).args(args).output().await {
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
                    let denied = stderr.contains("sandbox_apply: operation not permitted")
                        || stderr.contains("sandbox_apply_container: operation not permitted")
                        || (stderr.contains("sandbox")
                            && stderr.contains("operation not permitted"));
                    if denied || !output.status.success() {
                        log::warn!(
                            "macOS sandbox probe failed with `{executable}` (status={}): {}",
                            output.status,
                            stderr.trim()
                        );
                        return true;
                    }
                    return false;
                }
                Err(error) => {
                    probe_errors.push(format!("{executable}: {error}"));
                }
            }
        }

        if !probe_errors.is_empty() {
            log::warn!(
                "unable to execute macOS sandbox probe; forcing external sandbox mode: {}",
                probe_errors.join(" | ")
            );
            return true;
        }

        false
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn prefer_external_sandbox_by_default() -> bool {
    #[cfg(target_os = "macos")]
    {
        let override_workspace_write = env::var("PANES_CODEX_PREFER_WORKSPACE_WRITE")
            .ok()
            .map(|value| {
                let normalized = value.trim().to_lowercase();
                normalized == "1" || normalized == "true" || normalized == "yes"
            })
            .unwrap_or(false);
        !override_workspace_write
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn is_sandbox_denied_error(error: &str) -> bool {
    let value = error.to_lowercase();
    value.contains("sandbox")
        && (value.contains("operation not permitted")
            || value.contains("sandbox denied")
            || value.contains("sandbox_apply")
            || value.contains("sandbox error"))
}

fn is_auth_related_error(error: &str) -> bool {
    let value = error.to_lowercase();
    value.contains("401")
        || value.contains("unauthorized")
        || value.contains("not logged in")
        || value.contains("login required")
        || value.contains("authentication required")
        || value.contains("auth token")
        || value.contains("invalid token")
        || value.contains("expired token")
}

fn workspace_probe_result_indicates_failure(result: &serde_json::Value) -> bool {
    if result.get("success").and_then(serde_json::Value::as_bool) == Some(false) {
        return true;
    }

    if let Some(exit_code) = extract_any_i64(result, &["exitCode", "exit_code"]) {
        if exit_code != 0 {
            return true;
        }
    }

    if let Some(status) = extract_any_string(result, &["status", "state"]) {
        let normalized = status.trim().to_lowercase();
        if !normalized.is_empty()
            && normalized != "completed"
            && normalized != "success"
            && normalized != "ok"
        {
            return true;
        }
    }

    if result
        .get("error")
        .map(|error| {
            let value = if let Some(text) = error.as_str() {
                text.to_string()
            } else {
                error.to_string()
            };
            !value.trim().is_empty() && is_sandbox_denied_error(&value)
        })
        .unwrap_or(false)
    {
        return true;
    }

    for key in ["stderr", "output"] {
        if let Some(text) = extract_any_string(result, &[key]) {
            if !text.trim().is_empty() && is_sandbox_denied_error(&text) {
                return true;
            }
        }
    }

    false
}

fn is_opaque_workspace_probe_failure(error: &str) -> bool {
    let value = error.to_lowercase();
    if value.trim().is_empty() {
        return true;
    }

    !is_transport_or_protocol_error(&value)
}

fn is_transport_or_protocol_error(value: &str) -> bool {
    value.contains("timed out")
        || value.contains("timeout")
        || value.contains("transport")
        || value.contains("parse error")
        || value.contains("read error")
        || value.contains("eof")
        || value.contains("exited with status")
        || value.contains("codex app-server exited")
        || value.contains("broken pipe")
        || value.contains("connection reset")
        || value.contains("connection refused")
        || value.contains("not connected")
        || value.contains("unknown method")
        || value.contains("method not found")
        || value.contains("invalid params")
        || value.contains("invalid request")
}

fn is_opaque_action_failure(result: &ActionResult) -> bool {
    let has_output = result
        .output
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if has_output {
        return false;
    }

    match result.error.as_deref() {
        None => true,
        Some(error) => {
            let normalized = error.trim().to_lowercase();
            normalized == "action failed with status `failed`"
                || normalized == "action failed with status 'failed'"
                || normalized == "action failed with status failed"
        }
    }
}

fn sandbox_policy_network_enabled(policy: &serde_json::Value) -> bool {
    match policy.get("networkAccess") {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::String(value)) => value.eq_ignore_ascii_case("enabled"),
        _ => false,
    }
}

fn event_indicates_sandbox_denial(event: &EngineEvent) -> bool {
    match event {
        EngineEvent::ActionCompleted { result, .. } if !result.success => {
            let explicit_denial = result
                .error
                .as_deref()
                .map(is_sandbox_denied_error)
                .unwrap_or(false)
                || result
                    .output
                    .as_deref()
                    .map(is_sandbox_denied_error)
                    .unwrap_or(false);
            if explicit_denial {
                return true;
            }
            if is_opaque_action_failure(result) {
                log::warn!(
                    "forcing externalSandbox fallback after opaque failed action (no diagnostic payload)"
                );
                return true;
            }
            false
        }
        EngineEvent::Error { message, .. } => is_sandbox_denied_error(message),
        _ => false,
    }
}

fn event_indicates_auth_failure(event: &EngineEvent) -> bool {
    match event {
        EngineEvent::Error { message, .. } => is_auth_related_error(message),
        _ => false,
    }
}

fn extract_thread_id(value: &serde_json::Value) -> Option<String> {
    if let Some(id) = extract_any_string(value, &["threadId", "thread_id", "id"]) {
        return Some(id);
    }

    for key in ["thread", "data", "result"] {
        if let Some(nested) = value.get(key) {
            if let Some(id) = extract_thread_id(nested) {
                return Some(id);
            }
        }
    }

    None
}

fn extract_turn_id(value: &serde_json::Value) -> Option<String> {
    if let Some(id) = extract_any_string(value, &["turnId", "turn_id"]) {
        return Some(id);
    }

    if let Some(turn) = value.get("turn") {
        if let Some(id) = extract_any_string(turn, &["id", "turnId", "turn_id"]) {
            return Some(id);
        }
    }

    None
}

fn extract_reconciled_turn_completion(
    value: &serde_json::Value,
    expected_turn_id: Option<&str>,
) -> Option<ReconciledTurnCompletion> {
    let turns = extract_thread_turns(value)?;
    let expected_turn_id = expected_turn_id
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let selected = turns.iter().find(|turn| {
        extract_any_string(turn, &["id", "turnId", "turn_id"]).as_deref() == Some(expected_turn_id)
    })?;
    let status = extract_terminal_turn_completion_status(selected)?;

    Some(ReconciledTurnCompletion {
        status,
        error_message: extract_nested_string(selected, &["error", "message"]),
    })
}

fn build_reconciled_turn_completion_events(
    reconciled: ReconciledTurnCompletion,
    mode: TurnCompletionRecoveryMode,
) -> Vec<EngineEvent> {
    let mut events = Vec::new();

    if let Some(message) = reconciled.error_message {
        events.push(EngineEvent::Error {
            message,
            recoverable: true,
        });
    }

    let status = if matches!(mode, TurnCompletionRecoveryMode::StreamLost)
        && reconciled.status == TurnCompletionStatus::Completed
    {
        events.push(EngineEvent::Error {
            message:
                "Codex finished after Panes lost the live event stream, so the transcript may be incomplete."
                    .to_string(),
            recoverable: true,
        });
        TurnCompletionStatus::Failed
    } else {
        reconciled.status
    };

    events.push(EngineEvent::TurnCompleted {
        token_usage: None,
        status,
    });

    events
}

fn extract_thread_turns<'a>(value: &'a serde_json::Value) -> Option<&'a Vec<serde_json::Value>> {
    if let Some(turns) = value.get("turns").and_then(serde_json::Value::as_array) {
        return Some(turns);
    }

    for key in ["thread", "data", "result"] {
        if let Some(nested) = value.get(key) {
            if let Some(turns) = extract_thread_turns(nested) {
                return Some(turns);
            }
        }
    }

    None
}

fn extract_terminal_turn_completion_status(
    value: &serde_json::Value,
) -> Option<TurnCompletionStatus> {
    let status = extract_any_string(value, &["status"])?;
    match normalize_method(&status).as_str() {
        "completed" => Some(TurnCompletionStatus::Completed),
        "interrupted" => Some(TurnCompletionStatus::Interrupted),
        "failed" => Some(TurnCompletionStatus::Failed),
        _ => None,
    }
}

fn extract_thread_preview(value: &serde_json::Value) -> Option<String> {
    if let Some(preview) = extract_any_string(value, &["preview"]) {
        return Some(preview);
    }

    for key in ["thread", "data", "result"] {
        if let Some(nested) = value.get(key) {
            if let Some(preview) = extract_thread_preview(nested) {
                return Some(preview);
            }
        }
    }

    None
}

fn thread_runtime_from_start_response(
    response: &serde_json::Value,
    fallback_cwd: &str,
    fallback_model: &str,
    fallback_approval_policy: &serde_json::Value,
    fallback_sandbox_policy: &serde_json::Value,
    fallback_reasoning_effort: Option<String>,
    fallback_service_tier: Option<String>,
    fallback_personality: Option<String>,
    fallback_output_schema: Option<serde_json::Value>,
) -> ThreadRuntime {
    let mut runtime = ThreadRuntime {
        cwd: extract_any_string(response, &["cwd"]).unwrap_or_else(|| fallback_cwd.to_string()),
        model_id: extract_any_string(response, &["model"])
            .unwrap_or_else(|| fallback_model.to_string()),
        approval_policy: response
            .get("approvalPolicy")
            .cloned()
            .filter(|value| !value.is_null())
            .unwrap_or_else(|| fallback_approval_policy.clone()),
        sandbox_policy: response
            .get("sandbox")
            .cloned()
            .filter(|value| !value.is_null())
            .unwrap_or_else(|| fallback_sandbox_policy.clone()),
        reasoning_effort: extract_any_string(response, &["reasoningEffort", "reasoning_effort"]),
        service_tier: extract_any_string(response, &["serviceTier", "service_tier"]),
        personality: extract_any_string(response, &["personality"]),
        output_schema: fallback_output_schema,
        native_plan_mode_active: false,
    };

    if runtime.reasoning_effort.is_none() {
        runtime.reasoning_effort = fallback_reasoning_effort;
    }
    if runtime.service_tier.is_none() {
        runtime.service_tier = fallback_service_tier;
    }
    if runtime.personality.is_none() {
        runtime.personality = fallback_personality;
    }

    runtime
}

fn thread_runtime_from_resume_response(
    response: &serde_json::Value,
    requested_runtime: &ThreadRuntime,
) -> ThreadRuntime {
    let mut runtime = thread_runtime_from_start_response(
        response,
        &requested_runtime.cwd,
        &requested_runtime.model_id,
        &requested_runtime.approval_policy,
        &requested_runtime.sandbox_policy,
        requested_runtime.reasoning_effort.clone(),
        requested_runtime.service_tier.clone(),
        requested_runtime.personality.clone(),
        requested_runtime.output_schema.clone(),
    );

    // `thread/resume` can echo the previous thread preview, including stale model or effort.
    // The requested runtime is what we want to apply to subsequent `turn/start` calls.
    runtime.cwd = requested_runtime.cwd.clone();
    runtime.model_id = requested_runtime.model_id.clone();
    runtime.approval_policy = requested_runtime.approval_policy.clone();
    runtime.sandbox_policy = requested_runtime.sandbox_policy.clone();
    runtime.reasoning_effort = requested_runtime.reasoning_effort.clone();
    runtime.service_tier = requested_runtime.service_tier.clone();
    runtime.personality = requested_runtime.personality.clone();
    runtime.output_schema = requested_runtime.output_schema.clone();

    runtime
}

fn extract_any_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(string) = found.as_str() {
                return Some(string.to_string());
            }
            if found.is_number() || found.is_boolean() {
                return Some(found.to_string());
            }
        }
    }
    None
}

fn extract_any_i64(value: &serde_json::Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_i64() {
                return Some(number);
            }
            if let Some(text) = found.as_str() {
                if let Ok(parsed) = text.trim().parse::<i64>() {
                    return Some(parsed);
                }
            }
        }
    }
    None
}

fn extract_nested_string(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(str::to_string)
}

fn extract_nested_i64(value: &serde_json::Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    if let Some(number) = current.as_i64() {
        return Some(number);
    }
    current
        .as_str()
        .and_then(|text| text.trim().parse::<i64>().ok())
}

fn extract_codex_remote_thread_summary(
    value: &serde_json::Value,
    archived: bool,
) -> Option<CodexRemoteThreadSummary> {
    let thread = value.get("thread").unwrap_or(value);
    let engine_thread_id = extract_any_string(thread, &["id"])?;
    let cwd = extract_any_string(thread, &["cwd"])?;
    let created_at = extract_any_i64(thread, &["createdAt", "created_at"])?;
    let updated_at = extract_any_i64(thread, &["updatedAt", "updated_at"]).unwrap_or(created_at);

    Some(CodexRemoteThreadSummary {
        engine_thread_id,
        title: extract_thread_title(value),
        preview: extract_thread_preview(value).unwrap_or_default(),
        cwd,
        created_at,
        updated_at,
        model_provider: extract_any_string(thread, &["modelProvider", "model_provider"])
            .unwrap_or_else(|| "unknown".to_string()),
        source_kind: extract_thread_source_kind(thread.get("source")),
        status_type: extract_thread_runtime_status_type(value)
            .unwrap_or_else(|| "unknown".to_string()),
        active_flags: extract_thread_runtime_active_flags(value),
        archived,
    })
}

fn extract_thread_source_kind(value: Option<&serde_json::Value>) -> String {
    let Some(value) = value else {
        return "unknown".to_string();
    };

    if let Some(kind) = value.as_str() {
        return kind.to_string();
    }

    let Some(object) = value.as_object() else {
        return "unknown".to_string();
    };

    let Some(sub_agent) = object.get("subAgent").or_else(|| object.get("sub_agent")) else {
        return "unknown".to_string();
    };

    if let Some(kind) = sub_agent.as_str() {
        return match kind {
            "review" => "subAgentReview".to_string(),
            "compact" => "subAgentCompact".to_string(),
            _ => "subAgentOther".to_string(),
        };
    }

    let Some(sub_agent_object) = sub_agent.as_object() else {
        return "subAgentOther".to_string();
    };

    if sub_agent_object.contains_key("thread_spawn") {
        return "subAgentThreadSpawn".to_string();
    }

    "subAgentOther".to_string()
}

fn extract_thread_title(value: &serde_json::Value) -> Option<String> {
    value
        .get("thread")
        .and_then(|thread| extract_any_string(thread, &["name", "threadName", "title"]))
        .or_else(|| extract_any_string(value, &["name", "threadName", "title"]))
}

fn extract_thread_runtime_status_type(value: &serde_json::Value) -> Option<String> {
    value
        .get("thread")
        .and_then(|thread| {
            extract_nested_string(thread, &["status", "type"])
                .or_else(|| extract_any_string(thread, &["status"]))
        })
        .or_else(|| {
            extract_nested_string(value, &["status", "type"])
                .or_else(|| extract_any_string(value, &["status"]))
        })
}

fn extract_thread_active_flags_from_status_value(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|status| status.get("activeFlags"))
        .and_then(serde_json::Value::as_array)
        .map(|flags| {
            flags
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_auth_mode(value: &str) -> String {
    match value.trim() {
        "apiKey" | "apikey" | "api_key" => "apikey".to_string(),
        "chatgpt" => "chatgpt".to_string(),
        "chatgptAuthTokens" | "chatgpt_auth_tokens" => "chatgptAuthTokens".to_string(),
        other => other.to_string(),
    }
}

fn provider_from_auth_mode(auth_mode: &str) -> String {
    match auth_mode {
        "apikey" => "apiKey".to_string(),
        "chatgptAuthTokens" => "chatgpt".to_string(),
        other => other.to_string(),
    }
}

fn unsupported_external_auth_tokens_message(
    previous_account_id: Option<&str>,
    reason: Option<&str>,
) -> String {
    match (previous_account_id, reason) {
        (Some(previous_account_id), Some(reason)) => format!(
            "Codex is using external ChatGPT auth tokens for account `{previous_account_id}` after `{reason}`, but Panes cannot refresh those tokens. Re-authenticate outside Panes or switch Codex to a managed auth mode."
        ),
        (Some(previous_account_id), None) => format!(
            "Codex is using external ChatGPT auth tokens for account `{previous_account_id}`, but Panes cannot refresh those tokens. Re-authenticate outside Panes or switch Codex to a managed auth mode."
        ),
        (None, Some(reason)) => format!(
            "Codex is using external ChatGPT auth tokens after `{reason}`, but Panes cannot refresh those tokens. Re-authenticate outside Panes or switch Codex to a managed auth mode."
        ),
        (None, None) => "Codex is using external ChatGPT auth tokens, but Panes cannot refresh those tokens. Re-authenticate outside Panes or switch Codex to a managed auth mode.".to_string(),
    }
}

fn extract_thread_runtime_active_flags(value: &serde_json::Value) -> Vec<String> {
    value
        .get("thread")
        .map(|thread| extract_thread_active_flags_from_status_value(thread.get("status")))
        .unwrap_or_else(|| extract_thread_active_flags_from_status_value(value.get("status")))
}

#[derive(Debug)]
enum MethodCallOutcome<T> {
    Available(T),
    Unsupported(Option<String>),
    Error(String),
}

fn update_method_availability(
    diagnostics: &mut CodexProtocolDiagnosticsDto,
    method: &str,
    availability: CodexMethodAvailabilityDto,
) {
    if let Some(existing) = diagnostics
        .method_availability
        .iter_mut()
        .find(|item| item.method == method)
    {
        *existing = availability;
    } else {
        diagnostics.method_availability.push(availability);
    }
}

const PAGINATION_MAX_PAGES: usize = 50;

async fn fetch_paginated_data(
    transport: &CodexTransport,
    methods: &[&str],
    mut params_for_cursor: impl FnMut(Option<String>) -> serde_json::Value,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    let mut cursor: Option<String> = None;
    let mut out = Vec::new();

    for _page in 0..PAGINATION_MAX_PAGES {
        let response = request_with_fallback(
            transport,
            methods,
            params_for_cursor(cursor.clone()),
            DEFAULT_TIMEOUT,
        )
        .await?;
        let Some(data) = response.get("data").and_then(serde_json::Value::as_array) else {
            break;
        };
        out.extend(data.iter().cloned());
        let next_cursor = extract_any_string(&response, &["nextCursor", "next_cursor"]);
        if next_cursor.is_none() {
            break;
        }
        cursor = next_cursor;
    }

    Ok(out)
}

fn method_call_outcome_from_error<T>(error: anyhow::Error) -> MethodCallOutcome<T> {
    let message = error.to_string();
    if is_method_not_supported_error(&message) {
        MethodCallOutcome::Unsupported(Some(message))
    } else {
        MethodCallOutcome::Error(message)
    }
}

fn is_method_not_supported_error(message: &str) -> bool {
    let normalized = message.to_lowercase();
    normalized.contains("32601")
        || normalized.contains("method not found")
        || normalized.contains("unknown method")
        || normalized.contains("not supported")
}

async fn fetch_experimental_features(
    transport: &CodexTransport,
) -> MethodCallOutcome<Vec<CodexExperimentalFeatureDto>> {
    let response =
        match fetch_paginated_data(transport, EXPERIMENTAL_FEATURE_LIST_METHODS, |cursor| {
            serde_json::json!({
                "limit": 200,
                "cursor": cursor,
            })
        })
        .await
        {
            Ok(data) => data,
            Err(error) => return method_call_outcome_from_error(error),
        };

    MethodCallOutcome::Available(
        response
            .into_iter()
            .map(|entry| CodexExperimentalFeatureDto {
                name: extract_any_string(&entry, &["name"])
                    .unwrap_or_else(|| "unknown".to_string()),
                enabled: entry
                    .get("enabled")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                default_enabled: entry
                    .get("defaultEnabled")
                    .or_else(|| entry.get("default_enabled"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                stage: extract_any_string(&entry, &["stage"])
                    .unwrap_or_else(|| "unknown".to_string()),
                display_name: extract_any_string(&entry, &["displayName", "display_name"]),
                description: extract_any_string(&entry, &["description"]),
            })
            .collect(),
    )
}

async fn fetch_collaboration_modes(transport: &CodexTransport) -> MethodCallOutcome<Vec<String>> {
    let response = match request_with_fallback(
        transport,
        COLLABORATION_MODE_LIST_METHODS,
        serde_json::Value::Null,
        DEFAULT_TIMEOUT,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return method_call_outcome_from_error(error),
    };

    let data = response
        .get("data")
        .and_then(serde_json::Value::as_array)
        .or_else(|| response.as_array())
        .cloned()
        .unwrap_or_default();
    let mut modes = BTreeSet::new();
    for entry in data {
        if let Some(mode) = extract_any_string(&entry, &["mode", "name", "id"]) {
            modes.insert(mode);
        }
    }

    MethodCallOutcome::Available(modes.into_iter().collect())
}

async fn fetch_apps(transport: &CodexTransport) -> MethodCallOutcome<Vec<CodexAppDto>> {
    let response = match fetch_paginated_data(transport, APP_LIST_METHODS, |cursor| {
        serde_json::json!({
            "limit": 200,
            "cursor": cursor,
            "forceRefetch": true,
        })
    })
    .await
    {
        Ok(data) => data,
        Err(error) => return method_call_outcome_from_error(error),
    };

    MethodCallOutcome::Available(
        response
            .into_iter()
            .map(|entry| CodexAppDto {
                id: extract_any_string(&entry, &["id"]).unwrap_or_else(|| "unknown".to_string()),
                name: extract_any_string(&entry, &["name"])
                    .unwrap_or_else(|| "unknown".to_string()),
                description: extract_any_string(&entry, &["description"]),
                is_enabled: entry
                    .get("isEnabled")
                    .or_else(|| entry.get("is_enabled"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true),
                is_accessible: entry
                    .get("isAccessible")
                    .or_else(|| entry.get("is_accessible"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            })
            .collect(),
    )
}

fn map_skill_entries(entries: &[serde_json::Value]) -> Vec<CodexSkillDto> {
    let mut skills_by_path = HashMap::<String, CodexSkillDto>::new();

    for entry in entries {
        let Some(skills) = entry.get("skills").and_then(serde_json::Value::as_array) else {
            continue;
        };

        for skill in skills {
            let name =
                extract_any_string(skill, &["name"]).unwrap_or_else(|| "unknown".to_string());
            let path = extract_any_string(skill, &["path"]).unwrap_or_else(|| name.clone());
            skills_by_path
                .entry(path.clone())
                .or_insert_with(|| CodexSkillDto {
                    name,
                    path,
                    description: extract_any_string(skill, &["description"])
                        .or_else(|| {
                            extract_nested_string(skill, &["interface", "shortDescription"])
                        })
                        .or_else(|| {
                            extract_any_string(skill, &["shortDescription", "short_description"])
                        })
                        .unwrap_or_default(),
                    enabled: skill
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true),
                    scope: extract_any_string(skill, &["scope"])
                        .unwrap_or_else(|| "unknown".to_string()),
                });
        }
    }

    let mut skills: Vec<_> = skills_by_path.into_values().collect();
    skills.sort_by(|left, right| {
        left.scope
            .cmp(&right.scope)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.path.cmp(&right.path))
    });
    skills
}

async fn fetch_skills(transport: &CodexTransport) -> MethodCallOutcome<Vec<CodexSkillDto>> {
    let cwds = env::current_dir()
        .ok()
        .map(|cwd| vec![cwd.to_string_lossy().to_string()])
        .unwrap_or_default();

    let response = match request_with_fallback(
        transport,
        SKILLS_LIST_METHODS,
        serde_json::json!({
            "cwds": cwds,
            "forceReload": false,
        }),
        DEFAULT_TIMEOUT,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return method_call_outcome_from_error(error),
    };

    let entries = response
        .get("data")
        .and_then(serde_json::Value::as_array)
        .or_else(|| response.as_array())
        .cloned()
        .unwrap_or_default();
    MethodCallOutcome::Available(map_skill_entries(&entries))
}

fn map_plugin_marketplaces(response: &serde_json::Value) -> Vec<CodexPluginMarketplaceDto> {
    let mut marketplaces = response
        .get("marketplaces")
        .and_then(serde_json::Value::as_array)
        .or_else(|| response.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|marketplace| {
            let mut plugins = marketplace
                .get("plugins")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|plugin| CodexPluginDto {
                    id: extract_any_string(&plugin, &["id"])
                        .unwrap_or_else(|| "unknown".to_string()),
                    name: extract_nested_string(&plugin, &["interface", "displayName"])
                        .or_else(|| extract_any_string(&plugin, &["name"]))
                        .unwrap_or_else(|| "unknown".to_string()),
                    enabled: plugin
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    installed: plugin
                        .get("installed")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    capabilities: plugin
                        .get("interface")
                        .and_then(|interface| interface.get("capabilities"))
                        .and_then(serde_json::Value::as_array)
                        .map(|capabilities| {
                            capabilities
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .map(str::to_string)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default(),
                    developer_name: extract_nested_string(&plugin, &["interface", "developerName"])
                        .or_else(|| {
                            extract_nested_string(&plugin, &["interface", "developer_name"])
                        }),
                    description: extract_nested_string(&plugin, &["interface", "shortDescription"])
                        .or_else(|| {
                            extract_nested_string(&plugin, &["interface", "short_description"])
                        })
                        .or_else(|| {
                            extract_nested_string(&plugin, &["interface", "longDescription"])
                        })
                        .or_else(|| {
                            extract_nested_string(&plugin, &["interface", "long_description"])
                        }),
                })
                .collect::<Vec<_>>();
            plugins.sort_by(|left, right| {
                left.name
                    .cmp(&right.name)
                    .then_with(|| left.id.cmp(&right.id))
            });

            CodexPluginMarketplaceDto {
                name: extract_any_string(&marketplace, &["name"])
                    .unwrap_or_else(|| "unknown".to_string()),
                path: extract_any_string(&marketplace, &["path"]).unwrap_or_default(),
                plugins,
            }
        })
        .collect::<Vec<_>>();

    marketplaces.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.path.cmp(&right.path))
    });
    marketplaces
}

async fn fetch_plugin_marketplaces(
    transport: &CodexTransport,
) -> MethodCallOutcome<Vec<CodexPluginMarketplaceDto>> {
    let response = match request_with_fallback(
        transport,
        PLUGIN_LIST_METHODS,
        serde_json::Value::Null,
        DEFAULT_TIMEOUT,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return method_call_outcome_from_error(error),
    };

    MethodCallOutcome::Available(map_plugin_marketplaces(&response))
}

fn map_mcp_servers(entries: &[serde_json::Value]) -> Vec<CodexMcpServerDto> {
    let mut servers = entries
        .iter()
        .map(|entry| CodexMcpServerDto {
            name: extract_any_string(entry, &["name"]).unwrap_or_else(|| "unknown".to_string()),
            auth_status: extract_any_string(entry, &["authStatus", "auth_status"])
                .unwrap_or_else(|| "unknown".to_string()),
            tool_count: entry
                .get("tools")
                .and_then(serde_json::Value::as_object)
                .map(|tools| tools.len())
                .unwrap_or_default(),
            resource_count: entry
                .get("resources")
                .and_then(serde_json::Value::as_array)
                .map(|resources| resources.len())
                .unwrap_or_default(),
            resource_template_count: entry
                .get("resourceTemplates")
                .or_else(|| entry.get("resource_templates"))
                .and_then(serde_json::Value::as_array)
                .map(|resources| resources.len())
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    servers.sort_by(|left, right| left.name.cmp(&right.name));
    servers
}

async fn fetch_mcp_servers(
    transport: &CodexTransport,
) -> MethodCallOutcome<Vec<CodexMcpServerDto>> {
    let response = match fetch_paginated_data(transport, MCP_SERVER_STATUS_LIST_METHODS, |cursor| {
        serde_json::json!({
            "limit": 200,
            "cursor": cursor,
        })
    })
    .await
    {
        Ok(data) => data,
        Err(error) => return method_call_outcome_from_error(error),
    };

    MethodCallOutcome::Available(map_mcp_servers(&response))
}

fn map_account_state(response: &serde_json::Value) -> CodexAccountStateDto {
    let account = response.get("account").unwrap_or(&serde_json::Value::Null);
    CodexAccountStateDto {
        provider: extract_any_string(account, &["type"]).unwrap_or_else(|| "none".to_string()),
        auth_mode: extract_any_string(account, &["type"]).map(|value| normalize_auth_mode(&value)),
        email: extract_any_string(account, &["email"]),
        plan_type: extract_any_string(account, &["planType", "plan_type"]),
        requires_openai_auth: response
            .get("requiresOpenaiAuth")
            .or_else(|| response.get("requires_openai_auth"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

async fn fetch_account_state(
    transport: &CodexTransport,
) -> MethodCallOutcome<CodexAccountStateDto> {
    let response = match request_with_fallback(
        transport,
        ACCOUNT_READ_METHODS,
        serde_json::Value::Null,
        DEFAULT_TIMEOUT,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return method_call_outcome_from_error(error),
    };

    MethodCallOutcome::Available(map_account_state(&response))
}

fn format_config_layer_source(source: &serde_json::Value) -> String {
    let source_type =
        extract_any_string(source, &["type"]).unwrap_or_else(|| "unknown".to_string());
    match source_type.as_str() {
        "mdm" => {
            let domain = extract_any_string(source, &["domain"]);
            let key = extract_any_string(source, &["key"]);
            match (domain, key) {
                (Some(domain), Some(key)) => format!("mdm:{domain}:{key}"),
                (Some(domain), None) => format!("mdm:{domain}"),
                _ => source_type,
            }
        }
        "system" | "user" | "legacyManagedConfigTomlFromFile" => {
            extract_any_string(source, &["file"])
                .map(|file| format!("{source_type}:{file}"))
                .unwrap_or(source_type)
        }
        "project" => extract_any_string(source, &["dotCodexFolder", "dot_codex_folder"])
            .map(|folder| format!("project:{folder}"))
            .unwrap_or(source_type),
        _ => source_type,
    }
}

fn map_config_layer(value: &serde_json::Value) -> Option<CodexConfigLayerDto> {
    let source = value.get("name").or_else(|| value.get("source"))?;
    let version = extract_any_string(value, &["version"])?;
    Some(CodexConfigLayerDto {
        source: format_config_layer_source(source),
        version,
    })
}

fn map_config_layers(response: &serde_json::Value) -> Vec<CodexConfigLayerDto> {
    let mut layers = Vec::new();
    let mut seen = BTreeSet::new();

    if let Some(entries) = response.get("layers").and_then(serde_json::Value::as_array) {
        for entry in entries {
            if let Some(layer) = map_config_layer(entry) {
                let dedupe_key = format!("{}\u{0}{}", layer.source, layer.version);
                if seen.insert(dedupe_key) {
                    layers.push(layer);
                }
            }
        }
    }

    if layers.is_empty() {
        if let Some(origins) = response
            .get("origins")
            .and_then(serde_json::Value::as_object)
        {
            for origin in origins.values() {
                if let Some(layer) = map_config_layer(origin) {
                    let dedupe_key = format!("{}\u{0}{}", layer.source, layer.version);
                    if seen.insert(dedupe_key) {
                        layers.push(layer);
                    }
                }
            }
        }
    }

    layers.sort_by(|left, right| {
        left.source
            .cmp(&right.source)
            .then_with(|| left.version.cmp(&right.version))
    });
    layers
}

fn map_config_state(response: &serde_json::Value) -> CodexConfigStateDto {
    let config = response.get("config").unwrap_or(response);
    CodexConfigStateDto {
        model: extract_any_string(config, &["model"]),
        model_provider: extract_any_string(config, &["modelProvider", "model_provider"]),
        service_tier: extract_any_string(config, &["serviceTier", "service_tier"]),
        approval_policy: config
            .get("approvalPolicy")
            .or_else(|| config.get("approval_policy"))
            .filter(|value| !value.is_null())
            .cloned(),
        sandbox_mode: extract_any_string(config, &["sandboxMode", "sandbox_mode"]),
        web_search: extract_any_string(config, &["webSearch", "web_search"]),
        profile: extract_any_string(config, &["profile"]),
        layers: map_config_layers(response),
    }
}

async fn fetch_config_state(transport: &CodexTransport) -> MethodCallOutcome<CodexConfigStateDto> {
    let response = match request_with_fallback(
        transport,
        CONFIG_READ_METHODS,
        serde_json::Value::Null,
        DEFAULT_TIMEOUT,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return method_call_outcome_from_error(error),
    };

    MethodCallOutcome::Available(map_config_state(&response))
}

async fn refresh_protocol_diagnostics_via_transport(
    transport: &CodexTransport,
    previous: Option<CodexProtocolDiagnosticsDto>,
) -> anyhow::Result<CodexProtocolDiagnosticsDto> {
    let mut diagnostics = previous.unwrap_or_default();
    let (
        experimental,
        collaboration,
        apps,
        skills,
        plugin_marketplaces,
        mcp_servers,
        account,
        config,
    ) = tokio::join!(
        fetch_experimental_features(transport),
        fetch_collaboration_modes(transport),
        fetch_apps(transport),
        fetch_skills(transport),
        fetch_plugin_marketplaces(transport),
        fetch_mcp_servers(transport),
        fetch_account_state(transport),
        fetch_config_state(transport),
    );

    let experimental_availability = match experimental {
        MethodCallOutcome::Available(value) => {
            diagnostics.experimental_features = value;
            CodexMethodAvailabilityDto {
                method: "experimentalFeature/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.experimental_features.clear();
            CodexMethodAvailabilityDto {
                method: "experimentalFeature/list".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "experimentalFeature/list".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(
        &mut diagnostics,
        "experimentalFeature/list",
        experimental_availability,
    );

    let collaboration_availability = match collaboration {
        MethodCallOutcome::Available(value) => {
            diagnostics.collaboration_modes = value;
            CodexMethodAvailabilityDto {
                method: "collaborationMode/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.collaboration_modes.clear();
            CodexMethodAvailabilityDto {
                method: "collaborationMode/list".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "collaborationMode/list".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(
        &mut diagnostics,
        "collaborationMode/list",
        collaboration_availability,
    );

    let app_availability = match apps {
        MethodCallOutcome::Available(value) => {
            diagnostics.apps = value;
            CodexMethodAvailabilityDto {
                method: "app/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.apps.clear();
            CodexMethodAvailabilityDto {
                method: "app/list".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "app/list".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(&mut diagnostics, "app/list", app_availability);

    let skills_availability = match skills {
        MethodCallOutcome::Available(value) => {
            diagnostics.skills = value;
            CodexMethodAvailabilityDto {
                method: "skills/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.skills.clear();
            CodexMethodAvailabilityDto {
                method: "skills/list".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "skills/list".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(&mut diagnostics, "skills/list", skills_availability);

    let plugin_availability = match plugin_marketplaces {
        MethodCallOutcome::Available(value) => {
            diagnostics.plugin_marketplaces = value;
            CodexMethodAvailabilityDto {
                method: "plugin/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.plugin_marketplaces.clear();
            CodexMethodAvailabilityDto {
                method: "plugin/list".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "plugin/list".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(&mut diagnostics, "plugin/list", plugin_availability);

    let mcp_server_availability = match mcp_servers {
        MethodCallOutcome::Available(value) => {
            diagnostics.mcp_servers = value;
            CodexMethodAvailabilityDto {
                method: "mcpServerStatus/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.mcp_servers.clear();
            CodexMethodAvailabilityDto {
                method: "mcpServerStatus/list".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "mcpServerStatus/list".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(
        &mut diagnostics,
        "mcpServerStatus/list",
        mcp_server_availability,
    );

    let account_availability = match account {
        MethodCallOutcome::Available(value) => {
            diagnostics.account = Some(value);
            CodexMethodAvailabilityDto {
                method: "account/read".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.account = None;
            CodexMethodAvailabilityDto {
                method: "account/read".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "account/read".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(&mut diagnostics, "account/read", account_availability);

    let config_availability = match config {
        MethodCallOutcome::Available(value) => {
            diagnostics.config = Some(value);
            CodexMethodAvailabilityDto {
                method: "config/read".to_string(),
                status: "available".to_string(),
                detail: None,
            }
        }
        MethodCallOutcome::Unsupported(detail) => {
            diagnostics.config = None;
            CodexMethodAvailabilityDto {
                method: "config/read".to_string(),
                status: "unsupported".to_string(),
                detail,
            }
        }
        MethodCallOutcome::Error(detail) => CodexMethodAvailabilityDto {
            method: "config/read".to_string(),
            status: "error".to_string(),
            detail: Some(detail),
        },
    };
    update_method_availability(&mut diagnostics, "config/read", config_availability);

    diagnostics.fetched_at = Some(Utc::now().to_rfc3339());
    diagnostics.stale = false;
    diagnostics
        .method_availability
        .sort_by(|left, right| left.method.cmp(&right.method));
    Ok(diagnostics)
}

async fn refresh_protocol_diagnostics_for_runtime_monitor(
    transport: &CodexTransport,
    state: Arc<Mutex<CodexState>>,
) -> anyhow::Result<CodexProtocolDiagnosticsDto> {
    let current = {
        let state = state.lock().await;
        state.protocol_diagnostics.clone()
    };
    let diagnostics = refresh_protocol_diagnostics_via_transport(transport, current).await?;
    {
        let mut state = state.lock().await;
        state.protocol_diagnostics = Some(diagnostics.clone());
    }
    Ok(diagnostics)
}

async fn current_protocol_diagnostics(
    state: Arc<Mutex<CodexState>>,
) -> Option<CodexProtocolDiagnosticsDto> {
    let state = state.lock().await;
    state.protocol_diagnostics.clone()
}

async fn refresh_protocol_diagnostics_with_fallback(
    transport: &CodexTransport,
    state: Arc<Mutex<CodexState>>,
    log_context: &str,
    allow_current_on_failure: bool,
) -> Option<CodexProtocolDiagnosticsDto> {
    match refresh_protocol_diagnostics_for_runtime_monitor(transport, state.clone()).await {
        Ok(diagnostics) => Some(diagnostics),
        Err(error) => {
            log::debug!("failed to refresh codex diagnostics {log_context}: {error}");
            if allow_current_on_failure {
                current_protocol_diagnostics(state).await
            } else {
                None
            }
        }
    }
}

async fn update_protocol_diagnostics_with_config_warning(
    state: Arc<Mutex<CodexState>>,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    diagnostics.last_config_warning = Some(CodexConfigWarningDto {
        summary: extract_any_string(params, &["summary"])
            .unwrap_or_else(|| "Config warning".to_string()),
        details: extract_any_string(params, &["details"]),
        path: extract_any_string(params, &["path"]),
        start_line: extract_nested_i64(params, &["range", "start", "line"])
            .and_then(|value| u64::try_from(value).ok()),
        start_column: extract_nested_i64(params, &["range", "start", "column"])
            .and_then(|value| u64::try_from(value).ok()),
        end_line: extract_nested_i64(params, &["range", "end", "line"])
            .and_then(|value| u64::try_from(value).ok()),
        end_column: extract_nested_i64(params, &["range", "end", "column"])
            .and_then(|value| u64::try_from(value).ok()),
    });
    Some(diagnostics.clone())
}

async fn update_protocol_diagnostics_with_account_login(
    state: Arc<Mutex<CodexState>>,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    diagnostics.last_account_login = Some(CodexAccountLoginCompletedDto {
        success: params
            .get("success")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        error: extract_any_string(params, &["error"]),
        login_id: extract_any_string(params, &["loginId", "login_id"]),
    });
    Some(diagnostics.clone())
}

async fn update_protocol_diagnostics_with_account_update(
    state: Arc<Mutex<CodexState>>,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    let account = diagnostics
        .account
        .get_or_insert_with(|| CodexAccountStateDto {
            provider: "none".to_string(),
            auth_mode: None,
            email: None,
            plan_type: None,
            requires_openai_auth: false,
        });

    if let Some(auth_mode) = extract_any_string(params, &["authMode", "auth_mode"])
        .map(|value| normalize_auth_mode(&value))
    {
        if account.provider == "none" {
            account.provider = provider_from_auth_mode(&auth_mode);
        }
        account.auth_mode = Some(auth_mode);
    }

    if let Some(plan_type) = extract_any_string(params, &["planType", "plan_type"]) {
        account.plan_type = Some(plan_type);
    }

    Some(diagnostics.clone())
}

async fn update_protocol_diagnostics_with_mcp_oauth(
    state: Arc<Mutex<CodexState>>,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    diagnostics.last_mcp_oauth = Some(CodexMcpOauthCompletedDto {
        name: extract_any_string(params, &["name"]).unwrap_or_else(|| "unknown".to_string()),
        success: params
            .get("success")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        error: extract_any_string(params, &["error"]),
    });
    Some(diagnostics.clone())
}

async fn update_protocol_diagnostics_with_thread_realtime(
    state: Arc<Mutex<CodexState>>,
    normalized_method: &str,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    diagnostics.last_thread_realtime = Some(CodexThreadRealtimeEventDto {
        kind: normalized_method.to_string(),
        thread_id: extract_any_string(params, &["threadId", "thread_id"])
            .unwrap_or_else(|| "unknown".to_string()),
        session_id: extract_any_string(params, &["sessionId", "session_id"]),
        reason: extract_any_string(params, &["reason"]),
        message: extract_any_string(params, &["message"]),
        item_type: params
            .get("item")
            .and_then(|item| extract_any_string(item, &["type"])),
        sample_rate: extract_nested_i64(params, &["audio", "sampleRate"])
            .and_then(|value| u64::try_from(value).ok()),
        num_channels: extract_nested_i64(params, &["audio", "numChannels"])
            .and_then(|value| u64::try_from(value).ok()),
        samples_per_channel: extract_nested_i64(params, &["audio", "samplesPerChannel"])
            .and_then(|value| u64::try_from(value).ok()),
    });
    Some(diagnostics.clone())
}

async fn update_protocol_diagnostics_with_windows_sandbox_setup(
    state: Arc<Mutex<CodexState>>,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    diagnostics.last_windows_sandbox_setup = Some(CodexWindowsSandboxSetupDto {
        mode: extract_any_string(params, &["mode"]).unwrap_or_else(|| "unknown".to_string()),
        success: params
            .get("success")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        error: extract_any_string(params, &["error"]),
    });
    Some(diagnostics.clone())
}

async fn update_protocol_diagnostics_with_windows_world_writable_warning(
    state: Arc<Mutex<CodexState>>,
    params: &serde_json::Value,
) -> Option<CodexProtocolDiagnosticsDto> {
    let mut state = state.lock().await;
    let diagnostics = state
        .protocol_diagnostics
        .get_or_insert_with(Default::default);
    diagnostics.last_windows_world_writable_warning = Some(CodexWindowsWorldWritableWarningDto {
        sample_paths: params
            .get("samplePaths")
            .and_then(serde_json::Value::as_array)
            .map(|paths| {
                paths
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        extra_count: params
            .get("extraCount")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        failed_scan: params
            .get("failedScan")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    });
    Some(diagnostics.clone())
}

fn build_config_warning_toast(_params: &serde_json::Value) -> Option<RuntimeToastDto> {
    None
}

fn build_account_login_toast(params: &serde_json::Value) -> Option<RuntimeToastDto> {
    let success = params
        .get("success")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if success {
        return None;
    }

    Some(RuntimeToastDto {
        variant: "error".to_string(),
        message: extract_any_string(params, &["error"])
            .unwrap_or_else(|| "Codex account login failed.".to_string()),
    })
}

fn build_mcp_oauth_toast(params: &serde_json::Value) -> Option<RuntimeToastDto> {
    let success = params
        .get("success")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if success {
        return None;
    }

    let server_name =
        extract_any_string(params, &["name"]).unwrap_or_else(|| "MCP server".to_string());
    Some(RuntimeToastDto {
        variant: "error".to_string(),
        message: extract_any_string(params, &["error"])
            .map(|error| format!("{server_name} OAuth failed: {error}"))
            .unwrap_or_else(|| format!("{server_name} OAuth failed.")),
    })
}

fn build_account_updated_toast(params: &serde_json::Value) -> Option<RuntimeToastDto> {
    let auth_mode = extract_any_string(params, &["authMode", "auth_mode"])?;
    if normalize_auth_mode(&auth_mode) != "chatgptAuthTokens" {
        return None;
    }

    Some(RuntimeToastDto {
        variant: "warning".to_string(),
        message: unsupported_external_auth_tokens_message(None, Some("auth mode updated")),
    })
}

fn build_windows_sandbox_setup_toast(params: &serde_json::Value) -> Option<RuntimeToastDto> {
    let success = params
        .get("success")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if success {
        return None;
    }

    Some(RuntimeToastDto {
        variant: "warning".to_string(),
        message: extract_any_string(params, &["error"]).unwrap_or_else(|| {
            "Codex Windows sandbox setup did not complete successfully.".to_string()
        }),
    })
}

fn build_windows_world_writable_warning_toast(
    params: &serde_json::Value,
) -> Option<RuntimeToastDto> {
    let sample_paths = params
        .get("samplePaths")
        .and_then(serde_json::Value::as_array)
        .map(|paths| {
            paths
                .iter()
                .filter_map(serde_json::Value::as_str)
                .take(2)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let extra_count = params
        .get("extraCount")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    let mut message =
        "Codex detected world-writable Windows paths that may weaken sandbox safety.".to_string();
    if !sample_paths.is_empty() {
        message.push_str(&format!(" Examples: {sample_paths}."));
    }
    if extra_count > 0 {
        message.push_str(&format!(" Plus {extra_count} more."));
    }

    Some(RuntimeToastDto {
        variant: "warning".to_string(),
        message,
    })
}

async fn resolve_pending_approval_request(
    state: Arc<Mutex<CodexState>>,
    request_id: &serde_json::Value,
) -> Option<String> {
    let mut state = state.lock().await;
    let approval_id = state
        .approval_requests
        .iter()
        .find(|(_, pending)| pending.raw_request_id == *request_id)
        .map(|(approval_id, _)| approval_id.clone())?;
    state.approval_requests.remove(&approval_id);
    Some(approval_id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApprovalResponseTargetError {
    RuntimeReset,
    MissingRequestMetadata,
}

fn resolve_approval_response_target<'a>(
    pending: Option<&'a PendingApproval>,
    route: Option<&'a ApprovalRequestRoute>,
) -> Result<(&'a serde_json::Value, &'a str), ApprovalResponseTargetError> {
    if let Some(pending) = pending {
        return Ok((&pending.raw_request_id, pending.method.as_str()));
    }

    if route.is_some() {
        return Err(ApprovalResponseTargetError::RuntimeReset);
    }

    Err(ApprovalResponseTargetError::MissingRequestMetadata)
}

fn approval_response_target_error_message(
    reason: ApprovalResponseTargetError,
    approval_id: &str,
) -> String {
    match reason {
        ApprovalResponseTargetError::RuntimeReset => format!(
            "Codex approval `{approval_id}` can no longer be answered because the runtime connection was reset. Re-run the request to create a fresh approval."
        ),
        ApprovalResponseTargetError::MissingRequestMetadata => {
            format!("Codex approval `{approval_id}` is no longer active.")
        }
    }
}

fn belongs_to_thread(params: &serde_json::Value, thread_id: &str) -> bool {
    let candidates = [
        "threadId",
        "thread_id",
        "engineThreadId",
        "engine_thread_id",
        "conversationId",
        "conversation_id",
        "sessionId",
        "session_id",
    ];

    if let Some(found) = extract_any_string(params, &candidates) {
        return found == thread_id;
    }

    for key in [
        "thread", "turn", "session", "context", "meta", "metadata", "item",
    ] {
        if let Some(nested) = params.get(key) {
            if let Some(found) = extract_any_string(nested, &candidates) {
                return found == thread_id;
            }
        }
    }

    // No thread ID field found in params — pass through.
    // Server requests (e.g. approval requests) often omit threadId.
    // The turn ID check provides additional filtering when needed.
    log::debug!(
        "belongs_to_thread: no thread ID field found in params, passing through (expected={thread_id})"
    );
    true
}

fn transport_failure_message(
    normalized_method: &str,
    params: &serde_json::Value,
) -> Option<String> {
    match normalized_method {
        "transport/eof" => Some("codex app-server closed the connection unexpectedly".to_string()),
        "transport/readerror" | "transport/read_error" => Some(
            extract_any_string(params, &["error"])
                .map(|error| format!("codex app-server connection failed: {error}"))
                .unwrap_or_else(|| "codex app-server connection failed".to_string()),
        ),
        "transport/parseerror" | "transport/parse_error" => Some(
            extract_any_string(params, &["error"])
                .map(|error| {
                    format!("codex app-server sent an unreadable protocol message: {error}")
                })
                .unwrap_or_else(|| {
                    "codex app-server sent an unreadable protocol message".to_string()
                }),
        ),
        _ => None,
    }
}

fn belongs_to_turn(params: &serde_json::Value, expected_turn_id: Option<&str>) -> bool {
    let Some(expected_turn_id) = expected_turn_id else {
        return true;
    };

    let candidates = ["turnId", "turn_id"];
    if let Some(found) = extract_any_string(params, &candidates) {
        return found == expected_turn_id;
    }

    for key in ["turn", "item", "session", "context", "meta", "metadata"] {
        if let Some(nested) = params.get(key) {
            if let Some(found) = extract_any_string(nested, &candidates) {
                return found == expected_turn_id;
            }
        }
    }

    true
}

fn rebind_expected_turn_id(
    expected_turn_id: &mut Option<String>,
    next_turn_id: &str,
    thread_id: &str,
    source: &str,
) {
    let trimmed_turn_id = next_turn_id.trim();
    if trimmed_turn_id.is_empty() {
        return;
    }

    let changed = expected_turn_id.as_deref() != Some(trimmed_turn_id);
    if changed {
        match expected_turn_id.as_deref() {
            Some(previous) => {
                log::info!(
                    "codex turn id rebound for thread {thread_id}: {previous} -> {trimmed_turn_id} ({source})"
                );
            }
            None => {
                log::debug!(
                    "codex turn id established for thread {thread_id}: {trimmed_turn_id} ({source})"
                );
            }
        }
        *expected_turn_id = Some(trimmed_turn_id.to_string());
    }
}

fn normalize_approval_response(
    method: Option<&str>,
    mut response: serde_json::Value,
) -> serde_json::Value {
    let Some(method) = method else {
        return response;
    };
    let method_key = method_signature(method);
    let is_modern = matches!(
        method_key.as_str(),
        "itemcommandexecutionrequestapproval" | "itemfilechangerequestapproval"
    );
    let is_legacy = matches!(
        method_key.as_str(),
        "execcommandapproval" | "applypatchapproval"
    );

    if is_modern {
        if let Some(amendment) = response.get("acceptWithExecpolicyAmendment").cloned() {
            response = serde_json::json!({
                "decision": {
                    "acceptWithExecpolicyAmendment": amendment,
                }
            });
        }

        if let Some(amendment) = response.get("applyNetworkPolicyAmendment").cloned() {
            response = serde_json::json!({
                "decision": {
                    "applyNetworkPolicyAmendment": amendment,
                }
            });
        }

        if let Some(object) = response.as_object_mut() {
            if let Some(decision) = object.get("decision").and_then(serde_json::Value::as_str) {
                object.insert(
                    "decision".to_string(),
                    serde_json::Value::String(normalize_modern_approval_decision(decision)),
                );
            }
        }

        return response;
    }

    if is_legacy {
        if let Some(amendment_values) = response
            .get("acceptWithExecpolicyAmendment")
            .and_then(|value| value.get("execpolicy_amendment"))
            .cloned()
        {
            response = serde_json::json!({
                "decision": {
                    "approved_execpolicy_amendment": {
                        "proposed_execpolicy_amendment": amendment_values,
                    }
                }
            });
        }

        if let Some(amendment_value) = response
            .get("network_policy_amendment")
            .or_else(|| {
                response
                    .get("applyNetworkPolicyAmendment")
                    .and_then(|value| value.get("network_policy_amendment"))
            })
            .cloned()
        {
            response = serde_json::json!({
                "decision": {
                    "network_policy_amendment": {
                        "network_policy_amendment": amendment_value,
                    }
                }
            });
        }

        if let Some(object) = response.as_object_mut() {
            if let Some(decision) = object.get("decision").and_then(serde_json::Value::as_str) {
                object.insert(
                    "decision".to_string(),
                    serde_json::Value::String(normalize_legacy_approval_decision(decision)),
                );
            }
        }

        return response;
    }

    response
}

fn normalize_modern_approval_decision(value: &str) -> String {
    match value {
        "approved" | "allow" => "accept".to_string(),
        "accept_for_session" => "acceptForSession".to_string(),
        "allow_session" => "acceptForSession".to_string(),
        "approved_for_session" => "acceptForSession".to_string(),
        "deny" => "decline".to_string(),
        "denied" => "decline".to_string(),
        "abort" => "cancel".to_string(),
        other => other.to_string(),
    }
}

fn parse_optional_timeout_seconds(raw: Option<&str>) -> Option<Duration> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }

    let seconds = raw.parse::<u64>().ok()?;
    if seconds == 0 {
        None
    } else {
        Some(Duration::from_secs(seconds))
    }
}

fn completion_inactivity_timeout() -> Option<Duration> {
    parse_optional_timeout_seconds(
        env::var("PANES_CODEX_COMPLETION_INACTIVITY_TIMEOUT_SECS")
            .ok()
            .as_deref(),
    )
}

fn normalize_legacy_approval_decision(value: &str) -> String {
    match value {
        "accept" | "allow" => "approved".to_string(),
        "accept_for_session" => "approved_for_session".to_string(),
        "acceptForSession" => "approved_for_session".to_string(),
        "allow_session" => "approved_for_session".to_string(),
        "decline" | "deny" => "denied".to_string(),
        "cancel" => "abort".to_string(),
        other => other.to_string(),
    }
}

fn normalize_method(method: &str) -> String {
    method
        .replace('.', "/")
        .to_lowercase()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            segment
                .chars()
                .filter(|ch| *ch != '_' && *ch != '-')
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn method_signature(method: &str) -> String {
    normalize_method(method).replace('/', "")
}

fn is_known_codex_notification_method(normalized_method: &str) -> bool {
    matches!(
        normalized_method,
        "turn/started"
            | "turn/completed"
            | "turn/diff/updated"
            | "turn/plan/updated"
            | "thread/started"
            | "thread/compacted"
            | "thread/status/changed"
            | "thread/name/updated"
            | "thread/archived"
            | "thread/unarchived"
            | "thread/closed"
            | "thread/tokenusage/updated"
            | "account/ratelimits/updated"
            | "account/updated"
            | "item/started"
            | "item/completed"
            | "item/agentmessage/delta"
            | "item/plan/delta"
            | "item/reasoning/summarypartadded"
            | "reasoningsummary/partadded"
            | "item/reasoning/summarytextdelta"
            | "item/reasoning/textdelta"
            | "item/mcptoolcall/progress"
            | "item/commandexecution/outputdelta"
            | "item/filechange/outputdelta"
            | "hook/started"
            | "hook/completed"
            | "item/commandexecution/terminalinteraction"
            | "terminal/interaction"
            | "thread/realtime/started"
            | "thread/realtime/closed"
            | "thread/realtime/error"
            | "thread/realtime/itemadded"
            | "thread/realtime/outputaudio/delta"
            | "thread/realtime/outputaudiodelta"
            | "windows/worldwritablewarning"
            | "windowssandbox/setupcompleted"
            | "windows/sandboxsetup/completed"
            | "model/rerouted"
            | "deprecationnotice"
            | "error"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn normalize_modern_accept_with_execpolicy_from_top_level() {
        let response = json!({
            "acceptWithExecpolicyAmendment": {
                "execpolicy_amendment": ["npm", "test"]
            }
        });

        let normalized =
            normalize_approval_response(Some("item/commandExecution/requestApproval"), response);

        assert_eq!(
            normalized,
            json!({
                "decision": {
                    "acceptWithExecpolicyAmendment": {
                        "execpolicy_amendment": ["npm", "test"]
                    }
                }
            })
        );
    }

    #[test]
    fn normalize_modern_accept_for_session_to_camel_case() {
        let response = json!({ "decision": "accept_for_session" });
        let normalized =
            normalize_approval_response(Some("item/fileChange/requestApproval"), response);

        assert_eq!(normalized, json!({ "decision": "acceptForSession" }));
    }

    #[test]
    fn normalize_modern_network_policy_amendment_from_top_level() {
        let response = json!({
            "applyNetworkPolicyAmendment": {
                "network_policy_amendment": {
                    "host": "registry.npmjs.org",
                    "action": "allow"
                }
            }
        });

        let normalized =
            normalize_approval_response(Some("item/commandExecution/requestApproval"), response);

        assert_eq!(
            normalized,
            json!({
                "decision": {
                    "applyNetworkPolicyAmendment": {
                        "network_policy_amendment": {
                            "host": "registry.npmjs.org",
                            "action": "allow"
                        }
                    }
                }
            })
        );
    }

    #[test]
    fn normalize_legacy_accept_with_execpolicy_to_legacy_shape() {
        let response = json!({
            "acceptWithExecpolicyAmendment": {
                "execpolicy_amendment": ["pnpm", "install"]
            }
        });

        let normalized = normalize_approval_response(Some("execCommandApproval"), response);

        assert_eq!(
            normalized,
            json!({
                "decision": {
                    "approved_execpolicy_amendment": {
                        "proposed_execpolicy_amendment": ["pnpm", "install"]
                    }
                }
            })
        );
    }

    #[test]
    fn normalize_legacy_network_policy_to_legacy_shape() {
        let response = json!({
            "network_policy_amendment": {
                "host": "registry.npmjs.org",
                "action": "allow"
            }
        });

        let normalized = normalize_approval_response(Some("execCommandApproval"), response);

        assert_eq!(
            normalized,
            json!({
                "decision": {
                    "network_policy_amendment": {
                        "network_policy_amendment": {
                            "host": "registry.npmjs.org",
                            "action": "allow"
                        }
                    }
                }
            })
        );
    }

    #[test]
    fn normalize_dynamic_tool_call_response_is_unchanged() {
        let response = json!({
            "success": true,
            "contentItems": []
        });

        let normalized = normalize_approval_response(Some("item/tool/call"), response.clone());

        assert_eq!(normalized, response);
    }

    #[test]
    fn thread_resume_params_include_requested_runtime() {
        let params = build_thread_resume_params(
            "thread-123",
            "gpt-5-codex",
            "/tmp/workspace",
            &json!("on-request"),
            "workspace-write",
            Some("fast"),
            Some("friendly"),
        );

        assert_eq!(
            params,
            json!({
                "threadId": "thread-123",
                "model": "gpt-5-codex",
                "cwd": "/tmp/workspace",
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
                "serviceTier": "fast",
                "personality": "friendly",
                "persistExtendedHistory": false,
            })
        );
    }

    #[tokio::test]
    async fn build_turn_start_params_uses_native_plan_mode_for_codex_when_available() {
        let runtime = ThreadRuntime {
            cwd: "/tmp/workspace".to_string(),
            model_id: "gpt-5.4".to_string(),
            approval_policy: json!("on-request"),
            sandbox_policy: json!({
                "type": "workspaceWrite",
                "writableRoots": ["/tmp/workspace"],
                "networkAccess": false,
            }),
            reasoning_effort: Some("medium".to_string()),
            service_tier: Some("fast".to_string()),
            personality: Some("friendly".to_string()),
            output_schema: Some(json!({"type":"object"})),
            native_plan_mode_active: false,
        };
        let input = TurnInput {
            message: "Inspect the repo first".to_string(),
            attachments: Vec::new(),
            plan_mode: true,
            input_items: vec![TurnInputItem::Text {
                text: "Inspect the repo first".to_string(),
            }],
        };

        let params = build_turn_start_params(
            "thread-123",
            Some(&runtime),
            &input,
            PlanModeActivation::NativeCollaboration,
        )
        .await
        .expect("turn/start params");

        assert_eq!(
            params.get("collaborationMode"),
            Some(&json!({
                "mode": "plan",
                "settings": {
                    "model": "gpt-5.4",
                    "reasoning_effort": "medium",
                }
            }))
        );
        assert_eq!(params.get("summary"), Some(&json!("detailed")));

        let payload = params
            .get("input")
            .and_then(Value::as_array)
            .expect("input array");
        assert_eq!(payload.len(), 1);
        assert_eq!(payload[0].get("type").and_then(Value::as_str), Some("text"));
        let text = payload[0]
            .get("text")
            .and_then(Value::as_str)
            .expect("text payload");
        assert_eq!(text, "Inspect the repo first");
    }

    #[tokio::test]
    async fn build_turn_start_params_resets_native_plan_mode_on_non_plan_turns() {
        let handoff_message = "Implement the plan.";
        let runtime = ThreadRuntime {
            cwd: "/tmp/workspace".to_string(),
            model_id: "gpt-5.4".to_string(),
            approval_policy: json!("on-request"),
            sandbox_policy: json!({
                "type": "workspaceWrite",
                "writableRoots": ["/tmp/workspace"],
                "networkAccess": false,
            }),
            reasoning_effort: Some("medium".to_string()),
            service_tier: Some("fast".to_string()),
            personality: Some("friendly".to_string()),
            output_schema: Some(json!({"type":"object"})),
            native_plan_mode_active: true,
        };
        let input = TurnInput {
            message: handoff_message.to_string(),
            attachments: Vec::new(),
            plan_mode: false,
            input_items: vec![TurnInputItem::Text {
                text: handoff_message.to_string(),
            }],
        };

        let params = build_turn_start_params(
            "thread-123",
            Some(&runtime),
            &input,
            PlanModeActivation::NativeCollaboration,
        )
        .await
        .expect("turn/start params");

        assert_eq!(
            params.get("collaborationMode"),
            Some(&json!({
                "mode": "default",
                "settings": {
                    "model": "gpt-5.4",
                    "reasoning_effort": "medium",
                }
            }))
        );
        assert_eq!(params.get("summary"), Some(&Value::Null));

        let payload = params
            .get("input")
            .and_then(Value::as_array)
            .expect("input array");
        assert_eq!(payload.len(), 1);
        assert_eq!(
            payload[0].get("text").and_then(Value::as_str),
            Some(handoff_message)
        );
    }

    #[tokio::test]
    async fn build_turn_start_params_uses_prompt_fallback_when_plan_mode_is_not_native() {
        let runtime = ThreadRuntime {
            cwd: "/tmp/workspace".to_string(),
            model_id: "gpt-5.4".to_string(),
            approval_policy: json!("on-request"),
            sandbox_policy: json!({
                "type": "workspaceWrite",
                "writableRoots": ["/tmp/workspace"],
                "networkAccess": false,
            }),
            reasoning_effort: Some("medium".to_string()),
            service_tier: Some("fast".to_string()),
            personality: Some("friendly".to_string()),
            output_schema: Some(json!({"type":"object"})),
            native_plan_mode_active: false,
        };
        let input = TurnInput {
            message: "Inspect the repo first".to_string(),
            attachments: Vec::new(),
            plan_mode: true,
            input_items: vec![TurnInputItem::Text {
                text: "Inspect the repo first".to_string(),
            }],
        };

        let params = build_turn_start_params(
            "thread-123",
            Some(&runtime),
            &input,
            PlanModeActivation::PromptPrefix,
        )
        .await
        .expect("turn/start params");

        assert_eq!(params.get("collaborationMode"), None);
        assert_eq!(params.get("summary"), None);

        let payload = params
            .get("input")
            .and_then(Value::as_array)
            .expect("input array");
        let text = payload[0]
            .get("text")
            .and_then(Value::as_str)
            .expect("text payload");
        assert!(text.starts_with(PLAN_MODE_PROMPT_PREFIX));
        assert!(text.contains("- [pending] Step"));
        assert!(text.contains("Inspect the repo first"));
    }

    #[tokio::test]
    async fn build_turn_start_params_keeps_non_plan_text_unchanged() {
        let input = TurnInput {
            message: "Inspect the repo first".to_string(),
            attachments: Vec::new(),
            plan_mode: false,
            input_items: vec![TurnInputItem::Text {
                text: "Inspect the repo first".to_string(),
            }],
        };

        let params =
            build_turn_start_params("thread-123", None, &input, PlanModeActivation::Disabled)
                .await
                .expect("turn/start params");

        assert_eq!(params.get("collaborationMode"), None);
        assert_eq!(params.get("summary"), None);

        let payload = params
            .get("input")
            .and_then(Value::as_array)
            .expect("input array");
        assert_eq!(
            payload[0].get("text").and_then(Value::as_str),
            Some("Inspect the repo first")
        );
    }

    #[test]
    fn plan_mode_activation_prefers_native_when_plan_is_advertised() {
        let diagnostics = CodexProtocolDiagnosticsDto {
            method_availability: vec![CodexMethodAvailabilityDto {
                method: "collaborationMode/list".to_string(),
                status: "available".to_string(),
                detail: None,
            }],
            collaboration_modes: vec!["default".to_string(), "plan".to_string()],
            experimental_features: Vec::new(),
            apps: Vec::new(),
            skills: Vec::new(),
            plugin_marketplaces: Vec::new(),
            mcp_servers: Vec::new(),
            account: None,
            config: None,
            last_config_warning: None,
            last_account_login: None,
            last_mcp_oauth: None,
            last_thread_realtime: None,
            last_windows_sandbox_setup: None,
            last_windows_world_writable_warning: None,
            fetched_at: None,
            stale: false,
        };

        assert_eq!(
            plan_mode_activation_from_diagnostics(Some(&diagnostics)),
            Some(PlanModeActivation::NativeCollaboration)
        );
    }

    #[test]
    fn plan_mode_activation_falls_back_when_plan_is_not_advertised() {
        let diagnostics = CodexProtocolDiagnosticsDto {
            method_availability: vec![CodexMethodAvailabilityDto {
                method: "collaborationMode/list".to_string(),
                status: "unsupported".to_string(),
                detail: Some("not implemented".to_string()),
            }],
            collaboration_modes: Vec::new(),
            experimental_features: Vec::new(),
            apps: Vec::new(),
            skills: Vec::new(),
            plugin_marketplaces: Vec::new(),
            mcp_servers: Vec::new(),
            account: None,
            config: None,
            last_config_warning: None,
            last_account_login: None,
            last_mcp_oauth: None,
            last_thread_realtime: None,
            last_windows_sandbox_setup: None,
            last_windows_world_writable_warning: None,
            fetched_at: None,
            stale: false,
        };

        assert_eq!(
            plan_mode_activation_from_diagnostics(Some(&diagnostics)),
            Some(PlanModeActivation::PromptPrefix)
        );
    }

    #[test]
    fn normalize_modern_snake_case_method_alias() {
        let response = json!({ "decision": "accept_for_session" });
        let normalized =
            normalize_approval_response(Some("item/command_execution/request_approval"), response);

        assert_eq!(normalized, json!({ "decision": "acceptForSession" }));
    }

    #[test]
    fn transport_failure_message_detects_terminal_transport_events() {
        assert_eq!(
            transport_failure_message("transport/eof", &json!({})).as_deref(),
            Some("codex app-server closed the connection unexpectedly")
        );
        assert_eq!(
            transport_failure_message(
                "transport/readerror",
                &json!({
                    "error": "broken pipe"
                })
            )
            .as_deref(),
            Some("codex app-server connection failed: broken pipe")
        );
        assert_eq!(
            transport_failure_message(
                "transport/parse_error",
                &json!({
                    "error": "expected value at line 1 column 1"
                })
            )
            .as_deref(),
            Some("codex app-server sent an unreadable protocol message: expected value at line 1 column 1")
        );
    }

    #[test]
    fn rebind_expected_turn_id_replaces_prior_turn() {
        let mut expected_turn_id = Some("turn-plan".to_string());

        rebind_expected_turn_id(
            &mut expected_turn_id,
            "turn-execute",
            "thread-123",
            "turn/started notification",
        );

        assert_eq!(expected_turn_id.as_deref(), Some("turn-execute"));
    }

    #[test]
    fn extract_reconciled_turn_completion_prefers_expected_turn() {
        let reconciled = extract_reconciled_turn_completion(
            &json!({
                "thread": {
                    "turns": [
                        { "id": "turn-old", "status": "completed" },
                        {
                            "id": "turn-active",
                            "status": "failed",
                            "error": { "message": "permission denied" }
                        }
                    ]
                }
            }),
            Some("turn-active"),
        )
        .expect("expected terminal turn");

        assert_eq!(
            reconciled,
            ReconciledTurnCompletion {
                status: TurnCompletionStatus::Failed,
                error_message: Some("permission denied".to_string()),
            }
        );
    }

    #[test]
    fn extract_reconciled_turn_completion_requires_matching_turn_id() {
        assert_eq!(
            extract_reconciled_turn_completion(
                &json!({
                    "thread": {
                        "turns": [
                            { "id": "turn-old", "status": "completed" },
                            { "id": "turn-latest", "status": "interrupted" }
                        ]
                    }
                }),
                Some("turn-missing"),
            ),
            None
        );
    }

    #[test]
    fn extract_reconciled_turn_completion_requires_expected_turn_id() {
        assert_eq!(
            extract_reconciled_turn_completion(
                &json!({
                    "thread": {
                        "turns": [
                            { "id": "turn-latest", "status": "completed" }
                        ]
                    }
                }),
                None,
            ),
            None
        );
    }

    #[test]
    fn build_reconciled_turn_completion_events_marks_lost_completed_turn_failed() {
        let events = build_reconciled_turn_completion_events(
            ReconciledTurnCompletion {
                status: TurnCompletionStatus::Completed,
                error_message: None,
            },
            TurnCompletionRecoveryMode::StreamLost,
        );

        assert_eq!(events.len(), 2);
        match &events[0] {
            EngineEvent::Error {
                message,
                recoverable,
            } => {
                assert!(message.contains("transcript may be incomplete"));
                assert!(*recoverable);
            }
            other => panic!("expected warning error event, got {other:?}"),
        }
        match &events[1] {
            EngineEvent::TurnCompleted {
                status,
                token_usage,
            } => {
                assert_eq!(*status, TurnCompletionStatus::Failed);
                assert!(token_usage.is_none());
            }
            other => panic!("expected turn completed event, got {other:?}"),
        }
    }

    #[test]
    fn build_reconciled_turn_completion_events_keeps_timeout_completion_status() {
        let events = build_reconciled_turn_completion_events(
            ReconciledTurnCompletion {
                status: TurnCompletionStatus::Completed,
                error_message: Some("remote failure".to_string()),
            },
            TurnCompletionRecoveryMode::CompletionTimeout,
        );

        assert_eq!(events.len(), 2);
        match &events[0] {
            EngineEvent::Error {
                message,
                recoverable,
            } => {
                assert_eq!(message, "remote failure");
                assert!(*recoverable);
            }
            other => panic!("expected remote error event, got {other:?}"),
        }
        match &events[1] {
            EngineEvent::TurnCompleted {
                status,
                token_usage,
            } => {
                assert_eq!(*status, TurnCompletionStatus::Completed);
                assert!(token_usage.is_none());
            }
            other => panic!("expected turn completed event, got {other:?}"),
        }
    }

    #[test]
    fn extract_reconciled_turn_completion_ignores_in_progress_turns() {
        assert_eq!(
            extract_reconciled_turn_completion(
                &json!({
                    "thread": {
                        "turns": [
                            { "id": "turn-active", "status": "inProgress" }
                        ]
                    }
                }),
                Some("turn-active"),
            ),
            None
        );
    }

    #[test]
    fn resolve_approval_response_target_prefers_pending_request_metadata() {
        let pending = PendingApproval {
            raw_request_id: json!(42),
            method: "item/fileChange/requestApproval".to_string(),
        };
        let persisted = ApprovalRequestRoute {
            server_method: "item/commandExecution/requestApproval".to_string(),
            raw_request_id: json!("req-2"),
        };

        let resolved = resolve_approval_response_target(Some(&pending), Some(&persisted))
            .expect("expected live pending approval target");

        assert_eq!(resolved.0, &json!(42));
        assert_eq!(resolved.1, "item/fileChange/requestApproval");
    }

    #[test]
    fn resolve_approval_response_target_rejects_persisted_route_after_transport_reset() {
        let persisted = ApprovalRequestRoute {
            server_method: "item/commandExecution/requestApproval".to_string(),
            raw_request_id: json!("req-2"),
        };

        assert_eq!(
            resolve_approval_response_target(None, Some(&persisted)),
            Err(ApprovalResponseTargetError::RuntimeReset)
        );
    }

    #[test]
    fn resolve_approval_response_target_rejects_missing_request_metadata() {
        assert_eq!(
            resolve_approval_response_target(None, None),
            Err(ApprovalResponseTargetError::MissingRequestMetadata)
        );
    }

    #[test]
    fn parse_optional_timeout_seconds_treats_zero_and_invalid_as_disabled() {
        assert_eq!(parse_optional_timeout_seconds(None), None);
        assert_eq!(parse_optional_timeout_seconds(Some("")), None);
        assert_eq!(parse_optional_timeout_seconds(Some("0")), None);
        assert_eq!(parse_optional_timeout_seconds(Some("abc")), None);
        assert_eq!(
            parse_optional_timeout_seconds(Some("120")),
            Some(Duration::from_secs(120))
        );
    }

    #[test]
    fn normalize_legacy_snake_case_method_alias() {
        let response = json!({ "decision": "accept_for_session" });
        let normalized = normalize_approval_response(Some("exec_command_approval"), response);

        assert_eq!(normalized, json!({ "decision": "approved_for_session" }));
    }

    #[test]
    fn opaque_action_failure_detects_generic_failed_status() {
        let result = ActionResult {
            success: false,
            output: None,
            error: Some("Action failed with status `failed`".to_string()),
            diff: None,
            duration_ms: 52,
        };

        assert!(is_opaque_action_failure(&result));
    }

    #[test]
    fn opaque_action_failure_ignores_failures_with_output() {
        let result = ActionResult {
            success: false,
            output: Some("zsh:1: command not found: pnpm\n".to_string()),
            error: Some("Action failed with status `failed`".to_string()),
            diff: None,
            duration_ms: 52,
        };

        assert!(!is_opaque_action_failure(&result));
    }

    #[test]
    fn opaque_workspace_probe_error_excludes_transport_failures() {
        assert!(!is_opaque_workspace_probe_failure(
            "all rpc methods failed: command/exec: timed out waiting for response"
        ));
        assert!(is_opaque_workspace_probe_failure(
            "all rpc methods failed: command/exec: failed"
        ));
    }

    #[test]
    fn workspace_probe_result_detects_failed_status_payload() {
        let payload = json!({
            "status": "failed",
            "exitCode": null,
            "stderr": ""
        });

        assert!(workspace_probe_result_indicates_failure(&payload));
    }

    #[test]
    fn workspace_probe_result_detects_non_zero_exit_code() {
        let payload = json!({
            "status": "completed",
            "exitCode": 137,
            "stderr": "sandbox error: command was killed by a signal"
        });

        assert!(workspace_probe_result_indicates_failure(&payload));
    }

    #[test]
    fn workspace_probe_result_accepts_successful_payload() {
        let payload = json!({
            "status": "completed",
            "exitCode": 0,
            "stdout": "",
            "stderr": ""
        });

        assert!(!workspace_probe_result_indicates_failure(&payload));
    }

    #[test]
    fn thread_runtime_uses_effective_values_from_start_response() {
        let response = json!({
            "cwd": "/tmp/effective",
            "model": "gpt-5.3-codex",
            "approvalPolicy": "untrusted",
            "sandbox": {
                "type": "externalSandbox",
                "networkAccess": "restricted"
            },
            "reasoningEffort": "high"
        });

        let runtime = thread_runtime_from_start_response(
            &response,
            "/tmp/fallback",
            "gpt-5",
            &json!("on-request"),
            &json!({"type":"workspaceWrite"}),
            Some("medium".to_string()),
            Some("flex".to_string()),
            Some("friendly".to_string()),
            Some(json!({"type":"object"})),
        );

        assert_eq!(runtime.cwd, "/tmp/effective");
        assert_eq!(runtime.model_id, "gpt-5.3-codex");
        assert_eq!(runtime.approval_policy, json!("untrusted"));
        assert_eq!(
            runtime.sandbox_policy,
            json!({
                "type": "externalSandbox",
                "networkAccess": "restricted"
            })
        );
        assert_eq!(runtime.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(runtime.service_tier.as_deref(), Some("flex"));
        assert_eq!(runtime.personality.as_deref(), Some("friendly"));
        assert_eq!(runtime.output_schema, Some(json!({"type":"object"})));
    }

    #[test]
    fn thread_runtime_falls_back_when_response_omits_fields() {
        let response = json!({});
        let runtime = thread_runtime_from_start_response(
            &response,
            "/tmp/fallback",
            "gpt-5",
            &json!("on-request"),
            &json!({"type":"workspaceWrite","networkAccess":false}),
            Some("medium".to_string()),
            Some("fast".to_string()),
            Some("pragmatic".to_string()),
            Some(json!(true)),
        );

        assert_eq!(runtime.cwd, "/tmp/fallback");
        assert_eq!(runtime.model_id, "gpt-5");
        assert_eq!(runtime.approval_policy, json!("on-request"));
        assert_eq!(
            runtime.sandbox_policy,
            json!({"type":"workspaceWrite","networkAccess":false})
        );
        assert_eq!(runtime.reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(runtime.service_tier.as_deref(), Some("fast"));
        assert_eq!(runtime.personality.as_deref(), Some("pragmatic"));
        assert_eq!(runtime.output_schema, Some(json!(true)));
    }

    #[test]
    fn thread_runtime_from_resume_response_prefers_requested_runtime() {
        let requested_runtime = ThreadRuntime {
            cwd: "/tmp/requested".to_string(),
            model_id: "gpt-5.1-codex-mini".to_string(),
            approval_policy: json!("on-request"),
            sandbox_policy: json!({
                "type": "workspaceWrite",
                "writableRoots": ["/tmp/requested"],
                "networkAccess": false,
            }),
            reasoning_effort: Some("medium".to_string()),
            service_tier: Some("flex".to_string()),
            personality: Some("friendly".to_string()),
            output_schema: Some(json!({"type":"object"})),
            native_plan_mode_active: false,
        };
        let response = json!({
            "cwd": "/tmp/stale",
            "model": "gpt-5.3-codex",
            "approvalPolicy": "never",
            "sandbox": {
                "type": "dangerFullAccess",
            },
            "reasoningEffort": "xhigh"
        });

        let runtime = thread_runtime_from_resume_response(&response, &requested_runtime);

        assert_eq!(runtime, requested_runtime);
    }

    #[test]
    fn preserve_live_thread_runtime_flags_keeps_native_plan_mode_from_existing_runtime() {
        let existing_runtime = ThreadRuntime {
            cwd: "/tmp/original".to_string(),
            model_id: "gpt-5.4".to_string(),
            approval_policy: json!("on-request"),
            sandbox_policy: json!({
                "type": "workspaceWrite",
                "writableRoots": ["/tmp/original"],
                "networkAccess": false,
            }),
            reasoning_effort: Some("medium".to_string()),
            service_tier: Some("default".to_string()),
            personality: Some("friendly".to_string()),
            output_schema: Some(json!({"type":"object"})),
            native_plan_mode_active: true,
        };
        let requested_runtime = ThreadRuntime {
            cwd: "/tmp/updated".to_string(),
            model_id: "gpt-5.4".to_string(),
            approval_policy: json!("never"),
            sandbox_policy: json!({
                "type": "workspaceWrite",
                "writableRoots": ["/tmp/updated"],
                "networkAccess": true,
            }),
            reasoning_effort: Some("high".to_string()),
            service_tier: Some("flex".to_string()),
            personality: Some("precise".to_string()),
            output_schema: None,
            native_plan_mode_active: false,
        };

        let preserved_runtime =
            preserve_live_thread_runtime_flags(requested_runtime, Some(&existing_runtime));

        assert!(preserved_runtime.native_plan_mode_active);
        assert_eq!(preserved_runtime.cwd, "/tmp/updated");
        assert_eq!(preserved_runtime.approval_policy, json!("never"));
        assert_eq!(preserved_runtime.reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn extract_codex_remote_thread_summary_reads_thread_list_shape() {
        let summary = extract_codex_remote_thread_summary(
            &json!({
                "id": "thread-123",
                "name": "Remote thread",
                "preview": "Most recent preview",
                "cwd": "/tmp/workspace",
                "createdAt": 1710000000,
                "updatedAt": 1710003600,
                "modelProvider": "openai",
                "source": "appServer",
                "status": {
                    "type": "active",
                    "activeFlags": ["waitingOnApproval"]
                }
            }),
            false,
        )
        .expect("expected summary");

        assert_eq!(summary.engine_thread_id, "thread-123");
        assert_eq!(summary.title.as_deref(), Some("Remote thread"));
        assert_eq!(summary.preview, "Most recent preview");
        assert_eq!(summary.cwd, "/tmp/workspace");
        assert_eq!(summary.created_at, 1710000000);
        assert_eq!(summary.updated_at, 1710003600);
        assert_eq!(summary.model_provider, "openai");
        assert_eq!(summary.source_kind, "appServer");
        assert_eq!(summary.status_type, "active");
        assert_eq!(summary.active_flags, vec!["waitingOnApproval".to_string()]);
        assert!(!summary.archived);
    }

    #[test]
    fn extract_codex_remote_thread_summary_maps_sub_agent_sources() {
        let summary = extract_codex_remote_thread_summary(
            &json!({
                "thread": {
                    "id": "thread-456",
                    "cwd": "/tmp/repo",
                    "createdAt": 1710000000,
                    "updatedAt": 1710000001,
                    "modelProvider": "openai",
                    "source": {
                        "subAgent": {
                            "thread_spawn": true
                        }
                    },
                    "status": {
                        "type": "idle",
                        "activeFlags": []
                    }
                },
                "preview": "Preview"
            }),
            true,
        )
        .expect("expected summary");

        assert_eq!(summary.source_kind, "subAgentThreadSpawn");
        assert!(summary.archived);
    }

    #[tokio::test]
    async fn resolve_pending_approval_request_removes_matching_request() {
        let state = Arc::new(Mutex::new(CodexState::default()));
        {
            let mut locked = state.lock().await;
            locked.approval_requests.insert(
                "approval-1".to_string(),
                PendingApproval {
                    raw_request_id: json!(42),
                    method: "item/fileChange/requestApproval".to_string(),
                },
            );
        }

        let approval_id = resolve_pending_approval_request(state.clone(), &json!(42)).await;

        assert_eq!(approval_id.as_deref(), Some("approval-1"));
        let locked = state.lock().await;
        assert!(locked.approval_requests.is_empty());
    }

    #[tokio::test]
    async fn runtime_model_fallback_prefers_cached_runtime_models() {
        let engine = CodexEngine::default();
        let cached_models = vec![ModelInfo {
            id: "cached-model".to_string(),
            display_name: "cached-model".to_string(),
            description: "Runtime cached model".to_string(),
            hidden: false,
            is_default: true,
            upgrade: None,
            availability_nux: None,
            upgrade_info: None,
            input_modalities: vec!["text".to_string()],
            supports_personality: true,
            default_reasoning_effort: "minimal".to_string(),
            supported_reasoning_efforts: vec![ReasoningEffortOption {
                reasoning_effort: "minimal".to_string(),
                description: "Fastest".to_string(),
            }],
        }];

        engine
            .store_runtime_model_cache(cached_models.clone())
            .await;

        assert_eq!(
            engine
                .runtime_model_fallback()
                .await
                .into_iter()
                .map(|model| model.id)
                .collect::<Vec<_>>(),
            cached_models
                .into_iter()
                .map(|model| model.id)
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn update_protocol_diagnostics_with_config_warning_tracks_end_range() {
        let state = Arc::new(Mutex::new(CodexState::default()));

        let diagnostics = update_protocol_diagnostics_with_config_warning(
            state,
            &json!({
                "summary": "Bad config",
                "path": "/tmp/config.toml",
                "range": {
                    "start": { "line": 2, "column": 4 },
                    "end": { "line": 2, "column": 12 }
                }
            }),
        )
        .await
        .expect("diagnostics should update");

        let warning = diagnostics
            .last_config_warning
            .expect("config warning should be stored");
        assert_eq!(warning.start_line, Some(2));
        assert_eq!(warning.start_column, Some(4));
        assert_eq!(warning.end_line, Some(2));
        assert_eq!(warning.end_column, Some(12));
    }

    #[tokio::test]
    async fn update_protocol_diagnostics_with_windows_and_realtime_notifications() {
        let state = Arc::new(Mutex::new(CodexState::default()));

        let diagnostics = update_protocol_diagnostics_with_windows_world_writable_warning(
            state.clone(),
            &json!({
                "samplePaths": ["C:/tmp/a", "C:/tmp/b"],
                "extraCount": 3,
                "failedScan": true
            }),
        )
        .await
        .expect("world writable warning should update");
        assert_eq!(
            diagnostics
                .last_windows_world_writable_warning
                .as_ref()
                .map(|value| value.extra_count),
            Some(3)
        );

        let diagnostics = update_protocol_diagnostics_with_windows_sandbox_setup(
            state.clone(),
            &json!({
                "mode": "unelevated",
                "success": false,
                "error": "permission denied"
            }),
        )
        .await
        .expect("sandbox setup should update");
        assert_eq!(
            diagnostics
                .last_windows_sandbox_setup
                .as_ref()
                .map(|value| value.error.as_deref()),
            Some(Some("permission denied"))
        );

        let diagnostics = update_protocol_diagnostics_with_thread_realtime(
            state,
            &normalize_method("thread/realtime/outputAudio/delta"),
            &json!({
                "threadId": "thread-123",
                "audio": {
                    "sampleRate": 24000,
                    "numChannels": 2,
                    "samplesPerChannel": 480,
                    "data": "abc"
                }
            }),
        )
        .await
        .expect("thread realtime should update");
        let realtime = diagnostics
            .last_thread_realtime
            .expect("thread realtime event should be stored");
        assert_eq!(realtime.kind, "thread/realtime/outputaudio/delta");
        assert_eq!(realtime.thread_id, "thread-123");
        assert_eq!(realtime.sample_rate, Some(24000));
        assert_eq!(realtime.num_channels, Some(2));
        assert_eq!(realtime.samples_per_channel, Some(480));
    }

    #[tokio::test]
    async fn update_protocol_diagnostics_with_account_update_tracks_auth_mode() {
        let state = Arc::new(Mutex::new(CodexState::default()));

        let diagnostics = update_protocol_diagnostics_with_account_update(
            state,
            &json!({
                "authMode": "chatgptAuthTokens",
                "planType": "team"
            }),
        )
        .await
        .expect("account update should update diagnostics");

        let account = diagnostics
            .account
            .expect("account diagnostics should exist");
        assert_eq!(account.provider, "chatgpt");
        assert_eq!(account.auth_mode.as_deref(), Some("chatgptAuthTokens"));
        assert_eq!(account.plan_type.as_deref(), Some("team"));
    }

    #[test]
    fn known_codex_notification_methods_include_remaining_runtime_notifications() {
        assert!(is_known_codex_notification_method(&normalize_method(
            "thread/started"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "thread/archived"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "thread/unarchived"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "thread/closed"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "item/reasoning/summaryPartAdded"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "item/commandExecution/terminalInteraction"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "thread/realtime/started"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "thread/realtime/outputAudio/delta"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "windows/worldWritableWarning"
        )));
        assert!(is_known_codex_notification_method(&normalize_method(
            "windowsSandbox/setupCompleted"
        )));
    }

    #[test]
    fn unsupported_external_auth_tokens_message_includes_context() {
        let message =
            unsupported_external_auth_tokens_message(Some("acc_123"), Some("unauthorized"));
        assert!(message.contains("acc_123"));
        assert!(message.contains("unauthorized"));
        assert!(message.contains("cannot refresh"));
    }

    #[test]
    fn event_indicates_auth_failure_for_top_level_error() {
        let event = EngineEvent::Error {
            message: "401 Unauthorized".to_string(),
            recoverable: false,
        };

        assert!(event_indicates_auth_failure(&event));
    }

    #[test]
    fn event_indicates_auth_failure_ignores_failed_tool_output() {
        let event = EngineEvent::ActionCompleted {
            action_id: "action-1".to_string(),
            result: ActionResult {
                success: false,
                output: Some("curl failed with 401 Unauthorized".to_string()),
                error: Some("request failed".to_string()),
                diff: None,
                duration_ms: 10,
            },
        };

        assert!(!event_indicates_auth_failure(&event));
    }

    #[test]
    fn codex_health_checks_use_windows_commands() {
        let checks = codex_health_checks_for_platform("windows");

        assert!(checks.contains(&"where codex".to_string()));
        assert!(checks.contains(&"where node".to_string()));
        assert!(checks.contains(&"echo %PATH%".to_string()));
        assert!(!checks.iter().any(|check| check == "command -v codex"));
    }

    #[test]
    fn codex_unavailable_details_for_windows_mentions_appdata_npm() {
        let details = codex_unavailable_details_for_platform(
            "windows",
            &CodexExecutableResolution {
                executable: None,
                source: "unavailable",
                app_path: Some(r"C:\Windows\System32".to_string()),
                login_shell_executable: None,
            },
        )
        .expect("details should exist");

        assert!(details.contains("%APPDATA%\\npm"));
        assert!(details.contains("App PATH"));
    }

    #[test]
    fn codex_fix_commands_for_windows_cover_install_and_path() {
        let fixes = codex_fix_commands_for_platform(
            "windows",
            &CodexExecutableResolution {
                executable: None,
                source: "unavailable",
                app_path: Some(r"C:\Windows\System32".to_string()),
                login_shell_executable: None,
            },
            None,
        );

        assert!(fixes.contains(&"npm install -g @openai/codex".to_string()));
        assert!(fixes.contains(&"where codex".to_string()));
        assert!(fixes.iter().any(|fix| fix.contains("%APPDATA%\\npm")));
    }

    #[test]
    fn codex_execution_failure_details_for_windows_mentions_node_path() {
        let details = codex_execution_failure_details_for_platform(
            "windows",
            &CodexExecutableResolution {
                executable: Some(std::path::PathBuf::from(
                    r"C:\Users\panes\AppData\Roaming\npm\codex.cmd",
                )),
                source: "app-path",
                app_path: Some(r"C:\Windows\System32".to_string()),
                login_shell_executable: None,
            },
            "env: node: no such file or directory",
        );

        assert!(details.contains("missing from PATH on Windows"));
        assert!(details.contains("node"));
    }

    #[test]
    fn map_codex_model_preserves_runtime_metadata() {
        let model = CodexModel {
            id: "gpt-5.4".to_string(),
            display_name: Some("gpt-5.4".to_string()),
            description: Some("Latest frontier agentic coding model.".to_string()),
            hidden: Some(false),
            is_default: Some(true),
            upgrade: Some("gpt-5.5".to_string()),
            availability_nux: Some(CodexModelAvailabilityNux {
                message: "Try this model for your current plan.".to_string(),
            }),
            upgrade_info: Some(CodexModelUpgradeInfo {
                model: "gpt-5.5".to_string(),
                upgrade_copy: Some("Upgrade available".to_string()),
                model_link: Some("https://example.com".to_string()),
                migration_markdown: Some("Introducing GPT-5.5".to_string()),
            }),
            input_modalities: vec!["text".to_string(), "image".to_string()],
            supports_personality: Some(true),
            default_reasoning_effort: Some("minimal".to_string()),
            supported_reasoning_efforts: vec![CodexReasoningEffortOption {
                reasoning_effort: "minimal".to_string(),
                description: "Fastest responses".to_string(),
            }],
        };

        let mapped = map_codex_model(model);

        assert_eq!(mapped.upgrade.as_deref(), Some("gpt-5.5"));
        assert_eq!(
            mapped
                .availability_nux
                .as_ref()
                .map(|value| value.message.as_str()),
            Some("Try this model for your current plan.")
        );
        assert_eq!(
            mapped
                .upgrade_info
                .as_ref()
                .map(|value| value.model.as_str()),
            Some("gpt-5.5")
        );
        assert_eq!(
            mapped
                .upgrade_info
                .as_ref()
                .and_then(|value| value.upgrade_copy.as_deref()),
            Some("Upgrade available")
        );
        assert_eq!(mapped.input_modalities, vec!["text", "image"]);
        assert!(mapped.supports_personality);
        assert_eq!(mapped.default_reasoning_effort, "minimal");
        assert_eq!(
            mapped.supported_reasoning_efforts[0].reasoning_effort,
            "minimal"
        );
    }

    #[test]
    fn map_codex_model_defaults_modalities_when_runtime_omits_them() {
        let model = CodexModel {
            id: "gpt-5.4".to_string(),
            display_name: None,
            description: None,
            hidden: None,
            is_default: None,
            upgrade: None,
            availability_nux: None,
            upgrade_info: None,
            input_modalities: Vec::new(),
            supports_personality: None,
            default_reasoning_effort: None,
            supported_reasoning_efforts: Vec::new(),
        };

        let mapped = map_codex_model(model);

        assert_eq!(mapped.input_modalities, vec!["text", "image"]);
        assert!(!mapped.supports_personality);
    }

    #[test]
    fn map_skill_entries_flattens_and_sorts_skills() {
        let mapped = map_skill_entries(&[
            json!({
                "cwd": "/tmp/workspace",
                "skills": [
                    {
                        "name": "repo-skill",
                        "path": "/tmp/workspace/.codex/repo-skill",
                        "description": "Repo-local skill",
                        "enabled": true,
                        "scope": "repo"
                    },
                    {
                        "name": "user-skill",
                        "path": "/Users/panes/.codex/user-skill",
                        "description": "User skill",
                        "enabled": true,
                        "scope": "user"
                    }
                ],
                "errors": []
            }),
            json!({
                "cwd": "/tmp/workspace",
                "skills": [
                    {
                        "name": "repo-skill",
                        "path": "/tmp/workspace/.codex/repo-skill",
                        "description": "Repo-local skill",
                        "enabled": true,
                        "scope": "repo"
                    }
                ],
                "errors": []
            }),
        ]);

        assert_eq!(
            mapped
                .iter()
                .map(|skill| (skill.scope.as_str(), skill.name.as_str()))
                .collect::<Vec<_>>(),
            vec![("repo", "repo-skill"), ("user", "user-skill")]
        );
    }

    #[test]
    fn map_plugin_marketplaces_prefers_display_metadata() {
        let mapped = map_plugin_marketplaces(&json!({
            "marketplaces": [
                {
                    "name": "default",
                    "path": "/tmp/plugins",
                    "plugins": [
                        {
                            "id": "deploy",
                            "name": "deploy",
                            "enabled": true,
                            "installed": true,
                            "interface": {
                                "displayName": "Deploy Helper",
                                "developerName": "OpenAI",
                                "shortDescription": "Ship builds faster",
                                "capabilities": ["composer", "review"]
                            }
                        }
                    ]
                }
            ]
        }));

        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].plugins[0].name, "Deploy Helper");
        assert_eq!(
            mapped[0].plugins[0].developer_name.as_deref(),
            Some("OpenAI")
        );
        assert_eq!(
            mapped[0].plugins[0].capabilities,
            vec!["composer".to_string(), "review".to_string()]
        );
    }

    #[test]
    fn map_config_state_uses_layers_and_structured_values() {
        let mapped = map_config_state(&json!({
            "config": {
                "model": "gpt-5.4",
                "model_provider": "openai",
                "service_tier": "flex",
                "approval_policy": {
                    "reject": {
                        "mcp_elicitations": true,
                        "rules": false,
                        "sandbox_approval": false
                    }
                },
                "sandbox_mode": "workspace-write",
                "web_search": "enabled",
                "profile": "default"
            },
            "layers": [
                {
                    "name": {
                        "type": "user",
                        "file": "/Users/panes/.codex/config.toml"
                    },
                    "version": "v2",
                    "config": {}
                }
            ],
            "origins": {}
        }));

        assert_eq!(mapped.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(mapped.model_provider.as_deref(), Some("openai"));
        assert_eq!(mapped.service_tier.as_deref(), Some("flex"));
        assert_eq!(mapped.sandbox_mode.as_deref(), Some("workspace-write"));
        assert_eq!(mapped.web_search.as_deref(), Some("enabled"));
        assert_eq!(mapped.profile.as_deref(), Some("default"));
        assert_eq!(mapped.layers.len(), 1);
        assert_eq!(
            mapped.layers[0].source,
            "user:/Users/panes/.codex/config.toml"
        );
        assert_eq!(mapped.layers[0].version, "v2");
        assert!(mapped.approval_policy.is_some());
    }
}
