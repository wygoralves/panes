import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "../types";

const mockIpc = vi.hoisted(() => ({
  terminalCreateSession: vi.fn(),
  terminalCloseSession: vi.fn(),
  addGitWorktree: vi.fn(),
  removeGitWorktree: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

import { useTerminalStore } from "./terminalStore";

function makeSession(id: string): TerminalSession {
  return {
    id,
    workspaceId: "ws-1",
    shell: "zsh",
    cwd: "/tmp",
    createdAt: new Date(0).toISOString(),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminalStore.createMultiSessionGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    useTerminalStore.setState({ workspaces: {} });
    mockIpc.terminalCloseSession.mockResolvedValue(undefined);
    mockIpc.addGitWorktree.mockResolvedValue(undefined);
    mockIpc.removeGitWorktree.mockResolvedValue(undefined);
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

  it("uses a unique run id in worktree branch and path names", async () => {
    mockIpc.terminalCreateSession
      .mockResolvedValueOnce(makeSession("s1"))
      .mockResolvedValueOnce(makeSession("s2"));

    const result = await useTerminalStore.getState().createMultiSessionGroup(
      "ws-1",
      [
        { harnessId: "h1", name: "Harness 1" },
        { harnessId: "h2", name: "Harness 2" },
      ],
      {
        repoPath: "/repo",
        baseBranch: "main",
        baseDir: "/repo/.panes/worktrees",
      },
      120,
      36,
    );

    expect(result).not.toBeNull();
    expect(mockIpc.addGitWorktree).toHaveBeenCalledTimes(2);

    const first = mockIpc.addGitWorktree.mock.calls[0];
    const second = mockIpc.addGitWorktree.mock.calls[1];
    const runId = /^panes\/([^/]+)\/agent-1$/.exec(first[2] as string)?.[1];

    expect(runId).toBeTruthy();
    expect(first[1]).toBe(`/repo/.panes/worktrees/${runId}/agent-1`);
    expect(second[1]).toBe(`/repo/.panes/worktrees/${runId}/agent-2`);
    expect(first[2]).toBe(`panes/${runId}/agent-1`);
    expect(second[2]).toBe(`panes/${runId}/agent-2`);
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
          activeSessionId: "s1",
          groups: [
            {
              id: "g1",
              name: "2 agents",
              root: { type: "leaf", sessionId: "s1" },
              worktrees: {
                s1: {
                  repoPath: "/repo",
                  worktreePath: "/repo/.panes/worktrees/r1/agent-1",
                  branch: "panes/r1/agent-1",
                },
              },
            },
          ],
          activeGroupId: "g1",
          focusedSessionId: "s1",
          broadcastGroupId: null,
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
        repoPath: "/repo",
        baseBranch: "main",
        baseDir: "/repo/.panes/worktrees",
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
});
