use std::sync::Arc;

use anyhow::Context;
use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

use crate::{
    engines::{claude_sidecar::ClaudeSidecarEngine, codex::CodexEngine},
    models::{EngineHealthDto, EngineInfoDto, EngineModelDto, ReasoningEffortOptionDto, ThreadDto},
};

pub mod api_direct;
pub mod claude_sidecar;
pub mod codex;
pub mod codex_event_mapper;
pub mod codex_protocol;
pub mod codex_transport;
pub mod events;

pub use events::*;

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
    pub approval_policy: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub hidden: bool,
    pub is_default: bool,
    pub upgrade: Option<String>,
    pub default_reasoning_effort: String,
    pub supported_reasoning_efforts: Vec<ReasoningEffortOption>,
}

#[derive(Debug, Clone)]
pub struct ReasoningEffortOption {
    pub reasoning_effort: String,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct EngineThread {
    pub engine_thread_id: String,
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
}

#[async_trait]
pub trait Engine: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn models(&self) -> Vec<ModelInfo>;

    async fn is_available(&self) -> bool;
    async fn version(&self) -> Option<String>;

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

    async fn respond_to_approval(
        &self,
        approval_id: &str,
        response: serde_json::Value,
    ) -> Result<(), anyhow::Error>;

    async fn interrupt(&self, engine_thread_id: &str) -> Result<(), anyhow::Error>;
}

pub struct EngineManager {
    codex: Arc<CodexEngine>,
    claude: Arc<ClaudeSidecarEngine>,
}

impl EngineManager {
    pub fn new() -> Self {
        Self {
            codex: Arc::new(CodexEngine::default()),
            claude: Arc::new(ClaudeSidecarEngine::default()),
        }
    }

    pub async fn list_engines(&self) -> anyhow::Result<Vec<EngineInfoDto>> {
        let codex_models =
            match timeout(Duration::from_secs(4), self.codex.list_models_runtime()).await {
                Ok(models) => models,
                Err(_) => {
                    log::warn!(
                    "timed out loading codex runtime models; falling back to static model catalog"
                );
                    self.codex.models()
                }
            };
        let claude_models = self.claude.models();

        Ok(vec![
            EngineInfoDto {
                id: self.codex.id().to_string(),
                name: self.codex.name().to_string(),
                models: codex_models.into_iter().map(map_model_info).collect(),
            },
            EngineInfoDto {
                id: self.claude.id().to_string(),
                name: self.claude.name().to_string(),
                models: claude_models.into_iter().map(map_model_info).collect(),
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
                })
            }
            "claude" => {
                let available = self.claude.is_available().await;
                let version = self.claude.version().await;
                Ok(EngineHealthDto {
                    id: "claude".to_string(),
                    available,
                    version,
                    details: Some(
                        "Claude sidecar scaffold is present; SDK runtime wiring pending"
                            .to_string(),
                    ),
                    warnings: Vec::new(),
                    checks: Vec::new(),
                    fixes: Vec::new(),
                })
            }
            _ => anyhow::bail!("unknown engine: {engine_id}"),
        }
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
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn respond_to_approval(
        &self,
        thread: &ThreadDto,
        approval_id: &str,
        response: serde_json::Value,
    ) -> anyhow::Result<()> {
        match thread.engine_id.as_str() {
            "codex" => self.codex.respond_to_approval(approval_id, response).await,
            "claude" => self.claude.respond_to_approval(approval_id, response).await,
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
    }

    pub async fn interrupt(&self, thread: &ThreadDto) -> anyhow::Result<()> {
        let engine_thread_id = thread.engine_thread_id.as_deref().unwrap_or("default");
        match thread.engine_id.as_str() {
            "codex" => self.codex.interrupt(engine_thread_id).await,
            "claude" => self.claude.interrupt(engine_thread_id).await,
            _ => anyhow::bail!("unsupported engine_id {}", thread.engine_id),
        }
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
