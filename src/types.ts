export type TrustLevel = "trusted" | "standard" | "restricted";

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  scanDepth: number;
  createdAt: string;
  lastOpenedAt: string;
}

export interface KeepAwakeState {
  supported: boolean;
  enabled: boolean;
  active: boolean;
  supportsClosedDisplay?: boolean | null;
  closedDisplayActive?: boolean | null;
  message?: string | null;
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

export interface WorkspaceGitSelectionStatus {
  configured: boolean;
}

export type WorkspaceStartupPresetFormat = "json" | "toml";
export type WorkspaceDefaultView = "chat" | "split" | "terminal" | "editor";
export type WorkspacePathBase = "workspace" | "worktree" | "absolute";
export type WorkspaceStartupApplyWhen = "no_live_sessions";
export type WorkspaceStartupRepoMode = "active_repo" | "fixed_repo";
export type WorkspaceStartupSplitDirection = "horizontal" | "vertical";

export interface WorkspaceStartupPreset {
  version: 1;
  defaultView: WorkspaceDefaultView;
  splitPanelSize?: number | null;
  terminal?: WorkspaceTerminalStartupPreset | null;
}

export interface WorkspaceTerminalStartupPreset {
  applyWhen: WorkspaceStartupApplyWhen;
  groups: WorkspaceStartupGroup[];
  activeGroupId?: string | null;
  focusedSessionId?: string | null;
}

export interface WorkspaceStartupGroup {
  id: string;
  name: string;
  broadcastOnStart?: boolean;
  worktree?: WorkspaceStartupWorktreeConfig | null;
  sessions: WorkspaceStartupSession[];
  root: WorkspaceStartupSplitNode;
}

export interface WorkspaceStartupWorktreeConfig {
  enabled: boolean;
  repoMode: WorkspaceStartupRepoMode;
  repoPath?: string | null;
  baseBranch?: string | null;
  baseDir?: string | null;
  branchPrefix?: string | null;
}

export interface WorkspaceStartupSession {
  id: string;
  title?: string | null;
  cwd: string;
  cwdBase?: WorkspacePathBase | null;
  harnessId?: string | null;
  launchHarnessOnCreate?: boolean | null;
}

export type WorkspaceStartupSplitNode =
  | {
      type: "leaf";
      sessionId: string;
    }
  | {
      type: "split";
      direction: WorkspaceStartupSplitDirection;
      ratio: number;
      children: [WorkspaceStartupSplitNode, WorkspaceStartupSplitNode];
    };

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

export interface CodexRemoteThread {
  engineThreadId: string;
  title?: string | null;
  preview: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  modelProvider: string;
  sourceKind: string;
  statusType: string;
  activeFlags: string[];
  archived: boolean;
  localThreadId?: string | null;
}

export interface CodexRemoteThreadPage {
  threads: CodexRemoteThread[];
  nextCursor?: string | null;
}

export type CodexReviewDelivery = "inline" | "detached";

export type CodexReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string };

export type MessageStatus = "completed" | "streaming" | "interrupted" | "error";

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content?: string;
  blocks?: ContentBlock[];
  clientTurnId?: string | null;
  turnEngineId?: string | null;
  turnModelId?: string | null;
  turnReasoningEffort?: string | null;
  status: MessageStatus;
  schemaVersion: number;
  tokenUsage?: { input: number; output: number };
  createdAt: string;
  hydration?: "full" | "summary";
  hasDeferredContent?: boolean;
}

export interface MessageWindowCursor {
  createdAt: string;
  id: string;
  rowId?: number;
}

