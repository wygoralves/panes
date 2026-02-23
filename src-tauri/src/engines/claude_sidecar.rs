use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    Engine, EngineEvent, EngineThread, ModelInfo, ReasoningEffortOption, SandboxPolicy,
    ThreadScope, TokenUsage, TurnCompletionStatus, TurnInput,
};

#[derive(Default)]
pub struct ClaudeSidecarEngine;

#[async_trait]
impl Engine for ClaudeSidecarEngine {
    fn id(&self) -> &str {
        "claude"
    }

    fn name(&self) -> &str {
        "Claude"
    }

    fn models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "claude-sonnet-4".to_string(),
            display_name: "Claude Sonnet 4".to_string(),
            description: "Claude sidecar model scaffold".to_string(),
            hidden: false,
            is_default: true,
            upgrade: None,
            default_reasoning_effort: "medium".to_string(),
            supported_reasoning_efforts: vec![
                ReasoningEffortOption {
                    reasoning_effort: "low".to_string(),
                    description: "Low reasoning effort".to_string(),
                },
                ReasoningEffortOption {
                    reasoning_effort: "medium".to_string(),
                    description: "Balanced reasoning effort".to_string(),
                },
                ReasoningEffortOption {
                    reasoning_effort: "high".to_string(),
                    description: "High reasoning effort".to_string(),
                },
            ],
        }]
    }

    async fn is_available(&self) -> bool {
        false
    }

    async fn version(&self) -> Option<String> {
        None
    }

    async fn start_thread(
        &self,
        _scope: ThreadScope,
        resume_engine_thread_id: Option<&str>,
        _model: &str,
        _sandbox: SandboxPolicy,
    ) -> Result<EngineThread, anyhow::Error> {
        Ok(EngineThread {
            engine_thread_id: resume_engine_thread_id
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("claude-{}", Uuid::new_v4())),
        })
    }

    async fn send_message(
        &self,
        _engine_thread_id: &str,
        _input: TurnInput,
        event_tx: mpsc::Sender<EngineEvent>,
        _cancellation: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        event_tx.send(EngineEvent::TurnStarted).await.ok();
        event_tx
            .send(EngineEvent::TextDelta {
                content: "Claude sidecar integration is scaffolded but not active yet.".to_string(),
            })
            .await
            .ok();
        event_tx
            .send(EngineEvent::TurnCompleted {
                token_usage: Some(TokenUsage {
                    input: 0,
                    output: 0,
                }),
                status: TurnCompletionStatus::Completed,
            })
            .await
            .ok();
        Ok(())
    }

    async fn respond_to_approval(
        &self,
        _approval_id: &str,
        _response: serde_json::Value,
    ) -> Result<(), anyhow::Error> {
        Ok(())
    }

    async fn interrupt(&self, _engine_thread_id: &str) -> Result<(), anyhow::Error> {
        Ok(())
    }
}
