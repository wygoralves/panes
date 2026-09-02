import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../types";

const mockIpc = vi.hoisted(() => ({
  settleThread: vi.fn(),
  unsettleThread: vi.fn(),
  archiveThread: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

import { useThreadStore } from "./threadStore";
import { useThreadReadStore } from "./threadReadStore";
import { hasUnseenCompletion } from "../components/sidebar/statusGrouping";

function thread(settledAt: string | null = null): Thread {
  return {
    id: "thread-1",
    workspaceId: "workspace-1",
    repoId: null,
    engineId: "codex",
    modelId: "gpt-5.6-sol",
    engineThreadId: "engine-thread-1",
    title: "Lifecycle thread",
    status: "idle",
    messageCount: 1,
    totalTokens: 0,
    createdAt: "2026-09-01T12:00:00.000Z",
    lastActivityAt: "2026-09-01T12:00:00.000Z",
    settledAt,
  };
}

describe("threadStore settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const activeThread = thread();
    useThreadStore.setState({
      threads: [activeThread],
      threadsByWorkspace: { "workspace-1": [activeThread] },
      archivedThreadsByWorkspace: {},
      activeThreadId: activeThread.id,
      loading: false,
      error: undefined,
    });
  });

  it("moves a thread to Settled without changing selection", async () => {
    const settledAt = "2026-09-01T13:00:00.000Z";
    mockIpc.settleThread.mockResolvedValue(thread(settledAt));

    await expect(useThreadStore.getState().settleThread("thread-1")).resolves.toBe(true);

    expect(useThreadStore.getState()).toMatchObject({
      activeThreadId: "thread-1",
      threads: [{ id: "thread-1", settledAt }],
      threadsByWorkspace: {
        "workspace-1": [{ id: "thread-1", settledAt }],
      },
    });
  });

  it("returns a settled thread to Working only through the explicit action", async () => {
    const settled = thread("2026-09-01T13:00:00.000Z");
    useThreadStore.setState({
      threads: [settled],
      threadsByWorkspace: { "workspace-1": [settled] },
    });
    mockIpc.unsettleThread.mockResolvedValue(thread());

    await expect(useThreadStore.getState().unsettleThread("thread-1")).resolves.toBe(true);

    expect(useThreadStore.getState().threads[0]?.settledAt).toBeNull();
  });
});

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    ...thread(),
    id,
    title: id,
    ...overrides,
  };
}

