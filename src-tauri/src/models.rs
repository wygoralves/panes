use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub scan_depth: i64,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDto {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub path: String,
    pub default_branch: String,
    pub is_active: bool,
    pub trust_level: TrustLevelDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevelDto {
    Trusted,
    Standard,
    Restricted,
}

impl TrustLevelDto {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustLevelDto::Trusted => "trusted",
            TrustLevelDto::Standard => "standard",
            TrustLevelDto::Restricted => "restricted",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "trusted" => Self::Trusted,
            "restricted" => Self::Restricted,
            _ => Self::Standard,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDto {
    pub id: String,
    pub workspace_id: String,
    pub repo_id: Option<String>,
    pub engine_id: String,
    pub model_id: String,
    pub engine_thread_id: Option<String>,
    pub engine_metadata: Option<Value>,
    pub title: String,
    pub status: ThreadStatusDto,
    pub message_count: i64,
    pub total_tokens: i64,
    pub created_at: String,
    pub last_activity_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadStatusDto {
    Idle,
    Streaming,
    AwaitingApproval,
    Error,
    Completed,
}

impl ThreadStatusDto {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThreadStatusDto::Idle => "idle",
            ThreadStatusDto::Streaming => "streaming",
            ThreadStatusDto::AwaitingApproval => "awaiting_approval",
            ThreadStatusDto::Error => "error",
            ThreadStatusDto::Completed => "completed",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "streaming" => Self::Streaming,
            "awaiting_approval" => Self::AwaitingApproval,
            "error" => Self::Error,
            "completed" => Self::Completed,
            _ => Self::Idle,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDto {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: Option<String>,
    pub blocks: Option<Value>,
    pub turn_engine_id: Option<String>,
    pub turn_model_id: Option<String>,
    pub schema_version: i64,
    pub status: MessageStatusDto,
    pub token_usage: Option<TokenUsageDto>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageStatusDto {
    Completed,
    Streaming,
    Interrupted,
    Error,
}

impl MessageStatusDto {
    pub fn as_str(&self) -> &'static str {
        match self {
            MessageStatusDto::Completed => "completed",
            MessageStatusDto::Streaming => "streaming",
            MessageStatusDto::Interrupted => "interrupted",
            MessageStatusDto::Error => "error",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "streaming" => Self::Streaming,
            "interrupted" => Self::Interrupted,
            "error" => Self::Error,
            _ => Self::Completed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageDto {
    pub input: u64,
    pub output: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultDto {
    pub thread_id: String,
    pub message_id: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfoDto {
    pub id: String,
    pub name: String,
    pub models: Vec<EngineModelDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModelDto {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub hidden: bool,
    pub is_default: bool,
    pub upgrade: Option<String>,
    pub default_reasoning_effort: String,
    pub supported_reasoning_efforts: Vec<ReasoningEffortOptionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffortOptionDto {
    pub reasoning_effort: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineHealthDto {
    pub id: String,
    pub available: bool,
    pub version: Option<String>,
    pub details: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub branch: String,
    pub files: Vec<GitFileStatusDto>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatusDto {
    pub path: String,
    pub index_status: Option<String>,
    pub worktree_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitBranchScopeDto {
    Local,
    Remote,
}

impl GitBranchScopeDto {
    pub fn from_str(value: &str) -> Self {
        match value {
            "remote" => Self::Remote,
            _ => Self::Local,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchDto {
    pub name: String,
    pub full_name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchPageDto {
    pub entries: Vec<GitBranchDto>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDto {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub body: String,
    pub authored_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitPageDto {
    pub entries: Vec<GitCommitDto>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashDto {
    pub index: usize,
    pub name: String,
    pub branch_hint: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeEntryDto {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreePageDto {
    pub entries: Vec<FileTreeEntryDto>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub has_more: bool,
    pub scan_truncated: bool,
}
