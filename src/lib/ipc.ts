import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ApprovalResponse,
  EngineCheckResult,
  GitBranchPage,
  GitBranchScope,
  GitCommitPage,
  GitStash,
  EngineHealth,
  EngineInfo,
  FileTreeEntry,
  FileTreePage,
  GitStatus,
  Message,
  Repo,
  SearchResult,
  StreamEvent,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSession,
  Thread,
  TrustLevel,
  WorkspaceGitSelectionStatus,
  Workspace
} from "../types";

export const ipc = {
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
  listThreads: (workspaceId: string) => invoke<Thread[]>("list_threads", { workspaceId }),
  listArchivedThreads: (workspaceId: string) =>
    invoke<Thread[]>("list_archived_threads", { workspaceId }),
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
  archiveThread: (threadId: string) => invoke<void>("archive_thread", { threadId }),
  restoreThread: (threadId: string) => invoke<Thread>("restore_thread", { threadId }),
  deleteThread: (threadId: string) => invoke<void>("delete_thread", { threadId }),
  listEngines: () => invoke<EngineInfo[]>("list_engines"),
  engineHealth: (engineId: string) => invoke<EngineHealth>("engine_health", { engineId }),
  runEngineCheck: (engineId: string, command: string) =>
    invoke<EngineCheckResult>("run_engine_check", { engineId, command }),
  sendMessage: (threadId: string, message: string, modelId?: string | null) =>
    invoke<string>("send_message", { threadId, message, modelId: modelId ?? null }),
  cancelTurn: (threadId: string) => invoke<void>("cancel_turn", { threadId }),
  respondApproval: (threadId: string, approvalId: string, response: ApprovalResponse) =>
    invoke<void>("respond_to_approval", { threadId, approvalId, response }),
  getThreadMessages: (threadId: string) =>
    invoke<Message[]>("get_thread_messages", { threadId }),
  searchMessages: (workspaceId: string, query: string) =>
    invoke<SearchResult[]>("search_messages", {
      workspaceId,
      query
    }),
  getGitStatus: (repoPath: string) => invoke<GitStatus>("get_git_status", { repoPath }),
  getFileDiff: (repoPath: string, filePath: string, staged: boolean) =>
    invoke<string>("get_file_diff", { repoPath, filePath, staged }),
  getFileTree: (repoPath: string) => invoke<FileTreeEntry[]>("get_file_tree", { repoPath }),
  getFileTreePage: (repoPath: string, offset?: number, limit?: number) =>
    invoke<FileTreePage>("get_file_tree_page", { repoPath, offset: offset ?? null, limit: limit ?? null }),
  stageFiles: (repoPath: string, files: string[]) => invoke<void>("stage_files", { repoPath, files }),
  unstageFiles: (repoPath: string, files: string[]) =>
    invoke<void>("unstage_files", { repoPath, files }),
  discardFiles: (repoPath: string, files: string[]) =>
    invoke<void>("discard_files", { repoPath, files }),
  commit: (repoPath: string, message: string) => invoke<string>("commit", { repoPath, message }),
  fetchGit: (repoPath: string) => invoke<void>("fetch_git", { repoPath }),
  pullGit: (repoPath: string) => invoke<void>("pull_git", { repoPath }),
  pushGit: (repoPath: string) => invoke<void>("push_git", { repoPath }),
  listGitBranches: (repoPath: string, scope: GitBranchScope, offset?: number, limit?: number) =>
    invoke<GitBranchPage>("list_git_branches", {
      repoPath,
      scope,
      offset: offset ?? null,
      limit: limit ?? null,
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
  listGitStashes: (repoPath: string) =>
    invoke<GitStash[]>("list_git_stashes", { repoPath }),
  applyGitStash: (repoPath: string, stashIndex: number) =>
    invoke<void>("apply_git_stash", { repoPath, stashIndex }),
  popGitStash: (repoPath: string, stashIndex: number) =>
    invoke<void>("pop_git_stash", { repoPath, stashIndex }),
  watchGitRepo: (repoPath: string) => invoke<void>("watch_git_repo", { repoPath }),
  terminalCreateSession: (workspaceId: string, cols: number, rows: number) =>
    invoke<TerminalSession>("terminal_create_session", { workspaceId, cols, rows }),
  terminalWrite: (workspaceId: string, sessionId: string, data: string) =>
    invoke<void>("terminal_write", { workspaceId, sessionId, data }),
  terminalResize: (workspaceId: string, sessionId: string, cols: number, rows: number) =>
    invoke<void>("terminal_resize", { workspaceId, sessionId, cols, rows }),
  terminalCloseSession: (workspaceId: string, sessionId: string) =>
    invoke<void>("terminal_close_session", { workspaceId, sessionId }),
  terminalCloseWorkspaceSessions: (workspaceId: string) =>
    invoke<void>("terminal_close_workspace_sessions", { workspaceId }),
  terminalListSessions: (workspaceId: string) =>
    invoke<TerminalSession[]>("terminal_list_sessions", { workspaceId })
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
}

export async function listenThreadUpdated(
  onEvent: (event: ThreadUpdatedEvent) => void
): Promise<UnlistenFn> {
  return listen<ThreadUpdatedEvent>("thread-updated", ({ payload }) => onEvent(payload));
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

export async function listenTerminalExit(
  workspaceId: string,
  onEvent: (event: TerminalExitEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>(
    `terminal-exit-${workspaceId}`,
    ({ payload }) => onEvent(payload)
  );
}
