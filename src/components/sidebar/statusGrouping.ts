import { normalizeTimestamp } from "../../lib/formatters";
import type { Thread, ThreadStatus } from "../../types";

export interface StatusGroups {
  working: Thread[];
  settled: Thread[];
}

export type StatusSectionId = keyof StatusGroups;

/** Five row states, one resting state. "ready" is the unlabeled state: the
 * engine stopped and the user has already seen the result. */
export type ThreadDisplayStatus =
  | "working"
  | "approval"
  | "failed"
  | "done"
  | "ready";

export interface ThreadDisplayState {
  status: ThreadDisplayStatus;
  isUnread: boolean;
}

export function filterThreadsByWorkspace(
  threads: Thread[],
  workspaceId: string | null,
): Thread[] {
  if (!workspaceId) return threads;
  return threads.filter((thread) => thread.workspaceId === workspaceId);
}

/** Manual lifecycle grouping. Selection and transient engine status never
 * move a thread between Working and Settled. */
export function groupThreadsByStatus(threads: Thread[]): StatusGroups {
  const groups: StatusGroups = { working: [], settled: [] };

  for (const thread of threads) {
    if (thread.settledAt) {
      groups.settled.push(thread);
    } else {
      groups.working.push(thread);
    }
  }

  return groups;
}

/* ─────────────────────────────────────────────────────
   Unread completion
   ───────────────────────────────────────────────────── */

interface UnseenCompletionInput {
  status: ThreadStatus;
  lastActivityAt: string;
  lastVisitedAt?: string | null;
}

/** Backend stamps arrive in two shapes, so every comparison in this module
 * goes through the same normalizing parse. */
export function parseTimestampMs(value?: string | null): number {
  if (!value) return Number.NaN;
  return Date.parse(normalizeTimestamp(value));
}

/** A completion the user has not come back to. A never-visited thread counts
 * as read, so switching list modes never lights up historical threads. */
export function hasUnseenCompletion(input: UnseenCompletionInput): boolean {
  if (input.status !== "completed") return false;

  const completedAt = parseTimestampMs(input.lastActivityAt);
  if (Number.isNaN(completedAt)) return false;

  if (!input.lastVisitedAt) return false;
  const visitedAt = parseTimestampMs(input.lastVisitedAt);
  if (Number.isNaN(visitedAt)) return true;

  return completedAt > visitedAt;
}

/** Row display state. "done" is reserved for completions the user has not
 * seen yet: a read completion rests unlabeled as "ready". The open thread is
 * read by definition, whatever the stamps say: the user is looking at it. */
export function resolveThreadDisplayStatus(
  thread: Thread,
  lastVisitedAt?: string | null,
  isActive = false,
): ThreadDisplayState {
  const isUnread =
    !isActive &&
    hasUnseenCompletion({
      status: thread.status,
      lastActivityAt: thread.lastActivityAt,
      lastVisitedAt,
    });

  if (thread.status === "awaiting_approval") {
    return { status: "approval", isUnread };
  }
  if (thread.status === "streaming") {
    return { status: "working", isUnread };
  }
  if (thread.status === "error") {
    return { status: "failed", isUnread };
  }
  if (isUnread) {
    return { status: "done", isUnread };
  }
  return { status: "ready", isUnread };
}

/** The timestamp a working row counts its elapsed label from: the turn start
 * the backend stamps, falling back to the last activity for threads that
 * started before the column existed. */
export function resolveWorkingStartedAt(thread: Thread): string | null {
  if (thread.status !== "streaming") return null;
  for (const candidate of [thread.turnStartedAt, thread.lastActivityAt]) {
    if (!candidate) continue;
    if (!Number.isNaN(parseTimestampMs(candidate))) {
      return normalizeTimestamp(candidate);
    }
  }
  return null;
}

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.floor(elapsedMs / 1000))
    : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/* ─────────────────────────────────────────────────────
   Static sort
   ───────────────────────────────────────────────────── */

/** NaN-safe parse: a malformed timestamp sinks to the epoch instead of
 * poisoning the whole ordering. */
