import type { Repo, Thread } from "../types";

/** The worktree a thread is bound to, if any. Stored on thread metadata so it
 * travels with the other per-thread execution overrides. */
export function readThreadWorktreePath(
  thread: Pick<Thread, "engineMetadata"> | null | undefined,
): string | null {
  const value = thread?.engineMetadata?.worktreePath;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Directory the thread's turns run in: its worktree when bound, otherwise
 * the repo checkout. Null when the thread has no repo scope. */
export function resolveThreadWorkingDirectory(
  thread: Pick<Thread, "engineMetadata"> | null | undefined,
  repo: Pick<Repo, "path"> | null | undefined,
): string | null {
  if (!repo) return null;
  return readThreadWorktreePath(thread) ?? repo.path;
}

/** Marker the backend puts on a worktree removal it refused because a bound
 * thread is mid-turn. The UI swaps it for localized copy. */
export const WORKTREE_BUSY_ERROR_PREFIX = "worktree_busy:";

/** Names of the running threads that blocked a worktree removal, or null when
 * the failure was something else. */
export function readBusyWorktreeThreads(error: unknown): string[] | null {
  const raw = String(error);
  const marker = raw.indexOf(WORKTREE_BUSY_ERROR_PREFIX);
  if (marker < 0) return null;
  return raw
    .slice(marker + WORKTREE_BUSY_ERROR_PREFIX.length)
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}
