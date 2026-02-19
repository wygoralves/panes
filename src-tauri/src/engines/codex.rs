use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Context;
use async_trait::async_trait;
use tokio::{
    process::Command,
    sync::{broadcast, mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;

use super::{
    codex_event_mapper::TurnEventMapper, codex_protocol::IncomingMessage,
    codex_transport::CodexTransport, Engine, EngineEvent, EngineThread, ModelInfo, SandboxPolicy,
    ThreadScope,
};

const INITIALIZE_METHODS: &[&str] = &["initialize"];
const THREAD_START_METHODS: &[&str] = &["thread/start"];
const THREAD_RESUME_METHODS: &[&str] = &["thread/resume"];
const TURN_START_METHODS: &[&str] = &["turn/start"];
const TURN_INTERRUPT_METHODS: &[&str] = &["turn/interrupt"];

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Default)]
pub struct CodexEngine {
    state: Arc<Mutex<CodexState>>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    request_id: String,
    method: String,
}

#[derive(Debug, Clone)]
struct ThreadRuntime {
    cwd: String,
    approval_policy: String,
    sandbox_policy: serde_json::Value,
}

#[derive(Default)]
struct CodexState {
    transport: Option<Arc<CodexTransport>>,
    initialized: bool,
    approval_requests: HashMap<String, PendingApproval>,
    active_turn_ids: HashMap<String, String>,
    thread_runtimes: HashMap<String, ThreadRuntime>,
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
                id: "gpt-5-codex".to_string(),
                name: "GPT-5 Codex".to_string(),
            },
            ModelInfo {
                id: "gpt-5-codex-mini".to_string(),
                name: "GPT-5 Codex Mini".to_string(),
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
        let approval_policy = "on-request";
        let sandbox_mode = sandbox_mode_from_policy(&sandbox);
        let sandbox_policy = sandbox_policy_to_json(&sandbox);

        if let Some(existing_thread_id) = resume_engine_thread_id {
            let resume_params = serde_json::json!({
              "threadId": existing_thread_id,
              "model": model,
              "cwd": cwd.clone(),
              "approvalPolicy": approval_policy,
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
                            approval_policy: approval_policy.to_string(),
                            sandbox_policy: sandbox_policy.clone(),
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
          "approvalPolicy": approval_policy,
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
                approval_policy: approval_policy.to_string(),
                sandbox_policy,
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
        let mut post_completion_grace_deadline: Option<Instant> = None;

        while !completion_seen || !turn_request_done {
            if let Some(deadline) = post_completion_grace_deadline {
                if Instant::now() >= deadline {
                    break;
                }
            }

            tokio::select! {
              _ = cancellation.cancelled() => {
                self.interrupt(&thread_id).await.ok();
                return Ok(());
              }
              response = &mut turn_task, if !turn_request_done => {
                turn_request_done = true;
                let result = response.context("turn/start task join failed")??;

                if let Some(turn_id) = extract_turn_id(&result) {
                  self.set_active_turn(&thread_id, &turn_id).await;
                }

                for event in mapper.map_turn_result(&result) {
                  if matches!(event, EngineEvent::TurnCompleted { .. }) {
                    completion_seen = true;
                    post_completion_grace_deadline = Some(Instant::now() + Duration::from_millis(600));
                    self.clear_active_turn(&thread_id).await;
                  }
                  event_tx.send(event).await.ok();
                }

                if !completion_seen && post_completion_grace_deadline.is_none() {
                  post_completion_grace_deadline = Some(Instant::now() + Duration::from_secs(2));
                }
              }
              incoming = subscription.recv() => {
                match incoming {
                  Ok(IncomingMessage::Notification { method, params }) => {
                    if !belongs_to_thread(&params, &thread_id) {
                      continue;
                    }

                    let normalized_method = normalize_method(&method);
                    if normalized_method == "turn/started" {
                      if let Some(turn_id) = extract_turn_id(&params) {
                        self.set_active_turn(&thread_id, &turn_id).await;
                      }
                    } else if normalized_method == "turn/completed" {
                      self.clear_active_turn(&thread_id).await;
                    }

                    for event in mapper.map_notification(&method, &params) {
                      if matches!(event, EngineEvent::TurnCompleted { .. }) {
                        completion_seen = true;
                        post_completion_grace_deadline = Some(Instant::now() + Duration::from_millis(600));
                        self.clear_active_turn(&thread_id).await;
                      }
                      event_tx.send(event).await.ok();
                    }
                  }
                  Ok(IncomingMessage::Request { id, method, params }) => {
                    if !belongs_to_thread(&params, &thread_id) {
                      continue;
                    }
                    if let Some(approval) = mapper.map_server_request(&id, &method, &params) {
                      self
                        .register_approval_request(
                          &approval.approval_id,
                          &approval.server_request_id,
                          &approval.server_method,
                        )
                        .await;
                      event_tx.send(approval.event).await.ok();
                    } else {
                      let normalized_method = normalize_method(&method);
                      let (message, recoverable) = if normalized_method == "item/tool/requestuserinput" {
                        (
                          "Codex requested user input (`item/tool/requestUserInput`), but this app version does not support structured answers yet.".to_string(),
                          true,
                        )
                      } else {
                        (
                          format!("Unsupported Codex server request method `{method}`"),
                          true,
                        )
                      };

                      event_tx
                        .send(EngineEvent::Error {
                          message: message.clone(),
                          recoverable,
                        })
                        .await
                        .ok();

                      transport
                        .respond_error(
                          &id,
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
              _ = tokio::time::sleep(Duration::from_millis(100)), if turn_request_done => {}
            }
        }

        if !completion_seen {
            event_tx
                .send(EngineEvent::TurnCompleted { token_usage: None })
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
        let request_id = pending
            .as_ref()
            .map(|value| value.request_id.clone())
            .unwrap_or_else(|| approval_id.to_string());
        let method = pending.as_ref().map(|value| value.method.as_str());
        let normalized_response = normalize_approval_response(method, response);

        transport
            .respond_success(&request_id, normalized_response)
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

        let turn_id = self.active_turn_id(engine_thread_id).await;
        let params = if let Some(turn_id) = turn_id {
            serde_json::json!({
              "threadId": engine_thread_id,
              "turnId": turn_id,
            })
        } else {
            serde_json::json!({
              "threadId": engine_thread_id,
            })
        };

        match request_with_fallback(
            transport.as_ref(),
            TURN_INTERRUPT_METHODS,
            params.clone(),
            Duration::from_secs(5),
        )
        .await
        {
            Ok(_) => {
                self.clear_active_turn(engine_thread_id).await;
                Ok(())
            }
            Err(error) => {
                log::warn!(
                    "codex turn interrupt request failed, trying notification fallback: {error}"
                );
                notify_with_fallback(transport.as_ref(), TURN_INTERRUPT_METHODS, params)
                    .await
                    .context("failed to send interrupt fallback notification")
            }
        }
    }
}

impl CodexEngine {
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
        }

        let transport = Arc::new(CodexTransport::spawn().await?);
        let mut state = self.state.lock().await;
        state.transport = Some(transport.clone());
        state.initialized = false;
        Ok(transport)
    }

    async fn ensure_initialized(&self, transport: &CodexTransport) -> anyhow::Result<()> {
        let should_initialize = {
            let state = self.state.lock().await;
            !state.initialized
        };

        if !should_initialize {
            return Ok(());
        }

        let initialize_params = serde_json::json!({
          "clientInfo": {
            "name": "agent-workspace",
            "title": "Agent Workspace",
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
            .ok();

        let mut state = self.state.lock().await;
        state.initialized = true;

        Ok(())
    }

    async fn register_approval_request(&self, approval_id: &str, request_id: &str, method: &str) {
        let mut state = self.state.lock().await;
        state.approval_requests.insert(
            approval_id.to_string(),
            PendingApproval {
                request_id: request_id.to_string(),
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

async fn notify_with_fallback(
    transport: &CodexTransport,
    methods: &[&str],
    params: serde_json::Value,
) -> anyhow::Result<()> {
    let mut errors = Vec::new();

    for method in methods {
        match transport.notify(method, params.clone()).await {
            Ok(_) => return Ok(()),
            Err(error) => errors.push(format!("{method}: {error}")),
        }
    }

    anyhow::bail!("all notifications failed: {}", errors.join(" | "))
}

fn scope_cwd(scope: &ThreadScope) -> String {
    match scope {
        ThreadScope::Repo { repo_path } => repo_path.to_string(),
        ThreadScope::Workspace { root_path, .. } => root_path.to_string(),
    }
}

fn sandbox_mode_from_policy(_sandbox: &SandboxPolicy) -> &'static str {
    "workspace-write"
}

fn sandbox_policy_to_json(sandbox: &SandboxPolicy) -> serde_json::Value {
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

    false
}

fn normalize_approval_response(
    method: Option<&str>,
    response: serde_json::Value,
) -> serde_json::Value {
    let Some(method) = method else {
        return response;
    };
    let normalized_method = normalize_method(method);
    let mut response = response;

    let should_normalize_decision = matches!(
        normalized_method.as_str(),
        "item/commandexecution/requestapproval"
            | "item/filechange/requestapproval"
            | "execcommandapproval"
            | "applypatchapproval"
    );

    if should_normalize_decision {
        if let Some(object) = response.as_object_mut() {
            if let Some(decision) = object.get("decision").and_then(serde_json::Value::as_str) {
                object.insert(
                    "decision".to_string(),
                    serde_json::Value::String(normalize_approval_decision(decision)),
                );
            }
        }
    }

    response
}

fn normalize_approval_decision(value: &str) -> String {
    match value {
        "accept_for_session" => "acceptForSession".to_string(),
        "allow" => "accept".to_string(),
        "allow_session" => "acceptForSession".to_string(),
        "deny" => "decline".to_string(),
        other => other.to_string(),
    }
}

fn normalize_method(method: &str) -> String {
    method.replace('.', "/").replace('_', "/").to_lowercase()
}
