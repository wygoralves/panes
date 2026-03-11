export interface TerminalDetachState {
  isAttached: boolean;
  detachedAt?: number;
  lastAccessedAt: number;
  needsResumeOnAttach: boolean;
}

export interface DetachedTerminalCacheEntry {
  cacheKey: string;
  isAttached: boolean;
  detachedAt?: number;
  lastAccessedAt: number;
}

function markTerminalDetached(
  session: TerminalDetachState,
  detachedAt: number,
  requireReplayOnAttach: boolean,
): void {
  session.isAttached = false;
  session.detachedAt = detachedAt;
  session.lastAccessedAt = detachedAt;
  if (requireReplayOnAttach) {
    session.needsResumeOnAttach = true;
  }
}

export function markWorkspaceTerminalDetached(
  session: TerminalDetachState,
  detachedAt: number,
): void {
  // Workspace switches tear down the live output listener, so reattach must replay.
  markTerminalDetached(session, detachedAt, true);
}

export function markPaneTerminalDetached(
  session: TerminalDetachState,
  detachedAt: number,
): void {
  markTerminalDetached(session, detachedAt, false);
}

export function shouldEvictDetachedTerminal(
  entry: Omit<DetachedTerminalCacheEntry, "cacheKey">,
  now: number,
  idleEvictionMs: number,
): boolean {
  if (entry.isAttached) {
    return false;
  }
  if (entry.detachedAt === undefined) {
    return true;
  }
  return now - entry.detachedAt >= idleEvictionMs;
}

export function collectDetachedTerminalEvictionKeys(
  entries: DetachedTerminalCacheEntry[],
  now: number,
  idleEvictionMs: number,
): string[] {
  return entries
    .filter((entry) => shouldEvictDetachedTerminal(entry, now, idleEvictionMs))
    .sort((left, right) => {
      const leftDetachedAt = left.detachedAt ?? 0;
      const rightDetachedAt = right.detachedAt ?? 0;
      if (leftDetachedAt !== rightDetachedAt) {
        return leftDetachedAt - rightDetachedAt;
      }
      return left.lastAccessedAt - right.lastAccessedAt;
    })
    .map((entry) => entry.cacheKey);
}
