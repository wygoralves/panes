import { describe, expect, it, vi } from "vitest";
import type { GitStatus, Repo } from "../types";
import {
  getActiveGitRepos,
  isRepoScopedGitCommandAvailable,
  resolveCommandPaletteGitStatus,
  shouldPersistPickedRepoSelection,
} from "./commandPaletteGit";

function createRepo(id: string, isActive = true): Repo {
  return {
    id,
    workspaceId: "ws-1",
    name: id,
    path: `/repos/${id}`,
    defaultBranch: "main",
    isActive,
    trustLevel: "trusted",
  };
}

function createStatus(files: GitStatus["files"] = []): GitStatus {
  return {
    branch: "main",
    files,
    ahead: 0,
    behind: 0,
  };
}

describe("isRepoScopedGitCommandAvailable", () => {
  it("allows repo-scoped git commands when an active repo exists", () => {
    expect(isRepoScopedGitCommandAvailable("/repos/repo-a", [createRepo("repo-a")])).toBe(true);
  });

  it("allows repo-scoped git commands without an active repo in multi-repo workspaces", () => {
    expect(
      isRepoScopedGitCommandAvailable(null, [createRepo("repo-a"), createRepo("repo-b")]),
    ).toBe(true);
  });

  it("keeps repo-scoped git commands hidden when no repo is active in a single-repo workspace", () => {
    expect(isRepoScopedGitCommandAvailable(null, [createRepo("repo-a")])).toBe(false);
  });

  it("keeps repo-scoped git commands hidden when extra repos are inactive", () => {
    expect(
      isRepoScopedGitCommandAvailable(null, [
        createRepo("repo-a"),
        createRepo("repo-b", false),
      ]),
    ).toBe(false);
  });
});

describe("getActiveGitRepos", () => {
  it("returns only repos marked active for git-scoped picker flows", () => {
    expect(
      getActiveGitRepos([
        createRepo("repo-a"),
        createRepo("repo-b", false),
        createRepo("repo-c"),
      ]).map((repo) => repo.id),
    ).toEqual(["repo-a", "repo-c"]);
  });
});

describe("resolveCommandPaletteGitStatus", () => {
  it("reuses the active repo status without fetching again", async () => {
    const activeStatus = createStatus([{ path: "tracked.ts", indexStatus: "M" }]);
    const loadStatus = vi.fn<(repoPath: string) => Promise<GitStatus>>();

    await expect(
      resolveCommandPaletteGitStatus({
        repoPath: "/repos/repo-a",
        activeRepoPath: "/repos/repo-a",
        activeStatus,
        loadStatus,
      }),
    ).resolves.toBe(activeStatus);

    expect(loadStatus).not.toHaveBeenCalled();
  });

  it("fetches status for a picked repo that is not currently active", async () => {
    const pickedStatus = createStatus([{ path: "feature.ts", worktreeStatus: "M" }]);
    const loadStatus = vi.fn(async () => pickedStatus);

    await expect(
      resolveCommandPaletteGitStatus({
        repoPath: "/repos/repo-b",
        activeRepoPath: "/repos/repo-a",
        activeStatus: createStatus(),
        loadStatus,
      }),
    ).resolves.toBe(pickedStatus);

    expect(loadStatus).toHaveBeenCalledWith("/repos/repo-b");
  });

  it("returns undefined when there is no repo path to resolve", async () => {
    const loadStatus = vi.fn<(repoPath: string) => Promise<GitStatus>>();

    await expect(
      resolveCommandPaletteGitStatus({
        repoPath: null,
        activeRepoPath: "/repos/repo-a",
        activeStatus: createStatus(),
        loadStatus,
      }),
    ).resolves.toBeUndefined();

    expect(loadStatus).not.toHaveBeenCalled();
  });
});

describe("shouldPersistPickedRepoSelection", () => {
  it("persists the selected repo when a command opens the changes view", () => {
    expect(shouldPersistPickedRepoSelection("git-discard-all")).toBe(true);
  });

  it("keeps transient repo selection for commands that should not change global state", () => {
    expect(shouldPersistPickedRepoSelection("git-commit")).toBe(false);
  });
});
