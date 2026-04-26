use serde::{Deserialize, Serialize};

pub const ACTION_OUTPUT_DELTA_MAX_CHARS: usize = 16 * 1024;
pub const STREAMED_DIFF_MAX_CHARS: usize = 128 * 1024;
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

pub fn trim_action_output_delta_json_string(raw_json_string: &str) -> Option<String> {
    trim_json_string_to_chars(raw_json_string, ACTION_OUTPUT_DELTA_MAX_CHARS)
}

pub fn trim_json_string_to_chars(raw_json_string: &str, max_chars: usize) -> Option<String> {
    let inner = raw_json_string.strip_prefix('"')?.strip_suffix('"')?;
    let mut chars = inner.chars().peekable();
    let max_chars = max_chars.max(1);
    let mut tail = std::collections::VecDeque::with_capacity(max_chars);
    let mut total_chars = 0usize;

    while let Some(ch) = chars.next() {
        let decoded = if ch == '\\' {
            decode_json_escape(&mut chars)?
        } else {
            ch
        };
        total_chars = total_chars.saturating_add(1);
        if tail.len() == max_chars {
            tail.pop_front();
        }
        tail.push_back(decoded);
    }

    if total_chars <= max_chars {
        return Some(tail.into_iter().collect());
    }

    let tail_chars = max_chars.saturating_sub(ACTION_OUTPUT_DELTA_TRUNCATED_PREFIX.len());
    let skip = tail.len().saturating_sub(tail_chars.max(1));
    let mut trimmed = String::with_capacity(max_chars);
    trimmed.push_str(ACTION_OUTPUT_DELTA_TRUNCATED_PREFIX);
    trimmed.extend(tail.into_iter().skip(skip));
    Some(trimmed)
}

fn decode_json_escape(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Option<char> {
    match chars.next()? {
        '"' => Some('"'),
        '\\' => Some('\\'),
        '/' => Some('/'),
        'b' => Some('\u{0008}'),
        'f' => Some('\u{000c}'),
        'n' => Some('\n'),
        'r' => Some('\r'),
        't' => Some('\t'),
        'u' => decode_json_unicode_escape(chars),
        _ => None,
    }
}

fn decode_json_unicode_escape(
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
) -> Option<char> {
    let code = read_json_hex_escape(chars)?;
    if (0xd800..=0xdbff).contains(&code) {
        let mut lookahead = chars.clone();
        if lookahead.next()? != '\\' || lookahead.next()? != 'u' {
            return None;
        }
        let low = read_json_hex_escape(&mut lookahead)?;
        if !(0xdc00..=0xdfff).contains(&low) {
            return None;
        }
        *chars = lookahead;
        let high_ten = code - 0xd800;
        let low_ten = low - 0xdc00;
        return char::from_u32(0x10000 + ((high_ten << 10) | low_ten));
    }

    if (0xdc00..=0xdfff).contains(&code) {
        return None;
    }

    char::from_u32(code)
}

fn read_json_hex_escape(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Option<u32> {
    let mut value = 0u32;
    for _ in 0..4 {
        value = (value << 4) | chars.next()?.to_digit(16)?;
    }
    Some(value)
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