export interface MessageWindow {
  messages: Message[];
  nextCursor: MessageWindowCursor | null;
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
  planMode?: boolean;
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

export interface NoticeBlock {
  type: "notice";
  kind: string;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
}

export interface ActionBlock {
  type: "action";
  actionId: string;
  engineActionId?: string;
  actionType: ActionType;
  summary: string;
  details: Record<string, unknown>;
  outputChunks: Array<{ stream: "stdout" | "stderr" | "stdin"; content: string }>;
  outputDeferred?: boolean;
  outputDeferredLoaded?: boolean;
  status: "pending" | "running" | "done" | "error";
  result?: {
    success: boolean;
    output?: string;
    error?: string;
    diff?: string;
    durationMs: number;
  };
}

export interface ActionOutputPayload {
  found: boolean;
  outputChunks: Array<{ stream: "stdout" | "stderr" | "stdin"; content: string }>;
  truncated: boolean;
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

export interface NetworkPolicyAmendment {
  host: string;
  action: "allow" | "deny";
}

export interface ApplyNetworkPolicyAmendmentDecision {
  applyNetworkPolicyAmendment: {
    network_policy_amendment: NetworkPolicyAmendment;
  };
}

export interface PermissionsApprovalResponse {
  permissions: Record<string, unknown>;
  scope?: "turn" | "session";
}

export interface McpServerElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface DynamicToolCallOutputTextItem {
  type: "inputText";
  text: string;
}

export interface DynamicToolCallOutputImageItem {
  type: "inputImage";
  imageUrl: string;
}

export interface DynamicToolCallResponse {
  success: boolean;
  contentItems: Array<DynamicToolCallOutputTextItem | DynamicToolCallOutputImageItem>;
}

export interface ToolInputAnswer {
  answers: string[];
}

export type ApprovalResponse =
  | {
      decision: ApprovalDecision;
    }
  | AcceptWithExecpolicyAmendmentDecision
  | ApplyNetworkPolicyAmendmentDecision
  | PermissionsApprovalResponse
  | McpServerElicitationResponse
  | DynamicToolCallResponse
  | {
      answers: Record<string, ToolInputAnswer>;
    }
  | Record<string, unknown>;

export interface ThinkingBlock {
  type: "thinking";
  content: string;
}

export interface ErrorBlock {
  type: "error";
  message: string;
}

export interface AttachmentBlock {
  type: "attachment";
  fileName: string;
  filePath: string;
  sizeBytes: number;
  mimeType?: string;
}

export interface SkillBlock {
  type: "skill";
  name: string;
  path: string;
}

export interface MentionBlock {
  type: "mention";
  name: string;
  path: string;
}

export interface SteerBlock {
  type: "steer";
  steerId: string;
  content: string;
  planMode?: boolean;
  attachments?: AttachmentBlock[];
  skills?: SkillBlock[];
  mentions?: MentionBlock[];
}

export type ContentBlock =
  | TextBlock
  | CodeBlock
  | DiffBlock
  | NoticeBlock
  | ActionBlock
  | ApprovalBlock
  | ThinkingBlock
  | ErrorBlock
  | AttachmentBlock
  | SkillBlock
  | MentionBlock
  | SteerBlock;

export interface EngineInfo {
  id: string;
  name: string;
  models: EngineModel[];
  capabilities: EngineCapabilities;
}

export interface EngineCapabilities {
  permissionModes: string[];
  sandboxModes: string[];
  approvalDecisions: string[];
}

export interface EngineModel {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  upgrade?: string;
  availabilityNux?: EngineModelAvailabilityNux;
  upgradeInfo?: EngineModelUpgradeInfo;
  inputModalities: string[];
  supportsPersonality: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: ReasoningEffortOption[];
}

export interface EngineModelAvailabilityNux {
  message: string;
}

export interface EngineModelUpgradeInfo {
  model: string;
  upgradeCopy?: string;
  modelLink?: string;
  migrationMarkdown?: string;
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
  checks?: string[];
  fixes?: string[];
  protocolDiagnostics?: CodexProtocolDiagnostics;
}

export interface CodexMethodAvailability {
  method: string;
  status: string;
  detail?: string;
}

export interface CodexExperimentalFeature {
  name: string;
  enabled: boolean;
  defaultEnabled: boolean;
  stage: string;
  displayName?: string;
  description?: string;
}

export interface CodexApp {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  isAccessible: boolean;
}

export interface CodexSkill {
  name: string;
  path: string;
  description: string;
  enabled: boolean;
  scope: string;
}

export interface CodexPluginMarketplace {
  name: string;
  path: string;
  plugins: CodexPlugin[];
}

export interface CodexPlugin {
  id: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  capabilities: string[];
  developerName?: string;
  description?: string;
}

export interface CodexMcpServer {
  name: string;
  authStatus: string;
  toolCount: number;
  resourceCount: number;
  resourceTemplateCount: number;
}

export interface CodexAccountState {
  provider: string;
  authMode?: string;
  email?: string;
  planType?: string;
  requiresOpenaiAuth: boolean;
}

export interface CodexConfigLayer {
  source: string;
  version: string;
}

export interface CodexConfigState {
  model?: string;
  modelProvider?: string;
  serviceTier?: string;
  approvalPolicy?: unknown;
  sandboxMode?: string;
  webSearch?: string;
  profile?: string;
  layers: CodexConfigLayer[];
}

export interface CodexConfigWarning {
  summary: string;
  details?: string;
  path?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface CodexAccountLoginCompleted {
  success: boolean;
  error?: string;
  loginId?: string;
}

export interface CodexMcpOauthCompleted {
  name: string;
  success: boolean;
  error?: string;
}

export interface CodexThreadRealtimeEvent {
  kind: string;
  threadId: string;
  sessionId?: string;
  reason?: string;
  message?: string;
  itemType?: string;
  sampleRate?: number;
  numChannels?: number;
  samplesPerChannel?: number;
}

export interface CodexWindowsSandboxSetup {
  mode: string;
  success: boolean;
  error?: string;
}

export interface CodexWindowsWorldWritableWarning {
  samplePaths: string[];
  extraCount: number;
  failedScan: boolean;
}

export interface CodexProtocolDiagnostics {
  methodAvailability: CodexMethodAvailability[];
  experimentalFeatures: CodexExperimentalFeature[];
  collaborationModes: string[];
  apps: CodexApp[];
  skills: CodexSkill[];
  pluginMarketplaces: CodexPluginMarketplace[];
  mcpServers: CodexMcpServer[];
  account?: CodexAccountState;
  config?: CodexConfigState;
  lastConfigWarning?: CodexConfigWarning;
  lastAccountLogin?: CodexAccountLoginCompleted;
  lastMcpOauth?: CodexMcpOauthCompleted;
  lastThreadRealtime?: CodexThreadRealtimeEvent;
  lastWindowsSandboxSetup?: CodexWindowsSandboxSetup;
  lastWindowsWorldWritableWarning?: CodexWindowsWorldWritableWarning;
  fetchedAt?: string;
  stale: boolean;
}

export interface RuntimeToast {
  variant: "success" | "error" | "warning" | "info";
  message: string;
}

export interface EngineRuntimeUpdatedEvent {
  engineId: string;
  protocolDiagnostics?: CodexProtocolDiagnostics;
  toast?: RuntimeToast;
}

export interface EngineCheckResult {
  command: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SearchResult {
  threadId: string;
  threadTitle: string;
  workspaceName: string;
  repoId: string | null;
  messageId: string;
  snippet: string;
}

export interface GitFileStatus {
  path: string;
  indexStatus?: string;
  worktreeStatus?: string;
}

export interface GitStatus {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export interface GitDiffPreview {
  content: string;
  truncated: boolean;
  originalBytes: number;
  returnedBytes: number;
}

export type GitCompareSource = "changes" | "staged";
export type GitChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface GitFileCompare {
  source: GitCompareSource;
  baseContent: string;
  modifiedContent: string;
  baseLabel: string;
  modifiedLabel: string;
  changeType: GitChangeType;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  isBinary: boolean;
  isEditable?: boolean;
  fallbackReason?: string | null;
}

export type GitBranchScope = "local" | "remote";

export interface GitBranch {
  name: string;
  fullName: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  lastCommitAt?: string;
}

export interface GitBranchPage {
  entries: GitBranch[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  body: string;
  authoredAt: string;
}

export interface GitCommitPage {
  entries: GitCommit[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface GitStash {
  index: number;
  name: string;
  branchHint?: string;
  createdAt?: string;
}

export interface GitWorktree {
  path: string;
  headSha: string | null;
  branch: string | null;
  isMain: boolean;
  isLocked: boolean;
  isPrunable: boolean;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitInitRepoStatus {
  canInitialize: boolean;
  blockingRepoPath: string | null;
}

export interface WorktreeSessionInfo {
  repoPath: string;
  worktreePath: string;
  branch: string;
}

export interface FileTreeEntry {
  path: string;
  isDir: boolean;
}

export interface FileTreePage {
  entries: FileTreeEntry[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  scanTruncated: boolean;
}

export interface ReadFileResult {
  content: string;
  sizeBytes: number;
  isBinary: boolean;
}

export type EditorRenderMode = "plain-editor" | "git-diff-editor";

export interface GitEditorContext extends GitFileCompare {}

export interface EditorTab {
  id: string;
  repoPath: string;
  filePath: string;
  fileName: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  isLoading: boolean;
  isBinary: boolean;
  renderMode: EditorRenderMode;
  gitContext: GitEditorContext | null;
  loadError?: string;
}

export interface TerminalSession {
  id: string;
  workspaceId: string;
  shell: string;
  cwd: string;
  createdAt: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  seq: number;
  ts: string;
  data: string;
}

export interface TerminalReplayChunk {
  seq: number;
  ts: string;
  data: string;
}

export interface TerminalResumeSession {
  latestSeq: number;
  oldestAvailableSeq: number | null;
  gap: boolean;
  chunks: TerminalReplayChunk[];
}

export interface TerminalExitEvent {
  sessionId: string;
  code: number | null;
  signal: number | null;
}

export interface TerminalForegroundChangedEvent {
  sessionId: string;
  pid: number | null;
  name: string | null;
}

export interface TerminalEnvSnapshot {
  term: string | null;
  colorterm: string | null;
  termProgram: string | null;
  termProgramVersion: string | null;
  home: string | null;
  userProfile: string | null;
  appData: string | null;
  localAppData: string | null;
  xdgConfigHome: string | null;
  xdgDataHome: string | null;
  xdgCacheHome: string | null;
  xdgStateHome: string | null;
  tmpdir: string | null;
  temp: string | null;
  tmp: string | null;
  lang: string | null;
  lcAll: string | null;
  lcCtype: string | null;
  path: string | null;
}

export interface TerminalResizeSnapshot {
  cols: number;
  rows: number;
  pixelWidth: number;
  pixelHeight: number;
  recordedAt: string;
}

export interface TerminalIoCounters {
  stdinWrites: number;
  stdinBytes: number;
  stdinCtrlC: number;
  lastStdinWriteDurationMs: number | null;
  stdoutReads: number;
  stdoutBytes: number;
  stdoutEmits: number;
  stdoutEmitBytes: number;
  stdoutDroppedBytes: number;
  lastStdinWriteAt: string | null;
  lastStdoutReadAt: string | null;
  lastStdoutEmitAt: string | null;
}

export interface TerminalLatencySnapshot {
  stdinToStdoutReadMs: number | null;
  stdoutReadToEmitMs: number | null;
}

export interface TerminalOutputThrottleSnapshot {
  minEmitIntervalMs: number;
  maxEmitBytes: number;
  bufferBytes: number;
  bufferCapBytes: number;
  bufferPeakBytes: number;
  bufferTrimmedBytes: number;
}

export interface TerminalRendererDiagnostics {
  sessionId: string;
  shell: string;
  cwd: string;
  envSnapshot: TerminalEnvSnapshot;
  lastResize: TerminalResizeSnapshot | null;
  ioCounters: TerminalIoCounters;
  latency: TerminalLatencySnapshot;
  outputThrottle: TerminalOutputThrottleSnapshot;
}

// ── Terminal Split Layout ───────────────────────────────────────────

export type SplitDirection = "horizontal" | "vertical";

export interface SplitLeaf {
  type: "leaf";
  sessionId: string;
}

export interface SplitContainer {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  children: [SplitNode, SplitNode];
}

export type SplitNode = SplitLeaf | SplitContainer;

export interface TerminalSessionRuntimeMeta {
  harnessId?: string | null;
  harnessName?: string | null;
  autoDetectedHarness?: boolean;
  launchHarnessOnCreate?: boolean;
  worktree?: WorktreeSessionInfo | null;
}

export interface TerminalGroup {
  id: string;
  root: SplitNode;
  name: string;
  sessionMeta?: Record<string, TerminalSessionRuntimeMeta>;
  worktreeConfig?: WorkspaceStartupWorktreeConfig | null;
}

// ── Setup / Onboarding ──────────────────────────────────────────────

export type OnboardingWorkflowPreference = "cli" | "chat";
export type OnboardingChatEngineId = "codex" | "claude";
export type OnboardingStep =
  | "greeting"
  | "workflow"
  | "cliProviders"
  | "chatEngines"
  | "chatReadiness"
  | "workspace";

export interface DependencyReport {
  node: DepStatus;
  codex: DepStatus;
  git: DepStatus;
  platform: string;
  packageManagers: string[];
}

export interface DepStatus {
  found: boolean;
  version: string | null;
  path: string | null;
  canAutoInstall: boolean;
  installMethod: string | null;
}

export interface InstallResult {
  success: boolean;
  message: string;
}

export interface InstallProgressEvent {
  dependency: string;
  line: string;
  stream: string;
  finished: boolean;
}

// ── Harness Management ──────────────────────────────────────────────

export interface HarnessInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  found: boolean;
  version: string | null;
  path: string | null;
  canAutoInstall: boolean;
  website: string;
  native: boolean;
}

export interface HarnessReport {
  harnesses: HarnessInfo[];
  npmAvailable: boolean;
}

// ── Stream Events ───────────────────────────────────────────────────

export type TurnCompletionStatus = "completed" | "interrupted" | "failed";

export interface StreamTokenUsage {
  input: number;
  output: number;
}

export interface TurnStartedEvent {
  type: "TurnStarted";
  client_turn_id?: string | null;
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
  stream: "stdout" | "stderr" | "stdin";
  content: string;
}

export interface ActionProgressUpdatedEvent {
  type: "ActionProgressUpdated";
  action_id: string;
  message: string;
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

export interface ApprovalResolvedEvent {
  type: "ApprovalResolved";
  approval_id: string;
}

export interface ErrorEvent {
  type: "Error";
  message: string;
  recoverable: boolean;
}

export interface UsageLimitsUpdatedEvent {
  type: "UsageLimitsUpdated";
  usage: {
    current_tokens?: number | null;
    max_context_tokens?: number | null;
    context_window_percent?: number | null;
    five_hour_percent?: number | null;
    weekly_percent?: number | null;
    five_hour_resets_at?: number | null;
    weekly_resets_at?: number | null;
  };
}

export interface ModelReroutedEvent {
  type: "ModelRerouted";
  from_model: string;
  to_model: string;
  reason: string;
}

export interface NoticeEvent {
  type: "Notice";
  kind: string;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
}

export type StreamEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ActionStartedEvent
  | ActionOutputDeltaEvent
  | ActionProgressUpdatedEvent
  | ActionCompletedEvent
  | DiffUpdatedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ModelReroutedEvent
  | NoticeEvent
  | ErrorEvent
  | UsageLimitsUpdatedEvent;

// ── Attachments ─────────────────────────────────────────────────────

export interface ChatAttachment {
  id: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  mimeType?: string;
}

export type ChatInputItem =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "skill";
      name: string;
      path: string;
    }
  | {
      type: "mention";
      name: string;
      path: string;
    };

// ── Context Usage ───────────────────────────────────────────────────

export interface ContextUsage {
  currentTokens: number | null;
  maxContextTokens: number | null;
  contextPercent: number | null;
  windowFiveHourPercent: number | null;
  windowWeeklyPercent: number | null;
  windowFiveHourResetsAt: string | null;
  windowWeeklyResetsAt: string | null;
}
