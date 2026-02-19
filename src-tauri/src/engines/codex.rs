use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Context;
use async_trait::async_trait;
use serde::Deserialize;
use tokio::{
    process::Command,
    sync::{broadcast, mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;

use super::{
    codex_event_mapper::TurnEventMapper, codex_protocol::IncomingMessage,
    codex_transport::CodexTransport, Engine, EngineEvent, EngineThread, ModelInfo,
    ReasoningEffortOption, SandboxPolicy, ThreadScope, TurnCompletionStatus,
};

const INITIALIZE_METHODS: &[&str] = &["initialize"];
const THREAD_START_METHODS: &[&str] = &["thread/start"];
const THREAD_RESUME_METHODS: &[&str] = &["thread/resume"];
const THREAD_READ_METHODS: &[&str] = &["thread/read"];
const THREAD_SET_NAME_METHODS: &[&str] = &["thread/name/set"];
const TURN_START_METHODS: &[&str] = &["turn/start"];
const TURN_INTERRUPT_METHODS: &[&str] = &["turn/interrupt"];
const COMMAND_EXEC_METHODS: &[&str] = &["command/exec"];
const MODEL_LIST_METHODS: &[&str] = &["model/list", "models/list"];

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const TURN_COMPLETION_FALLBACK_TIMEOUT: Duration = Duration::from_secs(900);

#[derive(Default)]
pub struct CodexEngine {
    state: Arc<Mutex<CodexState>>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    raw_request_id: serde_json::Value,
    method: String,
}

#[derive(Debug, Clone)]
struct ThreadRuntime {
    cwd: String,
    approval_policy: String,
    sandbox_policy: serde_json::Value,
    reasoning_effort: Option<String>,
}

#[derive(Default)]
struct CodexState {
    transport: Option<Arc<CodexTransport>>,
    initialized: bool,
    approval_requests: HashMap<String, PendingApproval>,
    active_turn_ids: HashMap<String, String>,
    thread_runtimes: HashMap<String, ThreadRuntime>,
    sandbox_probe_completed: bool,
    force_external_sandbox: bool,
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
                id: "gpt-5.3-codex".to_string(),
                display_name: "gpt-5.3-codex".to_string(),
                description: "Latest frontier agentic coding model.".to_string(),
                hidden: false,
                is_default: true,
                upgrade: None,
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
                id: "gpt-5.1-codex-mini".to_string(),
                display_name: "gpt-5.1-codex-mini".to_string(),
                description: "Optimized for codex. Cheaper, faster, but less capable.".to_string(),
                hidden: false,
                is_default: false,
                upgrade: Some("gpt-5.3-codex".to_string()),
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
        which::which("codex").is_ok()
    }

    async fn version(&self) -> Option<String> {
        if !self.is_available().await {
            return None;
        }

        let output = Command::new("codex").arg("--version").output().await.ok()?;
        if !output.status.success() {
            return None;
        }

        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    async fn start(&mut self) -> Result<(), anyhow::Error> {
        let transport = self.ensure_transport().await?;
        self.ensure_initialized(&transport).await
    }

    async fn stop(&mut self) -> Result<(), anyhow::Error> {
        let transport = {
            let mut state = self.state.lock().await;
            state.initialized = false;
            state.approval_requests.clear();
            state.active_turn_ids.clear();
            state.thread_runtimes.clear();
            state.transport.take()
        };

        if let Some(transport) = transport {
            transport.shutdown().await.ok();
        }

        Ok(())
    }

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error> {
        let transport = self.ensure_transport().await?;
        self.ensure_initialized(&transport).await?;

        let cwd = scope_cwd(&scope);
        let approval_policy = sandbox
            .approval_policy
            .clone()
            .unwrap_or_else(|| "on-request".to_string());
        let mut force_external_sandbox = self.resolve_external_sandbox_mode().await;
        if !force_external_sandbox
            && self
                .detect_workspace_write_sandbox_failure(transport.as_ref(), &cwd, &sandbox)
                .await
        {
            force_external_sandbox = true;
            self.set_force_external_sandbox(true).await;
            log::warn!("forcing external sandbox mode after workspaceWrite command probe failed");
        }
        let sandbox_mode = sandbox_mode_from_policy(&sandbox, force_external_sandbox);
        let sandbox_policy = sandbox_policy_to_json(&sandbox, force_external_sandbox);

        if let Some(existing_thread_id) = resume_engine_thread_id {
            let resume_params = serde_json::json!({
              "threadId": existing_thread_id,
              "model": model,
              "cwd": cwd.clone(),
              "approvalPolicy": approval_policy.clone(),
              "sandbox": sandbox_mode,
              "persistExtendedHistory": false,
            });

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

                    self.store_thread_runtime(
                        &engine_thread_id,
                        ThreadRuntime {
                            cwd: cwd.clone(),
                            approval_policy: approval_policy.clone(),
                            sandbox_policy: sandbox_policy.clone(),
                            reasoning_effort: sandbox.reasoning_effort.clone(),
                        },
                    )
                    .await;

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
          "experimentalRawEvents": false,
          "persistExtendedHistory": false,
        });

        let result = request_with_fallback(
            transport.as_ref(),
            THREAD_START_METHODS,
            start_params,
            DEFAULT_TIMEOUT,
        )
        .await
        .context("failed to create codex thread")?;

        let engine_thread_id = extract_thread_id(&result)
            .ok_or_else(|| anyhow::anyhow!("missing thread id in thread/start response"))?;

        self.store_thread_runtime(
            &engine_thread_id,
            ThreadRuntime {
                cwd,
                approval_policy,
                sandbox_policy,
                reasoning_effort: sandbox.reasoning_effort.clone(),
            },
        )
        .await;

        Ok(EngineThread { engine_thread_id })
    }

    async fn send_message(
        &self,
        engine_thread_id: &str,
        message: &str,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_transport().await?;
        self.ensure_initialized(&transport).await?;

        let mut mapper = TurnEventMapper::default();
        let mut subscription = transport.subscribe();
        let thread_id = engine_thread_id.to_string();

        let runtime = self.thread_runtime(&thread_id).await;
        let mut turn_params = serde_json::json!({
          "threadId": engine_thread_id,
          "input": [{
            "type": "text",
            "text": message,
            "text_elements": [],
          }],
        });

        if let Some(runtime) = runtime {
            if let Some(params) = turn_params.as_object_mut() {
                params.insert("cwd".to_string(), serde_json::Value::String(runtime.cwd));
                params.insert(
                    "approvalPolicy".to_string(),
                    serde_json::Value::String(runtime.approval_policy),
                );
                params.insert("sandboxPolicy".to_string(), runtime.sandbox_policy);
                if let Some(effort) = runtime.reasoning_effort {
                    params.insert("effort".to_string(), serde_json::Value::String(effort));
                }
            }
        }

        let transport_for_turn = transport.clone();
        let turn_task = tokio::spawn(async move {
            request_with_fallback(
                transport_for_turn.as_ref(),
                TURN_START_METHODS,
                turn_params,
                TURN_REQUEST_TIMEOUT,
            )
            .await
        });

        let mut turn_task = turn_task;
        let mut turn_request_done = false;
        let mut completion_seen = false;
        let mut expected_turn_id: Option<String> = None;
        let mut completion_fallback_deadline: Option<Instant> = None;

        while !completion_seen || !turn_request_done {
            tokio::select! {
              _ = cancellation.cancelled() => {
                self
                  .interrupt(&thread_id)
                  .await
                  .context("failed to interrupt codex turn on cancellation")?;
                return Ok(());
              }
              response = &mut turn_task, if !turn_request_done => {
                turn_request_done = true;
                let result = response.context("turn/start task join failed")??;

                if let Some(turn_id) = extract_turn_id(&result) {
                  if expected_turn_id.is_none() {
                    expected_turn_id = Some(turn_id.clone());
                  }
                  self.set_active_turn(&thread_id, &turn_id).await;
                }

                for event in mapper.map_turn_result(&result) {
                  if event_indicates_sandbox_denial(&event) {
                    self.force_external_sandbox_for_thread(&thread_id).await;
                  }
                  if matches!(event, EngineEvent::TurnCompleted { .. }) {
                    completion_seen = true;
                    self.clear_active_turn(&thread_id).await;
                  }
                  event_tx.send(event).await.ok();
                }

                if !completion_seen {
                  completion_fallback_deadline = Some(Instant::now() + TURN_COMPLETION_FALLBACK_TIMEOUT);
                }
              }
              incoming = subscription.recv() => {
                match incoming {
                  Ok(IncomingMessage::Notification { method, params }) => {
                    if !belongs_to_thread(&params, &thread_id) {
                      continue;
                    }
                    if !belongs_to_turn(&params, expected_turn_id.as_deref()) {
                      continue;
                    }

                    let normalized_method = normalize_method(&method);
                    if normalized_method == "turn/started" {
                      if let Some(turn_id) = extract_turn_id(&params) {
                        if expected_turn_id.is_none() {
                          expected_turn_id = Some(turn_id.clone());
                        }
                        self.set_active_turn(&thread_id, &turn_id).await;
                      }
                    } else if normalized_method == "turn/completed" {
                      self.clear_active_turn(&thread_id).await;
                    }

                    for event in mapper.map_notification(&method, &params) {
                      if event_indicates_sandbox_denial(&event) {
                        self.force_external_sandbox_for_thread(&thread_id).await;
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
                    if let Some(approval) = mapper.map_server_request(&id, &method, &params) {
                      log::info!(
                        "codex approval request mapped: approval_id={}, method={method}",
                        approval.approval_id
                      );
                      self
                        .register_approval_request(
                          &approval.approval_id,
                          &raw_id,
                          &approval.server_method,
                        )
                        .await;
                      event_tx.send(approval.event).await.ok();
                    } else {
                      let normalized_method = normalize_method(&method);
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
                    log::warn!("codex notification consumer lagged, skipped {skipped} messages");
                  }
                  Err(broadcast::error::RecvError::Closed) => {
                    break;
                  }
                }
              }
              _ = tokio::time::sleep(Duration::from_millis(200)), if turn_request_done && !completion_seen => {
                if let Some(deadline) = completion_fallback_deadline {
                  if Instant::now() >= deadline {
                    log::warn!(
                      "codex turn completion timeout reached for thread {thread_id}; synthesizing completion"
                    );
                    break;
                  }
                }
              }
            }
        }

        if !completion_seen {
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

        self.clear_active_turn(&thread_id).await;
        Ok(())
    }

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_transport().await?;
        self.ensure_initialized(&transport).await?;

        let pending = self.take_approval_request(approval_id).await;
        let raw_request_id = pending
            .as_ref()
            .map(|value| value.raw_request_id.clone())
            .unwrap_or_else(|| serde_json::Value::String(approval_id.to_string()));
        let method = pending.as_ref().map(|value| value.method.as_str());
        let normalized_response = normalize_approval_response(method, response);

        log::info!(
            "sending approval response to codex: approval_id={approval_id}, raw_request_id={raw_request_id}"
        );

        transport
            .respond_success(&raw_request_id, normalized_response)
            .await
            .context("failed to send approval response to codex")?;

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
}

impl CodexEngine {
    pub async fn list_models_runtime(&self) -> Vec<ModelInfo> {
        match self.fetch_models_from_server().await {
            Ok(models) if !models.is_empty() => models,
            Ok(_) => self.models(),
            Err(error) => {
                log::warn!("failed to load codex models via model/list, using fallback: {error}");
                self.models()
            }
        }
    }

    pub async fn sandbox_preflight_warning(&self) -> Option<String> {
        if self.resolve_external_sandbox_mode().await {
            Some(
                "macOS denied Codex local sandbox (`sandbox-exec`). Commands may fail unless Panes uses external sandbox mode. This is an OS/policy restriction, not a promptable permission.".to_string(),
            )
        } else {
            None
        }
    }

    pub async fn read_thread_preview(&self, engine_thread_id: &str) -> Option<String> {
        let transport = self.ensure_transport().await.ok()?;
        if self.ensure_initialized(&transport).await.is_err() {
            return None;
        }

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

    pub async fn set_thread_name(
        &self,
        engine_thread_id: &str,
        name: &str,
    ) -> Result<(), anyhow::Error> {
        let transport = self.ensure_transport().await?;
        self.ensure_initialized(&transport).await?;

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
            return Ok(self.models());
        }

        let transport = self.ensure_transport().await?;
        self.ensure_initialized(&transport).await?;

        let mut cursor: Option<String> = None;
        let mut output = Vec::new();

        loop {
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

            transport.shutdown().await.ok();
            let mut state = self.state.lock().await;
            state.transport = None;
            state.initialized = false;
            state.approval_requests.clear();
            state.active_turn_ids.clear();
            state.thread_runtimes.clear();
            state.sandbox_probe_completed = false;
            state.force_external_sandbox = false;
        }

        let transport = Arc::new(CodexTransport::spawn().await?);
        let mut state = self.state.lock().await;
        state.transport = Some(transport.clone());
        state.initialized = false;
        Ok(transport)
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

    async fn resolve_external_sandbox_mode(&self) -> bool {
        {
            let state = self.state.lock().await;
            if state.sandbox_probe_completed {
                return state.force_external_sandbox;
            }
        }

        let force_external = detect_macos_sandbox_exec_failure().await;
        if force_external {
            log::warn!(
                "detected broken macOS sandbox-exec environment; using externalSandbox for codex turns"
            );
        }

        let mut state = self.state.lock().await;
        if !state.sandbox_probe_completed {
            state.sandbox_probe_completed = true;
            state.force_external_sandbox = force_external;
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
            let probe_params = serde_json::json!({
              "command": ["/usr/bin/true"],
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
                Ok(_) => false,
                Err(error) => {
                    let error_text = error.to_string();
                    if is_sandbox_denied_error(&error_text) {
                        log::warn!("workspaceWrite command probe detected sandbox denial: {error}");
                        true
                    } else {
                        false
                    }
                }
            }
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

    async fn thread_runtime(&self, engine_thread_id: &str) -> Option<ThreadRuntime> {
        let state = self.state.lock().await;
        state.thread_runtimes.get(engine_thread_id).cloned()
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

fn map_codex_model(value: CodexModel) -> ModelInfo {
    ModelInfo {
        id: value.id.clone(),
        display_name: value.display_name.unwrap_or_else(|| value.id.clone()),
        description: value.description.unwrap_or_default(),
        hidden: value.hidden.unwrap_or(false),
        is_default: value.is_default.unwrap_or(false),
        upgrade: value.upgrade,
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

fn sandbox_mode_from_policy(
    _sandbox: &SandboxPolicy,
    force_external_sandbox: bool,
) -> &'static str {
    // `thread/start` only accepts sandbox mode enums. When local workspace sandboxing is broken
    // (common in macOS app contexts), use danger-full-access and enforce external sandboxing on
    // each `turn/start` via `sandboxPolicy`.
    if force_external_sandbox {
        "danger-full-access"
    } else {
        "workspace-write"
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
        serde_json::json!({
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
        })
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

fn is_sandbox_denied_error(error: &str) -> bool {
    let value = error.to_lowercase();
    value.contains("sandbox")
        && (value.contains("operation not permitted")
            || value.contains("sandbox denied")
            || value.contains("sandbox_apply")
            || value.contains("sandbox error"))
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
            result
                .error
                .as_deref()
                .map(is_sandbox_denied_error)
                .unwrap_or(false)
                || result
                    .output
                    .as_deref()
                    .map(is_sandbox_denied_error)
                    .unwrap_or(false)
        }
        EngineEvent::Error { message, .. } => is_sandbox_denied_error(message),
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

fn normalize_approval_response(
    method: Option<&str>,
    response: serde_json::Value,
) -> serde_json::Value {
    let Some(method) = method else {
        return response;
    };
    let normalized_method = normalize_method(method);

    if matches!(
        normalized_method.as_str(),
        "item/commandexecution/requestapproval" | "item/filechange/requestapproval"
    ) {
        if let Some(decision_object) = response
            .get("decision")
            .and_then(serde_json::Value::as_object)
        {
            if let Some(amendment) = decision_object.get("acceptWithExecpolicyAmendment") {
                return serde_json::json!({
                    "acceptWithExecpolicyAmendment": amendment,
                });
            }
        }
    }

    let mut response = response;

    if let Some(object) = response.as_object_mut() {
        if let Some(decision) = object.get("decision").and_then(serde_json::Value::as_str) {
            let normalized_decision = match normalized_method.as_str() {
                "item/commandexecution/requestapproval" | "item/filechange/requestapproval" => {
                    normalize_modern_approval_decision(decision)
                }
                "execcommandapproval" | "applypatchapproval" => {
                    normalize_legacy_approval_decision(decision)
                }
                _ => decision.to_string(),
            };

            object.insert(
                "decision".to_string(),
                serde_json::Value::String(normalized_decision),
            );
        }
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
    method.replace('.', "/").replace('_', "/").to_lowercase()
}
