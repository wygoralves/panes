use std::{path::PathBuf, sync::Arc};

use anyhow::Context;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

use crate::{
    engines::{
        claude_sidecar::ClaudeSidecarEngine,
        codex::{CodexEngine, CodexForkedThread, CodexReviewStarted},
        opencode::OpenCodeEngine,
    },
    models::{
        CodexAppDto, CodexSkillDto, EngineCapabilitiesDto, EngineHealthDto, EngineInfoDto,
        EngineModelAvailabilityNuxDto, EngineModelDto, EngineModelUpgradeInfoDto,
        OpenCodeRuntimeCatalogDto, ReasoningEffortOptionDto, ThreadDto,
    },
};

pub mod api_direct;
pub mod claude_sidecar;
pub mod codex;
pub mod codex_event_mapper;
pub mod codex_protocol;
pub mod codex_transport;
pub mod events;
pub mod opencode;

pub use codex::CodexRuntimeEvent;
pub use events::*;

#[derive(Debug, Clone, PartialEq)]
pub struct ApprovalRequestRoute {
    pub server_method: String,
    pub raw_request_id: Value,
}

#[derive(Debug, Clone)]
pub enum ThreadScope {
    Repo {
        repo_path: String,
    },
    Workspace {
        root_path: String,
        writable_roots: Vec<String>,
    },
}

#[derive(Debug, Clone)]
pub struct SandboxPolicy {
    pub writable_roots: Vec<String>,
    pub allow_network: bool,
    pub approval_policy: Option<Value>,
    pub reasoning_effort: Option<String>,
    pub sandbox_mode: Option<String>,
    pub service_tier: Option<String>,
    pub personality: Option<String>,
    pub output_schema: Option<Value>,
    pub opencode_agent: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub hidden: bool,
    pub is_default: bool,
    pub upgrade: Option<String>,
    pub availability_nux: Option<ModelAvailabilityNux>,
    pub upgrade_info: Option<ModelUpgradeInfo>,
    pub input_modalities: Vec<String>,
    pub attachment_modalities: Vec<String>,
    pub limits: Option<ModelLimits>,
    pub supports_personality: bool,
    pub default_reasoning_effort: String,
    pub supported_reasoning_efforts: Vec<ReasoningEffortOption>,
}

