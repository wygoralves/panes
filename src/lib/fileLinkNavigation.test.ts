import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpenExternal = vi.hoisted(() => vi.fn());
const mockOpenFileAtLocation = vi.hoisted(() => vi.fn());
const mockSetLayoutMode = vi.hoisted(() => vi.fn());
const mockEnsureWorkspace = vi.hoisted(() => vi.fn());
const mockShowSurface = vi.hoisted(() => vi.fn());
const mockSetActiveView = vi.hoisted(() => vi.fn());
const mockSetExplorerOpen = vi.hoisted(() => vi.fn());
const mockWorkspaceState = vi.hoisted(() => ({
  activeWorkspaceId: "ws-1",
  activeRepoId: "repo-1",
  workspaces: [
    {
      id: "ws-1",
      name: "Workspace",
      rootPath: "/workspace",
      scanDepth: 4,
      createdAt: "",
      lastOpenedAt: "",
    },
  ],
  repos: [
    {
      id: "repo-1",
      workspaceId: "ws-1",
      name: "app",
      path: "/workspace/apps/app",
      defaultBranch: "main",
      isActive: true,
      trustLevel: "trusted" as const,
    },
    {
      id: "repo-2",
      workspaceId: "ws-1",
      name: "nested",
      path: "/workspace/apps/app/packages/web",
      defaultBranch: "main",
      isActive: true,
      trustLevel: "trusted" as const,
    },
  ],
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: mockOpenExternal,
}));

vi.mock("../stores/fileStore", () => ({
  useFileStore: {
    getState: () => ({
      openFileAtLocation: mockOpenFileAtLocation,
    }),
  },
}));

vi.mock("../stores/terminalStore", () => ({
  useTerminalStore: {
    getState: () => ({
      setLayoutMode: mockSetLayoutMode,
      workspaces: {},
    }),
  },
}));

vi.mock("../stores/workspacePaneStore", () => ({
  collectWorkspacePaneLeaves: vi.fn(() => []),
  getWorkspacePaneActiveTab: vi.fn(() => null),
  useWorkspacePaneStore: {
    getState: () => ({
      ensureWorkspace: mockEnsureWorkspace,
      showSurface: mockShowSurface,
      workspaces: {},
    }),
  },
}));

vi.mock("../stores/uiStore", () => ({
  useUiStore: {
    getState: () => ({
      setActiveView: mockSetActiveView,
      setExplorerOpen: mockSetExplorerOpen,
    }),
  },
}));

vi.mock("../stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => mockWorkspaceState,
  },
}));

import {
  classifyLinkTarget,
  extractTextLinkMatches,
  navigateLinkTarget,
  resolveLocalFileLinkTarget,
} from "./fileLinkNavigation";

