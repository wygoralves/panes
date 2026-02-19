use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EngineEvent {
  TurnStarted,
  TurnCompleted { token_usage: Option<TokenUsage> },
  TextDelta { content: String },
  ThinkingDelta { content: String },
  ActionStarted {
    action_id: String,
    engine_action_id: Option<String>,
    action_type: ActionType,
    summary: String,
    details: serde_json::Value,
  },
  ActionOutputDelta {
    action_id: String,
    stream: OutputStream,
    content: String,
  },
  ActionCompleted {
    action_id: String,
    result: ActionResult,
  },
  DiffUpdated {
    diff: String,
    scope: DiffScope,
  },
  ApprovalRequested {
    approval_id: String,
    action_type: ActionType,
    summary: String,
    details: serde_json::Value,
  },
  Error {
    message: String,
    recoverable: bool,
  },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
  FileRead,
  FileWrite,
  FileEdit,
  FileDelete,
  Command,
  Git,
  Search,
  Other,
}

impl ActionType {
  pub fn as_str(&self) -> &'static str {
    match self {
      ActionType::FileRead => "file_read",
      ActionType::FileWrite => "file_write",
      ActionType::FileEdit => "file_edit",
      ActionType::FileDelete => "file_delete",
      ActionType::Command => "command",
      ActionType::Git => "git",
      ActionType::Search => "search",
      ActionType::Other => "other",
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputStream {
  Stdout,
  Stderr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffScope {
  Turn,
  File,
  Workspace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
  pub success: bool,
  pub output: Option<String>,
  pub error: Option<String>,
  pub diff: Option<String>,
  pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
  pub input: u64,
  pub output: u64,
}
