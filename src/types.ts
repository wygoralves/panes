export type TrustLevel = "trusted" | "standard" | "restricted";

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  scanDepth: number;
  createdAt: string;
  lastOpenedAt: string;
}

export interface Repo {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  defaultBranch: string;
  isActive: boolean;
  trustLevel: TrustLevel;
}

export type ThreadStatus =
  | "idle"
  | "streaming"
  | "awaiting_approval"
  | "error"
  | "completed";

export interface Thread {
  id: string;
  workspaceId: string;
  repoId: string | null;
  engineId: "codex" | "claude";
  modelId: string;
  engineThreadId: string | null;
  engineMetadata?: Record<string, unknown>;
  title: string;
  status: ThreadStatus;
  messageCount: number;
  totalTokens: number;
  createdAt: string;
  lastActivityAt: string;
}

export type MessageStatus = "completed" | "streaming" | "interrupted" | "error";

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content?: string;
  blocks?: ContentBlock[];
  turnEngineId?: string | null;
  turnModelId?: string | null;
  status: MessageStatus;
  schemaVersion: number;
  tokenUsage?: { input: number; output: number };
  createdAt: string;
}

export type ActionType =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "file_delete"
  | "command"
  | "git"
  | "search"
  | "other";

export interface TextBlock {
  type: "text";
  content: string;
}

export interface CodeBlock {
  type: "code";
  language: string;
  content: string;
  filename?: string;
}

export interface DiffBlock {
  type: "diff";
  diff: string;
  scope: "turn" | "file" | "workspace";
}

export interface ActionBlock {
  type: "action";
  actionId: string;
  engineActionId?: string;
  actionType: ActionType;
  summary: string;
  details: Record<string, unknown>;
  outputChunks: Array<{ stream: "stdout" | "stderr"; content: string }>;
  status: "pending" | "running" | "done" | "error";
  result?: {
    success: boolean;
    output?: string;
    error?: string;
    diff?: string;
    durationMs: number;
  };
}

export interface ApprovalBlock {
  type: "approval";
  approvalId: string;
  actionType: ActionType;
  summary: string;
  details: Record<string, unknown>;
  status: "pending" | "answered";
  decision?:
    | "accept"
    | "accept_for_session"
    | "decline"
    | "cancel"
    | "custom";
}

export type ApprovalDecision =
  | "accept"
  | "accept_for_session"
  | "decline"
  | "cancel";

export interface AcceptWithExecpolicyAmendmentDecision {
  acceptWithExecpolicyAmendment: {
    execpolicy_amendment: string[];
  };
}

export interface ToolInputAnswer {
  answers: string[];
}

export type ApprovalResponse =
  | {
      decision: ApprovalDecision;
    }
  | AcceptWithExecpolicyAmendmentDecision
  | {
      answers: Record<string, ToolInputAnswer>;
    };

export interface ThinkingBlock {
  type: "thinking";
  content: string;
}

export interface ErrorBlock {
  type: "error";
  message: string;
}

export type ContentBlock =
  | TextBlock
  | CodeBlock
  | DiffBlock
  | ActionBlock
  | ApprovalBlock
  | ThinkingBlock
  | ErrorBlock;

export interface EngineInfo {
  id: string;
  name: string;
  models: EngineModel[];
}

export interface EngineModel {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  upgrade?: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: ReasoningEffortOption[];
}

export interface ReasoningEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface EngineHealth {
  id: string;
  available: boolean;
  version?: string;
  details?: string;
  warnings?: string[];
}

export interface SearchResult {
  threadId: string;
  messageId: string;
  snippet: string;
}

export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export type TurnCompletionStatus = "completed" | "interrupted" | "failed";

export interface StreamTokenUsage {
  input: number;
  output: number;
}

export interface TurnStartedEvent {
  type: "TurnStarted";
}

export interface TurnCompletedEvent {
  type: "TurnCompleted";
  token_usage?: StreamTokenUsage | null;
  status?: TurnCompletionStatus;
}

export interface TextDeltaEvent {
  type: "TextDelta";
  content: string;
}

export interface ThinkingDeltaEvent {
  type: "ThinkingDelta";
  content: string;
}

export interface ActionStartedEvent {
  type: "ActionStarted";
  action_id: string;
  engine_action_id?: string | null;
  action_type: ActionType;
  summary: string;
  details: Record<string, unknown>;
}

export interface ActionOutputDeltaEvent {
  type: "ActionOutputDelta";
  action_id: string;
  stream: "stdout" | "stderr";
  content: string;
}

export interface ActionCompletedEvent {
  type: "ActionCompleted";
  action_id: string;
  result: {
    success: boolean;
    output?: string | null;
    error?: string | null;
    diff?: string | null;
    durationMs: number;
  };
}

export interface DiffUpdatedEvent {
  type: "DiffUpdated";
  diff: string;
  scope: "turn" | "file" | "workspace";
}

export interface ApprovalRequestedEvent {
  type: "ApprovalRequested";
  approval_id: string;
  action_type: ActionType;
  summary: string;
  details: Record<string, unknown>;
}

export interface ErrorEvent {
  type: "Error";
  message: string;
  recoverable: boolean;
}

export type StreamEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ActionStartedEvent
  | ActionOutputDeltaEvent
  | ActionCompletedEvent
  | DiffUpdatedEvent
  | ApprovalRequestedEvent
  | ErrorEvent;
