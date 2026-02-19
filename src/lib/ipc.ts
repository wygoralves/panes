import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EngineHealth,
  EngineInfo,
  GitStatus,
  Message,
  Repo,
  StreamEvent,
  Thread,
  Workspace
} from "../types";

export const ipc = {
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  openWorkspace: (path: string) => invoke<Workspace>("open_workspace", { path }),
  getRepos: (workspaceId: string) => invoke<Repo[]>("get_repos", { workspaceId }),
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
  listEngines: () => invoke<EngineInfo[]>("list_engines"),
  engineHealth: (engineId: string) => invoke<EngineHealth>("engine_health", { engineId }),
  sendMessage: (threadId: string, message: string) =>
    invoke<string>("send_message", { threadId, message }),
  cancelTurn: (threadId: string) => invoke<void>("cancel_turn", { threadId }),
  respondApproval: (threadId: string, approvalId: string, response: unknown) =>
    invoke<void>("respond_to_approval", { threadId, approvalId, response }),
  getThreadMessages: (threadId: string) =>
    invoke<Message[]>("get_thread_messages", { threadId }),
  searchMessages: (workspaceId: string, query: string) =>
    invoke<Array<{ threadId: string; messageId: string; snippet: string }>>("search_messages", {
      workspaceId,
      query
    }),
  getGitStatus: (repoPath: string) => invoke<GitStatus>("get_git_status", { repoPath }),
  getFileDiff: (repoPath: string, filePath: string, staged: boolean) =>
    invoke<string>("get_file_diff", { repoPath, filePath, staged }),
  stageFiles: (repoPath: string, files: string[]) => invoke<void>("stage_files", { repoPath, files }),
  unstageFiles: (repoPath: string, files: string[]) =>
    invoke<void>("unstage_files", { repoPath, files }),
  commit: (repoPath: string, message: string) => invoke<string>("commit", { repoPath, message })
};

export async function listenThreadEvents(
  threadId: string,
  onEvent: (event: StreamEvent) => void
): Promise<UnlistenFn> {
  return listen<StreamEvent>(`stream-event-${threadId}`, ({ payload }) => onEvent(payload));
}
