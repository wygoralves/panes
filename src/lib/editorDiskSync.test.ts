import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => ({
  chatTurnFinished: null as ((event: { workspaceId: string }) => void) | null,
  gitRepoChanged: null as ((event: { repoPath: string }) => void) | null,
}));

const mockFileState = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; workspaceId: string | null; absolutePath: string }>,
  reloadTabFromDisk: vi.fn(),
}));

vi.mock("./ipc", () => ({
  listenChatTurnFinished: vi.fn(async (handler: (event: { workspaceId: string }) => void) => {
    listeners.chatTurnFinished = handler;
    return () => {};
  }),
  listenGitRepoChanged: vi.fn(async (handler: (event: { repoPath: string }) => void) => {
    listeners.gitRepoChanged = handler;
    return () => {};
  }),
}));

vi.mock("../stores/fileStore", () => ({
  useFileStore: {
    getState: () => mockFileState,
  },
}));

import { startEditorDiskSync } from "./editorDiskSync";

describe("editorDiskSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFileState.tabs = [
      { id: "repo-tab", workspaceId: "ws-1", absolutePath: "/repo/src/app.ts" },
      { id: "other-tab", workspaceId: "ws-2", absolutePath: "/other/readme.md" },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads the tabs of the workspace whose turn finished, once per burst", async () => {
    const stop = startEditorDiskSync();
    await vi.waitFor(() => expect(listeners.chatTurnFinished).not.toBeNull());

    listeners.chatTurnFinished!({ workspaceId: "ws-1" });
    listeners.chatTurnFinished!({ workspaceId: "ws-1" });
    await vi.runAllTimersAsync();

    expect(mockFileState.reloadTabFromDisk).toHaveBeenCalledTimes(1);
    expect(mockFileState.reloadTabFromDisk).toHaveBeenCalledWith("repo-tab");
    stop();
  });

  it("reloads tabs under a repo after a git change", async () => {
    const stop = startEditorDiskSync();
    await vi.waitFor(() => expect(listeners.gitRepoChanged).not.toBeNull());

    listeners.gitRepoChanged!({ repoPath: "/other" });
    await vi.runAllTimersAsync();

    expect(mockFileState.reloadTabFromDisk).toHaveBeenCalledTimes(1);
    expect(mockFileState.reloadTabFromDisk).toHaveBeenCalledWith("other-tab");
    stop();
  });
});
