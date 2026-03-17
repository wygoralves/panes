import type { Thread } from "../types";

const EMPTY_REMOTE_THREADS: Thread[] = [];

export function selectWorkspaceThreads(
  threadsByWorkspace: Record<string, Thread[]>,
  workspaceId: string | null,
): Thread[] {
  if (!workspaceId) {
    return EMPTY_REMOTE_THREADS;
  }

  return threadsByWorkspace[workspaceId] ?? EMPTY_REMOTE_THREADS;
}
