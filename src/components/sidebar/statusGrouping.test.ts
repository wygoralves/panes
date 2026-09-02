import { describe, expect, it } from "vitest";
import {
  filterThreadsByWorkspace,
  formatWorkingDurationLabel,
  getAdjacentThreadId,
  getSidebarThreadOrder,
  getVisibleThreads,
  groupThreadsByStatus,
  groupThreadsForInbox,
  hasUnseenCompletion,
  resolveThreadDisplayStatus,
  resolveWorkingStartedAt,
  sortActiveThreads,
  sortSettledThreads,
  sortThreadsForSidebar,
} from "./statusGrouping";
import type { Thread, ThreadStatus } from "../../types";

function thread(id: string, status: ThreadStatus = "idle"): Thread {
  return {
    id,
    workspaceId: `workspace-${id}`,
    repoId: null,
    engineId: "codex",
    modelId: "gpt-5.6-sol",
    engineThreadId: null,
    title: id,
    status,
    messageCount: 0,
    totalTokens: 0,
    createdAt: "2026-09-01T12:00:00.000Z",
    lastActivityAt: "2026-09-01T12:00:00.000Z",
    settledAt: null,
  };
}

describe("groupThreadsForInbox", () => {
  it("keeps an unsent thread as a draft above everything else", () => {
    const draft = { ...thread("draft", "idle"), messageCount: 0 };
    const idle = { ...thread("idle", "idle"), messageCount: 3 };
    const approval = thread("approval", "awaiting_approval");

    const groups = groupThreadsForInbox([idle, approval, draft], {}, "draft");

    expect(groups.drafts.map((item) => item.id)).toEqual(["draft"]);
    expect(groups.needsYou.map((item) => item.id)).toEqual(["approval"]);
    expect(groups.done.map((item) => item.id)).toEqual(["idle"]);
  });


  it("puts approvals and failures first, oldest waiting on top", () => {
    const approval = {
      ...thread("approval", "awaiting_approval"),
      lastActivityAt: "2026-09-01T12:10:00.000Z",
    };
    const failed = {
      ...thread("failed", "error"),
      lastActivityAt: "2026-09-01T12:05:00.000Z",
    };
    const working = thread("working", "streaming");
    const ready = thread("ready", "completed");
    const settled = { ...thread("settled", "completed"), settledAt: "2026-09-01T13:00:00.000Z" };

    const groups = groupThreadsForInbox([approval, ready, working, settled, failed], {}, null);

    expect(groups.needsYou.map((item) => item.id)).toEqual(["failed", "approval"]);
    expect(groups.working.map((item) => item.id)).toEqual(["working"]);
    expect(groups.done.map((item) => item.id)).toEqual(["ready"]);
    expect(groups.settled.map((item) => item.id)).toEqual(["settled"]);
  });

  it("orders finished threads by most recent activity, unread or not", () => {
    const older = { ...thread("older", "completed"), lastActivityAt: "2026-09-01T11:00:00.000Z" };
    const newer = { ...thread("newer", "completed"), lastActivityAt: "2026-09-01T12:00:00.000Z" };

    const groups = groupThreadsForInbox([older, newer], { older: "2026-09-01T10:00:00.000Z" }, null);

    expect(groups.done.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("keeps the open thread out of Needs you only when its state is a completion", () => {
    const approval = thread("approval", "awaiting_approval");
    const done = { ...thread("done", "completed"), lastActivityAt: "2026-09-01T12:00:00.000Z" };

    const groups = groupThreadsForInbox([approval, done], { done: "2026-09-01T11:00:00.000Z" }, "approval");

    expect(groups.needsYou.map((item) => item.id)).toEqual(["approval"]);
    expect(groups.done.map((item) => item.id)).toEqual(["done"]);
  });
});

describe("groupThreadsByStatus", () => {
  it("groups threads by manual settlement only", () => {
    const settled = {
      ...thread("two", "completed"),
      settledAt: "2026-09-01T12:30:00.000Z",
    };
    const threads = [thread("one"), settled, thread("three", "streaming")];

    expect(groupThreadsByStatus(threads)).toEqual({
      working: [threads[0], threads[2]],
      settled: [settled],
    });
  });

  it("does not move a settled thread when it becomes selected", () => {
    const settled = {
      ...thread("settled"),
      settledAt: "2026-09-01T12:30:00.000Z",
    };

    expect(groupThreadsByStatus([settled])).toEqual({
      working: [],
      settled: [settled],
    });
  });

  it("does not treat a completed turn as manual settlement", () => {
    const completed = thread("completed", "completed");

    expect(groupThreadsByStatus([completed])).toEqual({
      working: [completed],
      settled: [],
    });
  });
});

describe("filterThreadsByWorkspace", () => {
  it("returns every thread when no project is selected", () => {
    const threads = [thread("one"), thread("two")];

    expect(filterThreadsByWorkspace(threads, null)).toBe(threads);
  });

  it("keeps only threads from the selected project", () => {
    const threads = [thread("one"), thread("two"), thread("three")];

    expect(filterThreadsByWorkspace(threads, "workspace-two")).toEqual([threads[1]]);
  });
});

describe("hasUnseenCompletion", () => {
  it("marks a completion the user has not come back to", () => {
    expect(
      hasUnseenCompletion({
        status: "completed",
        lastActivityAt: "2026-09-01T12:30:00.000Z",
        lastVisitedAt: "2026-09-01T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("treats a never-visited thread as read", () => {
    expect(
      hasUnseenCompletion({
        status: "completed",
        lastActivityAt: "2026-09-01T12:30:00.000Z",
        lastVisitedAt: undefined,
      }),
    ).toBe(false);
  });

  it("treats a visit after the completion as read", () => {
    expect(
      hasUnseenCompletion({
        status: "completed",
        lastActivityAt: "2026-09-01T12:30:00.000Z",
        lastVisitedAt: "2026-09-01T12:31:00.000Z",
      }),
    ).toBe(false);
  });

  it("only applies to completed threads", () => {
    for (const status of ["idle", "streaming", "awaiting_approval", "error"] as const) {
      expect(
        hasUnseenCompletion({
          status,
          lastActivityAt: "2026-09-01T12:30:00.000Z",
          lastVisitedAt: "2026-09-01T12:00:00.000Z",
        }),
      ).toBe(false);
    }
  });

  it("compares bare SQLite stamps as UTC", () => {
    expect(
      hasUnseenCompletion({
        status: "completed",
        lastActivityAt: "2026-09-01 12:30:00",
        lastVisitedAt: "2026-09-01T12:31:00.000Z",
      }),
    ).toBe(false);
  });

  it("counts an unparseable visit as never seen", () => {
    expect(
      hasUnseenCompletion({
        status: "completed",
        lastActivityAt: "2026-09-01T12:30:00.000Z",
        lastVisitedAt: "not a date",
      }),
    ).toBe(true);
  });
});

describe("resolveThreadDisplayStatus", () => {
  it("reports what the engine is doing before it reports unread", () => {
    expect(resolveThreadDisplayStatus(thread("a", "streaming")).status).toBe("working");
    expect(resolveThreadDisplayStatus(thread("b", "awaiting_approval")).status).toBe(
      "approval",
    );
    expect(resolveThreadDisplayStatus(thread("c", "error")).status).toBe("failed");
  });

  it("labels a completion only while it is unseen", () => {
    const completed = { ...thread("done", "completed"), lastActivityAt: "2026-09-01T12:30:00.000Z" };

    expect(resolveThreadDisplayStatus(completed, "2026-09-01T12:00:00.000Z")).toEqual({
      status: "done",
      isUnread: true,
    });
    expect(resolveThreadDisplayStatus(completed, "2026-09-01T12:31:00.000Z")).toEqual({
      status: "ready",
      isUnread: false,
    });
  });

  it("never marks the open thread unread", () => {
    const completed = {
      ...thread("done", "completed"),
      lastActivityAt: "2026-09-01T12:30:00.000Z",
    };

    expect(
      resolveThreadDisplayStatus(completed, "2026-09-01T12:00:00.000Z", true),
    ).toEqual({ status: "ready", isUnread: false });
  });
});

describe("resolveWorkingStartedAt", () => {
  it("only counts for a streaming thread", () => {
    expect(resolveWorkingStartedAt(thread("a", "streaming"))).toBe(
      "2026-09-01T12:00:00.000Z",
    );
    expect(resolveWorkingStartedAt(thread("b", "completed"))).toBeNull();
  });

  it("prefers the turn start over the last activity", () => {
    const streaming = {
      ...thread("a", "streaming"),
      turnStartedAt: "2026-09-01T11:00:00Z",
      lastActivityAt: "2026-09-01T12:00:00.000Z",
    };

    expect(resolveWorkingStartedAt(streaming)).toBe("2026-09-01T11:00:00Z");
  });

  it("falls back to the last activity for threads without a turn stamp", () => {
    const streaming = {
      ...thread("a", "streaming"),
      turnStartedAt: null,
      lastActivityAt: "2026-09-01 12:00:00",
    };

    expect(resolveWorkingStartedAt(streaming)).toBe("2026-09-01T12:00:00Z");
  });
});

describe("formatWorkingDurationLabel", () => {
  it("steps from seconds to hours", () => {
    expect(formatWorkingDurationLabel(0)).toBe("0s");
    expect(formatWorkingDurationLabel(42_000)).toBe("42s");
    expect(formatWorkingDurationLabel(5 * 60_000)).toBe("5m");
    expect(formatWorkingDurationLabel(90 * 60_000)).toBe("1h 30m");
  });

  it("never shows a negative or unparseable elapsed time", () => {
    expect(formatWorkingDurationLabel(-5_000)).toBe("0s");
    expect(formatWorkingDurationLabel(Number.NaN)).toBe("0s");
  });
});

describe("sortActiveThreads", () => {
  it("orders by creation anchor, newest first", () => {
    const older = { ...thread("older"), createdAt: "2026-09-01T10:00:00.000Z" };
    const newer = { ...thread("newer"), createdAt: "2026-09-01T11:00:00.000Z" };

    expect(sortActiveThreads([older, newer]).map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("re-anchors an un-settled thread above newer threads", () => {
    const older = {
      ...thread("older"),
      createdAt: "2026-09-01T10:00:00.000Z",
      unsettledAt: "2026-09-01T13:00:00.000Z",
    };
    const newer = { ...thread("newer"), createdAt: "2026-09-01T11:00:00.000Z" };

    expect(sortActiveThreads([newer, older]).map((item) => item.id)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("does not move a row when activity changes", () => {
    const first = { ...thread("first"), createdAt: "2026-09-01T11:00:00.000Z" };
    const second = { ...thread("second"), createdAt: "2026-09-01T10:00:00.000Z" };
    const before = sortActiveThreads([first, second]).map((item) => item.id);

    const streamed = {
      ...second,
      status: "streaming" as const,
      lastActivityAt: "2026-09-01T23:00:00.000Z",
    };

    expect(sortActiveThreads([first, streamed]).map((item) => item.id)).toEqual(before);
  });

  it("breaks ties by id so the order is stable", () => {
    const a = { ...thread("a"), createdAt: "2026-09-01T10:00:00.000Z" };
    const b = { ...thread("b"), createdAt: "2026-09-01T10:00:00.000Z" };

    expect(sortActiveThreads([b, a]).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("sortSettledThreads", () => {
  it("orders by when the work ended", () => {
    const early = { ...thread("early"), settledAt: "2026-09-01T10:00:00.000Z" };
    const late = { ...thread("late"), settledAt: "2026-09-01T14:00:00.000Z" };

    expect(sortSettledThreads([early, late]).map((item) => item.id)).toEqual([
      "late",
      "early",
    ]);
  });

  it("falls back to the last activity when no settle stamp exists", () => {
    const stamped = { ...thread("stamped"), settledAt: "2026-09-01T10:00:00.000Z" };
    const unstamped = {
      ...thread("unstamped"),
      lastActivityAt: "2026-09-01T14:00:00.000Z",
    };

    expect(sortSettledThreads([stamped, unstamped]).map((item) => item.id)).toEqual([
      "unstamped",
      "stamped",
    ]);
  });
});

describe("sortThreadsForSidebar", () => {
  it("keeps settled rows below active ones", () => {
    const active = { ...thread("active"), createdAt: "2026-09-01T09:00:00.000Z" };
    const settled = {
      ...thread("settled"),
      createdAt: "2026-09-01T18:00:00.000Z",
      settledAt: "2026-09-01T19:00:00.000Z",
    };

    expect(sortThreadsForSidebar([settled, active]).map((item) => item.id)).toEqual([
      "active",
      "settled",
    ]);
  });
});

describe("getVisibleThreads", () => {
  const threads = [
    thread("one"),
    thread("two"),
    thread("three"),
    thread("four"),
  ];

  it("returns every thread when nothing is hidden", () => {
    expect(getVisibleThreads({ threads, activeThreadId: null, visibleCount: 4 })).toEqual({
      visibleThreads: threads,
      hiddenCount: 0,
    });
  });

  it("truncates to the preview count", () => {
    const result = getVisibleThreads({ threads, activeThreadId: null, visibleCount: 2 });

    expect(result.visibleThreads.map((item) => item.id)).toEqual(["one", "two"]);
    expect(result.hiddenCount).toBe(2);
  });

  it("never hides the active thread behind Show more", () => {
    const result = getVisibleThreads({
      threads,
      activeThreadId: "four",
      visibleCount: 2,
    });

    expect(result.visibleThreads.map((item) => item.id)).toEqual([
      "one",
      "two",
      "four",
    ]);
    expect(result.hiddenCount).toBe(1);
  });

  it("leaves the preview alone when the active thread is already visible", () => {
    const result = getVisibleThreads({
      threads,
      activeThreadId: "one",
      visibleCount: 2,
    });

    expect(result.visibleThreads.map((item) => item.id)).toEqual(["one", "two"]);
    expect(result.hiddenCount).toBe(2);
  });
});

describe("getSidebarThreadOrder", () => {
  const alpha = {
    ...thread("alpha"),
    workspaceId: "workspace-a",
    createdAt: "2026-09-01T10:00:00.000Z",
  };
  const beta = {
    ...thread("beta"),
    workspaceId: "workspace-a",
    createdAt: "2026-09-01T11:00:00.000Z",
  };
  const gamma = {
    ...thread("gamma"),
    workspaceId: "workspace-b",
    createdAt: "2026-09-01T12:00:00.000Z",
  };

  it("walks projects in sidebar order in project mode", () => {
    const order = getSidebarThreadOrder({
      threads: [gamma, alpha, beta],
      mode: "projects",
      workspaceIds: ["workspace-a", "workspace-b"],
      projectFilterId: null,
    });

    expect(order.map((item) => item.id)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("honours the project filter in status mode", () => {
    const order = getSidebarThreadOrder({
      threads: [gamma, alpha, beta],
      mode: "status",
      workspaceIds: ["workspace-a", "workspace-b"],
      projectFilterId: "workspace-a",
    });

    expect(order.map((item) => item.id)).toEqual(["beta", "alpha"]);
  });
});

describe("getAdjacentThreadId", () => {
  const order = [thread("one"), thread("two"), thread("three")];

  it("moves to the next and previous row", () => {
    expect(getAdjacentThreadId(order, "two", 1)).toBe("three");
    expect(getAdjacentThreadId(order, "two", -1)).toBe("one");
  });

  it("stops at the ends instead of wrapping", () => {
    expect(getAdjacentThreadId(order, "three", 1)).toBeNull();
    expect(getAdjacentThreadId(order, "one", -1)).toBeNull();
  });

  it("starts from the edge when nothing is selected", () => {
    expect(getAdjacentThreadId(order, null, 1)).toBe("one");
    expect(getAdjacentThreadId(order, null, -1)).toBe("three");
    expect(getAdjacentThreadId([], null, 1)).toBeNull();
  });
});
