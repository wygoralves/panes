import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUiState = vi.hoisted(() => {
  const state = {
    showExplorer: false,
    activeView: "harnesses" as "chat" | "harnesses" | "workspace-settings",
    setActiveView: vi.fn((view: "chat" | "harnesses" | "workspace-settings") => {
      state.activeView = view;
    }),
    setExplorerOpen: vi.fn((open: boolean) => {
      state.showExplorer = open;
    }),
  };

  return state;
});

const mockSetLayoutMode = vi.hoisted(() => vi.fn());
const mockShowSurface = vi.hoisted(() => vi.fn());
const mockWorkspaceState = vi.hoisted(() => ({
  activeWorkspaceId: "ws-1" as string | null,
}));

vi.mock("../../lib/ipc", () => ({
  ipc: {},
  writeCommandToNewSession: vi.fn(),
}));

vi.mock("../../stores/uiStore", () => ({
  useUiStore: {
    getState: () => mockUiState,
  },
}));

vi.mock("../../stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => mockWorkspaceState,
  },
}));

vi.mock("../../stores/threadStore", () => ({
  useThreadStore: {
    getState: () => ({}),
  },
}));

vi.mock("../../stores/chatStore", () => ({
  useChatStore: {
    getState: () => ({}),
  },
}));

vi.mock("../../stores/gitStore", () => ({
  useGitStore: {
    getState: () => ({}),
  },
}));

vi.mock("../../stores/fileStore", () => ({
  useFileStore: {
    getState: () => ({}),
  },
}));

vi.mock("../../stores/harnessStore", () => ({
  useHarnessStore: {
    getState: () => ({}),
  },
}));

vi.mock("../../stores/keepAwakeStore", () => ({
  canToggleKeepAwake: () => false,
  useKeepAwakeStore: {
    getState: () => ({
      state: null,
      toggle: vi.fn(),
      loadPowerSettings: vi.fn(),
      setPowerSettingsOpen: vi.fn(),
    }),
  },
}));

vi.mock("../../stores/toastStore", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../../stores/terminalStore", () => ({
  useTerminalStore: {
    getState: () => ({
      setLayoutMode: mockSetLayoutMode,
      workspaces: {},
    }),
  },
}));

vi.mock("../../stores/workspacePaneStore", () => ({
  collectWorkspacePaneLeaves: vi.fn(() => []),
  getWorkspacePaneActiveTab: vi.fn(() => null),
  useWorkspacePaneStore: {
    getState: () => ({
      showSurface: mockShowSurface,
      applyLegacyLayoutMode: vi.fn(),
      workspaces: {},
    }),
  },
}));

describe("CommandPalette view-files command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUiState.showExplorer = false;
    mockUiState.activeView = "harnesses";
    mockWorkspaceState.activeWorkspaceId = "ws-1";
  });

  it("routes back to chat, opens the explorer, and switches to editor layout", async () => {
    const { getStaticCommands } = await import("./CommandPalette");
    const close = vi.fn();
    const command = getStaticCommands(((key: string) => key) as never).find(
      (entry) => entry.id === "view-files",
    );

    await command?.action({
      activeWorkspaceId: "ws-1",
      activeRepoPath: null,
      repos: [],
      close,
      openSubFlow: vi.fn(),
    });

    expect(command?.label).toBe("commandPalette.commands.viewFiles");
    expect(mockUiState.setActiveView).toHaveBeenCalledWith("chat");
    expect(mockUiState.setExplorerOpen).toHaveBeenCalledWith(true);
    expect(mockShowSurface).toHaveBeenCalledWith("ws-1", "editor");
    expect(mockSetLayoutMode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
