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
import { buildGitDiffModel } from "../components/editor/gitDiffModel";

function makeReadFileResult(
  content: string,
  overrides: Partial<ReadFileResult> = {},
): ReadFileResult {
  return {
    content,
    sizeBytes: content.length,
    isBinary: false,
    isLossyDecode: false,
    ...overrides,
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

  it("opens markdown files in preview mode by default", async () => {
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("# Readme\n"));

    await useFileStore.getState().openFile("/repo", "README.md");

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.renderMode).toBe("markdown-preview");
    expect(tab.pendingReveal).toBeNull();
    expect(tab.content).toBe("# Readme\n");
  });

  it("opens markdown files in plain mode when a line reveal is requested", async () => {
    await useFileStore
      .getState()
      .openFileAtLocation("/repo", "README.md", { line: 12, column: 4 });

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.renderMode).toBe("plain-editor");
    expect(tab.pendingReveal).toMatchObject({
      line: 12,
      column: 4,
    });
  });

  it("reuses an existing tab and updates its pending reveal while keeping unchanged disk content", async () => {
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
    expect(mockIpc.readFile).toHaveBeenCalledTimes(1);
    expect(tab.content).toBe("plain\n");
    expect(tab.isDirty).toBe(false);
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

  it("keeps the editor layout active after closing the last tab", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");

    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().closeTab(tabId);

    expect(useFileStore.getState()).toMatchObject({
      tabs: [],
      activeTabId: null,
    });
    expect(mockSetLayoutMode).not.toHaveBeenCalled();
  });

  it("retargets open tabs after a directory rename so saves use the new path", async () => {
    mockWorkspaceState.activeRepoId = "repo-1";
    mockWorkspaceState.repos = [
      {
        id: "repo-1",
        workspaceId: "ws-1",
        name: "repo",
        path: "/workspace/apps/app",
        defaultBranch: "main",
        isActive: true,
        trustLevel: "trusted",
      },
    ];

    await useFileStore
      .getState()
      .openFile("/workspace", "apps/app/src/page.tsx");

    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "updated\n");
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("plain\n"));

    useFileStore
      .getState()
      .retargetTabsAfterRename("/workspace", "apps/app/src", "apps/app/source");

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab).toMatchObject({
      absolutePath: "/workspace/apps/app/source/page.tsx",
      filePath: "apps/app/source/page.tsx",
      fileName: "page.tsx",
      gitRepoPath: "/workspace/apps/app",
      gitFilePath: "source/page.tsx",
    });

    await useFileStore.getState().saveTab(tabId);

    expect(mockIpc.writeFile).toHaveBeenCalledWith(
      "/workspace",
      "apps/app/source/page.tsx",
      "updated\n",
      "ws-1",
      "plain\n",
    );
  });

  it("retargets git diff tabs when their repo root is renamed", async () => {
    mockWorkspaceState.activeRepoId = "repo-1";
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
    ];

    mockIpc.getGitFileCompare.mockResolvedValueOnce(makeCompare({ modifiedContent: "before\n" }));

    await useFileStore
      .getState()
      .openGitDiffFile("/workspace/apps/app", "src/app.ts", { source: "changes" });

    useFileStore
      .getState()
      .retargetTabsAfterRename("/workspace", "apps/app", "apps/renamed-app");

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab).toMatchObject({
      rootPath: "/workspace/apps/renamed-app",
      absolutePath: "/workspace/apps/renamed-app/src/app.ts",
      filePath: "src/app.ts",
      gitRepoPath: "/workspace/apps/renamed-app",
      gitFilePath: "src/app.ts",
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
    expect(mockIpc.writeFile).toHaveBeenCalledWith("/repo", "src/app.ts", "saved\n", "ws-1", "after\n");
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

  it("diffs a CRLF git diff tab against an LF base so only the changed line shows", async () => {
    mockIpc.getGitFileCompare.mockResolvedValueOnce(
      makeCompare({ baseContent: "a\r\nb\r\nc\r\n", modifiedContent: "a\r\nB\r\nc\r\n" }),
    );
    await useFileStore.getState().openGitDiffFile("/repo", "src/app.bat", { source: "changes" });
    const tab = useFileStore.getState().tabs[0]!;

    const model = buildGitDiffModel(tab.gitContext!.baseContent, tab.content);

    expect(model.hunks).toHaveLength(1);
    expect(model.hunks[0]!.baseRange).toEqual({ fromLine: 2, toLine: 2 });
    expect(model.hunks[0]!.modifiedRange).toEqual({ fromLine: 2, toLine: 2 });

    useFileStore.getState().setTabContent(tab.id, "a\nB2\nc\n");
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("a\r\nB\r\nc\r\n"));
    await expect(useFileStore.getState().saveTab(tab.id)).resolves.toBe(true);
    expect(mockIpc.writeFile).toHaveBeenCalledWith(
      "/repo",
      "src/app.bat",
      "a\r\nB2\r\nc\r\n",
      "ws-1",
      "a\r\nB\r\nc\r\n",
    );
  });

  it("keeps a git diff tab CRLF after a save leaves the file on one line", async () => {
    mockIpc.getGitFileCompare
      .mockResolvedValueOnce(makeCompare({ modifiedContent: "a\r\nb\r\n" }))
      .mockResolvedValue(makeCompare({ modifiedContent: "a" }));
    await useFileStore
      .getState()
      .openGitDiffFile("/repo", "src/app.bat", { source: "changes" });
    const tabId = useFileStore.getState().tabs[0]!.id;
    expect(useFileStore.getState().tabs[0]!.lineEnding).toBe("\r\n");

    useFileStore.getState().setTabContent(tabId, "a");
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("a\r\nb\r\n"));
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(true);
    expect(useFileStore.getState().tabs[0]!.lineEnding).toBe("\r\n");

    useFileStore.getState().setTabContent(tabId, "a\nb\n");
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("a"));
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(true);

    expect(mockIpc.writeFile).toHaveBeenLastCalledWith("/repo", "src/app.bat", "a\r\nb\r\n", "ws-1", "a");
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

  it("keeps CRLF files LF in the buffer and writes CRLF back on save", async () => {
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a\r\nb\r\n"));
    await useFileStore.getState().openFile("/repo", "win.bat");
    const tabId = useFileStore.getState().tabs[0]!.id;

    const opened = useFileStore.getState().tabs[0]!;
    expect(opened.content).toBe("a\nb\n");
    expect(opened.savedContent).toBe("a\nb\n");
    expect(opened.lineEnding).toBe("\r\n");

    useFileStore.getState().setTabContent(tabId, "a\nb\nc\n");
    useFileStore.getState().setTabContent(tabId, "a\nb\n");
    expect(useFileStore.getState().tabs[0]!.isDirty).toBe(false);

    useFileStore.getState().setTabContent(tabId, "a\nb\nc\n");
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(true);

    expect(mockIpc.writeFile).toHaveBeenCalledWith(
      "/repo",
      "win.bat",
      "a\r\nb\r\nc\r\n",
      "ws-1",
      "a\r\nb\r\n",
    );
    expect(useFileStore.getState().tabs[0]!.isDirty).toBe(false);
  });

  it("opens non-UTF-8 files read-only and never writes them", async () => {
    mockIpc.readFile.mockResolvedValue(
      makeReadFileResult("caf�\n", { isLossyDecode: true }),
    );
    await useFileStore.getState().openFile("/repo", "latin1.txt");
    const tabId = useFileStore.getState().tabs[0]!.id;
    expect(useFileStore.getState().tabs[0]!.readOnlyReason).toBe("non-utf8");

    useFileStore.getState().setTabContent(tabId, "cafe\n");
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);

    expect(mockIpc.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ["mixed endings with an LF majority", "a\r\nb\nc\n"],
    ["mixed endings with a CRLF majority", "x\r\ny\r\nz\n"],
    ["a lone CR inside a line", "progress 10%\rprogress 100%\n"],
    ["classic Mac CR-only endings", "a\rb\rc\r"],
  ])("opens a file with %s read-only and never writes it", async (_label, raw) => {
    mockIpc.readFile.mockResolvedValue(makeReadFileResult(raw));
    await useFileStore.getState().openFile("/repo", "mixed.txt");
    const tabId = useFileStore.getState().tabs[0]!.id;
    expect(useFileStore.getState().tabs[0]!.readOnlyReason).toBe("mixed-line-endings");

    useFileStore.getState().setTabContent(tabId, "edited\n");
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);

    expect(mockIpc.writeFile).not.toHaveBeenCalled();
  });

  it("opens a git diff of a file with mixed endings read-only", async () => {
    mockIpc.getGitFileCompare.mockResolvedValueOnce(
      makeCompare({ modifiedContent: "a\r\nb\nc\n" }),
    );
    await useFileStore.getState().openGitDiffFile("/repo", "src/app.ts", { source: "changes" });

    expect(useFileStore.getState().tabs[0]!.readOnlyReason).toBe("mixed-line-endings");
  });

  it("holds the save when the file's endings became mixed on disk after it loaded", async () => {
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a\nb\nc\n"));
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "a\nb\nC\n");
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a\r\nb\nc\n"));

    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);

    expect(mockIpc.writeFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().tabs[0]!.diskConflict).toEqual({ diskContent: "a\nb\nc\n" });
  });

  it("reloads a clean tab when the file changed on disk", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("agent edit\n"));

    await useFileStore.getState().openFile("/repo", "src/app.ts");

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.content).toBe("agent edit\n");
    expect(tab.savedContent).toBe("agent edit\n");
    expect(tab.isDirty).toBe(false);
    expect(tab.diskConflict ?? null).toBeNull();
  });

  it("flags a conflict instead of replacing a dirty buffer when the disk changed", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "mine\n");
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("agent edit\n"));

    await useFileStore.getState().reloadTabFromDisk(tabId);

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.content).toBe("mine\n");
    expect(tab.savedContent).toBe("plain\n");
    expect(tab.diskConflict).toEqual({ diskContent: "agent edit\n" });
  });

  it("does not overwrite newer disk content on repeated saves until the user keeps theirs", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "mine\n");
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("agent edit\n"));

    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);
    expect(mockIpc.writeFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().tabs[0]!.diskConflict).toEqual({
      diskContent: "agent edit\n",
    });

    await useFileStore.getState().resolveDiskConflict(tabId, "keep-mine");

    expect(mockIpc.writeFile).toHaveBeenCalledTimes(1);
    expect(mockIpc.writeFile).toHaveBeenCalledWith("/repo", "src/app.ts", "mine\n", "ws-1", null);
    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.isDirty).toBe(false);
    expect(tab.diskConflict).toBeNull();
  });

  it("takes the disk version when the user reloads a conflicted tab", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "mine\n");
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("agent edit\n"));
    await useFileStore.getState().saveTab(tabId);

    await useFileStore.getState().resolveDiskConflict(tabId, "reload");

    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.content).toBe("agent edit\n");
    expect(tab.isDirty).toBe(false);
    expect(tab.diskConflict).toBeNull();
    expect(mockIpc.writeFile).not.toHaveBeenCalled();
  });

  it("raises the conflict banner when the file changes between the disk check and the write", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "mine\n");
    mockIpc.writeFile.mockRejectedValueOnce(
      "file changed on disk after the save checked it",
    );

    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);

    expect(mockIpc.writeFile).toHaveBeenCalledWith("/repo", "src/app.ts", "mine\n", "ws-1", "plain\n");
    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.isDirty).toBe(true);
    expect(tab.diskConflict).toEqual({ diskContent: "" });
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);
    expect(mockIpc.writeFile).toHaveBeenCalledTimes(1);
  });

  it("writes once when two saves overlap", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "mine\n");

    await Promise.all([
      useFileStore.getState().saveTab(tabId),
      useFileStore.getState().saveTab(tabId),
    ]);

    expect(mockIpc.writeFile).toHaveBeenCalledTimes(1);
    const tab = useFileStore.getState().tabs[0]!;
    expect(tab.isDirty).toBe(false);
    expect(tab.diskConflict ?? null).toBeNull();
  });

  it("does not write when the disk check fails or finds a binary file", async () => {
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "mine\n");

    mockIpc.readFile.mockRejectedValueOnce(new Error("file too large"));
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);
    expect(useFileStore.getState().tabs[0]!.diskConflict).toEqual({ diskContent: "" });

    useFileStore.setState((state) => ({
      tabs: state.tabs.map((t) => ({ ...t, diskConflict: null })),
    }));
    mockIpc.readFile.mockResolvedValueOnce(makeReadFileResult("", { isBinary: true }));
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(false);

    expect(mockIpc.writeFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().tabs[0]!.content).toBe("mine\n");
  });

  it("keeps the line ending the file has on disk when only its endings changed", async () => {
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a\nb\n"));
    await useFileStore.getState().openFile("/repo", "src/app.ts");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "a\nb\nc\n");
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a\r\nb\r\n"));

    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(true);

    expect(mockIpc.writeFile).toHaveBeenCalledWith(
      "/repo",
      "src/app.ts",
      "a\r\nb\r\nc\r\n",
      "ws-1",
      "a\r\nb\r\n",
    );
    expect(useFileStore.getState().tabs[0]!.lineEnding).toBe("\r\n");
  });

  it("keeps a CRLF tab CRLF after a save leaves the file on one line", async () => {
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a\r\nb\r\n"));
    await useFileStore.getState().openFile("/repo", "win.bat");
    const tabId = useFileStore.getState().tabs[0]!.id;
    useFileStore.getState().setTabContent(tabId, "a");
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(true);
    mockIpc.readFile.mockResolvedValue(makeReadFileResult("a"));

    useFileStore.getState().setTabContent(tabId, "a\nb\n");
    await expect(useFileStore.getState().saveTab(tabId)).resolves.toBe(true);

    expect(mockIpc.writeFile).toHaveBeenLastCalledWith("/repo", "win.bat", "a\r\nb\r\n", "ws-1", "a");
  });
});
