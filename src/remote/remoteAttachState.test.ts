import { describe, expect, it } from "vitest";
import type { Thread } from "../types";
import { selectWorkspaceThreads } from "./remoteAttachState";

describe("remoteAttachState", () => {
  it("reuses a stable empty snapshot when no workspace threads are available", () => {
    const first = selectWorkspaceThreads({}, null);
    const second = selectWorkspaceThreads({}, null);
    const missing = selectWorkspaceThreads({}, "workspace-1");

    expect(second).toBe(first);
    expect(missing).toBe(first);
  });

  it("returns the live workspace thread list when it exists", () => {
    const threads = [{ id: "thread-1" }] as Thread[];

    expect(selectWorkspaceThreads({ "workspace-1": threads }, "workspace-1")).toBe(threads);
  });
});