#[derive(Debug, Clone, Default)]
pub struct ModelLimits {
    pub context_tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ReasoningEffortOption {
    pub reasoning_effort: String,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct ModelAvailabilityNux {
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ModelUpgradeInfo {
    pub model: String,
    pub upgrade_copy: Option<String>,
    pub model_link: Option<String>,
    pub migration_markdown: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct EngineCapabilities {
    pub permission_modes: &'static [&'static str],
    pub sandbox_modes: &'static [&'static str],
    pub approval_decisions: &'static [&'static str],
}

const CODEX_CAPABILITIES: EngineCapabilities = EngineCapabilities {
    permission_modes: &["untrusted", "on-failure", "on-request", "never"],
    sandbox_modes: &["read-only", "workspace-write", "danger-full-access"],
    approval_decisions: &["accept", "decline", "cancel", "accept_for_session"],
};

const CLAUDE_CAPABILITIES: EngineCapabilities = EngineCapabilities {
    permission_modes: &["restricted", "standard", "trusted"],
    sandbox_modes: &["read-only", "workspace-write"],
    approval_decisions: &["accept", "decline", "accept_for_session"],
};

const OPENCODE_CAPABILITIES: EngineCapabilities = EngineCapabilities {
    permission_modes: &["ask", "allow", "deny"],
    sandbox_modes: &[],
    approval_decisions: &["accept", "decline", "cancel", "accept_for_session"],
};

pub fn capabilities_for_engine(engine_id: &str) -> EngineCapabilities {
    match engine_id {
        "claude" => CLAUDE_CAPABILITIES,
        "codex" => CODEX_CAPABILITIES,
        "opencode" => OPENCODE_CAPABILITIES,
        _ => EngineCapabilities {
            permission_modes: &[],
            sandbox_modes: &[],
            approval_decisions: &[],
        },
    }
}

pub fn engine_supports_sandbox_mode(engine_id: &str, sandbox_mode: &str) -> bool {
    capabilities_for_engine(engine_id)
        .sandbox_modes
        .contains(&sandbox_mode)
}

pub fn validate_engine_sandbox_mode(
    engine_id: &str,
    sandbox_mode: Option<&str>,
) -> Result<(), String> {
    let Some(sandbox_mode) = sandbox_mode else {
        return Ok(());
    };

    if engine_supports_sandbox_mode(engine_id, sandbox_mode) {
        return Ok(());
    }

    let supported = capabilities_for_engine(engine_id).sandbox_modes.join(", ");
    let engine_name = if engine_id.eq_ignore_ascii_case("claude") {
        "Claude"
    } else {
        "engine"
    };

    Err(format!(
        "{engine_name} sandbox mode `{sandbox_mode}` is not supported. expected one of: {supported}"
    ))
}

pub fn normalize_approval_response_for_engine(
    engine_id: &str,
    response: Value,
) -> Result<Value, String> {
    if engine_id == "opencode" {
        return normalize_opencode_approval_response(response);
    }

    if engine_id != "claude" {
        return Ok(response);
    }

    let object = response
        .as_object()
        .ok_or_else(|| "Claude approval response must be a JSON object".to_string())?;

    if object.contains_key("answers") && object.len() == 1 {
        return Ok(response);
    }

    if object.len() != 1 {
        return Err(
            "Claude approval response must include either only an explicit `decision` field or only an `answers` object".to_string(),
        );
    }

    let raw_decision = object
        .get("decision")
        .or_else(|| object.get("action"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(raw_decision) = raw_decision {
        let normalized_decision =
            normalize_claude_approval_decision(raw_decision).or_else(|| {
                if raw_decision.eq_ignore_ascii_case("cancel") {
                    Some("decline")
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                "unsupported Claude approval decision. expected one of: accept, decline, deny, accept_for_session"
                    .to_string()
            })?;

        return Ok(json!({ "decision": normalized_decision }));
    }

    Err(
        "Claude approval response must include either an explicit `decision` field or an `answers` object".to_string(),
    )
}

fn normalize_opencode_approval_response(response: Value) -> Result<Value, String> {
    let object = response
        .as_object()
        .ok_or_else(|| "OpenCode approval response must be a JSON object".to_string())?;

    if object.contains_key("answers") {
        if object.len() != 1 {
            return Err(
                "OpenCode question response must include only an `answers` object".to_string(),
            );
        }
        return Ok(response);
    }

    if object.len() != 1 {
        return Err(
            "OpenCode approval response must include either only a `decision` field or only an `answers` object".to_string(),
        );
    }

    let raw_decision = object
        .get("decision")
        .or_else(|| object.get("action"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "OpenCode approval response must include either a `decision` field or an `answers` object"
                .to_string()
        })?;

    let normalized_decision = match raw_decision
        .to_lowercase()
        .replace(['-', '_'], "")
        .as_str()
    {
        "accept" => "accept",
        "decline" | "deny" => "decline",
        "cancel" => "cancel",
        "acceptforsession" => "accept_for_session",
        _ => {
            return Err(
                "unsupported OpenCode approval decision. expected one of: accept, decline, cancel, accept_for_session"
                    .to_string(),
            )
        }
    };

    Ok(json!({ "decision": normalized_decision }))
}

pub fn approval_response_route_for_engine(
    engine_id: &str,
    details: &Value,
) -> Option<ApprovalRequestRoute> {
    match engine_id {
        "codex" => codex_event_mapper::extract_persisted_approval_route(details),
        "opencode" => opencode::extract_persisted_approval_route(details),
        _ => None,
    }
}

pub fn normalize_claude_approval_decision(value: &str) -> Option<&'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_lowercase();
    let compact = normalized.replace(['-', '_'], "");
    match compact.as_str() {
        "accept" => Some("accept"),
        "decline" | "deny" => Some("decline"),
        "acceptforsession" => Some("accept_for_session"),
        _ => None,
    }
}

fn map_engine_capabilities(capabilities: EngineCapabilities) -> EngineCapabilitiesDto {
    EngineCapabilitiesDto {
        permission_modes: capabilities
            .permission_modes
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        sandbox_modes: capabilities
            .sandbox_modes
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        approval_decisions: capabilities
            .approval_decisions
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
    }
}

#[derive(Debug, Clone)]
pub struct EngineThread {
    pub engine_thread_id: String,
}

#[derive(Debug, Clone)]
pub struct ThreadSyncSnapshot {
    pub title: Option<String>,
    pub preview: Option<String>,
    pub raw_status: Option<String>,
    pub active_flags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CodexRemoteThreadSummary {
    pub engine_thread_id: String,
    pub title: Option<String>,
    pub preview: String,
    pub cwd: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub model_provider: String,
    pub source_kind: String,
    pub status_type: String,
    pub active_flags: Vec<String>,
    pub archived: bool,
}

#[derive(Debug, Clone)]
pub struct OpenCodeRemoteSessionSummary {
    pub engine_thread_id: String,
    pub title: Option<String>,
    pub cwd: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
}

#[derive(Debug, Clone)]
pub struct TurnAttachment {
    pub file_name: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TurnInput {
    pub message: String,
    pub attachments: Vec<TurnAttachment>,
    pub plan_mode: bool,
    pub input_items: Vec<TurnInputItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TurnInputItem {
    Text { text: String },
    Skill { name: String, path: String },
    Mention { name: String, path: String },
}

#[async_trait]
pub trait Engine: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn models(&self) -> Vec<ModelInfo>;

    async fn is_available(&self) -> bool;

    async fn start_thread(
        &self,
        scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error>;

    async fn send_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error>;

    async fn steer_message(
        &self,
        engine_thread_id: &str,
        input: TurnInput,
    ) -> Result<(), anyhow::Error>;

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
        route: Option<ApprovalRequestRoute>,
    ) -> Result<(), anyhow::Error>;

    async fn interrupt(&self, engine_thread_id: &str) -> Result<(), anyhow::Error>;

    async fn archive_thread(&self, engine_thread_id: &str) -> Result<(), anyhow::Error>;

    async fn unarchive_thread(&self, engine_thread_id: &str) -> Result<(), anyhow::Error>;
}

pub struct EngineManager {
    codex: Arc<CodexEngine>,
    claude: Arc<ClaudeSidecarEngine>,
    opencode: Arc<OpenCodeEngine>,
}

impl EngineManager {
    pub fn new() -> Self {
        Self {
            codex: Arc::new(CodexEngine::default()),
            claude: Arc::new(ClaudeSidecarEngine::default()),
            opencode: Arc::new(OpenCodeEngine::default()),
        }
    }

    pub fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        self.claude.set_resource_dir(resource_dir);
    }

    pub async fn list_engines(&self) -> anyhow::Result<Vec<EngineInfoDto>> {
        let codex_models = match timeout(Duration::from_secs(4), self.codex.list_models_runtime())
            .await
        {
            Ok(models) => models,
            Err(_) => {
                log::warn!(
                        "timed out loading codex runtime models; falling back to cached or static model catalog"
                    );
                self.codex.runtime_model_fallback().await
            }
        };
        let claude_models = self.claude.models();
        let opencode_models = match timeout(
            Duration::from_secs(4),
            self.opencode.list_models_runtime(),
        )
        .await
        {
            Ok(models) => models,
            Err(_) => {
                log::warn!("timed out loading opencode runtime models; falling back to static model catalog");
                self.opencode.models()
            }
        };

        Ok(vec![
            EngineInfoDto {
                id: self.codex.id().to_string(),
                name: self.codex.name().to_string(),
                models: codex_models.into_iter().map(map_model_info).collect(),
                capabilities: map_engine_capabilities(capabilities_for_engine(self.codex.id())),
            },
            EngineInfoDto {
                id: self.claude.id().to_string(),
                name: self.claude.name().to_string(),
                models: claude_models.into_iter().map(map_model_info).collect(),
                capabilities: map_engine_capabilities(capabilities_for_engine(self.claude.id())),
            },
            EngineInfoDto {
                id: self.opencode.id().to_string(),
                name: self.opencode.name().to_string(),
                models: opencode_models.into_iter().map(map_model_info).collect(),
                capabilities: map_engine_capabilities(capabilities_for_engine(self.opencode.id())),
            },
        ])
    }

    pub async fn health(&self, engine_id: &str) -> anyhow::Result<EngineHealthDto> {
        match engine_id {
            "codex" => {
                let report = self.codex.health_report().await;
                Ok(EngineHealthDto {
                    id: "codex".to_string(),
                    available: report.available,
                    version: report.version,
                    details: report.details,
                    warnings: report.warnings,
                    checks: report.checks,
                    fixes: report.fixes,
                    protocol_diagnostics: report.protocol_diagnostics,
                })
            }
            "claude" => {
                let report = self.claude.health_report().await;
                Ok(EngineHealthDto {
                    id: "claude".to_string(),
                    available: report.available,
                    version: report.version,
                    details: Some(report.details),
                    warnings: report.warnings,
                    checks: report.checks,
                    fixes: report.fixes,
                    protocol_diagnostics: None,
                })
            }
            "opencode" => {
                let report = self.opencode.health_report().await;
                Ok(EngineHealthDto {
                    id: "opencode".to_string(),
                    available: report.available,
                    version: report.version,
                    details: report.details,
                    warnings: report.warnings,
                    checks: report.checks,
                    fixes: report.fixes,
                    protocol_diagnostics: None,
                })
            }
            _ => anyhow::bail!("unknown engine: {engine_id}"),
        }
    }

    pub async fn prewarm(&self, engine_id: &str) -> anyhow::Result<()> {
        match engine_id {
            "codex" => self.codex.prewarm().await,
            "claude" => self.claude.prewarm().await,
            "opencode" => self.opencode.prewarm().await,
            _ => anyhow::bail!("unknown engine: {engine_id}"),
        }
    }

    pub async fn list_codex_skills(&self, cwd: &str) -> anyhow::Result<Vec<CodexSkillDto>> {
        self.codex.list_skills(cwd).await
    }

    pub async fn list_codex_apps(&self) -> anyhow::Result<Vec<CodexAppDto>> {
        self.codex.list_apps().await
    }

    pub async fn opencode_runtime_catalog(
        &self,
        cwd: &str,
    ) -> anyhow::Result<OpenCodeRuntimeCatalogDto> {
        self.opencode.runtime_catalog(cwd).await
    }

    pub async fn fork_codex_thread(
        &self,
        engine_thread_id: &str,
        cwd: &str,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> anyhow::Result<CodexForkedThread> {
        self.codex
            .fork_thread(engine_thread_id, cwd, model, sandbox)
            .await
    }

    pub async fn rollback_codex_thread(
        &self,
        engine_thread_id: &str,
        num_turns: u32,
    ) -> anyhow::Result<ThreadSyncSnapshot> {
        self.codex
            .rollback_thread(engine_thread_id, num_turns)
            .await
    }

    pub async fn compact_codex_thread(&self, engine_thread_id: &str) -> anyhow::Result<()> {
        self.codex.compact_thread(engine_thread_id).await
    }

    pub async fn archive_codex_thread(&self, engine_thread_id: &str) -> anyhow::Result<()> {
        self.codex.archive_thread(engine_thread_id).await
    }

    pub async fn list_codex_remote_threads(
        &self,
        search_term: Option<&str>,
        archived: Option<bool>,
    ) -> anyhow::Result<Vec<CodexRemoteThreadSummary>> {
        self.codex.list_threads(search_term, archived).await
    }

    pub async fn read_codex_remote_thread(
        &self,
        engine_thread_id: &str,
    ) -> anyhow::Result<CodexRemoteThreadSummary> {
        self.codex.read_remote_thread(engine_thread_id).await
    }

    pub async fn unarchive_codex_remote_thread(
        &self,
        engine_thread_id: &str,
    ) -> anyhow::Result<()> {
        self.codex.unarchive_remote_thread(engine_thread_id).await
    }

    pub async fn list_opencode_remote_sessions(
        &self,
        cwd: &str,
        search_term: Option<&str>,
        archived: Option<bool>,
    ) -> anyhow::Result<Vec<OpenCodeRemoteSessionSummary>> {
        self.opencode
            .list_sessions(cwd, search_term, archived)
            .await
    }

    pub async fn read_opencode_remote_session(
        &self,
        cwd: &str,
        engine_thread_id: &str,
    ) -> anyhow::Result<OpenCodeRemoteSessionSummary> {
        self.opencode.read_session(cwd, engine_thread_id).await
    }

    pub async fn archive_opencode_remote_session(
        &self,
        cwd: &str,
        engine_thread_id: &str,
    ) -> anyhow::Result<()> {
        self.opencode
            .set_session_archived(cwd, engine_thread_id, true)
            .await
    }

    pub async fn unarchive_opencode_remote_session(
        &self,
        cwd: &str,
        engine_thread_id: &str,
    ) -> anyhow::Result<()> {
        self.opencode
            .set_session_archived(cwd, engine_thread_id, false)
            .await
    }

    pub async fn forget_opencode_session(&self, engine_thread_id: &str) {
        self.opencode.forget_session(engine_thread_id).await;
    }

    pub async fn start_codex_review(
        &self,
        source_engine_thread_id: &str,
        target: Value,
        delivery: Option<&str>,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
        started_tx: oneshot::Sender<CodexReviewStarted>,
    ) -> anyhow::Result<()> {
        self.codex
            .start_review(
                source_engine_thread_id,
                target,
                delivery,
                event_tx,
                cancellation,
                started_tx,
            )
            .await
    }

    pub async fn ensure_engine_thread(
        &self,
        thread: &ThreadDto,
        model_id: Option<&str>,
        scope: ThreadScope,
        sandbox: SandboxPolicy,
    ) -> anyhow::Result<String> {
        let resume_id = thread.engine_thread_id.as_deref();
        let effective_model_id = model_id.unwrap_or(thread.model_id.as_str());

        let result = match thread.engine_id.as_str() {
            "codex" => self
                .codex
                .start_thread(scope, resume_id, effective_model_id, sandbox)
                .await
                .context("failed to start codex thread")?,
            "claude" => self
                .claude
                .start_thread(scope, resume_id, effective_model_id, sandbox)
                .await
                .context("failed to start claude thread")?,
            "opencode" => self
                .opencode
                .start_thread(scope, resume_id, effective_model_id, sandbox)
                .await
                .context("failed to start opencode thread")?,
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        };

        Ok(result.engine_thread_id)
    }

    pub async fn send_message(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
        input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> anyhow::Result<()> {
        match thread.engine_id.as_str() {
            "codex" => self
                .codex
                .send_message(engine_thread_id, input, event_tx, cancellation)
                .await
                .context("codex send_message failed"),
            "claude" => self
                .claude
                .send_message(engine_thread_id, input, event_tx, cancellation)
                .await
                .context("claude send_message failed"),
            "opencode" => self
                .opencode
                .send_message(engine_thread_id, input, event_tx, cancellation)
                .await
                .context("opencode send_message failed"),
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn steer_message(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
        input: TurnInput,
    ) -> anyhow::Result<()> {
        match thread.engine_id.as_str() {
            "codex" => self
                .codex
                .steer_message(engine_thread_id, input)
                .await
                .context("codex steer_message failed"),
            "claude" => self
                .claude
                .steer_message(engine_thread_id, input)
                .await
                .context("claude steer_message failed"),
            "opencode" => self
                .opencode
                .steer_message(engine_thread_id, input)
                .await
                .context("opencode steer_message failed"),
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn respond_to_approval(
        &self,
        thread: &ThreadDto,
        approval_id: &str,
        response: serde_json::Value,
        route: Option<ApprovalRequestRoute>,
    ) -> anyhow::Result<()> {
        match thread.engine_id.as_str() {
            "codex" => {
                self.codex
                    .respond_to_approval(approval_id, response, route)
                    .await
            }
            "claude" => {
                self.claude
                    .respond_to_approval(approval_id, response, route)
                    .await
            }
            "opencode" => {
                self.opencode
                    .respond_to_approval(approval_id, response, route)
                    .await
            }
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn interrupt(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let engine_thread_id = thread.engine_thread_id.as_deref().unwrap_or("default");
        match thread.engine_id.as_str() {
            "codex" => self.codex.interrupt(engine_thread_id).await,
            "claude" => self.claude.interrupt(engine_thread_id).await,
            "opencode" => self.opencode.interrupt(engine_thread_id).await,
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn archive_thread(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(());
        };

        match thread.engine_id.as_str() {
            "codex" => self.codex.archive_thread(engine_thread_id).await,
            "claude" => self.claude.archive_thread(engine_thread_id).await,
            "opencode" => self.opencode.archive_thread(engine_thread_id).await,
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn unarchive_thread(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(());
        };

        match thread.engine_id.as_str() {
            "codex" => self.codex.unarchive_thread(engine_thread_id).await,
            "claude" => self.claude.unarchive_thread(engine_thread_id).await,
            "opencode" => self.opencode.unarchive_thread(engine_thread_id).await,
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn codex_uses_external_sandbox(&self) -> bool {
        self.codex.uses_external_sandbox().await
    }

    pub async fn read_thread_preview(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
    ) -> Option<String> {
        match thread.engine_id.as_str() {
            "codex" => self.codex.read_thread_preview(engine_thread_id).await,
            _ => None,
        }
    }

    pub async fn set_thread_name(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
        name: &str,
    ) -> anyhow::Result<()> {
        match thread.engine_id.as_str() {
            "codex" => self.codex.set_thread_name(engine_thread_id, name).await,
            "claude" => Ok(()),
            "opencode" => Ok(()),
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub fn subscribe_codex_runtime_events(&self) -> broadcast::Receiver<CodexRuntimeEvent> {
        self.codex.subscribe_runtime_events()
    }

    pub async fn read_thread_sync_snapshot(
        &self,
        thread: &ThreadDto,
    ) -> anyhow::Result<Option<ThreadSyncSnapshot>> {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(None);
        };

        match thread.engine_id.as_str() {
            "codex" => self
                .codex
                .read_thread_sync_snapshot(engine_thread_id)
                .await
                .map(Some),
            "claude" => Ok(None),
            "opencode" => Ok(None),
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }
}

fn map_model_info(model: ModelInfo) -> EngineModelDto {
    EngineModelDto {
        id: model.id,
        display_name: model.display_name,
        description: model.description,
        hidden: model.hidden,
        is_default: model.is_default,
        upgrade: model.upgrade,
        availability_nux: model
            .availability_nux
            .map(|value| EngineModelAvailabilityNuxDto {
                message: value.message,
            }),
        upgrade_info: model.upgrade_info.map(|value| EngineModelUpgradeInfoDto {
            model: value.model,
            upgrade_copy: value.upgrade_copy,
            model_link: value.model_link,
            migration_markdown: value.migration_markdown,
        }),
        input_modalities: model.input_modalities,
        attachment_modalities: model.attachment_modalities,
        limits: model
            .limits
            .map(|limits| crate::models::EngineModelLimitsDto {
                context_tokens: limits.context_tokens,
                input_tokens: limits.input_tokens,
                output_tokens: limits.output_tokens,
            }),
        supports_personality: model.supports_personality,
        default_reasoning_effort: model.default_reasoning_effort,
        supported_reasoning_efforts: model
            .supported_reasoning_efforts
            .into_iter()
            .map(|option| ReasoningEffortOptionDto {
                reasoning_effort: option.reasoning_effort,
                description: option.description,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_capabilities_expose_supported_contract() {
        let capabilities = capabilities_for_engine("claude");

        assert_eq!(
            capabilities.permission_modes,
            &["restricted", "standard", "trusted"]
        );
        assert_eq!(
            capabilities.sandbox_modes,
            &["read-only", "workspace-write"]
        );
        assert_eq!(
            capabilities.approval_decisions,
            &["accept", "decline", "accept_for_session"]
        );
    }

    #[test]
    fn opencode_capabilities_do_not_inherit_codex_sandbox_modes() {
        let capabilities = capabilities_for_engine("opencode");

        assert_eq!(capabilities.permission_modes, &["ask", "allow", "deny"]);
        assert_eq!(capabilities.sandbox_modes, &[] as &[&str]);
        assert_eq!(
            capabilities.approval_decisions,
            &["accept", "decline", "cancel", "accept_for_session"]
        );
        assert!(validate_engine_sandbox_mode("opencode", Some("danger-full-access")).is_err());
        assert!(validate_engine_sandbox_mode("opencode", Some("workspace-write")).is_err());
    }

    #[test]
    fn validate_engine_sandbox_mode_rejects_unsupported_claude_full_access() {
        assert!(validate_engine_sandbox_mode("claude", Some("danger-full-access")).is_err());
        assert!(validate_engine_sandbox_mode("claude", Some("workspace-write")).is_ok());
    }

    #[test]
    fn normalize_claude_approval_response_rejects_missing_and_extra_fields() {
        assert!(normalize_approval_response_for_engine("claude", json!({})).is_err());
        assert!(normalize_approval_response_for_engine(
            "claude",
            json!({ "decision": "accept", "extra": true })
        )
        .is_err());
        assert!(normalize_approval_response_for_engine(
            "claude",
            json!({ "answers": {}, "decision": "accept" })
        )
        .is_err());
    }

    #[test]
    fn normalize_claude_approval_response_accepts_aliases() {
        assert_eq!(
            normalize_approval_response_for_engine("claude", json!({ "decision": "deny" }))
                .unwrap(),
            json!({ "decision": "decline" })
        );
        assert_eq!(
            normalize_approval_response_for_engine(
                "claude",
                json!({ "decision": "acceptForSession" })
            )
            .unwrap(),
            json!({ "decision": "accept_for_session" })
        );
        assert_eq!(
            normalize_approval_response_for_engine("claude", json!({ "action": "decline" }))
                .unwrap(),
            json!({ "decision": "decline" })
        );
        assert_eq!(
            normalize_approval_response_for_engine("claude", json!({ "action": "cancel" }))
                .unwrap(),
            json!({ "decision": "decline" })
        );
    }

    #[test]
    fn normalize_claude_approval_response_accepts_questionnaire_answers() {
        assert_eq!(
            normalize_approval_response_for_engine(
                "claude",
                json!({
                    "answers": {
                        "question-1": { "answers": ["Use pnpm"] }
                    }
                })
            )
            .unwrap(),
            json!({
                "answers": {
                    "question-1": { "answers": ["Use pnpm"] }
                }
            })
        );
    }

    #[test]
    fn normalize_opencode_approval_response_accepts_decisions_and_questions() {
        assert_eq!(
            normalize_approval_response_for_engine("opencode", json!({ "decision": "accept" }))
                .unwrap(),
            json!({ "decision": "accept" })
        );
        assert_eq!(
            normalize_approval_response_for_engine(
                "opencode",
                json!({ "action": "acceptForSession" })
            )
            .unwrap(),
            json!({ "decision": "accept_for_session" })
        );
        assert_eq!(
            normalize_approval_response_for_engine(
                "opencode",
                json!({ "answers": { "question-0-name": { "answers": ["pnpm"] } } })
            )
            .unwrap(),
            json!({ "answers": { "question-0-name": { "answers": ["pnpm"] } } })
        );
        assert!(normalize_approval_response_for_engine(
            "opencode",
            json!({ "decision": "accept", "answers": {} })
        )
        .is_err());
    }

    #[test]
    fn approval_response_route_for_codex_requires_hidden_transport_fields() {
        assert_eq!(
            approval_response_route_for_engine(
                "codex",
                &json!({
                    "_serverMethod": "item/fileChange/requestApproval"
                })
            ),
            None
        );
        assert_eq!(
            approval_response_route_for_engine(
                "claude",
                &json!({
                    "_serverMethod": "item/fileChange/requestApproval",
                    "_rawRequestId": 42
                })
            ),
            None
        );
    }
}
