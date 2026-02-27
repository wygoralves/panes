import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "../types";

const mockIpc = vi.hoisted(() => ({
  terminalCreateSession: vi.fn(),
  terminalCloseSession: vi.fn(),
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

describe("terminalStore.createMultiSessionGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({ workspaces: {} });
    mockIpc.terminalCloseSession.mockResolvedValue(undefined);
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
});
