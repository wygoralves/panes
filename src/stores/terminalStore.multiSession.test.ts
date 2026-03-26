import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repo, TerminalNotification, TerminalSession, Workspace } from "../types";

const mockIpc = vi.hoisted(() => ({
  terminalCreateSession: vi.fn(),
  terminalCloseSession: vi.fn(),
  terminalCloseWorkspaceSessions: vi.fn(),
  terminalListNotifications: vi.fn(),
  terminalClearNotification: vi.fn(),
  terminalSetNotificationFocus: vi.fn(),
  addGitWorktree: vi.fn(),
  removeGitWorktree: vi.fn(),
  getRepos: vi.fn(),
  launchHarness: vi.fn(),
  getWorkspaceStartupPreset: vi.fn(),
}));
const mockWriteCommandToNewSession = vi.hoisted(() => vi.fn());

const mockLocalStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
  writeCommandToNewSession: mockWriteCommandToNewSession,
}));

import { useTerminalStore } from "./terminalStore";
import { useHarnessStore } from "./harnessStore";
import { useWorkspaceStore } from "./workspaceStore";

function makeSession(id: string): TerminalSession {
  return {
    id,
    workspaceId: "ws-1",
    shell: "zsh",
    cwd: "/tmp",
    createdAt: new Date(0).toISOString(),
  };
}

