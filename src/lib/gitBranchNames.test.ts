import { describe, expect, it } from "vitest";
import {
  isValidBranchName,
  localNameForRemoteBranch,
  resolveBranchSelectionTarget,
  sanitizeNewBranchName,
} from "./gitBranchNames";

describe("isValidBranchName", () => {
  it("accepts ordinary and slash-separated names", () => {
    expect(isValidBranchName("main")).toBe(true);
    expect(isValidBranchName("feature/branch-picker")).toBe(true);
    expect(isValidBranchName("release-1.2.3")).toBe(true);
  });

  it("rejects names git would refuse", () => {
    expect(isValidBranchName("")).toBe(false);
    expect(isValidBranchName("has space")).toBe(false);
    expect(isValidBranchName("a..b")).toBe(false);
    expect(isValidBranchName("/leading")).toBe(false);
    expect(isValidBranchName("trailing/")).toBe(false);
    expect(isValidBranchName("double//slash")).toBe(false);
    expect(isValidBranchName(".hidden")).toBe(false);
    expect(isValidBranchName("feature/.hidden")).toBe(false);
    expect(isValidBranchName("name.lock")).toBe(false);
    expect(isValidBranchName("-dash")).toBe(false);
    expect(isValidBranchName("ref@{1}")).toBe(false);
    expect(isValidBranchName("tilde~1")).toBe(false);
    expect(isValidBranchName("caret^")).toBe(false);
    expect(isValidBranchName("colon:x")).toBe(false);
    expect(isValidBranchName("q?")).toBe(false);
    expect(isValidBranchName("star*")).toBe(false);
    expect(isValidBranchName("bracket[")).toBe(false);
    expect(isValidBranchName("back\\slash")).toBe(false);
  });
});

describe("localNameForRemoteBranch", () => {
  it("drops the remote prefix", () => {
    expect(localNameForRemoteBranch("origin/main")).toBe("main");
    expect(localNameForRemoteBranch("origin/feature/nested")).toBe("feature/nested");
  });

  it("leaves names without a remote untouched", () => {
    expect(localNameForRemoteBranch("main")).toBe("main");
  });
});

describe("sanitizeNewBranchName", () => {
  it("turns whitespace runs into dashes and trims the ends", () => {
    expect(sanitizeNewBranchName("  new branch  ")).toBe("new-branch");
    expect(sanitizeNewBranchName("a \t b\nc")).toBe("a-b-c");
  });

  it("leaves valid names alone", () => {
    expect(sanitizeNewBranchName("feature/x--y")).toBe("feature/x--y");
  });
});

describe("resolveBranchSelectionTarget", () => {
  const repoPath = "/repo";
  const worktree = "/repo/.panes/worktrees/feature-x/";

  it("moves the thread into the worktree that already holds the branch", () => {
    expect(
      resolveBranchSelectionTarget({
        repoPath,
        activeWorktreePath: null,
        branch: { name: "feature/x", isRemote: false, worktreePath: worktree },
        defaultBranch: "main",
      }),
    ).toEqual({ checkoutCwd: worktree, nextWorktreePath: worktree, reuseExistingWorktree: true });
  });

  it("returns to the main checkout when the branch lives there", () => {
    expect(
      resolveBranchSelectionTarget({
        repoPath,
        activeWorktreePath: worktree,
        branch: { name: "main", isRemote: false, worktreePath: repoPath },
        defaultBranch: "main",
      }),
    ).toEqual({ checkoutCwd: repoPath, nextWorktreePath: null, reuseExistingWorktree: true });
  });

  it("checks out inside the current worktree by default", () => {
    expect(
      resolveBranchSelectionTarget({
        repoPath,
        activeWorktreePath: worktree,
        branch: { name: "origin/other", isRemote: true, worktreePath: null },
        defaultBranch: "main",
      }),
    ).toEqual({ checkoutCwd: worktree, nextWorktreePath: worktree, reuseExistingWorktree: false });
  });

  it("leaves the worktree when the default branch is picked", () => {
    expect(
      resolveBranchSelectionTarget({
        repoPath,
        activeWorktreePath: worktree,
        branch: { name: "origin/main", isRemote: true, worktreePath: null },
        defaultBranch: "main",
      }),
    ).toEqual({ checkoutCwd: repoPath, nextWorktreePath: null, reuseExistingWorktree: false });
  });

  it("checks out in the repo when no worktree is active", () => {
    expect(
      resolveBranchSelectionTarget({
        repoPath,
        activeWorktreePath: null,
        branch: { name: "feature/y", isRemote: false, worktreePath: null },
        defaultBranch: null,
      }),
    ).toEqual({ checkoutCwd: repoPath, nextWorktreePath: null, reuseExistingWorktree: false });
  });
});
