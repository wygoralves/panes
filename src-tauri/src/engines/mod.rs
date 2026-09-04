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
pub mod instance;
pub mod opencode;

pub use codex::CodexRuntimeEvent;
pub use events::*;
pub use instance::{engine_kind, is_builtin_engine_id, EngineInstanceSettings};

use crate::config::app_config::{AppConfig, ChatProviderInstanceConfig};

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
    pub permission_profile: Option<Value>,
    pub approvals_reviewer: Option<String>,
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
    sandbox_modes: &["read-only", "workspace-write", "danger-full-access"],
    approval_decisions: &["accept", "decline", "accept_for_session"],
};

const OPENCODE_CAPABILITIES: EngineCapabilities = EngineCapabilities {
    permission_modes: &["ask", "allow", "deny"],
    sandbox_modes: &[],
    approval_decisions: &["accept", "decline", "cancel", "accept_for_session"],
};

pub fn capabilities_for_engine(engine_id: &str) -> EngineCapabilities {
    match engine_kind(engine_id) {
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
    if engine_kind(engine_id) == "opencode" {
        return normalize_opencode_approval_response(response);
    }

    if engine_kind(engine_id) != "claude" {
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
    match engine_kind(engine_id) {
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
    pub imported_messages: Vec<ImportedThreadMessage>,
}

#[derive(Debug, Clone)]
pub struct ImportedThreadMessage {
    pub role: String,
    pub content: Option<String>,
    pub blocks: Value,
    pub status: String,
    pub turn_engine_id: Option<String>,
    pub turn_model_id: Option<String>,
    pub turn_reasoning_effort: Option<String>,
    pub token_input: u64,
    pub token_output: u64,
    pub created_at: Option<String>,
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

    /// Whether `steer_message` can inject input into a running turn.
    fn supports_steering(&self) -> bool {
        false
    }

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
    /// Extra provider instances configured by the user, keyed by engine id.
    instances: tokio::sync::RwLock<Vec<EngineHandle>>,
    /// Merged runtime events from every Codex instance.
    codex_runtime_events: broadcast::Sender<CodexRuntimeEvent>,
    runtime_bridge_started: std::sync::atomic::AtomicBool,
    resource_dir: std::sync::Mutex<Option<PathBuf>>,
}

#[derive(Clone)]
pub enum EngineHandle {
    Codex(Arc<CodexEngine>),
    Claude(Arc<ClaudeSidecarEngine>),
    OpenCode(Arc<OpenCodeEngine>),
}

impl EngineHandle {
    pub fn engine(&self) -> &dyn Engine {
        match self {
            EngineHandle::Codex(engine) => engine.as_ref(),
            EngineHandle::Claude(engine) => engine.as_ref(),
            EngineHandle::OpenCode(engine) => engine.as_ref(),
        }
    }

    pub fn id(&self) -> &str {
        self.engine().id()
    }

    pub fn kind(&self) -> &'static str {
        match self {
            EngineHandle::Codex(_) => "codex",
            EngineHandle::Claude(_) => "claude",
            EngineHandle::OpenCode(_) => "opencode",
        }
    }

    async fn load_models(&self) -> Vec<ModelInfo> {
        match self {
            EngineHandle::Codex(engine) => {
                match timeout(Duration::from_secs(4), engine.list_models_runtime()).await {
                    Ok(models) => models,
                    Err(_) => {
                        log::warn!(
                            "timed out loading codex runtime models for {}; falling back to cached or static model catalog",
                            engine.id()
                        );
                        engine.runtime_model_fallback().await
                    }
                }
            }
            EngineHandle::Claude(engine) => {
                match timeout(Duration::from_secs(12), engine.list_models_runtime()).await {
                    Ok(models) => models,
                    Err(_) => {
                        log::warn!(
                            "timed out loading Claude runtime models for {}, falling back to the cached or default catalog",
                            engine.id()
                        );
                        engine.runtime_model_fallback().await
                    }
                }
            }
            EngineHandle::OpenCode(engine) => {
                match timeout(Duration::from_secs(4), engine.list_models_runtime()).await {
                    Ok(models) => models,
                    Err(_) => {
                        log::warn!("timed out loading opencode runtime models; falling back to static model catalog");
                        engine.models()
                    }
                }
            }
        }
    }

    async fn cached_models(&self) -> Vec<ModelInfo> {
        match self {
            EngineHandle::Codex(engine) => engine.runtime_model_fallback().await,
            EngineHandle::Claude(engine) => engine.runtime_model_fallback().await,
            EngineHandle::OpenCode(engine) => engine.runtime_model_fallback().await,
        }
    }

    async fn info(&self) -> EngineInfoDto {
        let models = self.load_models().await;
        EngineInfoDto {
            id: self.id().to_string(),
            kind: self.kind().to_string(),
            name: self.engine().name().to_string(),
            models: models.into_iter().map(map_model_info).collect(),
            capabilities: map_engine_capabilities(capabilities_for_engine(self.id())),
        }
    }

    async fn health(&self) -> EngineHealthDto {
        match self {
            EngineHandle::Codex(engine) => {
                let report = engine.health_report().await;
                EngineHealthDto {
                    id: engine.id().to_string(),
                    available: report.available,
                    version: report.version,
                    details: report.details,
                    warnings: report.warnings,
                    checks: report.checks,
                    fixes: report.fixes,
                    protocol_diagnostics: report.protocol_diagnostics,
                }
            }
            EngineHandle::Claude(engine) => {
                let report = engine.health_report().await;
                EngineHealthDto {
                    id: engine.id().to_string(),
                    available: report.available,
                    version: report.version,
                    details: Some(report.details),
                    warnings: report.warnings,
                    checks: report.checks,
                    fixes: report.fixes,
                    protocol_diagnostics: None,
                }
            }
            EngineHandle::OpenCode(engine) => {
                let report = engine.health_report().await;
                EngineHealthDto {
                    id: engine.id().to_string(),
                    available: report.available,
                    version: report.version,
                    details: report.details,
                    warnings: report.warnings,
                    checks: report.checks,
                    fixes: report.fixes,
                    protocol_diagnostics: None,
                }
            }
        }
    }

    async fn prewarm(&self) -> anyhow::Result<()> {
        match self {
            EngineHandle::Codex(engine) => engine.prewarm().await,
            EngineHandle::Claude(engine) => engine.prewarm().await,
            EngineHandle::OpenCode(engine) => engine.prewarm().await,
        }
    }
}

impl Default for EngineManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineManager {
    pub fn new() -> Self {
        let (codex_runtime_events, _) = broadcast::channel(256);
        Self {
            codex: Arc::new(CodexEngine::default()),
            claude: Arc::new(ClaudeSidecarEngine::default()),
            opencode: Arc::new(OpenCodeEngine::default()),
            instances: tokio::sync::RwLock::new(Vec::new()),
            codex_runtime_events,
            runtime_bridge_started: std::sync::atomic::AtomicBool::new(false),
            resource_dir: std::sync::Mutex::new(None),
        }
    }

    /// Builds the manager with the chat provider instances from config.
    /// Construction never spawns processes, so this is safe outside a runtime.
    pub fn from_config(config: &AppConfig) -> Self {
        let mut manager = Self::new();
        let providers = config.chat_providers();
        let mut instances = Vec::new();
        for entry in &providers {
            manager.apply_builtin_overrides_sync(entry);
            if let Some(handle) = manager.build_instance(entry) {
                instances.push(handle);
            }
        }
        *manager.instances.get_mut() = instances;
        manager
    }

    fn apply_builtin_overrides_sync(&self, entry: &ChatProviderInstanceConfig) {
        if !entry.is_builtin() {
            return;
        }
        let settings = EngineInstanceSettings::from_config(entry);
        match entry.kind.as_str() {
            "codex" => {
                if let Ok(mut current) = self.codex.instance_settings_slot().lock() {
                    *current = settings;
                }
            }
            "claude" => {
                if let Ok(mut current) = self.claude.instance_settings_slot().lock() {
                    *current = settings;
                }
            }
            _ => {}
        }
    }

    fn build_instance(&self, entry: &ChatProviderInstanceConfig) -> Option<EngineHandle> {
        if entry.is_builtin() || !entry.enabled {
            return None;
        }
        let settings = EngineInstanceSettings::from_config(entry);
        let name = entry.display_name.trim();
        match entry.kind.as_str() {
            "codex" => Some(EngineHandle::Codex(Arc::new(CodexEngine::with_instance(
                &entry.id, name, settings,
            )))),
            "claude" => {
                let engine = ClaudeSidecarEngine::with_instance(&entry.id, name, settings);
                if let Ok(resource_dir) = self.resource_dir.lock() {
                    engine.set_resource_dir_blocking_free(resource_dir.clone());
                }
                Some(EngineHandle::Claude(Arc::new(engine)))
            }
            _ => None,
        }
    }

    /// Reconciles the running instances with the configured entries: new
    /// entries are added, changed ones updated in place, removed or disabled
    /// ones dropped (which shuts their processes down).
    pub async fn apply_chat_providers(&self, providers: &[ChatProviderInstanceConfig]) {
        for entry in providers {
            if !entry.is_builtin() {
                continue;
            }
            let settings = EngineInstanceSettings::from_config(entry);
            match entry.kind.as_str() {
                "codex" => self.codex.update_instance_settings(settings).await,
                "claude" => self.claude.update_instance_settings(settings).await,
                _ => {}
            }
        }
        let builtin_kinds_configured: Vec<&str> = providers
            .iter()
            .filter(|entry| entry.is_builtin())
            .map(|entry| entry.kind.as_str())
            .collect();
        if !builtin_kinds_configured.contains(&"codex") {
            self.codex
                .update_instance_settings(EngineInstanceSettings::default())
                .await;
        }
        if !builtin_kinds_configured.contains(&"claude") {
            self.claude
                .update_instance_settings(EngineInstanceSettings::default())
                .await;
        }

        let mut instances = self.instances.write().await;
        let mut next = Vec::new();
        for entry in providers {
            if entry.is_builtin() || !entry.enabled {
                continue;
            }
            let settings = EngineInstanceSettings::from_config(entry);
            let existing = instances
                .iter()
                .find(|handle| handle.id() == entry.id && handle.kind() == entry.kind)
                .cloned();
            let display_name_matches = existing
                .as_ref()
                .map(|handle| handle.engine().name() == entry.display_name.trim())
                .unwrap_or(false);
            match existing {
                Some(handle) if display_name_matches => {
                    match &handle {
                        EngineHandle::Codex(engine) => {
                            engine.update_instance_settings(settings).await
                        }
                        EngineHandle::Claude(engine) => {
                            engine.update_instance_settings(settings).await
                        }
                        EngineHandle::OpenCode(_) => {}
                    }
                    next.push(handle);
                }
                _ => {
                    if let Some(handle) = self.build_instance(entry) {
                        if let EngineHandle::Codex(engine) = &handle {
                            self.forward_codex_runtime_events(engine.clone());
                        }
                        next.push(handle);
                    }
                }
            }
        }
        *instances = next;
    }

    /// Records the bundled resource dir and hands it to every Claude engine,
    /// including extra instances built from config before the app resolved
    /// its resource dir. Packaged builds have no dev sidecar path, so an
    /// instance without the resource dir cannot find the sidecar and reads
    /// as unavailable.
    pub async fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        if let Ok(mut current) = self.resource_dir.lock() {
            *current = resource_dir.clone();
        }
        self.claude.set_resource_dir(resource_dir.clone()).await;
        let instances = self.instances.read().await;
        for handle in instances.iter() {
            if let EngineHandle::Claude(engine) = handle {
                engine.set_resource_dir(resource_dir.clone()).await;
            }
        }
    }

    /// Engine handles in display order: the built-in engines first, then the
    /// configured instances.
    pub async fn handles(&self) -> Vec<EngineHandle> {
        let mut handles = vec![
            EngineHandle::Codex(self.codex.clone()),
            EngineHandle::Claude(self.claude.clone()),
            EngineHandle::OpenCode(self.opencode.clone()),
        ];
        handles.extend(self.instances.read().await.iter().cloned());
        handles
    }

    /// The engine behind an exact engine id. Built-in ids map to the built-in
    /// engines; extra instance ids (`<kind>_<slug>`) resolve only to their
    /// own configured instance, never to the built-in engine of the same
    /// kind, so a disabled or removed account fails instead of silently
    /// running against the default account.
    pub async fn handle(&self, engine_id: &str) -> Option<EngineHandle> {
        match engine_id {
            "codex" => return Some(EngineHandle::Codex(self.codex.clone())),
            "claude" => return Some(EngineHandle::Claude(self.claude.clone())),
            "opencode" => return Some(EngineHandle::OpenCode(self.opencode.clone())),
            _ => {}
        }
        self.instances
            .read()
            .await
            .iter()
            .find(|handle| handle.id() == engine_id)
            .cloned()
    }

    async fn require(&self, engine_id: &str) -> anyhow::Result<EngineHandle> {
        self.handle(engine_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("unsupported engine_id {engine_id}"))
    }

    /// The Codex engine behind an engine id, falling back to the built-in
    /// instance for ids that are not Codex instances.
    pub async fn codex_engine(&self, engine_id: &str) -> Arc<CodexEngine> {
        match self.handle(engine_id).await {
            Some(EngineHandle::Codex(engine)) => engine,
            _ => self.codex.clone(),
        }
    }

    fn forward_codex_runtime_events(&self, engine: Arc<CodexEngine>) {
        if !self
            .runtime_bridge_started
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }
        let sender = self.codex_runtime_events.clone();
        tokio::spawn(async move {
            let mut receiver = engine.subscribe_runtime_events();
            loop {
                match receiver.recv().await {
                    Ok(event) => {
                        let _ = sender.send(event);
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    pub async fn models_for_validation(
        &self,
        engine_id: &str,
        requested_model_id: &str,
    ) -> anyhow::Result<Vec<ModelInfo>> {
        let handle = self.require(engine_id).await?;
        let cached_models = handle.cached_models().await;

        if cached_models
            .iter()
            .any(|model| model.id == requested_model_id)
        {
            return Ok(cached_models);
        }

        Ok(handle.load_models().await)
    }

    pub async fn list_engines(&self) -> anyhow::Result<Vec<EngineInfoDto>> {
        let handles = self.handles().await;
        let infos = futures::future::join_all(handles.iter().map(|handle| handle.info())).await;
        Ok(infos)
    }

    pub async fn chat_provider_usage(&self) -> Vec<crate::models::ChatProviderUsageDto> {
        let handles = self.handles().await;
        let futures = handles.iter().filter_map(|handle| match handle {
            EngineHandle::Codex(engine) => {
                let engine = engine.clone();
                Some(Box::pin(async move {
                    map_provider_usage(
                        engine.id(),
                        engine.name(),
                        engine.usage_limits_snapshot().await,
                    )
                })
                    as std::pin::Pin<
                        Box<
                            dyn std::future::Future<Output = crate::models::ChatProviderUsageDto>
                                + Send,
                        >,
                    >)
            }
            EngineHandle::Claude(engine) => {
                let engine = engine.clone();
                Some(Box::pin(async move {
                    map_provider_usage(
                        engine.id(),
                        engine.name(),
                        engine.usage_limits_snapshot().await,
                    )
                }))
            }
            EngineHandle::OpenCode(_) => None,
        });
        futures::future::join_all(futures).await
    }

    pub async fn health(&self, engine_id: &str) -> anyhow::Result<EngineHealthDto> {
        let handle = self
            .handle(engine_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("unknown engine: {engine_id}"))?;
        Ok(handle.health().await)
    }

    pub async fn prewarm(&self, engine_id: &str) -> anyhow::Result<()> {
        let handle = self
            .handle(engine_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("unknown engine: {engine_id}"))?;
        handle.prewarm().await
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
        engine_id: &str,
        engine_thread_id: &str,
        cwd: &str,
        model: &str,
        sandbox: SandboxPolicy,
    ) -> anyhow::Result<CodexForkedThread> {
        self.codex_engine(engine_id)
            .await
            .fork_thread(engine_thread_id, cwd, model, sandbox)
            .await
    }

    pub async fn rollback_codex_thread(
        &self,
        engine_id: &str,
        engine_thread_id: &str,
        num_turns: u32,
    ) -> anyhow::Result<ThreadSyncSnapshot> {
        self.codex_engine(engine_id)
            .await
            .rollback_thread(engine_thread_id, num_turns)
            .await
    }

    pub async fn compact_codex_thread(
        &self,
        engine_id: &str,
        engine_thread_id: &str,
    ) -> anyhow::Result<()> {
        self.codex_engine(engine_id)
            .await
            .compact_thread(engine_thread_id)
            .await
    }

    pub async fn archive_codex_thread(
        &self,
        engine_id: &str,
        engine_thread_id: &str,
    ) -> anyhow::Result<()> {
        self.codex_engine(engine_id)
            .await
            .archive_thread(engine_thread_id)
            .await
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

    #[allow(clippy::too_many_arguments)]
    pub async fn start_codex_review(
        &self,
        engine_id: &str,
        source_engine_thread_id: &str,
        target: Value,
        delivery: Option<&str>,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
        started_tx: oneshot::Sender<CodexReviewStarted>,
    ) -> anyhow::Result<()> {
        self.codex_engine(engine_id)
            .await
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
        let handle = self.require(&thread.engine_id).await?;

        let result = handle
            .engine()
            .start_thread(scope, resume_id, effective_model_id, sandbox)
            .await
            .with_context(|| format!("failed to start {} thread", handle.kind()))?;

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
        let handle = self.require(&thread.engine_id).await?;
        handle
            .engine()
            .send_message(engine_thread_id, input, event_tx, cancellation)
            .await
            .with_context(|| format!("{} send_message failed", handle.kind()))
    }

    pub async fn steer_message(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
        input: TurnInput,
    ) -> anyhow::Result<()> {
        let handle = self.require(&thread.engine_id).await?;
        handle
            .engine()
            .steer_message(engine_thread_id, input)
            .await
            .with_context(|| format!("{} steer_message failed", handle.kind()))
    }

    pub async fn supports_steering(&self, thread: &ThreadDto) -> bool {
        match self.require(&thread.engine_id).await {
            Ok(handle) => handle.engine().supports_steering(),
            Err(_) => false,
        }
    }

    pub async fn respond_to_approval(
        &self,
        thread: &ThreadDto,
        approval_id: &str,
        response: serde_json::Value,
        route: Option<ApprovalRequestRoute>,
    ) -> anyhow::Result<()> {
        let handle = self.require(&thread.engine_id).await?;
        handle
            .engine()
            .respond_to_approval(approval_id, response, route)
            .await
    }

    pub async fn interrupt(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let engine_thread_id = thread.engine_thread_id.as_deref().unwrap_or("default");
        let handle = self.require(&thread.engine_id).await?;
        handle.engine().interrupt(engine_thread_id).await
    }

    pub async fn archive_thread(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(());
        };
        let handle = self.require(&thread.engine_id).await?;
        handle.engine().archive_thread(engine_thread_id).await
    }

    pub async fn unarchive_thread(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(());
        };
        let handle = self.require(&thread.engine_id).await?;
        handle.engine().unarchive_thread(engine_thread_id).await
    }

    pub async fn codex_uses_external_sandbox(&self) -> bool {
        self.codex.uses_external_sandbox().await
    }

    pub async fn read_thread_preview(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
    ) -> Option<String> {
        match self.handle(&thread.engine_id).await {
            Some(EngineHandle::Codex(engine)) => engine.read_thread_preview(engine_thread_id).await,
            _ => None,
        }
    }

    pub async fn set_thread_name(
        &self,
        thread: &ThreadDto,
        engine_thread_id: &str,
        name: &str,
    ) -> anyhow::Result<()> {
        match self.require(&thread.engine_id).await? {
            EngineHandle::Codex(engine) => engine.set_thread_name(engine_thread_id, name).await,
            _ => Ok(()),
        }
    }

    /// Runtime events from every Codex instance, merged. Forwarding tasks
    /// start on the first call, which must happen inside a tokio runtime.
    pub fn subscribe_codex_runtime_events(&self) -> broadcast::Receiver<CodexRuntimeEvent> {
        let receiver = self.codex_runtime_events.subscribe();
        if !self
            .runtime_bridge_started
            .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            self.forward_codex_runtime_events(self.codex.clone());
            if let Ok(instances) = self.instances.try_read() {
                for handle in instances.iter() {
                    if let EngineHandle::Codex(engine) = handle {
                        self.forward_codex_runtime_events(engine.clone());
                    }
                }
            }
        }
        receiver
    }

    pub async fn read_thread_sync_snapshot(
        &self,
        thread: &ThreadDto,
    ) -> anyhow::Result<Option<ThreadSyncSnapshot>> {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(None);
        };
        match self.require(&thread.engine_id).await? {
            EngineHandle::Codex(engine) => engine
                .read_thread_sync_snapshot(engine_thread_id)
                .await
                .map(Some),
            _ => Ok(None),
        }
    }
}

fn map_provider_usage(
    engine_id: &str,
    name: &str,
    result: anyhow::Result<UsageLimitsSnapshot>,
) -> crate::models::ChatProviderUsageDto {
    let Ok(usage) = result else {
        return crate::models::ChatProviderUsageDto {
            engine_id: engine_id.to_string(),
            name: name.to_string(),
            available: false,
            windows: Vec::new(),
        };
    };

    let mut windows = Vec::new();
    let mut push_window = |kind: &str, percent: Option<u8>, resets_at: Option<i64>| {
        if let Some(used_percent) = percent {
            windows.push(crate::models::ChatProviderUsageWindowDto {
                kind: kind.to_string(),
                used_percent,
                resets_at,
            });
        }
    };
    push_window(
        "five_hour",
        usage.five_hour_percent,
        usage.five_hour_resets_at,
    );
    push_window("weekly", usage.weekly_percent, usage.weekly_resets_at);
    push_window(
        "fable_weekly",
        usage.fable_weekly_percent,
        usage.fable_weekly_resets_at,
    );
    push_window(
        "opus_weekly",
        usage.opus_weekly_percent,
        usage.opus_weekly_resets_at,
    );
    push_window(
        "sonnet_weekly",
        usage.sonnet_weekly_percent,
        usage.sonnet_weekly_resets_at,
    );

    crate::models::ChatProviderUsageDto {
        engine_id: engine_id.to_string(),
        name: name.to_string(),
        available: !windows.is_empty(),
        windows,
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
            &["read-only", "workspace-write", "danger-full-access"]
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
    fn validate_engine_sandbox_mode_accepts_every_claude_mode() {
        assert!(validate_engine_sandbox_mode("claude", Some("read-only")).is_ok());
        assert!(validate_engine_sandbox_mode("claude", Some("workspace-write")).is_ok());
        assert!(validate_engine_sandbox_mode("claude", Some("danger-full-access")).is_ok());
        assert!(validate_engine_sandbox_mode("claude", Some("unrestricted")).is_err());
    }

    #[test]
    fn provider_usage_keeps_generic_and_fable_weekly_windows_separate() {
        let provider = map_provider_usage(
            "claude",
            "Claude",
            Ok(UsageLimitsSnapshot {
                five_hour_percent: Some(12),
                weekly_percent: Some(46),
                fable_weekly_percent: Some(76),
                ..UsageLimitsSnapshot::default()
            }),
        );

        assert!(provider.available);
        assert_eq!(provider.windows.len(), 3);
        assert_eq!(provider.windows[1].kind, "weekly");
        assert_eq!(provider.windows[1].used_percent, 46);
        assert_eq!(provider.windows[2].kind, "fable_weekly");
        assert_eq!(provider.windows[2].used_percent, 76);
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

    fn provider_entry(id: &str, kind: &str, enabled: bool) -> ChatProviderInstanceConfig {
        ChatProviderInstanceConfig {
            id: id.to_string(),
            kind: kind.to_string(),
            display_name: format!("{id} account"),
            home_path: Some(format!("/tmp/panes-test-{id}")),
            enabled,
            ..ChatProviderInstanceConfig::default()
        }
    }

    #[tokio::test]
    async fn handle_resolves_extra_instances_before_builtin_kinds() {
        let config = AppConfig {
            chat_providers: vec![
                provider_entry("claude_work", "claude", true),
                provider_entry("codex_personal", "codex", true),
                provider_entry("claude_disabled", "claude", false),
            ],
            ..AppConfig::default()
        };
        let manager = EngineManager::from_config(&config);

        let work = manager.handle("claude_work").await.expect("claude_work");
        assert_eq!(work.id(), "claude_work");
        assert!(matches!(work, EngineHandle::Claude(_)));
        assert!(!Arc::ptr_eq(
            match &work {
                EngineHandle::Claude(engine) => engine,
                _ => unreachable!(),
            },
            &manager.claude
        ));

        let personal = manager
            .handle("codex_personal")
            .await
            .expect("codex_personal");
        assert_eq!(personal.id(), "codex_personal");
        assert!(matches!(personal, EngineHandle::Codex(_)));

        assert_eq!(manager.handle("claude").await.unwrap().id(), "claude");
        assert_eq!(manager.handle("codex").await.unwrap().id(), "codex");
        assert_eq!(manager.handle("opencode").await.unwrap().id(), "opencode");

        // A disabled or unknown instance must not fall back to the default
        // account of its kind.
        assert!(manager.handle("claude_disabled").await.is_none());
        assert!(manager.handle("codex_missing").await.is_none());
    }

    fn claude_engine(handle: &EngineHandle) -> &Arc<ClaudeSidecarEngine> {
        match handle {
            EngineHandle::Claude(engine) => engine,
            _ => unreachable!("expected a Claude handle"),
        }
    }

    #[tokio::test]
    async fn resource_dir_reaches_claude_instances_built_before_it_was_known() {
        let config = AppConfig {
            chat_providers: vec![provider_entry("claude_work", "claude", true)],
            ..AppConfig::default()
        };
        let manager = EngineManager::from_config(&config);
        let resource_dir = PathBuf::from("/tmp/panes-test-resources");

        manager.set_resource_dir(Some(resource_dir.clone())).await;

        let builtin = manager.handle("claude").await.expect("claude");
        assert_eq!(
            claude_engine(&builtin).resource_dir().await,
            Some(resource_dir.clone())
        );
        let work = manager.handle("claude_work").await.expect("claude_work");
        assert_eq!(
            claude_engine(&work).resource_dir().await,
            Some(resource_dir.clone())
        );

        // Instances added after the resource dir is known pick it up too.
        manager
            .apply_chat_providers(&[
                provider_entry("claude_work", "claude", true),
                provider_entry("claude_personal", "claude", true),
            ])
            .await;
        let personal = manager
            .handle("claude_personal")
            .await
            .expect("claude_personal");
        assert_eq!(
            claude_engine(&personal).resource_dir().await,
            Some(resource_dir)
        );
    }
}
