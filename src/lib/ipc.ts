import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { normalizeDependencyReport } from "./dependencies";
import type { AppLocale } from "./locale";
import type {
  ApprovalResponse,
  ActionOutputPayload,
  ChatAttachment,
  ChatInputItem,
  CodexReviewDelivery,
  CodexReviewTarget,
  CodexRemoteThreadPage,
  ContentBlock,
  CodexApp,
  CodexSkill,
  DependencyReport,
  EngineCheckResult,
  EngineRuntimeUpdatedEvent,
  GitBranchPage,
  GitBranchScope,
  GitCommitPage,
  GitInitRepoStatus,
  GitCompareSource,
  GitFileCompare,
  GitStash,
  GitRemote,
  GitWorktree,
  EngineHealth,
  EngineInfo,
  FileTreeEntry,
  FileTreePage,
  GitDiffPreview,
  GitStatus,
  HarnessReport,
  InstallProgressEvent,
  InstallResult,
  HelperStatus,
  KeepAwakeState,
  PowerSettings,
  PowerSettingsInput,
  Message,
  MessageWindow,
  MessageWindowCursor,
  ReadFileResult,
  Repo,
  SearchResult,
  StreamEvent,
  TerminalNotificationClearedEvent,
  TerminalNotification,
  TerminalExitEvent,
  TerminalForegroundChangedEvent,
  TerminalNotificationIntegrationId,
  TerminalNotificationSettings,
  TerminalOutputEvent,
  TerminalRendererDiagnostics,
  TerminalResumeSession,
  TerminalSession,
  WorkspaceStartupPreset,
  WorkspaceStartupPresetFormat,
  Thread,
  TrustLevel,
  WorkspaceGitSelectionStatus,
  Workspace
} from "../types";

