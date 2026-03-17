import { describe, expect, it } from "vitest";
import type { Thread } from "../types";
import {
  parseRemoteThreadScopeValue,
  REMOTE_THREAD_SCOPE_WORKSPACE_VALUE,
  resolveRemoteChatRepoId,
  resolveRemoteThreadScopeValue,
  selectWorkspaceThreads,
} from "./remoteAttachState";

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

  it("round-trips the workspace thread scope sentinel", () => {
    expect(resolveRemoteThreadScopeValue(null)).toBe(REMOTE_THREAD_SCOPE_WORKSPACE_VALUE);
    expect(parseRemoteThreadScopeValue(REMOTE_THREAD_SCOPE_WORKSPACE_VALUE)).toBeNull();
  });

  it("preserves repo-scoped selections", () => {
    expect(resolveRemoteThreadScopeValue("repo-1")).toBe("repo-1");
    expect(parseRemoteThreadScopeValue("repo-1")).toBe("repo-1");
    expect(parseRemoteThreadScopeValue("")).toBeNull();
  });

  it("prefers the active thread scope over the draft scope once a thread exists", () => {
    expect(resolveRemoteChatRepoId(null, "repo-draft", true)).toBeNull();
    expect(resolveRemoteChatRepoId("repo-thread", "repo-draft", true)).toBe("repo-thread");
    expect(resolveRemoteChatRepoId(null, "repo-draft", false)).toBe("repo-draft");
  });
});
