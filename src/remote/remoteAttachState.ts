import type { Thread } from "../types";

const EMPTY_REMOTE_THREADS: Thread[] = [];
export const REMOTE_THREAD_SCOPE_WORKSPACE_VALUE = "__workspace__";

export function selectWorkspaceThreads(
  threadsByWorkspace: Record<string, Thread[]>,
  workspaceId: string | null,
): Thread[] {
  if (!workspaceId) {
    return EMPTY_REMOTE_THREADS;
  }

  return threadsByWorkspace[workspaceId] ?? EMPTY_REMOTE_THREADS;
}

export function resolveRemoteThreadScopeValue(repoId: string | null): string {
  return repoId ?? REMOTE_THREAD_SCOPE_WORKSPACE_VALUE;
}

export function parseRemoteThreadScopeValue(value: string): string | null {
  return value === REMOTE_THREAD_SCOPE_WORKSPACE_VALUE ? null : value || null;
}

export function resolveRemoteChatRepoId(
  activeThreadRepoId: string | null,
  draftRepoId: string | null,
  hasActiveThread: boolean,
): string | null {
  return hasActiveThread ? activeThreadRepoId : draftRepoId;
}
