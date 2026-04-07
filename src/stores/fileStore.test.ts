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
const mockWorkspaceState = vi.hoisted(() => ({
  activeWorkspaceId: "ws-1",
  activeRepoId: "repo-1",
  repos: [
    {
      id: "repo-1",
      workspaceId: "ws-1",
      name: "repo",
      path: "/repo",
      defaultBranch: "main",
      isActive: true,
      trustLevel: "trusted" as const,
    },
  ],
}));
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
    getState: () => mockWorkspaceState,
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
    mockWorkspaceState.activeWorkspaceId = "ws-1";
    mockWorkspaceState.activeRepoId = "repo-1";
    mockWorkspaceState.repos = [
      {
        id: "repo-1",
        workspaceId: "ws-1",
        name: "repo",
        path: "/repo",
        defaultBranch: "main",
        isActive: true,
        trustLevel: "trusted",
      },
    ];
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
      workspaceId: "ws-1",
      rootPath: "/repo",
      absolutePath: "/repo/src/app.ts",
      filePath: "src/app.ts",
      gitRepoPath: "/repo",
      gitFilePath: "src/app.ts",
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

  it("opens a plain editor tab with a pending reveal request", async () => {
    await useFileStore
      .getState()
      .openFileAtLocation("/repo", "src/app.ts", { line: 12, column: 4 });

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.renderMode).toBe("plain-editor");
    expect(tab.pendingReveal).toMatchObject({
      line: 12,
      column: 4,
    });
  });

  it("reuses an existing tab and updates its pending reveal without reloading the file", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    mockIpc.readFile.mockClear();

    await useFileStore
      .getState()
      .openFileAtLocation("/repo", "src/app.ts", { line: 28, column: 2 });

    const tab = useFileStore.getState().tabs[0]!;
    expect(useFileStore.getState().activeTabId).toBe(tabId);
    expect(tab.pendingReveal).toMatchObject({
      line: 28,
      column: 2,
    });
    expect(mockIpc.readFile).not.toHaveBeenCalled();
  });

  it("drops stale diff editor views when returning a shared tab to plain mode", async () => {
    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "src/app.ts", { source: "changes" });

    const tabId = useFileStore.getState().tabs[0]!.id;
    mockDestroyCachedEditor.mockClear();

    await useFileStore
      .getState()
      .openFileAtLocation("/repo", "src/app.ts", { line: 8 });

    expect(mockDestroyCachedEditor).toHaveBeenCalledWith(`${tabId}:git-base`);
    expect(mockDestroyCachedEditor).toHaveBeenCalledWith(`${tabId}:git-modified`);
    expect(useFileStore.getState().tabs[0]?.renderMode).toBe("plain-editor");
    expect(useFileStore.getState().tabs[0]?.pendingReveal).toMatchObject({
      line: 8,
      column: null,
    });
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
    expect(mockIpc.writeFile).toHaveBeenCalledWith("/repo", "src/app.ts", "saved\n", "ws-1");
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

  it("clears a pending reveal only when the nonce matches", async () => {
    await useFileStore
      .getState()
      .openFileAtLocation("/repo", "src/app.ts", { line: 3, column: 1 });

    const tab = useFileStore.getState().tabs[0]!;
    const nonce = tab.pendingReveal!.nonce;
    useFileStore.getState().clearPendingReveal(tab.id, "wrong-nonce");
    expect(useFileStore.getState().tabs[0]?.pendingReveal?.nonce).toBe(nonce);

    useFileStore.getState().clearPendingReveal(tab.id, nonce);
    expect(useFileStore.getState().tabs[0]?.pendingReveal).toBeNull();
  });

  it("switches a tab into markdown preview mode and clears git compare state", async () => {
    mockIpc.getGitFileCompare.mockResolvedValueOnce(
      makeCompare({
        modifiedContent: "# Preview\n",
      }),
    );

    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "README.md", { source: "changes" });

    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabRenderMode(tabId, "markdown-preview");

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.renderMode).toBe("markdown-preview");
    expect(tab.gitContext).toBeNull();
    expect(tab.pendingReveal).toBeNull();
  });

  it("reuses the same tab when the file is opened from workspace scope and then promoted to git diff", async () => {
    mockWorkspaceState.activeRepoId = "repo-2";
    mockWorkspaceState.repos = [
      {
        id: "repo-1",
        workspaceId: "ws-1",
        name: "app",
        path: "/workspace/apps/app",
        defaultBranch: "main",
        isActive: true,
        trustLevel: "trusted",
      },
      {
        id: "repo-2",
        workspaceId: "ws-1",
        name: "web",
        path: "/workspace/apps/app/packages/web",
        defaultBranch: "main",
        isActive: true,
        trustLevel: "trusted",
      },
    ];

    await useFileStore
      .getState()
      .openFile("/workspace", "apps/app/packages/web/src/page.tsx");

    const firstTab = useFileStore.getState().tabs[0]!;
    expect(firstTab).toMatchObject({
      workspaceId: "ws-1",
      rootPath: "/workspace",
      absolutePath: "/workspace/apps/app/packages/web/src/page.tsx",
      gitRepoPath: "/workspace/apps/app/packages/web",
      gitFilePath: "src/page.tsx",
      renderMode: "plain-editor",
    });

    await useFileStore
      .getState()
      .openGitDiffFile("/workspace/apps/app/packages/web", "src/page.tsx", {
        source: "changes",
      });

    const state = useFileStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.id).toBe(firstTab.id);
    expect(state.tabs[0]).toMatchObject({
      workspaceId: "ws-1",
      rootPath: "/workspace",
      absolutePath: "/workspace/apps/app/packages/web/src/page.tsx",
      gitRepoPath: "/workspace/apps/app/packages/web",
      gitFilePath: "src/page.tsx",
      renderMode: "git-diff-editor",
    });
  });
});
