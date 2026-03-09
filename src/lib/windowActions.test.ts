import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClose = vi.hoisted(() => vi.fn());
const mockRequestCloseTab = vi.hoisted(() => vi.fn());

const mockWorkspaceState = vi.hoisted(() => ({
  activeWorkspaceId: "ws-1" as string | null,
}));

const mockTerminalState = vi.hoisted(() => ({
  workspaces: {
    "ws-1": {
      layoutMode: "editor",
    },
  } as Record<string, { layoutMode: string }>,
}));

const mockFileState = vi.hoisted(() => ({
  activeTabId: "tab-1" as string | null,
  requestCloseTab: mockRequestCloseTab,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mockClose,
  }),
}));

vi.mock("../stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => mockWorkspaceState,
  },
}));

vi.mock("../stores/terminalStore", () => ({
  useTerminalStore: {
    getState: () => mockTerminalState,
  },
}));

vi.mock("../stores/fileStore", () => ({
  useFileStore: {
    getState: () => mockFileState,
  },
}));

import { closeCurrentWindow, requestWindowClose } from "./windowActions";

describe("windowActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState.activeWorkspaceId = "ws-1";
    mockTerminalState.workspaces = {
      "ws-1": {
        layoutMode: "editor",
      },
    };
    mockFileState.activeTabId = "tab-1";
    mockClose.mockResolvedValue(undefined);
  });

  it("closes the active editor tab for generic close-window requests", async () => {
    await requestWindowClose();

    expect(mockRequestCloseTab).toHaveBeenCalledWith("tab-1");
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("closes the native window for explicit window actions", async () => {
    await closeCurrentWindow();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockRequestCloseTab).not.toHaveBeenCalled();
  });

  it("falls back to closing the native window when no editor tab is active", async () => {
    mockFileState.activeTabId = null;

    await requestWindowClose();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockRequestCloseTab).not.toHaveBeenCalled();
  });
});
