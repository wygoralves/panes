use std::time::Instant;

use anyhow::Context;
use async_trait::async_trait;
use tokio::{process::Command, sync::mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
  ActionResult, ActionType, DiffScope, Engine, EngineEvent, EngineThread, ModelInfo, OutputStream,
  SandboxPolicy, ThreadScope, TokenUsage,
};

#[derive(Default)]
pub struct CodexEngine;

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
    Ok(())
  }

  async fn stop(&mut self) -> Result<(), anyhow::Error> {
    Ok(())
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
        .unwrap_or_else(|| format!("codex-{}", Uuid::new_v4())),
    })
  }

  async fn send_message(
    &self,
    _engine_thread_id: &str,
    message: &str,
    event_tx: mpsc::Sender<EngineEvent>,
    cancellation: CancellationToken,
  ) -> Result<(), anyhow::Error> {
    let started_at = Instant::now();
    event_tx.send(EngineEvent::TurnStarted).await.ok();

    if cancellation.is_cancelled() {
      return Ok(());
    }

    event_tx
      .send(EngineEvent::ThinkingDelta {
        content: "Preparing Codex turn...".to_string(),
      })
      .await
      .ok();

    let action_id = format!("action-{}", Uuid::new_v4());
    event_tx
      .send(EngineEvent::ActionStarted {
        action_id: action_id.clone(),
        engine_action_id: None,
        action_type: ActionType::Command,
        summary: "codex app-server protocol bootstrap".to_string(),
        details: serde_json::json!({
          "message_preview": preview(message, 120),
          "status": "scaffold"
        }),
      })
      .await
      .ok();

    if cancellation.is_cancelled() {
      return Ok(());
    }

    let output = if self.is_available().await {
      let command_output = Command::new("codex")
        .arg("app-server")
        .arg("--help")
        .output()
        .await
        .context("failed to run `codex app-server --help`")?;

      let stdout = String::from_utf8_lossy(&command_output.stdout).to_string();
      let stderr = String::from_utf8_lossy(&command_output.stderr).to_string();

      if !stdout.is_empty() {
        event_tx
          .send(EngineEvent::ActionOutputDelta {
            action_id: action_id.clone(),
            stream: OutputStream::Stdout,
            content: truncate_output(stdout, 4_000),
          })
          .await
          .ok();
      }

      if !stderr.is_empty() {
        event_tx
          .send(EngineEvent::ActionOutputDelta {
            action_id: action_id.clone(),
            stream: OutputStream::Stderr,
            content: truncate_output(stderr, 2_000),
          })
          .await
          .ok();
      }

      let success = command_output.status.success();
      event_tx
        .send(EngineEvent::ActionCompleted {
          action_id,
          result: ActionResult {
            success,
            output: Some("codex app-server handshake scaffold executed".to_string()),
            error: (!success).then_some("command exited with non-zero status".to_string()),
            diff: None,
            duration_ms: started_at.elapsed().as_millis() as u64,
          },
        })
        .await
        .ok();

      success
    } else {
      event_tx
        .send(EngineEvent::ActionCompleted {
          action_id,
          result: ActionResult {
            success: false,
            output: None,
            error: Some("codex binary not found in PATH".to_string()),
            diff: None,
            duration_ms: started_at.elapsed().as_millis() as u64,
          },
        })
        .await
        .ok();
      false
    };

    let text = if output {
      "Codex engine scaffold is running. Next step is wiring full JSONL request/response streaming for turn/start and approvals."
    } else {
      "Codex CLI is not available. Install Codex and authenticate to run agent turns."
    };

    event_tx
      .send(EngineEvent::TextDelta {
        content: text.to_string(),
      })
      .await
      .ok();

    event_tx
      .send(EngineEvent::DiffUpdated {
        diff: "".to_string(),
        scope: DiffScope::Turn,
      })
      .await
      .ok();

    event_tx
      .send(EngineEvent::TurnCompleted {
        token_usage: Some(TokenUsage {
          input: message.len() as u64 / 4,
          output: text.len() as u64 / 4,
        }),
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

fn preview(input: &str, max: usize) -> String {
  if input.len() <= max {
    return input.to_string();
  }
  let mut out = input.chars().take(max).collect::<String>();
  out.push_str("...");
  out
}

fn truncate_output(input: String, max_chars: usize) -> String {
  if input.chars().count() <= max_chars {
    return input;
  }

  let mut out = input.chars().take(max_chars).collect::<String>();
  out.push_str("\n... [truncated]");
  out
}
