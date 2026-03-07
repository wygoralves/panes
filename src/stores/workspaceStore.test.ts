import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repo, Workspace } from "../types";

const mockIpc = vi.hoisted(() => ({
  archiveWorkspace: vi.fn(),
  getRepos: vi.fn(),
  openWorkspace: vi.fn(),
}));

const mockTerminalStoreState = vi.hoisted(() => ({
  prepareWorkspaceActivation: vi.fn(),
}));

const mockGitStoreState = vi.hoisted(() => ({
  flushDrafts: vi.fn(),
  loadDraftsForWorkspace: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

vi.mock("./terminalStore", () => ({
  useTerminalStore: {
    getState: () => mockTerminalStoreState,
  },
}));

vi.mock("./gitStore", () => ({
  useGitStore: {
    getState: () => mockGitStoreState,
  },
}));

import { useWorkspaceStore } from "./workspaceStore";

function makeWorkspace(id: string, rootPath: string): Workspace {
  return {
    id,
    name: id,
    rootPath,
    scanDepth: 3,
    createdAt: new Date(0).toISOString(),
    lastOpenedAt: new Date(0).toISOString(),
  };
}

function makeRepo(id: string, workspaceId: string, path: string): Repo {
  return {
    id,
    workspaceId,
    name: id,
    path,
    defaultBranch: "main",
    isActive: true,
    trustLevel: "trusted",
  };
}

describe("workspaceStore.removeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });

    useWorkspaceStore.setState({
      workspaces: [],
      archivedWorkspaces: [],
      activeWorkspaceId: null,
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    mockIpc.archiveWorkspace.mockResolvedValue(undefined);
    mockIpc.getRepos.mockResolvedValue([]);
    mockIpc.openWorkspace.mockImplementation(async (path: string, scanDepth?: number) => ({
      ...makeWorkspace(path, path),
      scanDepth: scanDepth ?? 3,
    }));
    mockTerminalStoreState.prepareWorkspaceActivation.mockResolvedValue(undefined);
  });

  it("prepares the replacement workspace when archiving the active workspace", async () => {
    const workspaceA = makeWorkspace("ws-a", "/workspace/a");
    const workspaceB = makeWorkspace("ws-b", "/workspace/b");
    const repoB = makeRepo("repo-b", "ws-b", "/workspace/b/repo");

    mockIpc.getRepos.mockResolvedValueOnce([repoB]);
    useWorkspaceStore.setState({
      workspaces: [workspaceA, workspaceB],
      archivedWorkspaces: [],
      activeWorkspaceId: workspaceA.id,
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    await useWorkspaceStore.getState().removeWorkspace(workspaceA.id);

    expect(mockIpc.archiveWorkspace).toHaveBeenCalledWith(workspaceA.id);
    expect(mockTerminalStoreState.prepareWorkspaceActivation).toHaveBeenCalledWith(workspaceB.id);
    expect(mockIpc.getRepos).toHaveBeenCalledWith(workspaceB.id);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspaceB.id);
    expect(useWorkspaceStore.getState().repos).toEqual([repoB]);
  });
});

describe("workspaceStore.rescanWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });

    useWorkspaceStore.setState({
      workspaces: [],
      archivedWorkspaces: [],
      activeWorkspaceId: null,
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    mockIpc.getRepos.mockResolvedValue([]);
    mockTerminalStoreState.prepareWorkspaceActivation.mockResolvedValue(undefined);
  });

  it("updates the workspace scan depth without switching the active workspace", async () => {
    const activeWorkspace = makeWorkspace("ws-active", "/workspace/active");
    const targetWorkspace = makeWorkspace("ws-target", "/workspace/target");
    const updatedTargetWorkspace = {
      ...targetWorkspace,
      scanDepth: 7,
      lastOpenedAt: new Date(1_000).toISOString(),
    };

    mockIpc.openWorkspace.mockResolvedValue(updatedTargetWorkspace);

    useWorkspaceStore.setState({
      workspaces: [activeWorkspace, targetWorkspace],
      archivedWorkspaces: [],
      activeWorkspaceId: activeWorkspace.id,
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    const result = await useWorkspaceStore.getState().rescanWorkspace(targetWorkspace.id, 7);

    expect(mockIpc.openWorkspace).toHaveBeenCalledWith(targetWorkspace.rootPath, 7);
    expect(mockIpc.getRepos).not.toHaveBeenCalled();
    expect(result).toEqual(updatedTargetWorkspace);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(activeWorkspace.id);
    expect(useWorkspaceStore.getState().workspaces[0]).toEqual(updatedTargetWorkspace);
  });

  it("reloads repos when rescanning the active workspace", async () => {
    const workspace = makeWorkspace("ws-active", "/workspace/active");
    const updatedWorkspace = {
      ...workspace,
      scanDepth: 5,
    };
    const repos = [makeRepo("repo-a", workspace.id, "/workspace/active/repo-a")];

    mockIpc.openWorkspace.mockResolvedValue(updatedWorkspace);
    mockIpc.getRepos.mockResolvedValue(repos);

    useWorkspaceStore.setState({
      workspaces: [workspace],
      archivedWorkspaces: [],
      activeWorkspaceId: workspace.id,
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    const result = await useWorkspaceStore.getState().rescanWorkspace(workspace.id, 5);

    expect(mockIpc.openWorkspace).toHaveBeenCalledWith(workspace.rootPath, 5);
    expect(mockIpc.getRepos).toHaveBeenCalledWith(workspace.id);
    expect(result).toEqual(updatedWorkspace);
    expect(useWorkspaceStore.getState().repos).toEqual(repos);
    expect(useWorkspaceStore.getState().workspaces[0]).toEqual(updatedWorkspace);
  });
});
