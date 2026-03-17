import { describe, expect, it } from "vitest";
import {
  createInitialRemoteControlDesiredState,
  requestRemoteControlLeases,
  resolveRemoteControlLevel,
  setRemoteControlScopeDesired,
} from "./remoteControlState";

describe("remoteControlState", () => {
  it("disables one lease intent without clearing the other", () => {
    const initial = createInitialRemoteControlDesiredState();
    const next = setRemoteControlScopeDesired(initial, "workspace", false);

    expect(next).toEqual({
      workspace: false,
      thread: true,
    });
  });

  it("keeps trying to acquire thread control when workspace control fails", async () => {
    const result = await requestRemoteControlLeases({
      activeWorkspaceId: "workspace-1",
      activeThreadId: "thread-1",
      ensureWorkspaceControl: async () => {
        throw new Error("workspace locked");
      },
      ensureThreadControl: async () => true,
    });

    expect(result).toEqual({
      workspaceAcquired: false,
      threadAcquired: true,
      errors: ["Error: workspace locked"],
    });
  });

  it("reports thread-only control distinctly from full workspace control", () => {
    expect(resolveRemoteControlLevel(true, true)).toBe("workspace");
    expect(resolveRemoteControlLevel(false, true)).toBe("thread");
    expect(resolveRemoteControlLevel(false, false)).toBe("viewer");
  });
});
