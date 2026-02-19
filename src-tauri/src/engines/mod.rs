use std::sync::Arc;

use anyhow::Context;
use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    engines::{claude_sidecar::ClaudeSidecarEngine, codex::CodexEngine},
    models::{EngineHealthDto, EngineInfoDto, ThreadDto},
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
}

#[derive(Debug, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct EngineThread {
    pub engine_thread_id: String,
}

#[async_trait]
pub trait Engine: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn models(&self) -> Vec<ModelInfo>;

    async fn is_available(&self) -> bool;
    async fn version(&self) -> Option<String>;

    async fn start(&mut self) -> Result<(), anyhow::Error>;
    async fn stop(&mut self) -> Result<(), anyhow::Error>;

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
        message: &str,
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
        Ok(vec![
            EngineInfoDto {
                id: self.codex.id().to_string(),
                name: self.codex.name().to_string(),
                models: self.codex.models().into_iter().map(|m| m.id).collect(),
            },
            EngineInfoDto {
                id: self.claude.id().to_string(),
                name: self.claude.name().to_string(),
                models: self.claude.models().into_iter().map(|m| m.id).collect(),
            },
        ])
    }

    pub async fn health(&self, engine_id: &str) -> anyhow::Result<EngineHealthDto> {
        match engine_id {
            "codex" => {
                let available = self.codex.is_available().await;
                let version = self.codex.version().await;
                Ok(EngineHealthDto {
                    id: "codex".to_string(),
                    available,
                    version,
                    details: if available {
                        None
                    } else {
                        Some("`codex` executable not found in PATH".to_string())
                    },
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
                })
            }
            _ => anyhow::bail!("unknown engine: {engine_id}"),
        }
    }

    pub async fn ensure_engine_thread(
        &self,
        thread: &ThreadDto,
        scope: ThreadScope,
        sandbox: SandboxPolicy,
    ) -> anyhow::Result<String> {
        let resume_id = thread.engine_thread_id.as_deref();

        let result = match thread.engine_id.as_str() {
            "codex" => self
                .codex
                .start_thread(scope, resume_id, &thread.model_id, sandbox)
                .await
                .context("failed to start codex thread")?,
            "claude" => self
                .claude
                .start_thread(scope, resume_id, &thread.model_id, sandbox)
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
        message: &str,
        event_tx: mpsc::Sender<EngineEvent>,
        cancellation: CancellationToken,
    ) -> anyhow::Result<()> {
        match thread.engine_id.as_str() {
            "codex" => self
                .codex
                .send_message(engine_thread_id, message, event_tx, cancellation)
                .await
                .context("codex send_message failed"),
            "claude" => self
                .claude
                .send_message(engine_thread_id, message, event_tx, cancellation)
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
}
