import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileCompare, ReadFileResult } from "../types";

const mockIpc = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  getGitFileCompare: vi.fn(),
}));

const mockGitStore = vi.hoisted(() => ({
  invalidateRepoCache: vi.fn(),
  refresh: vi.fn(),
}));

const mockSetLayoutMode = vi.hoisted(() => vi.fn());
const mockDestroyCachedEditor = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

vi.mock("./gitStore", () => ({
  useGitStore: {
    getState: () => mockGitStore,
  },
}));

vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      activeWorkspaceId: "ws-1",
    }),
  },
}));

vi.mock("./terminalStore", () => ({
  useTerminalStore: {
    getState: () => ({
      workspaces: {
        "ws-1": {
          layoutMode: "editor",
          preEditorLayoutMode: "chat",
        },
      },
      setLayoutMode: mockSetLayoutMode,
    }),
  },
}));

vi.mock("./toastStore", () => ({
  toast: mockToast,
}));

vi.mock("../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../components/editor/CodeMirrorEditor", () => ({
  destroyCachedEditor: mockDestroyCachedEditor,
}));

import { useFileStore } from "./fileStore";

function makeReadFileResult(content: string): ReadFileResult {
  return {
    content,
    sizeBytes: content.length,
    isBinary: false,
  };
}

function makeCompare(
  overrides: Partial<GitFileCompare> = {},
): GitFileCompare {
  return {
    source: "changes",
    baseContent: "before\n",
    modifiedContent: "after\n",
    baseLabel: "Index",
    modifiedLabel: "Working Tree",
    changeType: "modified",
    hasStagedChanges: false,
    hasUnstagedChanges: true,
    isBinary: false,
    isEditable: true,
    fallbackReason: null,
    ...overrides,
  };
}

describe("fileStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("plain\n"));
    mockIpc.writeFile.mockResolvedValue(undefined);
    mockIpc.getGitFileCompare.mockResolvedValue(makeCompare());
    mockGitStore.refresh.mockResolvedValue(undefined);

    useFileStore.setState({
      tabs: [],
      activeTabId: null,
      pendingCloseTabId: null,
    });
  });

  it("opens a file from git context in the shared tab model", async () => {
    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "src/app.ts", { source: "changes" });

    const state = useFileStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0]?.id);
    expect(state.tabs[0]).toMatchObject({
      repoPath: "/repo",
      filePath: "src/app.ts",
      renderMode: "git-diff-editor",
      content: "after\n",
      savedContent: "after\n",
      isDirty: false,
    });
    expect(state.tabs[0]?.gitContext?.baseLabel).toBe("Index");
    expect(mockIpc.getGitFileCompare).toHaveBeenCalledWith(
      "/repo",
      "src/app.ts",
      "changes",
    );
  });

  it("preserves unsaved content when promoting an open tab to git diff mode", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;

    useFileStore.getState().setTabContent(tabId, "locally edited\n");
    mockIpc.getGitFileCompare.mockResolvedValueOnce(
      makeCompare({ modifiedContent: "on-disk\n" }),
    );

    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "src/app.ts", { source: "changes" });

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.renderMode).toBe("git-diff-editor");
    expect(tab.content).toBe("locally edited\n");
    expect(tab.savedContent).toBe("plain\n");
    expect(tab.isDirty).toBe(true);
    expect(tab.gitContext?.modifiedContent).toBe("on-disk\n");
    expect(mockDestroyCachedEditor).toHaveBeenCalledWith(tabId);
  });

  it("drops stale diff editor views when returning a shared tab to plain mode", async () => {
    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "src/app.ts", { source: "changes" });

    const tabId = useFileStore.getState().tabs[0]!.id;
    mockDestroyCachedEditor.mockClear();

    await useFileStore.getState().openFile("/repo", "src/app.ts");

    expect(mockDestroyCachedEditor).toHaveBeenCalledWith(`${tabId}:git-base`);
    expect(mockDestroyCachedEditor).toHaveBeenCalledWith(`${tabId}:git-modified`);
    expect(useFileStore.getState().tabs[0]?.renderMode).toBe("plain-editor");
  });

  it("refreshes git state and compare metadata after saving a git diff tab", async () => {
    mockIpc.getGitFileCompare
      .mockResolvedValueOnce(makeCompare({ modifiedContent: "after\n" }))
      .mockResolvedValueOnce(makeCompare({ modifiedContent: "saved\n" }));

    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "src/app.ts", { source: "changes" });

    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "saved\n");
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("after\n"));

    await useFileStore.getState().saveTab(tabId);

    const tab = useFileStore.getState().tabs[0]!;
    expect(mockIpc.writeFile).toHaveBeenCalledWith("/repo", "src/app.ts", "saved\n");
    expect(mockGitStore.invalidateRepoCache).toHaveBeenCalledWith("/repo");
    expect(mockGitStore.refresh).toHaveBeenCalledWith("/repo", { force: true });
    expect(mockIpc.getGitFileCompare).toHaveBeenLastCalledWith(
      "/repo",
      "src/app.ts",
      "changes",
    );
    expect(tab.savedContent).toBe("saved\n");
    expect(tab.isDirty).toBe(false);
  });
});
