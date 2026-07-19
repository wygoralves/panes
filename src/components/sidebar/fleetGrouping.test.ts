import { describe, expect, it } from "vitest";
import { groupThreadsForFleet } from "./fleetGrouping";
import type { Thread, ThreadStatus } from "../../types";

function thread(id: string, status: ThreadStatus, lastActivityAt: string): Thread {
  return {
    id,
    workspaceId: "ws-a",
    repoId: null,
    engineId: "codex",
    modelId: "gpt-5",
    engineThreadId: null,
    title: id,
    status,
    messageCount: 0,
    totalTokens: 0,
    createdAt: lastActivityAt,
    lastActivityAt,
  };
}

describe("groupThreadsForFleet", () => {
  it("buckets each status into its fleet section", () => {
    const groups = groupThreadsForFleet([
      thread("t-approval", "awaiting_approval", "2026-07-19T10:00:00Z"),
      thread("t-error", "error", "2026-07-19T09:00:00Z"),
      thread("t-streaming", "streaming", "2026-07-19T08:00:00Z"),
      thread("t-completed", "completed", "2026-07-19T07:00:00Z"),
      thread("t-idle", "idle", "2026-07-19T06:00:00Z"),
    ]);

    expect(groups.needsYou.map((t) => t.id)).toEqual(["t-error", "t-approval"]);
    expect(groups.running.map((t) => t.id)).toEqual(["t-streaming"]);
    expect(groups.review.map((t) => t.id)).toEqual(["t-completed"]);
    expect(groups.idle.map((t) => t.id)).toEqual(["t-idle"]);
  });

  it("sorts needs-you by longest wait first, keeping other sections in input order", () => {
    const groups = groupThreadsForFleet([
      thread("waiting-briefly", "awaiting_approval", "2026-07-19T11:55:00Z"),
      thread("running-new", "streaming", "2026-07-19T11:50:00Z"),
      thread("waiting-long", "awaiting_approval", "2026-07-19T09:00:00Z"),
      thread("running-old", "streaming", "2026-07-19T08:00:00Z"),
    ]);

    expect(groups.needsYou.map((t) => t.id)).toEqual(["waiting-long", "waiting-briefly"]);
    expect(groups.running.map((t) => t.id)).toEqual(["running-new", "running-old"]);
  });

  it("treats unknown statuses as idle instead of dropping the thread", () => {
    const rogue = thread("t-unknown", "idle", "2026-07-19T06:00:00Z");
    const groups = groupThreadsForFleet([
      { ...rogue, status: "someday_new_status" as ThreadStatus },
    ]);

    expect(groups.idle.map((t) => t.id)).toEqual(["t-unknown"]);
  });

  it("handles unparseable timestamps without throwing", () => {
    const groups = groupThreadsForFleet([
      thread("bad-time", "awaiting_approval", "not-a-date"),
      thread("good-time", "awaiting_approval", "2026-07-19T09:00:00Z"),
    ]);

    expect(groups.needsYou.map((t) => t.id)).toEqual(["bad-time", "good-time"]);
  });
});