function makeNotification(sessionId: string): TerminalNotification {
  return {
    id: `notif-${sessionId}`,
    workspaceId: "ws-1",
    sessionId,
    source: "codex",
    title: "Ready",
    body: "Turn complete",
    createdAt: new Date(0).toISOString(),
  };
}

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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminalStore.createMultiSessionGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockImplementation(() => null);
    mockLocalStorage.setItem.mockImplementation(() => undefined);
    mockLocalStorage.removeItem.mockImplementation(() => undefined);
    mockLocalStorage.clear.mockImplementation(() => undefined);
    vi.stubGlobal("localStorage", mockLocalStorage);
    useTerminalStore.setState({ workspaces: {} });
    useHarnessStore.setState({
      phase: "idle",
      harnesses: [],
      npmAvailable: false,
      loadedOnce: false,
      error: null,
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
    mockIpc.terminalCloseSession.mockResolvedValue(undefined);
    mockIpc.terminalCloseWorkspaceSessions.mockResolvedValue(undefined);
    mockIpc.terminalListNotifications.mockResolvedValue([]);
    mockIpc.terminalClearNotification.mockResolvedValue(undefined);
    mockIpc.terminalSetNotificationFocus.mockResolvedValue(undefined);
    mockIpc.addGitWorktree.mockResolvedValue(undefined);
    mockIpc.removeGitWorktree.mockResolvedValue(undefined);
    mockIpc.getRepos.mockResolvedValue([]);
    mockIpc.launchHarness.mockResolvedValue(null);
    mockIpc.getWorkspaceStartupPreset.mockResolvedValue(null);
    mockWriteCommandToNewSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes already created sessions if one creation fails", async () => {
    mockIpc.terminalCreateSession
      .mockResolvedValueOnce(makeSession("s1"))
      .mockRejectedValueOnce(new Error("create failed"));

    const result = await useTerminalStore.getState().createMultiSessionGroup(
      "ws-1",
      [
        { harnessId: "h1", name: "Harness 1" },
        { harnessId: "h2", name: "Harness 2" },
      ],
      null,
      120,
      36,
    );

    expect(result).toBeNull();
    expect(mockIpc.terminalCloseSession).toHaveBeenCalledWith("ws-1", "s1");

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.sessions ?? []).toHaveLength(0);
    expect(workspace?.groups ?? []).toHaveLength(0);
    expect(workspace?.loading).toBe(false);
    expect(workspace?.error).toContain("create failed");
  });

  it("uses unique worktree branch and path names for repeated harnesses", async () => {
    mockIpc.terminalCreateSession
      .mockResolvedValueOnce(makeSession("s1"))
      .mockResolvedValueOnce(makeSession("s2"));

    const result = await useTerminalStore.getState().createMultiSessionGroup(
      "ws-1",
      [
        { harnessId: "codex", name: "Codex" },
        { harnessId: "codex", name: "Codex" },
      ],
      {
        enabled: true,
        repoMode: "fixed_repo",
        repoPath: "/repo",
        baseBranch: "main",
        baseDir: "/repo/.panes/worktrees",
        branchPrefix: "panes",
      },
      120,
      36,
    );

    expect(result).not.toBeNull();
    expect(mockIpc.addGitWorktree).toHaveBeenCalledTimes(2);

    const first = mockIpc.addGitWorktree.mock.calls[0];
    const second = mockIpc.addGitWorktree.mock.calls[1];
    const runId = /^panes\/([^/]+)\/codex-1$/.exec(first[2] as string)?.[1];

    expect(runId).toBeTruthy();
    expect(first[1]).toBe(`/repo/.panes/worktrees/${runId}/codex-1`);
    expect(second[1]).toBe(`/repo/.panes/worktrees/${runId}/codex-2`);
    expect(first[2]).toBe(`panes/${runId}/codex-1`);
    expect(second[2]).toBe(`panes/${runId}/codex-2`);
  });

  it("throws and stores an error when worktree cleanup fails", async () => {
    mockIpc.removeGitWorktree
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("branch is not fully merged"));

    await expect(
      useTerminalStore.getState().removeGroupWorktrees("ws-1", [
        {
          repoPath: "/repo",
          worktreePath: "/repo/.panes/worktrees/r1/agent-1",
          branch: "panes/r1/agent-1",
        },
        {
          repoPath: "/repo",
          worktreePath: "/repo/.panes/worktrees/r1/agent-2",
          branch: "panes/r1/agent-2",
        },
      ]),
    ).rejects.toThrow("Failed to remove 1 worktree(s)");

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.error).toContain("panes/r1/agent-2");
    expect(mockIpc.removeGitWorktree).toHaveBeenNthCalledWith(
      1,
      "/repo",
      "/repo/.panes/worktrees/r1/agent-1",
      true,
      "panes/r1/agent-1",
      true,
    );
    expect(mockIpc.removeGitWorktree).toHaveBeenNthCalledWith(
      2,
      "/repo",
      "/repo/.panes/worktrees/r1/agent-2",
      true,
      "panes/r1/agent-2",
      true,
    );
  });

  it("does not auto-clean worktrees when a session exits", async () => {
    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "2 agents",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {
                  harnessId: "h1",
                  harnessName: "Harness 1",
                  autoDetectedHarness: false,
                  launchHarnessOnCreate: true,
                  worktree: {
                    repoPath: "/repo",
                    worktreePath: "/repo/.panes/worktrees/r1/agent-1",
                    branch: "panes/r1/agent-1",
                  },
                },
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    useTerminalStore.getState().handleSessionExit("ws-1", "s1");
    await flushPromises();

    expect(mockIpc.removeGitWorktree).not.toHaveBeenCalled();
  });

  it("reports rollback cleanup failures when group creation fails", async () => {
    mockIpc.addGitWorktree
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockIpc.terminalCreateSession
      .mockResolvedValueOnce(makeSession("s1"))
      .mockRejectedValueOnce(new Error("create failed"));
    mockIpc.removeGitWorktree
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("branch is not fully merged"));

    const result = await useTerminalStore.getState().createMultiSessionGroup(
      "ws-1",
      [
        { harnessId: "h1", name: "Harness 1" },
        { harnessId: "h2", name: "Harness 2" },
      ],
      {
        enabled: true,
        repoMode: "fixed_repo",
        repoPath: "/repo",
        baseBranch: "main",
        baseDir: "/repo/.panes/worktrees",
        branchPrefix: "panes",
      },
      120,
      36,
    );

    expect(result).toBeNull();
    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.error).toContain("create failed");
    expect(workspace?.error).toContain("Cleanup failed for 1 worktree(s)");
    expect(workspace?.error).toContain("panes/");
  });

  it("syncs a saved startup preset without mutating the live layout", () => {
    const preset = {
      version: 1 as const,
      defaultView: "terminal" as const,
      splitPanelSize: 48,
      terminal: null,
    };

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {},
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    useTerminalStore.getState().setWorkspaceStartupPresetState("ws-1", preset);

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.layoutMode).toBe("split");
    expect(workspace?.isOpen).toBe(true);
    expect(workspace?.sessions).toHaveLength(1);
    expect(workspace?.startupPreset).toEqual(preset);
    expect(workspace?.pendingStartupPreset).toBeNull();
  });

  it("clears pending startup preset state when the preset is removed", () => {
    const preset = {
      version: 1 as const,
      defaultView: "split" as const,
      splitPanelSize: 40,
      terminal: null,
    };

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: false,
          layoutMode: "chat",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [],
          notificationsBySessionId: {},
          activeSessionId: null,
          groups: [],
          activeGroupId: null,
          focusedSessionId: null,
          broadcastGroupId: null,
          startupPreset: preset,
          pendingStartupPreset: preset,
          loading: false,
          error: undefined,
        },
      },
    });

    useTerminalStore.getState().setWorkspaceStartupPresetState("ws-1", null);

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.startupPreset).toBeNull();
    expect(workspace?.pendingStartupPreset).toBeNull();
  });

  it("queues startup presets with hidden default views when they define terminal groups", () => {
    const preset = {
      version: 1 as const,
      defaultView: "chat" as const,
      splitPanelSize: 40,
      terminal: {
        applyWhen: "no_live_sessions" as const,
        groups: [
          {
            id: "g1",
            name: "Terminal 1",
            sessions: [{ id: "pane-1", cwd: ".", cwdBase: "workspace" as const }],
            root: { type: "leaf" as const, sessionId: "pane-1" },
          },
        ],
      },
    };

    useTerminalStore.getState().setWorkspaceStartupPresetState("ws-1", preset);

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.startupPreset).toEqual(preset);
    expect(workspace?.pendingStartupPreset).toEqual(preset);
  });

  it("does not queue a saved startup preset while live sessions exist", () => {
    const preset = {
      version: 1 as const,
      defaultView: "chat" as const,
      splitPanelSize: 40,
      terminal: {
        applyWhen: "no_live_sessions" as const,
        groups: [
          {
            id: "g1",
            name: "Terminal 1",
            sessions: [{ id: "pane-1", cwd: ".", cwdBase: "workspace" as const }],
            root: { type: "leaf" as const, sessionId: "pane-1" },
          },
        ],
      },
    };

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    useTerminalStore.getState().setWorkspaceStartupPresetState("ws-1", preset);

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.startupPreset).toEqual(preset);
    expect(workspace?.pendingStartupPreset).toBeNull();
  });

  it("preserves the live layout when reactivating a workspace with running sessions", async () => {
    const preset = {
      version: 1 as const,
      defaultView: "chat" as const,
      splitPanelSize: 60,
      terminal: null,
    };
    mockIpc.getWorkspaceStartupPreset.mockResolvedValue(preset);

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 33,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    await useTerminalStore.getState().prepareWorkspaceActivation("ws-1");

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.startupPreset).toEqual(preset);
    expect(workspace?.layoutMode).toBe("split");
    expect(workspace?.panelSize).toBe(33);
    expect(workspace?.isOpen).toBe(true);
    expect(workspace?.pendingStartupPreset).toBeNull();
  });

  it("re-arms the saved startup preset after closing the terminal", async () => {
    const preset = {
      version: 1 as const,
      defaultView: "split" as const,
      splitPanelSize: 48,
      terminal: {
        applyWhen: "no_live_sessions" as const,
        groups: [
          {
            id: "g1",
            name: "Startup",
            sessions: [{ id: "pane-1", cwd: ".", cwdBase: "workspace" as const }],
            root: { type: "leaf" as const, sessionId: "pane-1" },
          },
        ],
        activeGroupId: "g1",
        focusedSessionId: "pane-1",
      },
    };

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Startup",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: "g1",
          startupPreset: preset,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    await useTerminalStore.getState().closeTerminal("ws-1");

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(mockIpc.terminalCloseWorkspaceSessions).toHaveBeenCalledWith("ws-1");
    expect(workspace?.isOpen).toBe(false);
    expect(workspace?.layoutMode).toBe("chat");
    expect(workspace?.sessions).toHaveLength(0);
    expect(workspace?.groups).toHaveLength(0);
    expect(workspace?.broadcastGroupId).toBeNull();
    expect(workspace?.pendingStartupPreset).toEqual(preset);
  });

  it("re-arms the saved startup preset after the last session exits", () => {
    const preset = {
      version: 1 as const,
      defaultView: "split" as const,
      splitPanelSize: 48,
      terminal: {
        applyWhen: "no_live_sessions" as const,
        groups: [
          {
            id: "g1",
            name: "Startup",
            sessions: [{ id: "pane-1", cwd: ".", cwdBase: "workspace" as const }],
            root: { type: "leaf" as const, sessionId: "pane-1" },
          },
        ],
        activeGroupId: "g1",
        focusedSessionId: "pane-1",
      },
    };

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Startup",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: preset,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    useTerminalStore.getState().handleSessionExit("ws-1", "s1");

    const workspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(workspace?.isOpen).toBe(false);
    expect(workspace?.layoutMode).toBe("chat");
    expect(workspace?.sessions).toHaveLength(0);
    expect(workspace?.groups).toHaveLength(0);
    expect(workspace?.startupPreset).toEqual(preset);
    expect(workspace?.pendingStartupPreset).toEqual(preset);
  });

  it("uses the remembered active repo for active_repo startup worktrees", async () => {
    mockLocalStorage.getItem.mockImplementation((key: string) =>
      key === "panes:lastActiveRepoByWorkspace"
        ? JSON.stringify({ "ws-1": "repo-2" })
        : null,
    );
    mockIpc.terminalCreateSession.mockResolvedValueOnce(makeSession("s1"));

    const workspace = makeWorkspace("ws-1", "/workspace/ws-1");
    const repo1 = makeRepo("repo-1", workspace.id, "/workspace/ws-1/repo-a");
    const repo2 = makeRepo("repo-2", workspace.id, "/workspace/ws-1/repo-b");
    mockIpc.getRepos.mockResolvedValue([repo1, repo2]);

    useWorkspaceStore.setState({
      workspaces: [workspace],
      archivedWorkspaces: [],
      activeWorkspaceId: null,
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    const applied = await useTerminalStore.getState().materializeWorkspaceStartupPreset("ws-1", {
      version: 1,
      defaultView: "split",
      splitPanelSize: 32,
      terminal: {
        applyWhen: "no_live_sessions",
        groups: [
          {
            id: "g1",
            name: "Repo worktree",
            worktree: {
              enabled: true,
              repoMode: "active_repo",
              repoPath: null,
              baseBranch: "main",
              baseDir: ".panes/worktrees",
              branchPrefix: "panes/preset",
            },
            sessions: [{ id: "pane-1", cwd: ".", cwdBase: "workspace" }],
            root: { type: "leaf", sessionId: "pane-1" },
          },
        ],
        activeGroupId: "g1",
        focusedSessionId: "pane-1",
      },
    });

    expect(applied).toBe(true);
    expect(mockIpc.addGitWorktree).toHaveBeenCalledTimes(1);
    expect(mockIpc.addGitWorktree.mock.calls[0]?.[0]).toBe(repo2.path);
    expect(mockIpc.addGitWorktree.mock.calls[0]?.[1]).toContain(`${repo2.path}/.panes/worktrees/`);
  });

  it("launches saved harness commands even when harness scanning is still in flight", async () => {
    mockIpc.terminalCreateSession.mockResolvedValueOnce(makeSession("s1"));
    mockIpc.launchHarness.mockResolvedValueOnce("codex");

    const workspace = makeWorkspace("ws-1", "/workspace/ws-1");
    useWorkspaceStore.setState({
      workspaces: [workspace],
      archivedWorkspaces: [],
      activeWorkspaceId: "ws-1",
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });
    useHarnessStore.setState({
      phase: "scanning",
      harnesses: [],
      npmAvailable: false,
      loadedOnce: false,
      error: null,
    });

    const applied = await useTerminalStore.getState().materializeWorkspaceStartupPreset("ws-1", {
      version: 1,
      defaultView: "split",
      splitPanelSize: 32,
      terminal: {
        applyWhen: "no_live_sessions",
        groups: [
          {
            id: "g1",
            name: "Codex",
            sessions: [
              {
                id: "pane-1",
                cwd: ".",
                cwdBase: "workspace",
                harnessId: "codex",
                launchHarnessOnCreate: true,
              },
            ],
            root: { type: "leaf", sessionId: "pane-1" },
          },
        ],
        activeGroupId: "g1",
        focusedSessionId: "pane-1",
      },
    });

    expect(applied).toBe(true);
    expect(mockIpc.launchHarness).toHaveBeenCalledWith("codex");
    expect(mockWriteCommandToNewSession).toHaveBeenCalledWith("ws-1", "s1", "codex");
  });

  it("drops rolled-back pane mappings before resolving the focused session", async () => {
    const workspace = makeWorkspace("ws-1", "/workspace/ws-1");
    useWorkspaceStore.setState({
      workspaces: [workspace],
      archivedWorkspaces: [],
      activeWorkspaceId: "ws-1",
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    mockIpc.terminalCreateSession
      .mockResolvedValueOnce(makeSession("s1"))
      .mockRejectedValueOnce(new Error("create failed"))
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(makeSession("s2"));

    const applied = await useTerminalStore.getState().materializeWorkspaceStartupPreset("ws-1", {
      version: 1,
      defaultView: "split",
      splitPanelSize: 32,
      terminal: {
        applyWhen: "no_live_sessions",
        groups: [
          {
            id: "g1",
            name: "Broken group",
            broadcastOnStart: true,
            sessions: [
              { id: "pane-a", cwd: ".", cwdBase: "workspace" },
              { id: "pane-b", cwd: ".", cwdBase: "workspace" },
            ],
            root: {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                { type: "leaf", sessionId: "pane-a" },
                { type: "leaf", sessionId: "pane-b" },
              ],
            },
          },
          {
            id: "g2",
            name: "Healthy group",
            sessions: [{ id: "pane-c", cwd: ".", cwdBase: "workspace" }],
            root: { type: "leaf", sessionId: "pane-c" },
          },
        ],
        activeGroupId: "g2",
        focusedSessionId: "pane-a",
      },
    });

    expect(applied).toBe(true);
    const runtimeWorkspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(runtimeWorkspace?.sessions.map((session) => session.id)).toEqual(["s2"]);
    expect(runtimeWorkspace?.activeGroupId).toBe("g2");
    expect(runtimeWorkspace?.focusedSessionId).toBe("s2");
    expect(runtimeWorkspace?.activeSessionId).toBe("s2");
    expect(runtimeWorkspace?.broadcastGroupId).toBeNull();
    expect(mockIpc.terminalCloseSession).toHaveBeenCalledWith("ws-1", "s1");
  });

  it("stages preset bootstrap instead of creating sessions immediately during apply", async () => {
    const workspace = makeWorkspace("ws-1", "/workspace/ws-1");
    useWorkspaceStore.setState({
      workspaces: [workspace],
      archivedWorkspaces: [],
      activeWorkspaceId: "ws-1",
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });

    const applied = await useTerminalStore.getState().applyWorkspaceStartupPresetNow("ws-1", {
      version: 1,
      defaultView: "chat",
      splitPanelSize: 40,
      terminal: {
        applyWhen: "no_live_sessions",
        groups: [
          {
            id: "g1",
            name: "Startup",
            sessions: [{ id: "pane-1", cwd: ".", cwdBase: "workspace" }],
            root: { type: "leaf", sessionId: "pane-1" },
          },
        ],
        activeGroupId: "g1",
        focusedSessionId: "pane-1",
      },
    });

    expect(applied).toBe(true);
    expect(mockIpc.terminalCloseWorkspaceSessions).toHaveBeenCalledWith("ws-1");
    expect(mockIpc.terminalCreateSession).not.toHaveBeenCalled();

    const runtimeWorkspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(runtimeWorkspace?.isOpen).toBe(true);
    expect(runtimeWorkspace?.layoutMode).toBe("chat");
    expect(runtimeWorkspace?.startupPreset).toBeNull();
    expect(runtimeWorkspace?.pendingStartupPreset?.terminal?.groups).toHaveLength(1);
    expect(runtimeWorkspace?.sessions).toHaveLength(0);
  });

  it("keeps the saved startup preset after applying an unsaved layout", async () => {
    const workspace = makeWorkspace("ws-1", "/workspace/ws-1");
    const savedPreset = {
      version: 1 as const,
      defaultView: "split" as const,
      splitPanelSize: 44,
      terminal: {
        applyWhen: "no_live_sessions" as const,
        groups: [
          {
            id: "saved-group",
            name: "Saved",
            sessions: [{ id: "saved-pane", cwd: ".", cwdBase: "workspace" as const }],
            root: { type: "leaf" as const, sessionId: "saved-pane" },
          },
        ],
        activeGroupId: "saved-group",
        focusedSessionId: "saved-pane",
      },
    };
    const draftPreset = {
      version: 1 as const,
      defaultView: "chat" as const,
      splitPanelSize: 40,
      terminal: {
        applyWhen: "no_live_sessions" as const,
        groups: [
          {
            id: "draft-group",
            name: "Draft",
            sessions: [{ id: "draft-pane", cwd: ".", cwdBase: "workspace" as const }],
            root: { type: "leaf" as const, sessionId: "draft-pane" },
          },
        ],
        activeGroupId: "draft-group",
        focusedSessionId: "draft-pane",
      },
    };

    mockIpc.terminalCreateSession.mockResolvedValueOnce(makeSession("s1"));
    useWorkspaceStore.setState({
      workspaces: [workspace],
      archivedWorkspaces: [],
      activeWorkspaceId: "ws-1",
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });
    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: false,
          layoutMode: "chat",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [],
          notificationsBySessionId: {},
          activeSessionId: null,
          groups: [],
          activeGroupId: null,
          focusedSessionId: null,
          broadcastGroupId: null,
          startupPreset: savedPreset,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    const staged = await useTerminalStore.getState().applyWorkspaceStartupPresetNow("ws-1", draftPreset);
    expect(staged).toBe(true);

    let runtimeWorkspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(runtimeWorkspace?.startupPreset).toEqual(savedPreset);
    expect(runtimeWorkspace?.pendingStartupPreset).toEqual(draftPreset);

    const materialized = await useTerminalStore.getState().materializeWorkspaceStartupPreset("ws-1", draftPreset);
    expect(materialized).toBe(true);

    runtimeWorkspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(runtimeWorkspace?.startupPreset).toEqual(savedPreset);
    expect(runtimeWorkspace?.pendingStartupPreset).toBeNull();
    expect(runtimeWorkspace?.sessions.map((session) => session.id)).toEqual(["s1"]);

    await useTerminalStore.getState().closeTerminal("ws-1");

    runtimeWorkspace = useTerminalStore.getState().workspaces["ws-1"];
    expect(runtimeWorkspace?.startupPreset).toEqual(savedPreset);
    expect(runtimeWorkspace?.pendingStartupPreset).toEqual(savedPreset);
  });

  it("refuses to serialize an inactive workspace runtime layout", () => {
    const workspaceA = makeWorkspace("ws-1", "/workspace/ws-1");
    const workspaceB = makeWorkspace("ws-2", "/workspace/ws-2");

    useWorkspaceStore.setState({
      workspaces: [workspaceA, workspaceB],
      archivedWorkspaces: [],
      activeWorkspaceId: "ws-2",
      repos: [],
      activeRepoId: null,
      reposLoading: false,
      loading: false,
      error: undefined,
    });
    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    expect(useTerminalStore.getState().serializeWorkspaceRuntimeAsStartupPreset("ws-1")).toBeNull();
  });

  it("hydrates notifications only for live sessions", async () => {
    mockIpc.terminalListNotifications.mockResolvedValue([
      makeNotification("s1"),
      makeNotification("s2"),
    ]);

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    await useTerminalStore.getState().hydrateNotifications("ws-1");

    expect(useTerminalStore.getState().workspaces["ws-1"]?.notificationsBySessionId).toEqual({
      s1: makeNotification("s1"),
    });
  });

  it("preserves live notification events that arrive during hydration", async () => {
    let resolveNotifications: ((value: TerminalNotification[]) => void) | undefined;
    mockIpc.terminalListNotifications.mockImplementation(
      () =>
        new Promise<TerminalNotification[]>((resolve) => {
          resolveNotifications = resolve;
        }),
    );

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    const hydratePromise = useTerminalStore.getState().hydrateNotifications("ws-1");
    const liveNotification = {
      ...makeNotification("s1"),
      id: "notif-live",
      createdAt: new Date(1).toISOString(),
    };
    useTerminalStore.getState().applyNotification("ws-1", liveNotification);
    resolveNotifications?.([]);
    await hydratePromise;

    expect(useTerminalStore.getState().workspaces["ws-1"]?.notificationsBySessionId).toEqual({
      s1: liveNotification,
    });
  });

  it("preserves clears that happen during hydration", async () => {
    let resolveNotifications: ((value: TerminalNotification[]) => void) | undefined;
    mockIpc.terminalListNotifications.mockImplementation(
      () =>
        new Promise<TerminalNotification[]>((resolve) => {
          resolveNotifications = resolve;
        }),
    );

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {
            s1: makeNotification("s1"),
          },
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    const hydratePromise = useTerminalStore.getState().hydrateNotifications("ws-1");
    useTerminalStore.getState().clearNotificationLocal("ws-1", "s1");
    resolveNotifications?.([makeNotification("s1")]);
    await hydratePromise;

    expect(useTerminalStore.getState().workspaces["ws-1"]?.notificationsBySessionId).toEqual({});
  });

  it("preserves no-op clears that happen during hydration", async () => {
    let resolveNotifications: ((value: TerminalNotification[]) => void) | undefined;
    mockIpc.terminalListNotifications.mockImplementation(
      () =>
        new Promise<TerminalNotification[]>((resolve) => {
          resolveNotifications = resolve;
        }),
    );

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    const hydratePromise = useTerminalStore.getState().hydrateNotifications("ws-1");
    useTerminalStore.getState().clearNotificationLocal("ws-1", "s1");
    resolveNotifications?.([makeNotification("s1")]);
    await hydratePromise;

    expect(useTerminalStore.getState().workspaces["ws-1"]?.notificationsBySessionId).toEqual({});
  });

  it("ignores stale overlapping hydration responses", async () => {
    const resolvers: Array<(value: TerminalNotification[]) => void> = [];
    mockIpc.terminalListNotifications.mockImplementation(
      () =>
        new Promise<TerminalNotification[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {},
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    const firstHydrate = useTerminalStore.getState().hydrateNotifications("ws-1");
    const secondHydrate = useTerminalStore.getState().hydrateNotifications("ws-1");
    const staleNotification = makeNotification("s1");
    const freshNotification = {
      ...makeNotification("s1"),
      id: "notif-fresh",
      createdAt: new Date(2).toISOString(),
    };

    resolvers[1]?.([freshNotification]);
    await secondHydrate;
    resolvers[0]?.([staleNotification]);
    await firstHydrate;

    expect(useTerminalStore.getState().workspaces["ws-1"]?.notificationsBySessionId).toEqual({
      s1: freshNotification,
    });
  });

  it("clears the focused session notification when syncing focus", async () => {
    useTerminalStore.setState({
      workspaces: {
        "ws-1": {
          isOpen: true,
          layoutMode: "split",
          preEditorLayoutMode: "chat",
          panelSize: 32,
          sessions: [makeSession("s1")],
          notificationsBySessionId: {
            s1: makeNotification("s1"),
          },
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "Terminal 1",
              root: { type: "leaf", sessionId: "s1" },
              sessionMeta: {
                s1: {},
              },
              worktreeConfig: null,
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
          startupPreset: null,
          pendingStartupPreset: null,
          loading: false,
          error: undefined,
        },
      },
    });

    await useTerminalStore.getState().syncNotificationFocus("ws-1", "s1", true);

    expect(useTerminalStore.getState().workspaces["ws-1"]?.notificationsBySessionId).toEqual({});
    expect(mockIpc.terminalSetNotificationFocus).toHaveBeenCalledWith("ws-1", "s1", true);
  });
});