export function sortableTimestampMs(value?: string | null): number {
  const parsed = parseTimestampMs(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Creation time, re-anchored when the thread leaves the settled shelf, so an
 * un-settled thread surfaces at the top instead of sinking back into its
 * creation slot. Activity never enters the anchor: rows must not move while a
 * thread streams. */
export function activeThreadAnchorMs(thread: {
  createdAt: string;
  unsettledAt?: string | null;
}): number {
  return Math.max(sortableTimestampMs(thread.createdAt), sortableTimestampMs(thread.unsettledAt));
}

export function sortActiveThreads<
  T extends { id: string; createdAt: string; unsettledAt?: string | null },
>(threads: readonly T[]): T[] {
  return [...threads].sort(
    (left, right) =>
      activeThreadAnchorMs(right) - activeThreadAnchorMs(left) ||
      left.id.localeCompare(right.id),
  );
}

/** Settled rows are history, so they order by when the work ended. */
export function sortSettledThreads<
  T extends { id: string; settledAt?: string | null; lastActivityAt: string },
>(threads: readonly T[]): T[] {
  const settledMs = (thread: T) =>
    sortableTimestampMs(thread.settledAt) || sortableTimestampMs(thread.lastActivityAt);
  return [...threads].sort(
    (left, right) =>
      settledMs(right) - settledMs(left) || left.id.localeCompare(right.id),
  );
}

/** One ordering for both list modes: settled rows sink below active ones, and
 * neither group reorders on activity. */
export function sortThreadsForSidebar(threads: readonly Thread[]): Thread[] {
  const groups = groupThreadsByStatus([...threads]);
  return [...sortActiveThreads(groups.working), ...sortSettledThreads(groups.settled)];
}

/* ─────────────────────────────────────────────────────
   Paging
   ───────────────────────────────────────────────────── */

export interface VisibleThreadsResult<T> {
  visibleThreads: T[];
  hiddenCount: number;
}

/** Preview paging that never hides the open thread: navigating into a deep
 * row (search, deep link, keyboard jump) pulls it into the visible slice so
 * its highlight and row actions stay reachable. */
export function getVisibleThreads<T extends { id: string }>(input: {
  threads: readonly T[];
  activeThreadId: string | null;
  visibleCount: number;
}): VisibleThreadsResult<T> {
  const { activeThreadId, threads, visibleCount } = input;
  if (threads.length <= visibleCount) {
    return { visibleThreads: [...threads], hiddenCount: 0 };
  }

  const preview = threads.slice(0, visibleCount);
  const hidden = threads.slice(visibleCount);
  const activeHidden =
    activeThreadId !== null
      ? hidden.find((thread) => thread.id === activeThreadId)
      : undefined;

  if (!activeHidden) {
    return { visibleThreads: preview, hiddenCount: hidden.length };
  }

  return {
    visibleThreads: [...preview, activeHidden],
    hiddenCount: hidden.length - 1,
  };
}

/* ─────────────────────────────────────────────────────
   Keyboard navigation order
   ───────────────────────────────────────────────────── */

/** The order the sidebar renders rows in, flattened for previous/next thread
 * navigation. Status mode is one filtered stream; project mode walks the
 * workspaces in sidebar order. */
export function getSidebarThreadOrder(input: {
  threads: readonly Thread[];
  mode: "projects" | "status";
  workspaceIds: readonly string[];
  projectFilterId: string | null;
}): Thread[] {
  if (input.mode === "status") {
    return sortThreadsForSidebar(
      filterThreadsByWorkspace([...input.threads], input.projectFilterId),
    );
  }

  return input.workspaceIds.flatMap((workspaceId) =>
    sortThreadsForSidebar(
      input.threads.filter((thread) => thread.workspaceId === workspaceId),
    ),
  );
}

export function getAdjacentThreadId(
  order: readonly Thread[],
  activeThreadId: string | null,
  direction: -1 | 1,
): string | null {
  if (order.length === 0) return null;
  if (activeThreadId === null) {
    return direction === 1 ? order[0].id : order[order.length - 1].id;
  }

  const index = order.findIndex((thread) => thread.id === activeThreadId);
  if (index === -1) return order[0].id;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= order.length) return null;
  return order[nextIndex].id;
}
