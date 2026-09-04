import { describe, expect, it } from "vitest";
import {
  readBusyWorktreeThreads,
  readThreadWorktreePath,
  resolveThreadWorkingDirectory,
} from "./threadWorktree";

describe("readThreadWorktreePath", () => {
  it("reads a bound worktree from thread metadata", () => {
    expect(
      readThreadWorktreePath({ engineMetadata: { worktreePath: "/repo/.panes/worktrees/x/" } }),
    ).toBe("/repo/.panes/worktrees/x/");
  });

  it("treats blanks, missing keys, and non-strings as unbound", () => {
    expect(readThreadWorktreePath({ engineMetadata: { worktreePath: "   " } })).toBeNull();
    expect(readThreadWorktreePath({ engineMetadata: { worktreePath: 42 } })).toBeNull();
    expect(readThreadWorktreePath({ engineMetadata: {} })).toBeNull();
    expect(readThreadWorktreePath({})).toBeNull();
    expect(readThreadWorktreePath(null)).toBeNull();
  });
});

describe("resolveThreadWorkingDirectory", () => {
  const repo = { path: "/repo" };

  it("prefers the worktree over the repo checkout", () => {
    expect(
      resolveThreadWorkingDirectory({ engineMetadata: { worktreePath: "/repo/wt/" } }, repo),
    ).toBe("/repo/wt/");
  });

  it("falls back to the repo checkout when unbound", () => {
    expect(resolveThreadWorkingDirectory({ engineMetadata: {} }, repo)).toBe("/repo");
    expect(resolveThreadWorkingDirectory(null, repo)).toBe("/repo");
  });

  it("has no directory without a repo", () => {
    expect(
      resolveThreadWorkingDirectory({ engineMetadata: { worktreePath: "/repo/wt/" } }, null),
    ).toBeNull();
  });
});

describe("readBusyWorktreeThreads", () => {
  it("reads the thread names out of a busy removal failure", () => {
    expect(readBusyWorktreeThreads("worktree_busy:Refactor auth, Fix flaky test")).toEqual([
      "Refactor auth",
      "Fix flaky test",
    ]);
  });

  it("finds the marker inside a wrapped error", () => {
    expect(readBusyWorktreeThreads(new Error("worktree_busy:Refactor auth"))).toEqual([
      "Refactor auth",
    ]);
  });

  it("ignores unrelated failures", () => {
    expect(readBusyWorktreeThreads("fatal: not a working tree")).toBeNull();
  });
});
