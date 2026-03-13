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
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitSelectionStatusDto {
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    pub turn_reasoning_effort: Option<String>,
    pub schema_version: i64,
    pub status: MessageStatusDto,
    pub token_usage: Option<TokenUsageDto>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageWindowCursorDto {
    pub created_at: String,
    pub id: String,
    pub row_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageWindowDto {
    pub messages: Vec<MessageDto>,
    pub next_cursor: Option<MessageWindowCursorDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutputChunkDto {
    pub stream: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutputDto {
    pub found: bool,
    pub output_chunks: Vec<ActionOutputChunkDto>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    pub thread_title: String,
    pub workspace_name: String,
    pub repo_id: Option<String>,
    pub message_id: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfoDto {
    pub id: String,
    pub name: String,
    pub models: Vec<EngineModelDto>,
    pub capabilities: EngineCapabilitiesDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCapabilitiesDto {
    #[serde(default)]
    pub permission_modes: Vec<String>,
    #[serde(default)]
    pub sandbox_modes: Vec<String>,
    #[serde(default)]
    pub approval_decisions: Vec<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub availability_nux: Option<EngineModelAvailabilityNuxDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upgrade_info: Option<EngineModelUpgradeInfoDto>,
    #[serde(default)]
    pub input_modalities: Vec<String>,
    #[serde(default)]
    pub supports_personality: bool,
    pub default_reasoning_effort: String,
    pub supported_reasoning_efforts: Vec<ReasoningEffortOptionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModelAvailabilityNuxDto {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModelUpgradeInfoDto {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upgrade_copy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration_markdown: Option<String>,
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
    #[serde(default)]
    pub checks: Vec<String>,
    #[serde(default)]
    pub fixes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_diagnostics: Option<CodexProtocolDiagnosticsDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexProtocolDiagnosticsDto {
    #[serde(default)]
    pub method_availability: Vec<CodexMethodAvailabilityDto>,
    #[serde(default)]
    pub experimental_features: Vec<CodexExperimentalFeatureDto>,
    #[serde(default)]
    pub collaboration_modes: Vec<String>,
    #[serde(default)]
    pub apps: Vec<CodexAppDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_config_warning: Option<CodexConfigWarningDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_account_login: Option<CodexAccountLoginCompletedDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_mcp_oauth: Option<CodexMcpOauthCompletedDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    #[serde(default)]
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMethodAvailabilityDto {
    pub method: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExperimentalFeatureDto {
    pub name: String,
    pub enabled: bool,
    pub default_enabled: bool,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAppDto {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub is_enabled: bool,
    pub is_accessible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillDto {
    pub name: String,
    pub path: String,
    pub description: String,
    pub enabled: bool,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfigWarningDto {
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountLoginCompletedDto {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpOauthCompletedDto {
    pub name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeToastDto {
    pub variant: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRuntimeUpdatedDto {
    pub engine_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_diagnostics: Option<CodexProtocolDiagnosticsDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toast: Option<RuntimeToastDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCheckResultDto {
    pub command: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
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
#[serde(rename_all = "camelCase")]
pub struct GitDiffPreviewDto {
    pub content: String,
    pub truncated: bool,
    pub original_bytes: usize,
    pub returned_bytes: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitCompareSourceDto {
    Changes,
    Staged,
}

impl GitCompareSourceDto {
    pub fn from_str(value: &str) -> Self {
        match value {
            "staged" => Self::Staged,
            _ => Self::Changes,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitChangeTypeDto {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileCompareDto {
    pub source: GitCompareSourceDto,
    pub base_content: String,
    pub modified_content: String,
    pub base_label: String,
    pub modified_label: String,
    pub change_type: GitChangeTypeDto,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
    pub is_binary: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_editable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
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
pub struct GitWorktreeDto {
    pub path: String,
    pub head_sha: Option<String>,
    pub branch: Option<String>,
    pub is_main: bool,
    pub is_locked: bool,
    pub is_prunable: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResultDto {
    pub content: String,
    pub size_bytes: u64,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionDto {
    pub id: String,
    pub workspace_id: String,
    pub shell: String,
    pub cwd: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReplayChunkDto {
    pub seq: u64,
    pub ts: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResumeSessionDto {
    pub latest_seq: u64,
    pub oldest_available_seq: Option<u64>,
    pub gap: bool,
    pub chunks: Vec<TerminalReplayChunkDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEnvSnapshotDto {
    pub term: Option<String>,
    pub colorterm: Option<String>,
    pub term_program: Option<String>,
    pub term_program_version: Option<String>,
    pub home: Option<String>,
    pub user_profile: Option<String>,
    pub app_data: Option<String>,
    pub local_app_data: Option<String>,
    pub xdg_config_home: Option<String>,
    pub xdg_data_home: Option<String>,
    pub xdg_cache_home: Option<String>,
    pub xdg_state_home: Option<String>,
    pub tmpdir: Option<String>,
    pub temp: Option<String>,
    pub tmp: Option<String>,
    pub lang: Option<String>,
    pub lc_all: Option<String>,
    pub lc_ctype: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeSnapshotDto {
    pub cols: u16,
    pub rows: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRendererDiagnosticsDto {
    pub session_id: String,
    pub shell: String,
    pub cwd: String,
    pub env_snapshot: TerminalEnvSnapshotDto,
    pub last_resize: Option<TerminalResizeSnapshotDto>,
    pub io_counters: TerminalIoCountersDto,
    pub latency: TerminalLatencySnapshotDto,
    pub output_throttle: TerminalOutputThrottleSnapshotDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIoCountersDto {
    pub stdin_writes: u64,
    pub stdin_bytes: u64,
    pub stdin_ctrl_c: u64,
    pub last_stdin_write_duration_ms: Option<u64>,
    pub stdout_reads: u64,
    pub stdout_bytes: u64,
    pub stdout_emits: u64,
    pub stdout_emit_bytes: u64,
    pub stdout_dropped_bytes: u64,
    pub last_stdin_write_at: Option<String>,
    pub last_stdout_read_at: Option<String>,
    pub last_stdout_emit_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputThrottleSnapshotDto {
    pub min_emit_interval_ms: u64,
    pub max_emit_bytes: u64,
    pub buffer_bytes: u64,
    pub buffer_cap_bytes: u64,
    pub buffer_peak_bytes: u64,
    pub buffer_trimmed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLatencySnapshotDto {
    pub stdin_to_stdout_read_ms: Option<u64>,
    pub stdout_read_to_emit_ms: Option<u64>,
}

// ── Git Remotes ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteDto {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInitRepoStatusDto {
    pub can_initialize: bool,
    pub blocking_repo_path: Option<String>,
}

// ── Setup / Onboarding ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyReport {
    pub node: DepStatus,
    pub codex: DepStatus,
    pub git: DepStatus,
    pub platform: String,
    pub package_managers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepStatus {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub can_auto_install: bool,
    pub install_method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub dependency: String,
    pub line: String,
    pub stream: String,
    pub finished: bool,
}

// ── Harness Management ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub can_auto_install: bool,
    pub website: String,
    pub native: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessReport {
    pub harnesses: Vec<HarnessInfo>,
    pub npm_available: bool,
}
