import { create } from "zustand";
import { normalizeTimestamp } from "../lib/formatters";

const LAST_VISITED_KEY = "panes:threadLastVisitedAt";
const MAX_TRACKED_THREADS = 500;

export type ThreadVisitMap = Record<string, string>;

interface ThreadReadState {
  lastVisitedAtByThread: ThreadVisitMap;
  markThreadVisited: (threadId: string, visitedAt?: string) => void;
  markThreadUnread: (threadId: string, completedAt?: string | null) => boolean;
  forgetThread: (threadId: string) => void;
}

/** A visit only ever moves forward, so a stale event cannot re-open a thread
 * the user already read. */
export function applyThreadVisited(
  visits: ThreadVisitMap,
  threadId: string,
  visitedAt: string,
): ThreadVisitMap {
  const visitedAtMs = Date.parse(normalizeTimestamp(visitedAt));
  if (Number.isNaN(visitedAtMs)) return visits;

  const previous = visits[threadId];
  const previousMs = previous ? Date.parse(normalizeTimestamp(previous)) : Number.NaN;
  if (!Number.isNaN(previousMs) && previousMs >= visitedAtMs) return visits;

  return { ...visits, [threadId]: visitedAt };
}

/** Mark unread by rewinding the visit stamp to just before the completion, so
 * the same comparison that derives unread state keeps working. */
export function applyThreadUnread(
  visits: ThreadVisitMap,
  threadId: string,
  completedAt: string | null | undefined,
): ThreadVisitMap {
  if (!completedAt) return visits;
  const completedAtMs = Date.parse(normalizeTimestamp(completedAt));
  if (Number.isNaN(completedAtMs)) return visits;

  const unreadVisitedAt = new Date(completedAtMs - 1).toISOString();
  if (visits[threadId] === unreadVisitedAt) return visits;

  return { ...visits, [threadId]: unreadVisitedAt };
}

/** Local UI state, so the map is trimmed to the most recent visits instead of
 * growing without bound. */
export function trimVisitMap(
  visits: ThreadVisitMap,
  limit = MAX_TRACKED_THREADS,
): ThreadVisitMap {
  const entries = Object.entries(visits);
  if (entries.length <= limit) return visits;

  return Object.fromEntries(
    entries
      .sort(
        (left, right) =>
          Date.parse(normalizeTimestamp(right[1])) -
          Date.parse(normalizeTimestamp(left[1])),
      )
      .slice(0, limit),
  );
}

function readPersistedVisits(): ThreadVisitMap {
  try {
    const raw = localStorage.getItem(LAST_VISITED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const visits: ThreadVisitMap = {};
    for (const [threadId, visitedAt] of Object.entries(parsed)) {
      if (typeof visitedAt === "string") visits[threadId] = visitedAt;
    }
    return visits;
  } catch {
    return {};
  }
}

function persistVisits(visits: ThreadVisitMap) {
  try {
    localStorage.setItem(LAST_VISITED_KEY, JSON.stringify(visits));
  } catch {
    // Local UI state only: a full or blocked store must not break navigation.
  }
}

export const useThreadReadStore = create<ThreadReadState>((set, get) => ({
  lastVisitedAtByThread: readPersistedVisits(),

  markThreadVisited: (threadId, visitedAt) => {
    const current = get().lastVisitedAtByThread;
    const next = trimVisitMap(
      applyThreadVisited(current, threadId, visitedAt ?? new Date().toISOString()),
    );
    if (next === current) return;
    persistVisits(next);
    set({ lastVisitedAtByThread: next });
  },

  markThreadUnread: (threadId, completedAt) => {
    const current = get().lastVisitedAtByThread;
    const next = applyThreadUnread(current, threadId, completedAt);
    if (next === current) return false;
    persistVisits(next);
    set({ lastVisitedAtByThread: next });
    return true;
  },

  forgetThread: (threadId) => {
    const current = get().lastVisitedAtByThread;
    if (!(threadId in current)) return;
    const next = { ...current };
    delete next[threadId];
    persistVisits(next);
    set({ lastVisitedAtByThread: next });
  },
}));