export const ipc = {
  getAppLocale: () => invoke<AppLocale>("get_app_locale"),
  setAppLocale: (locale: AppLocale) => invoke<AppLocale>("set_app_locale", { locale }),
  getKeepAwakeState: () => invoke<KeepAwakeState>("get_keep_awake_state"),
  setKeepAwakeEnabled: (enabled: boolean) =>
    invoke<KeepAwakeState>("set_keep_awake_enabled", { enabled }),
  getPowerSettings: () => invoke<PowerSettings>("get_power_settings"),
  setPowerSettings: (settings: PowerSettingsInput) =>
    invoke<KeepAwakeState>("set_power_settings", { settings }),
  getHelperStatus: () => invoke<HelperStatus>("get_helper_status"),
  registerKeepAwakeHelper: () => invoke<HelperStatus>("register_keep_awake_helper"),
  getTerminalAcceleratedRendering: () =>
    invoke<boolean>("get_terminal_accelerated_rendering"),
  setTerminalAcceleratedRendering: (enabled: boolean) =>
    invoke<boolean>("set_terminal_accelerated_rendering", { enabled }),
  getAgentNotificationSettings: () =>
    invoke<TerminalNotificationSettings>("get_agent_notification_settings"),
  setChatNotificationsEnabled: (enabled: boolean) =>
    invoke<boolean>("set_chat_notifications_enabled", { enabled }),
  setTerminalNotificationsEnabled: (enabled: boolean) =>
    invoke<boolean>("set_terminal_notifications_enabled", { enabled }),
  installTerminalNotificationIntegration: (integration: TerminalNotificationIntegrationId) =>
    invoke<TerminalNotificationSettings>("install_terminal_notification_integration_command", { integration }),
  setNotificationSound: (sound: string) =>
    invoke<string>("set_notification_sound", { sound }),
  previewNotificationSound: (sound: string) =>
    invoke<void>("preview_notification_sound", { sound }),
  showAgentNotification: (title: string, body: string) =>
    invoke<void>("show_agent_notification", { title, body }),
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  listArchivedWorkspaces: () => invoke<Workspace[]>("list_archived_workspaces"),
  openWorkspace: (path: string, scanDepth?: number) =>
    invoke<Workspace>("open_workspace", {
      path,
      scanDepth: scanDepth ?? null,
    }),
  archiveWorkspace: (workspaceId: string) => invoke<void>("archive_workspace", { workspaceId }),
  restoreWorkspace: (workspaceId: string) => invoke<Workspace>("restore_workspace", { workspaceId }),
  deleteWorkspace: (workspaceId: string) => invoke<void>("delete_workspace", { workspaceId }),
  getRepos: (workspaceId: string) => invoke<Repo[]>("get_repos", { workspaceId }),
  setRepoTrustLevel: (repoId: string, trustLevel: TrustLevel) =>
    invoke<void>("set_repo_trust_level", { repoId, trustLevel }),
  setRepoGitActive: (repoId: string, isActive: boolean) =>
    invoke<void>("set_repo_git_active", { repoId, isActive }),
  setWorkspaceGitActiveRepos: (workspaceId: string, repoIds: string[]) =>
    invoke<void>("set_workspace_git_active_repos", { workspaceId, repoIds }),
  hasWorkspaceGitSelection: (workspaceId: string) =>
    invoke<WorkspaceGitSelectionStatus>("has_workspace_git_selection", { workspaceId }),
  getWorkspaceStartupPreset: (workspaceId: string) =>
    invoke<WorkspaceStartupPreset | null>("get_workspace_startup_preset", { workspaceId }),
  normalizeWorkspaceStartupPreset: (workspaceId: string, preset: WorkspaceStartupPreset) =>
    invoke<WorkspaceStartupPreset>("normalize_workspace_startup_preset", { workspaceId, preset }),
  serializeWorkspaceStartupPreset: (
    workspaceId: string,
    preset: WorkspaceStartupPreset,
    format: WorkspaceStartupPresetFormat,
  ) =>
    invoke<string>("serialize_workspace_startup_preset", { workspaceId, preset, format }),
  normalizeWorkspaceStartupPresetRaw: (
    workspaceId: string,
    format: WorkspaceStartupPresetFormat,
    rawText: string,
  ) =>
    invoke<WorkspaceStartupPreset>("normalize_workspace_startup_preset_raw", {
      workspaceId,
      format,
      rawText,
    }),
  setWorkspaceStartupPreset: (workspaceId: string, preset: WorkspaceStartupPreset) =>
    invoke<WorkspaceStartupPreset>("set_workspace_startup_preset", { workspaceId, preset }),
  setWorkspaceStartupPresetRaw: (
    workspaceId: string,
    format: WorkspaceStartupPresetFormat,
    rawText: string,
  ) =>
    invoke<WorkspaceStartupPreset>("set_workspace_startup_preset_raw", {
      workspaceId,
      format,
      rawText,
    }),
  clearWorkspaceStartupPreset: (workspaceId: string) =>
    invoke<void>("clear_workspace_startup_preset", { workspaceId }),
  exportWorkspaceStartupPreset: (
    workspaceId: string,
    format: WorkspaceStartupPresetFormat,
  ) =>
    invoke<string>("export_workspace_startup_preset", { workspaceId, format }),
  listWorkspaceDirs: (workspaceId: string, dirPath?: string | null) =>
    invoke<FileTreeEntry[]>("list_workspace_dirs", {
      workspaceId,
      dirPath: dirPath ?? null,
    }),
  listThreads: (workspaceId: string) => invoke<Thread[]>("list_threads", { workspaceId }),
  listArchivedThreads: (workspaceId: string) =>
    invoke<Thread[]>("list_archived_threads", { workspaceId }),
  listCodexRemoteThreads: (
    workspaceId: string,
    options?: {
      cursor?: string | null;
      limit?: number | null;
      searchTerm?: string | null;
      archived?: boolean | null;
    },
  ) =>
    invoke<CodexRemoteThreadPage>("list_codex_remote_threads", {
      workspaceId,
      cursor: options?.cursor ?? null,
      limit: options?.limit ?? null,
      searchTerm: options?.searchTerm ?? null,
      archived: options?.archived ?? null,
    }),
  attachCodexRemoteThread: (workspaceId: string, engineThreadId: string, modelId: string) =>
    invoke<Thread>("attach_codex_remote_thread", {
      workspaceId,
      engineThreadId,
      modelId,
    }),
  createThread: (
    workspaceId: string,
    repoId: string | null,
    engineId: string,
    modelId: string,
    title: string
  ) =>
    invoke<Thread>("create_thread", {
      workspaceId,
      repoId,
      engineId,
      modelId,
      title
    }),
  renameThread: (threadId: string, title: string) =>
    invoke<Thread>("rename_thread", {
      threadId,
      title,
    }),
  confirmWorkspaceThread: (threadId: string, writableRoots: string[]) =>
    invoke<void>("confirm_workspace_thread", { threadId, writableRoots }),
  setThreadReasoningEffort: (
    threadId: string,
    reasoningEffort: string | null,
    modelId?: string | null,
  ) =>
    invoke<void>("set_thread_reasoning_effort", { threadId, reasoningEffort, modelId: modelId ?? null }),
  setThreadExecutionPolicy: (
    threadId: string,
    patch: {
      approvalPolicy?: unknown;
      sandboxMode?: string | null;
      allowNetwork?: boolean | null;
    },
  ) =>
    invoke<Thread>("set_thread_execution_policy", {
      threadId,
      updateApprovalPolicy: Object.prototype.hasOwnProperty.call(patch, "approvalPolicy"),
      approvalPolicy: patch.approvalPolicy ?? null,
      updateSandboxMode: Object.prototype.hasOwnProperty.call(patch, "sandboxMode"),
      sandboxMode: patch.sandboxMode ?? null,
      updateAllowNetwork: Object.prototype.hasOwnProperty.call(patch, "allowNetwork"),
      allowNetwork: patch.allowNetwork ?? null,
    }),
  setThreadCodexConfig: (
    threadId: string,
    patch: {
      personality?: string | null;
      serviceTier?: string | null;
      outputSchema?: unknown;
    },
  ) =>
    invoke<Thread>("set_thread_codex_config", {
      threadId,
      updatePersonality: Object.prototype.hasOwnProperty.call(patch, "personality"),
      personality: patch.personality ?? null,
      updateServiceTier: Object.prototype.hasOwnProperty.call(patch, "serviceTier"),
      serviceTier: patch.serviceTier ?? null,
      updateOutputSchema: Object.prototype.hasOwnProperty.call(patch, "outputSchema"),
      outputSchema: patch.outputSchema ?? null,
    }),
  archiveThread: (threadId: string) => invoke<void>("archive_thread", { threadId }),
  restoreThread: (threadId: string) => invoke<Thread>("restore_thread", { threadId }),
  syncThreadFromEngine: (threadId: string) =>
    invoke<Thread>("sync_thread_from_engine", { threadId }),
  forkCodexThread: (threadId: string) =>
    invoke<Thread>("fork_codex_thread", { threadId }),
  rollbackCodexThread: (threadId: string, numTurns: number) =>
    invoke<Thread>("rollback_codex_thread", { threadId, numTurns }),
  compactCodexThread: (threadId: string) =>
    invoke<Thread>("compact_codex_thread", { threadId }),
  deleteThread: (threadId: string) => invoke<void>("delete_thread", { threadId }),
  listEngines: () => invoke<EngineInfo[]>("list_engines"),
  engineHealth: (engineId: string) => invoke<EngineHealth>("engine_health", { engineId }),
  prewarmEngine: (engineId: string) => invoke<void>("prewarm_engine", { engineId }),
  runEngineCheck: (engineId: string, command: string) =>
    invoke<EngineCheckResult>("run_engine_check", { engineId, command }),
  listCodexSkills: (cwd: string) =>
    invoke<CodexSkill[]>("list_codex_skills", { cwd }),
  listCodexApps: () => invoke<CodexApp[]>("list_codex_apps"),
  sendMessage: (
    threadId: string,
    message: string,
    modelId?: string | null,
    reasoningEffort?: string | null,
    attachments?: ChatAttachment[] | null,
    inputItems?: ChatInputItem[] | null,
    planMode?: boolean | null,
    clientTurnId?: string | null,
  ) =>
    invoke<string>("send_message", {
      threadId,
      message,
      modelId: modelId ?? null,
      reasoningEffort: reasoningEffort ?? null,
      attachments: attachments ?? null,
      inputItems: inputItems ?? null,
      planMode: planMode ?? null,
      clientTurnId: clientTurnId ?? null,
    }),
  steerMessage: (
    threadId: string,
    message: string,
    attachments?: ChatAttachment[] | null,
    inputItems?: ChatInputItem[] | null,
    planMode?: boolean | null,
  ) =>
    invoke<void>("steer_message", {
      threadId,
      message,
      attachments: attachments ?? null,
      inputItems: inputItems ?? null,
      planMode: planMode ?? null,
    }),
  startCodexReview: (
    threadId: string,
    target: CodexReviewTarget,
    delivery: CodexReviewDelivery,
  ) =>
    invoke<Thread>("start_codex_review", {
      threadId,
      target,
      delivery,
    }),
  cancelTurn: (threadId: string) => invoke<void>("cancel_turn", { threadId }),
  respondApproval: (threadId: string, approvalId: string, response: ApprovalResponse) =>
    invoke<void>("respond_to_approval", { threadId, approvalId, response }),
  getThreadMessages: (threadId: string) =>
    invoke<Message[]>("get_thread_messages", { threadId }),
  getThreadMessagesWindow: (
    threadId: string,
    cursor?: MessageWindowCursor | null,
    limit?: number | null,
  ) =>
    invoke<MessageWindow>("get_thread_messages_window", {
      threadId,
      cursor: cursor ?? null,
      limit: limit ?? null,
    }),
  getMessageBlocks: (messageId: string) =>
    invoke<ContentBlock[] | null>("get_message_blocks", { messageId }),
  getActionOutput: (messageId: string, actionId: string) =>
    invoke<ActionOutputPayload>("get_action_output", { messageId, actionId }),
  searchMessages: (workspaceId: string, query: string) =>
    invoke<SearchResult[]>("search_messages", {
      workspaceId,
      query
    }),
  getGitStatus: (repoPath: string) => invoke<GitStatus>("get_git_status", { repoPath }),
  getFileDiff: (repoPath: string, filePath: string, staged: boolean) =>
    invoke<GitDiffPreview>("get_file_diff", { repoPath, filePath, staged }),
  getGitFileCompare: (
    repoPath: string,
    filePath: string,
    source: GitCompareSource,
  ) =>
    invoke<GitFileCompare>("get_git_file_compare", {
      repoPath,
      filePath,
      source,
    }),
  getFileTree: (repoPath: string) => invoke<FileTreeEntry[]>("get_file_tree", { repoPath }),
  getFileTreePage: (repoPath: string, offset?: number, limit?: number) =>
    invoke<FileTreePage>("get_file_tree_page", { repoPath, offset: offset ?? null, limit: limit ?? null }),
  listDir: (repoPath: string, dirPath: string) =>
    invoke<FileTreeEntry[]>("list_dir", { repoPath, dirPath }),
  stageFiles: (repoPath: string, files: string[]) => invoke<void>("stage_files", { repoPath, files }),
  unstageFiles: (repoPath: string, files: string[]) =>
    invoke<void>("unstage_files", { repoPath, files }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  discardFiles: (repoPath: string, files: string[]) =>
    invoke<void>("discard_files", { repoPath, files }),
  commit: (repoPath: string, message: string) => invoke<string>("commit", { repoPath, message }),
  softResetLastCommit: (repoPath: string) =>
    invoke<void>("soft_reset_last_commit", { repoPath }),
  fetchGit: (repoPath: string) => invoke<void>("fetch_git", { repoPath }),
  pullGit: (repoPath: string) => invoke<void>("pull_git", { repoPath }),
  pushGit: (repoPath: string) => invoke<void>("push_git", { repoPath }),
  listGitBranches: (repoPath: string, scope: GitBranchScope, offset?: number, limit?: number, search?: string) =>
    invoke<GitBranchPage>("list_git_branches", {
      repoPath,
      scope,
      offset: offset ?? null,
      limit: limit ?? null,
      search: search ?? null,
    }),
  checkoutGitBranch: (repoPath: string, branchName: string, isRemote: boolean) =>
    invoke<void>("checkout_git_branch", { repoPath, branchName, isRemote }),
  createGitBranch: (repoPath: string, branchName: string, fromRef?: string | null) =>
    invoke<void>("create_git_branch", { repoPath, branchName, fromRef: fromRef ?? null }),
  renameGitBranch: (repoPath: string, oldName: string, newName: string) =>
    invoke<void>("rename_git_branch", { repoPath, oldName, newName }),
  deleteGitBranch: (repoPath: string, branchName: string, force: boolean) =>
    invoke<void>("delete_git_branch", { repoPath, branchName, force }),
  listGitCommits: (repoPath: string, offset?: number, limit?: number) =>
    invoke<GitCommitPage>("list_git_commits", {
      repoPath,
      offset: offset ?? null,
      limit: limit ?? null,
    }),
  getCommitDiff: (repoPath: string, commitHash: string) =>
    invoke<GitDiffPreview>("get_commit_diff", { repoPath, commitHash }),
  listGitStashes: (repoPath: string) =>
    invoke<GitStash[]>("list_git_stashes", { repoPath }),
  pushGitStash: (repoPath: string, message?: string) =>
    invoke<void>("push_git_stash", { repoPath, message: message ?? null }),
  applyGitStash: (repoPath: string, stashIndex: number) =>
    invoke<void>("apply_git_stash", { repoPath, stashIndex }),
  popGitStash: (repoPath: string, stashIndex: number) =>
    invoke<void>("pop_git_stash", { repoPath, stashIndex }),
  readFile: (repoPath: string, filePath: string) =>
    invoke<ReadFileResult>("read_file", { repoPath, filePath }),
  writeFile: (repoPath: string, filePath: string, content: string) =>
    invoke<void>("write_file", { repoPath, filePath, content }),
  watchGitRepo: (repoPath: string) => invoke<void>("watch_git_repo", { repoPath }),
  addGitWorktree: (repoPath: string, worktreePath: string, branchName: string, baseRef?: string | null) =>
    invoke<GitWorktree>("add_git_worktree", { repoPath, worktreePath, branchName, baseRef: baseRef ?? null }),
  listGitWorktrees: (repoPath: string) =>
    invoke<GitWorktree[]>("list_git_worktrees", { repoPath }),
  removeGitWorktree: (
    repoPath: string,
    worktreePath: string,
    force: boolean,
    branchName?: string | null,
    deleteBranch?: boolean,
  ) =>
    invoke<void>("remove_git_worktree", {
      repoPath,
      worktreePath,
      force,
      branchName: branchName ?? null,
      deleteBranch: deleteBranch ?? false,
    }),
  pruneGitWorktrees: (repoPath: string) =>
    invoke<void>("prune_git_worktrees", { repoPath }),
  initGitRepo: (repoPath: string, validateOnly?: boolean) =>
    invoke<GitInitRepoStatus>("init_git_repo", {
      repoPath,
      validateOnly: validateOnly ?? null,
    }),
  listGitRemotes: (repoPath: string) =>
    invoke<GitRemote[]>("list_git_remotes", { repoPath }),
  addGitRemote: (repoPath: string, name: string, url: string) =>
    invoke<void>("add_git_remote", { repoPath, name, url }),
  removeGitRemote: (repoPath: string, name: string) =>
    invoke<void>("remove_git_remote", { repoPath, name }),
  renameGitRemote: (repoPath: string, oldName: string, newName: string) =>
    invoke<void>("rename_git_remote", { repoPath, oldName, newName }),
  terminalCreateSession: (workspaceId: string, cols: number, rows: number, cwd?: string | null) =>
    invoke<TerminalSession>("terminal_create_session", { workspaceId, cols, rows, cwd: cwd ?? null }),
  terminalWrite: (workspaceId: string, sessionId: string, data: string) =>
    invoke<void>("terminal_write", { workspaceId, sessionId, data }),
  terminalWriteBytes: (workspaceId: string, sessionId: string, data: number[]) =>
    invoke<void>("terminal_write_bytes", { workspaceId, sessionId, data }),
  terminalResize: (
    workspaceId: string,
    sessionId: string,
    cols: number,
    rows: number,
    pixelWidth: number = 0,
    pixelHeight: number = 0,
  ) =>
    invoke<void>("terminal_resize", {
      workspaceId,
      sessionId,
      cols,
      rows,
      pixelWidth,
      pixelHeight,
    }),
  terminalCloseSession: (workspaceId: string, sessionId: string) =>
    invoke<void>("terminal_close_session", { workspaceId, sessionId }),
  terminalCloseWorkspaceSessions: (workspaceId: string) =>
    invoke<void>("terminal_close_workspace_sessions", { workspaceId }),
  terminalListSessions: (workspaceId: string) =>
    invoke<TerminalSession[]>("terminal_list_sessions", { workspaceId }),
  terminalGetRendererDiagnostics: (workspaceId: string, sessionId: string) =>
    invoke<TerminalRendererDiagnostics>("terminal_get_renderer_diagnostics", {
      workspaceId,
      sessionId,
    }),
  terminalResumeSession: (
    workspaceId: string,
    sessionId: string,
    fromSeq?: number | null,
  ) =>
    invoke<TerminalResumeSession>("terminal_resume_session", {
      workspaceId,
      sessionId,
      fromSeq: fromSeq ?? null,
    }),
  terminalListNotifications: (workspaceId: string) =>
    invoke<TerminalNotification[]>("terminal_list_notifications", { workspaceId }),
  terminalClearNotification: (workspaceId: string, sessionId?: string | null) =>
    invoke<void>("terminal_clear_notification", { workspaceId, sessionId: sessionId ?? null }),
  terminalSetNotificationFocus: (
    workspaceId: string | null,
    sessionId: string | null,
    windowFocused: boolean,
  ) =>
    invoke<void>("terminal_set_notification_focus", {
      workspaceId: workspaceId ?? null,
      sessionId: sessionId ?? null,
      windowFocused,
    }),
  checkDependencies: async () =>
    normalizeDependencyReport(
      await invoke<Partial<DependencyReport> | null>("check_dependencies"),
    ),
  installDependency: (dependency: string, method: string) =>
    invoke<InstallResult>("install_dependency", { dependency, method }),
  checkHarnesses: () => invoke<HarnessReport>("check_harnesses"),
  installHarness: (harnessId: string) =>
    invoke<InstallResult>("install_harness", { harnessId }),
  launchHarness: (harnessId: string) =>
    invoke<string>("launch_harness", { harnessId }),
};

export async function listenThreadEvents(
  threadId: string,
  onEvent: (event: StreamEvent) => void
): Promise<UnlistenFn> {
  return listen<StreamEvent>(`stream-event-${threadId}`, ({ payload }) => onEvent(payload));
}

export interface GitRepoChangedEvent {
  repoPath: string;
}

export async function listenGitRepoChanged(
  onEvent: (event: GitRepoChangedEvent) => void
): Promise<UnlistenFn> {
  return listen<GitRepoChangedEvent>("git-repo-changed", ({ payload }) => onEvent(payload));
}

export interface ThreadUpdatedEvent {
  threadId: string;
  workspaceId: string;
  thread?: Thread | null;
}

export interface ChatTurnFinishedEvent {
  threadId: string;
  workspaceId: string;
  engineId: "codex" | "claude";
  threadTitle: string;
  status: "completed" | "interrupted" | "error";
  preview?: string | null;
}

export async function listenThreadUpdated(
  onEvent: (event: ThreadUpdatedEvent) => void
): Promise<UnlistenFn> {
  return listen<ThreadUpdatedEvent>("thread-updated", ({ payload }) => onEvent(payload));
}

export async function listenChatTurnFinished(
  onEvent: (event: ChatTurnFinishedEvent) => void
): Promise<UnlistenFn> {
  return listen<ChatTurnFinishedEvent>("chat-turn-finished", ({ payload }) => onEvent(payload));
}

export async function listenEngineRuntimeUpdated(
  onEvent: (event: EngineRuntimeUpdatedEvent) => void
): Promise<UnlistenFn> {
  return listen<EngineRuntimeUpdatedEvent>(
    "engine-runtime-updated",
    ({ payload }) => onEvent(payload)
  );
}

export async function listenMenuAction(
  onEvent: (action: string) => void
): Promise<UnlistenFn> {
  return listen<string>("menu-action", ({ payload }) => onEvent(payload));
}

export async function listenTerminalOutput(
  workspaceId: string,
  onEvent: (event: TerminalOutputEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>(
    `terminal-output-${workspaceId}`,
    ({ payload }) => onEvent(payload)
  );
}

export async function listenInstallProgress(
  onEvent: (event: InstallProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<InstallProgressEvent>("setup-install-progress", ({ payload }) => onEvent(payload));
}

export async function listenTerminalExit(
  workspaceId: string,
  onEvent: (event: TerminalExitEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>(
    `terminal-exit-${workspaceId}`,
    ({ payload }) => onEvent(payload)
  );
}

export async function listenTerminalForegroundChanged(
  workspaceId: string,
  onEvent: (event: TerminalForegroundChangedEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalForegroundChangedEvent>(
    `terminal-fg-changed-${workspaceId}`,
    ({ payload }) => onEvent(payload)
  );
}

export async function listenTerminalNotification(
  workspaceId: string,
  onEvent: (event: TerminalNotification) => void
): Promise<UnlistenFn> {
  return listen<TerminalNotification>(
    `terminal-notification-${workspaceId}`,
    ({ payload }) => onEvent(payload)
  );
}

export async function listenTerminalNotificationCleared(
  workspaceId: string,
  onEvent: (event: TerminalNotificationClearedEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalNotificationClearedEvent>(
    `terminal-notification-cleared-${workspaceId}`,
    ({ payload }) => onEvent(payload)
  );
}

/**
 * Write a command to a newly created terminal session once the shell is ready.
 * Waits for terminal output (indicating the shell prompt), then writes.
 * Falls back to writing after a timeout if no output is detected.
 */
export async function writeCommandToNewSession(
  workspaceId: string,
  sessionId: string,
  command: string,
): Promise<void> {
  const FALLBACK_TIMEOUT_MS = 3000;
  const POST_OUTPUT_DELAY_MS = 50;

  return new Promise<void>((resolve) => {
    let settled = false;
    let unlisten: (() => void) | undefined;

    const doWrite = () => {
      if (settled) return;
      settled = true;
      unlisten?.();
      invoke<void>("terminal_write", {
        workspaceId,
        sessionId,
        data: command + "\r",
      })
        .catch(() => {})
        .finally(resolve);
    };

    const fallbackTimer = setTimeout(doWrite, FALLBACK_TIMEOUT_MS);

    listen<TerminalOutputEvent>(
      `terminal-output-${workspaceId}`,
      ({ payload }) => {
        if (settled || payload.sessionId !== sessionId) return;
        clearTimeout(fallbackTimer);
        setTimeout(doWrite, POST_OUTPUT_DELAY_MS);
      },
    ).then((fn) => {
      if (settled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
  });
}
