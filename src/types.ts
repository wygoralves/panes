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
  decision?: "accept" | "accept_for_session" | "decline" | "custom";
}

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
  models: string[];
}

export interface EngineHealth {
  id: string;
  available: boolean;
  version?: string;
  details?: string;
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

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}