describe("fileLinkNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState.activeWorkspaceId = "ws-1";
    mockWorkspaceState.activeRepoId = "repo-1";
    mockWorkspaceState.workspaces = [
      {
        id: "ws-1",
        name: "Workspace",
        rootPath: "/workspace",
        scanDepth: 4,
        createdAt: "",
        lastOpenedAt: "",
      },
    ];
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
        name: "nested",
        path: "/workspace/apps/app/packages/web",
        defaultBranch: "main",
        isActive: true,
        trustLevel: "trusted",
      },
    ];
    mockOpenExternal.mockResolvedValue(undefined);
    mockOpenFileAtLocation.mockResolvedValue(undefined);
    mockSetLayoutMode.mockResolvedValue(undefined);
  });

  it("resolves absolute POSIX paths with hash and suffix line references", () => {
    expect(
      resolveLocalFileLinkTarget("/workspace/apps/app/src/main.ts#L12", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app" }],
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app",
      filePath: "src/main.ts",
      line: 12,
    });

    expect(
      resolveLocalFileLinkTarget("/workspace/apps/app/src/main.ts:44:7", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app" }],
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app",
      filePath: "src/main.ts",
      line: 44,
      column: 7,
    });
  });

  it("resolves file URLs with encoded spaces", () => {
    expect(
      resolveLocalFileLinkTarget("file:///workspace/apps/app/docs/My%20File.md#L9", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app" }],
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app",
      filePath: "docs/My File.md",
      line: 9,
    });
  });

  it("ignores malformed percent-encoding in file URLs", () => {
    expect(
      resolveLocalFileLinkTarget("file:///workspace/apps/app/docs/%ZZ.md#L9", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app" }],
      }),
    ).toBeNull();

    expect(classifyLinkTarget("file:///workspace/apps/app/docs/%ZZ.md#L9")).toBe("other");
    expect(() =>
      extractTextLinkMatches(
        "bad file:///workspace/apps/app/docs/%ZZ.md should not break parsing",
      ),
    ).not.toThrow();
    expect(
      extractTextLinkMatches(
        "bad file:///workspace/apps/app/docs/%ZZ.md should not break parsing",
      ),
    ).toEqual([]);
  });

  it("resolves Windows absolute paths and file URLs", () => {
    expect(
      resolveLocalFileLinkTarget("C:\\Users\\dev\\repo\\src\\app.ts:7:3", {
        workspaceRoot: "C:/Users/dev",
        repos: [{ id: "repo-1", path: "C:/Users/dev/repo" }],
      }),
    ).toMatchObject({
      rootPath: "C:/Users/dev/repo",
      filePath: "src/app.ts",
      line: 7,
      column: 3,
    });

    expect(
      resolveLocalFileLinkTarget("file:///C:/Users/dev/repo/src/app.ts#L11", {
        workspaceRoot: "C:/Users/dev",
        repos: [{ id: "repo-1", path: "C:/Users/dev/repo" }],
      }),
    ).toMatchObject({
      rootPath: "C:/Users/dev/repo",
      filePath: "src/app.ts",
      line: 11,
    });
  });

  it("prefers the deepest matching repo root before falling back to the workspace root", () => {
    expect(
      resolveLocalFileLinkTarget("/workspace/apps/app/packages/web/src/page.tsx#L5", {
        workspaceRoot: "/workspace",
        repos: [
          { id: "repo-1", path: "/workspace/apps/app" },
          { id: "repo-2", path: "/workspace/apps/app/packages/web" },
        ],
        activeRepoId: "repo-1",
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app/packages/web",
      filePath: "src/page.tsx",
      line: 5,
    });

    expect(
      resolveLocalFileLinkTarget("/workspace/README.md#L2", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app" }],
      }),
    ).toMatchObject({
      rootPath: "/workspace",
      filePath: "README.md",
      line: 2,
    });
  });

  it("resolves repo-relative file references against the active repo first", () => {
    expect(
      resolveLocalFileLinkTarget("src/main.ts:44:7", {
        workspaceRoot: "/workspace",
        repos: [
          { id: "repo-1", path: "/workspace/apps/app", isActive: true },
          { id: "repo-2", path: "/workspace/apps/app/packages/web", isActive: true },
        ],
        activeRepoId: "repo-1",
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app",
      filePath: "src/main.ts",
      absolutePath: "/workspace/apps/app/src/main.ts",
      line: 44,
      column: 7,
    });

    expect(
      resolveLocalFileLinkTarget("./README.md#L12", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app", isActive: true }],
        activeRepoId: "repo-1",
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app",
      filePath: "README.md",
      absolutePath: "/workspace/apps/app/README.md",
      line: 12,
    });

    expect(
      resolveLocalFileLinkTarget(".gitignore", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app", isActive: true }],
        activeRepoId: "repo-1",
      }),
    ).toMatchObject({
      rootPath: "/workspace/apps/app",
      filePath: ".gitignore",
      absolutePath: "/workspace/apps/app/.gitignore",
    });
  });

  it("rejects paths outside the active workspace and classifies external URLs", () => {
    expect(
      resolveLocalFileLinkTarget("/other/place/file.ts#L1", {
        workspaceRoot: "/workspace",
        repos: [{ id: "repo-1", path: "/workspace/apps/app" }],
      }),
    ).toBeNull();

    expect(classifyLinkTarget("https://example.com")).toBe("external");
    expect(classifyLinkTarget("/workspace/apps/app/src/main.ts#L1")).toBe("local");
    expect(classifyLinkTarget("src/main.ts#L1")).toBe("local");
    expect(classifyLinkTarget("#heading")).toBe("other");
  });

  it("extracts plain-text terminal links for absolute paths, relative paths, hashes and URLs", () => {
    expect(
      extractTextLinkMatches("- /workspace/apps/app/src/main.ts:44:7"),
    ).toEqual([
      {
        text: "/workspace/apps/app/src/main.ts:44:7",
        startIndex: 2,
        endIndex: 38,
        kind: "local",
      },
    ]);

    expect(
      extractTextLinkMatches("see /workspace/apps/app/src/main.ts#L12 and https://example.com/docs."),
    ).toEqual([
      {
        text: "/workspace/apps/app/src/main.ts#L12",
        startIndex: 4,
        endIndex: 39,
        kind: "local",
      },
      {
        text: "https://example.com/docs",
        startIndex: 44,
        endIndex: 68,
        kind: "external",
      },
    ]);

    expect(
      extractTextLinkMatches("relative src/App.tsx should now link"),
    ).toEqual([
      {
        text: "src/App.tsx",
        startIndex: 9,
        endIndex: 20,
        kind: "local",
      },
    ]);

    expect(extractTextLinkMatches("ignore example.com and version 1.2.3")).toEqual([]);
  });

  it("opens local links internally only on shift-click", async () => {
    await expect(
      navigateLinkTarget("/workspace/apps/app/src/main.ts#L12C4", { shiftKey: false }),
    ).resolves.toBe("ignored");

    expect(mockOpenFileAtLocation).not.toHaveBeenCalled();
    expect(mockSetLayoutMode).not.toHaveBeenCalled();
    expect(mockShowSurface).not.toHaveBeenCalled();
    expect(mockSetActiveView).not.toHaveBeenCalled();
    expect(mockSetExplorerOpen).not.toHaveBeenCalled();

    await expect(
      navigateLinkTarget("/workspace/apps/app/src/main.ts#L12C4", { shiftKey: true }),
    ).resolves.toBe("internal");

    expect(mockOpenFileAtLocation).toHaveBeenCalledWith(
      "/workspace/apps/app",
      "src/main.ts",
      { line: 12, column: 4 },
    );
    expect(mockShowSurface).toHaveBeenCalledWith("ws-1", "editor");
    expect(mockSetActiveView).toHaveBeenCalledWith("chat");
    expect(mockSetExplorerOpen).toHaveBeenCalledWith(false);
    expect(mockSetLayoutMode).not.toHaveBeenCalled();
  });

  it("opens repo-relative local links against the active repo on shift-click", async () => {
    await expect(
      navigateLinkTarget("src/main.ts:12:4", { shiftKey: true }),
    ).resolves.toBe("internal");

    expect(mockOpenFileAtLocation).toHaveBeenCalledWith(
      "/workspace/apps/app",
      "src/main.ts",
      { line: 12, column: 4 },
    );
    expect(mockShowSurface).toHaveBeenCalledWith("ws-1", "editor");
    expect(mockSetExplorerOpen).toHaveBeenCalledWith(false);
    expect(mockSetLayoutMode).not.toHaveBeenCalled();
  });

  it("opens external links through the shell only on shift-click", async () => {
    await expect(
      navigateLinkTarget("https://example.com/docs", { shiftKey: false }),
    ).resolves.toBe("ignored");

    expect(mockOpenExternal).not.toHaveBeenCalled();

    await expect(
      navigateLinkTarget("https://example.com/docs", { shiftKey: true }),
    ).resolves.toBe("external");

    expect(mockOpenExternal).toHaveBeenCalledWith("https://example.com/docs");
  });
});
