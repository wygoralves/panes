import type { Thread, ThreadStatus } from "../../types";

export interface FleetGroups {
  needsYou: Thread[];
  running: Thread[];
  review: Thread[];
  idle: Thread[];
}

export type FleetSectionId = keyof FleetGroups;

const SECTION_BY_STATUS: Record<ThreadStatus, FleetSectionId> = {
  awaiting_approval: "needsYou",
  error: "needsYou",
  streaming: "running",
  completed: "review",
  idle: "idle",
};

function activityTime(thread: Thread): number {
  const parsed = new Date(thread.lastActivityAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Buckets threads into the fleet sections. Input order is preserved for
 * running/review/idle (callers pass the store's recency-sorted list); the
 * needs-you pile instead surfaces the longest-waiting thread first, since
 * lastActivityAt marks when the agent stopped and started waiting.
 */
export function groupThreadsForFleet(threads: Thread[]): FleetGroups {
  const groups: FleetGroups = { needsYou: [], running: [], review: [], idle: [] };
  for (const thread of threads) {
    groups[SECTION_BY_STATUS[thread.status] ?? "idle"].push(thread);
  }
  groups.needsYou.sort((a, b) => activityTime(a) - activityTime(b));
  return groups;
}