describe("threadStore ordering", () => {
  beforeEach(() => {
    useThreadStore.setState({
      threads: [],
      threadsByWorkspace: {},
      archivedThreadsByWorkspace: {},
      activeThreadId: null,
      loading: false,
      error: undefined,
    });
  });

  it("orders active threads by their anchor, not by activity", () => {
    const older = makeThread("older", { createdAt: "2026-09-01T10:00:00.000Z" });
    const newer = makeThread("newer", { createdAt: "2026-09-01T11:00:00.000Z" });
    useThreadStore.setState({
      threads: [],
      threadsByWorkspace: { "workspace-1": [older, newer] },
    });

    useThreadStore.getState().applyThreadUpdateLocal({
      ...older,
      status: "streaming",
      lastActivityAt: "2026-09-01T23:00:00.000Z",
    });

    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("re-anchors an un-settled thread at the top", () => {
    const settled = makeThread("settled", {
      createdAt: "2026-09-01T09:00:00.000Z",
      settledAt: "2026-09-01T10:00:00.000Z",
    });
    const active = makeThread("active", { createdAt: "2026-09-01T11:00:00.000Z" });
    useThreadStore.setState({
      threadsByWorkspace: { "workspace-1": [settled, active] },
      threads: [],
    });

    useThreadStore.getState().applyThreadUpdateLocal({
      ...settled,
      settledAt: null,
      unsettledAt: "2026-09-01T12:00:00.000Z",
    });

    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual([
      "settled",
      "active",
    ]);
  });

  it("keeps settled threads below active ones", () => {
    const settled = makeThread("settled", {
      createdAt: "2026-09-01T18:00:00.000Z",
      settledAt: "2026-09-01T19:00:00.000Z",
    });
    const active = makeThread("active", { createdAt: "2026-09-01T09:00:00.000Z" });
    useThreadStore.setState({
      threadsByWorkspace: { "workspace-1": [settled, active] },
      threads: [],
    });

    useThreadStore.getState().applyThreadUpdateLocal(active);

    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual([
      "active",
      "settled",
    ]);
  });
});

function createStorageStub() {
  const storage = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

describe("threadStore selection", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageStub());
    useThreadReadStore.setState({ lastVisitedAtByThread: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps a visit when a thread becomes active", () => {
    useThreadStore.getState().setActiveThread("thread-1");

    expect(
      useThreadReadStore.getState().lastVisitedAtByThread["thread-1"],
    ).toBeDefined();
  });

  it("clears an unread completion when the thread is opened", () => {
    useThreadReadStore
      .getState()
      .markThreadUnread("thread-1", "2026-09-01T12:00:00.000Z");
    useThreadStore.getState().setActiveThread("thread-1");

    const visitedAt =
      useThreadReadStore.getState().lastVisitedAtByThread["thread-1"];
    expect(Date.parse(visitedAt)).toBeGreaterThan(
      Date.parse("2026-09-01T12:00:00.000Z"),
    );
  });
});

describe("threadStore read tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageStub());
    useThreadReadStore.setState({ lastVisitedAtByThread: {} });
    const active = makeThread("thread-1", { status: "completed" });
    useThreadStore.setState({
      threads: [active],
      threadsByWorkspace: { "workspace-1": [active] },
      archivedThreadsByWorkspace: {},
      activeThreadId: "thread-1",
      loading: false,
      error: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the open thread read when its own turn completes", () => {
    useThreadReadStore
      .getState()
      .markThreadVisited("thread-1", "2026-09-01T12:00:00.000Z");

    expect(useThreadStore.getState().markThreadReadIfActive("thread-1")).toBe(true);

    const completed = {
      ...makeThread("thread-1", { status: "completed" }),
      lastActivityAt: "2026-09-01T12:30:00.000Z",
    };
    const visitedAt =
      useThreadReadStore.getState().lastVisitedAtByThread["thread-1"] ?? "";

    expect(
      hasUnseenCompletion({
        status: completed.status,
        lastActivityAt: completed.lastActivityAt,
        lastVisitedAt: visitedAt,
      }),
    ).toBe(false);
  });

  it("leaves a background thread unread when its turn completes", () => {
    useThreadStore.setState({ activeThreadId: "other-thread" });

    expect(useThreadStore.getState().markThreadReadIfActive("thread-1")).toBe(false);
    expect(
      useThreadReadStore.getState().lastVisitedAtByThread["thread-1"],
    ).toBeUndefined();
  });

  it("marks a thread read when it is settled", async () => {
    useThreadReadStore
      .getState()
      .markThreadUnread("thread-1", "2026-09-01T12:00:00.000Z");
    mockIpc.settleThread.mockResolvedValue({
      ...makeThread("thread-1"),
      settledAt: "2026-09-01T13:00:00.000Z",
    });

    await useThreadStore.getState().settleThread("thread-1");

    const visitedAt =
      useThreadReadStore.getState().lastVisitedAtByThread["thread-1"] ?? "";
    expect(Date.parse(visitedAt)).toBeGreaterThan(
      Date.parse("2026-09-01T12:00:00.000Z"),
    );
  });

  it("passes the previous stamps back when an undo restores settlement", async () => {
    mockIpc.unsettleThread.mockResolvedValue(makeThread("thread-1"));

    await useThreadStore
      .getState()
      .unsettleThread("thread-1", { unsettledAt: "2026-09-01T09:00:00.000Z" });

    expect(mockIpc.unsettleThread).toHaveBeenCalledWith("thread-1", {
      unsettledAt: "2026-09-01T09:00:00.000Z",
    });
  });

  it("forgets the visit stamp when a thread is archived", async () => {
    useThreadReadStore
      .getState()
      .markThreadVisited("thread-1", "2026-09-01T12:00:00.000Z");
    mockIpc.archiveThread.mockResolvedValue(undefined);

    await useThreadStore.getState().removeThread("thread-1");

    expect(
      useThreadReadStore.getState().lastVisitedAtByThread["thread-1"],
    ).toBeUndefined();
  });
});
