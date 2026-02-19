import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ApprovalResponse,
  EngineHealth,
  EngineInfo,
  GitStatus,
  Message,
  Repo,
  SearchResult,
  StreamEvent,
  Thread,
  TrustLevel,
  Workspace
} from "../types";

export const ipc = {
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  openWorkspace: (path: string) => invoke<Workspace>("open_workspace", { path }),
  deleteWorkspace: (workspaceId: string) => invoke<void>("delete_workspace", { workspaceId }),
  getRepos: (workspaceId: string) => invoke<Repo[]>("get_repos", { workspaceId }),
  setRepoTrustLevel: (repoId: string, trustLevel: TrustLevel) =>
    invoke<void>("set_repo_trust_level", { repoId, trustLevel }),
  listThreads: (workspaceId: string) => invoke<Thread[]>("list_threads", { workspaceId }),
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
  deleteThread: (threadId: string) => invoke<void>("delete_thread", { threadId }),
  listEngines: () => invoke<EngineInfo[]>("list_engines"),
  engineHealth: (engineId: string) => invoke<EngineHealth>("engine_health", { engineId }),
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
  stageFiles: (repoPath: string, files: string[]) => invoke<void>("stage_files", { repoPath, files }),
  unstageFiles: (repoPath: string, files: string[]) =>
    invoke<void>("unstage_files", { repoPath, files }),
  commit: (repoPath: string, message: string) => invoke<string>("commit", { repoPath, message }),
  watchGitRepo: (repoPath: string) => invoke<void>("watch_git_repo", { repoPath })
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
