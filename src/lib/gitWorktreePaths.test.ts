import { describe, expect, it } from "vitest";
import {
  defaultWorktreePath,
  worktreeDisplayName,
  worktreeFolderNameForBranch,
} from "./gitWorktreePaths";

describe("worktreeFolderNameForBranch", () => {
  it("flattens slashes so nested branch names become one folder", () => {
    expect(worktreeFolderNameForBranch("feature/branch-picker")).toBe("feature-branch-picker");
    expect(worktreeFolderNameForBranch("  main ")).toBe("main");
    expect(worktreeFolderNameForBranch("a\\b")).toBe("a-b");
  });
});

describe("defaultWorktreePath", () => {
  it("places the worktree under the repo's .panes/worktrees directory", () => {
    expect(defaultWorktreePath("/repo", "feature/x")).toBe("/repo/.panes/worktrees/feature-x");
  });

  it("tolerates a trailing slash on the repo path", () => {
    expect(defaultWorktreePath("/repo/", "main")).toBe("/repo/.panes/worktrees/main");
  });

  it("ends without a separator so it matches a git-reported worktree path", () => {
    expect(defaultWorktreePath("/repo", "main").endsWith("/")).toBe(false);
  });

  it("returns an empty path for an empty branch", () => {
    expect(defaultWorktreePath("/repo", "   ")).toBe("");
  });
});

describe("worktreeDisplayName", () => {
  it("uses the last path segment regardless of trailing separators", () => {
    expect(worktreeDisplayName("/repo/.panes/worktrees/feature-x/")).toBe("feature-x");
    expect(worktreeDisplayName("/repo/.panes/worktrees/feature-x")).toBe("feature-x");
    expect(worktreeDisplayName("C:\\repo\\wt\\fix")).toBe("fix");
  });
});
