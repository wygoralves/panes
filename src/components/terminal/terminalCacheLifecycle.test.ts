import { describe, expect, it } from "vitest";
import {
  collectDetachedTerminalEvictionKeys,
  markPaneTerminalDetached,
  markWorkspaceTerminalDetached,
  shouldEvictDetachedTerminal,
  type TerminalDetachState,
} from "./terminalCacheLifecycle";

function makeSessionState(
  overrides: Partial<TerminalDetachState> = {},
): TerminalDetachState {
  return {
    isAttached: true,
    detachedAt: undefined,
    lastAccessedAt: 0,
    needsResumeOnAttach: false,
    ...overrides,
  };
}

describe("terminalCacheLifecycle", () => {
  it("forces replay when a workspace terminal detaches", () => {
    const session = makeSessionState({
      isAttached: true,
      lastAccessedAt: 10,
      needsResumeOnAttach: false,
    });

    markWorkspaceTerminalDetached(session, 250);

    expect(session).toMatchObject({
      isAttached: false,
      detachedAt: 250,
      lastAccessedAt: 250,
      needsResumeOnAttach: true,
    });
  });

  it("keeps pane detaches from forcing a replay", () => {
    const session = makeSessionState({
      isAttached: true,
      lastAccessedAt: 10,
      needsResumeOnAttach: false,
    });

    markPaneTerminalDetached(session, 400);

    expect(session).toMatchObject({
      isAttached: false,
      detachedAt: 400,
      lastAccessedAt: 400,
      needsResumeOnAttach: false,
    });
  });

  it("does not evict fresh detached terminals just because many are parked", () => {
    const now = 1_000_000;
    const freshDetached = Array.from({ length: 6 }, (_, index) => ({
      cacheKey: `ws::${index}`,
      isAttached: false,
      detachedAt: now - 30_000,
      lastAccessedAt: now - 30_000 + index,
    }));

    expect(
      collectDetachedTerminalEvictionKeys(freshDetached, now, 120_000),
    ).toEqual([]);
  });

  it("evicts detached terminals after the idle timeout", () => {
    const now = 1_000_000;

    expect(
      collectDetachedTerminalEvictionKeys(
        [
          {
            cacheKey: "stale",
            isAttached: false,
            detachedAt: now - 130_000,
            lastAccessedAt: now - 130_000,
          },
          {
            cacheKey: "fresh",
            isAttached: false,
            detachedAt: now - 5_000,
            lastAccessedAt: now - 5_000,
          },
          {
            cacheKey: "attached",
            isAttached: true,
            detachedAt: undefined,
            lastAccessedAt: now,
          },
        ],
        now,
        120_000,
      ),
    ).toEqual(["stale"]);
  });

  it("treats detached entries without a timestamp as evictable", () => {
    expect(
      shouldEvictDetachedTerminal(
        {
          isAttached: false,
          detachedAt: undefined,
          lastAccessedAt: 0,
        },
        1_000,
        120_000,
      ),
    ).toBe(true);
  });
});
