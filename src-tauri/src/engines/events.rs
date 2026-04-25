use serde::{Deserialize, Serialize};

pub const ACTION_OUTPUT_DELTA_MAX_CHARS: usize = 16 * 1024;
const ACTION_OUTPUT_DELTA_TRUNCATED_PREFIX: &str = "... [output truncated; showing tail]\n";

pub fn trim_action_output_delta_content(content: &str) -> String {
    if content.chars().count() <= ACTION_OUTPUT_DELTA_MAX_CHARS {
        return content.to_string();
    }

    let tail_chars =
        ACTION_OUTPUT_DELTA_MAX_CHARS.saturating_sub(ACTION_OUTPUT_DELTA_TRUNCATED_PREFIX.len());
    let mut tail = content
        .chars()
        .rev()
        .take(tail_chars.max(1))
        .collect::<Vec<_>>();
    tail.reverse();

    format!(
        "{}{}",
        ACTION_OUTPUT_DELTA_TRUNCATED_PREFIX,
        tail.into_iter().collect::<String>()
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EngineEvent {
    TurnStarted {
        client_turn_id: Option<String>,
    },
    TurnCompleted {
        token_usage: Option<TokenUsage>,
        status: TurnCompletionStatus,
    },
    TextDelta {
        content: String,
    },
    ThinkingDelta {
        content: String,
    },
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
    ActionProgressUpdated {
        action_id: String,
        message: String,
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
    UsageLimitsUpdated {
        usage: UsageLimitsSnapshot,
    },
    ModelRerouted {
        from_model: String,
        to_model: String,
        reason: String,
    },
    Notice {
        kind: String,
        level: String,
        title: String,
        message: String,
    },
    Error {
        message: String,
        recoverable: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnCompletionStatus {
    Completed,
    Interrupted,
    Failed,
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
    Stdin,
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
    pub reasoning: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageLimitsSnapshot {
    pub current_tokens: Option<u64>,
    pub max_context_tokens: Option<u64>,
    pub context_window_percent: Option<u8>,
    pub five_hour_percent: Option<u8>,
    pub weekly_percent: Option<u8>,
    pub five_hour_resets_at: Option<i64>,
    pub weekly_resets_at: Option<i64>,
}
