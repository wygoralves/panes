import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../types";

const mockIpc = vi.hoisted(() => ({
  settleThread: vi.fn(),
  unsettleThread: vi.fn(),
}));

vi.mock("./ipc", () => ({
  ipc: mockIpc,
  listenThreadEvents: vi.fn(),
}));

import {
  revealThreadInSidebar,
  settleThreadWithUndo,
  toggleThreadSettlement,
  unsettleThreadWithUndo,
} from "./threadActions";
import { useSidebarListModeStore } from "../stores/sidebarListModeStore";
import { useSidebarViewStore } from "../stores/sidebarViewStore";
import { useThreadStore } from "../stores/threadStore";
import { useToastStore } from "../stores/toastStore";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    workspaceId: "workspace-1",
    repoId: null,
    engineId: "codex",
    modelId: "gpt-5.6-sol",
    engineThreadId: null,
    title: "Lifecycle thread",
    status: "completed",
    messageCount: 1,
    totalTokens: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    lastActivityAt: "2026-09-01T12:00:00.000Z",
    settledAt: null,
    ...overrides,
  };
}

function runLatestToastAction() {
  const toasts = useToastStore.getState().toasts;
  const action = toasts[toasts.length - 1]?.action;
  expect(action).toBeDefined();
  action?.onClick();
}

describe("settle undo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useThreadStore.setState({
      threads: [],
      threadsByWorkspace: {},
      archivedThreadsByWorkspace: {},
      activeThreadId: null,
      loading: false,
      error: undefined,
    });
  });

  it("restores the anchor the row carried before the settle", async () => {
    const original = thread({ unsettledAt: "2026-09-01T11:00:00.000Z" });
    mockIpc.settleThread.mockResolvedValue({
      ...original,
      settledAt: "2026-09-01T13:00:00.000Z",
    });
    mockIpc.unsettleThread.mockResolvedValue(original);

    await settleThreadWithUndo(original);
    runLatestToastAction();
    await Promise.resolve();

    expect(mockIpc.unsettleThread).toHaveBeenCalledWith("thread-1", {
      unsettledAt: "2026-09-01T11:00:00.000Z",
    });
  });

  it("clears the anchor again when the row never had one", async () => {
    const original = thread();
    mockIpc.settleThread.mockResolvedValue({
      ...original,
      settledAt: "2026-09-01T13:00:00.000Z",
    });
    mockIpc.unsettleThread.mockResolvedValue(original);

    await settleThreadWithUndo(original);
    runLatestToastAction();

    expect(mockIpc.unsettleThread).toHaveBeenCalledWith("thread-1", {
      unsettledAt: null,
    });
  });

  it("restores the settle stamp when an un-settle is undone", async () => {
    const original = thread({ settledAt: "2026-09-01T13:00:00.000Z" });
    mockIpc.unsettleThread.mockResolvedValue({ ...original, settledAt: null });
    mockIpc.settleThread.mockResolvedValue(original);

    await unsettleThreadWithUndo(original);
    runLatestToastAction();

    expect(mockIpc.settleThread).toHaveBeenCalledWith("thread-1", {
      settledAt: "2026-09-01T13:00:00.000Z",
    });
  });

  it("explains why a running thread cannot be settled", async () => {
    const running = thread({ status: "streaming" });

    await expect(toggleThreadSettlement(running)).resolves.toBe(false);

    expect(mockIpc.settleThread).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe("info");
  });
});

describe("revealThreadInSidebar", () => {
  beforeEach(() => {
    useSidebarViewStore.setState({
      settledCollapsed: true,
      collapsedProjects: { "workspace-1": true },
    });
  });

  it("opens the settled shelf for a settled row in status mode", () => {
    useSidebarListModeStore.setState({ mode: "status" });

    revealThreadInSidebar(thread({ settledAt: "2026-09-01T13:00:00.000Z" }));

    expect(useSidebarViewStore.getState().settledCollapsed).toBe(false);
  });

  it("leaves the shelf alone for an inbox row", () => {
    useSidebarListModeStore.setState({ mode: "status" });

    revealThreadInSidebar(thread());

    expect(useSidebarViewStore.getState().settledCollapsed).toBe(true);
  });

  it("opens the containing project group in project mode", () => {
    useSidebarListModeStore.setState({ mode: "projects" });

    revealThreadInSidebar(thread());

    expect(
      useSidebarViewStore.getState().collapsedProjects["workspace-1"],
    ).toBe(false);
  });
});
