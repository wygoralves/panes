import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "../types";

const mockIpc = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  getFileDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  discardFiles: vi.fn(),
  commit: vi.fn(),
  softResetLastCommit: vi.fn(),
  fetchGit: vi.fn(),
  pullGit: vi.fn(),
  pushGit: vi.fn(),
  listGitBranches: vi.fn(),
  checkoutGitBranch: vi.fn(),
  createGitBranch: vi.fn(),
  renameGitBranch: vi.fn(),
  deleteGitBranch: vi.fn(),
  listGitCommits: vi.fn(),
  listGitStashes: vi.fn(),
  pushGitStash: vi.fn(),
  applyGitStash: vi.fn(),
  popGitStash: vi.fn(),
  getCommitDiff: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

import { useGitStore } from "./gitStore";

function makeStatus(branch: string, files: GitStatus["files"] = []): GitStatus {
  return {
    branch,
    files,
    ahead: 0,
    behind: 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("gitStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockIpc.getGitStatus.mockResolvedValue(makeStatus("main"));
    mockIpc.getFileDiff.mockResolvedValue("");
    mockIpc.stageFiles.mockResolvedValue(undefined);
    mockIpc.unstageFiles.mockResolvedValue(undefined);
    mockIpc.discardFiles.mockResolvedValue(undefined);
    mockIpc.commit.mockResolvedValue("abc123");
    mockIpc.softResetLastCommit.mockResolvedValue(undefined);
    mockIpc.fetchGit.mockResolvedValue(undefined);
    mockIpc.pullGit.mockResolvedValue(undefined);
    mockIpc.pushGit.mockResolvedValue(undefined);
    mockIpc.listGitBranches.mockResolvedValue({ entries: [] });
    mockIpc.checkoutGitBranch.mockResolvedValue(undefined);
    mockIpc.createGitBranch.mockResolvedValue(undefined);
    mockIpc.renameGitBranch.mockResolvedValue(undefined);
    mockIpc.deleteGitBranch.mockResolvedValue(undefined);
    mockIpc.listGitCommits.mockResolvedValue({
      entries: [],
      offset: 0,
      limit: 100,
      total: 0,
      hasMore: false,
    });
    mockIpc.listGitStashes.mockResolvedValue([]);
    mockIpc.pushGitStash.mockResolvedValue(undefined);
    mockIpc.applyGitStash.mockResolvedValue(undefined);
    mockIpc.popGitStash.mockResolvedValue(undefined);
    mockIpc.getCommitDiff.mockResolvedValue("");

    useGitStore.setState({
      status: undefined,
      selectedFile: undefined,
      selectedFileStaged: undefined,
      diff: undefined,
      loading: false,
      error: undefined,
      activeRepoPath: null,
      remoteSyncAction: null,
      remoteSyncRepoPath: null,
      activeView: "changes",
      branchScope: "local",
      branches: [],
      commits: [],
      commitsOffset: 0,
      commitsHasMore: false,
      commitsTotal: 0,
      stashes: [],
      selectedCommitHash: undefined,
      commitDiff: undefined,
    });
  });

  it("keeps loading true until all overlapping operations settle", async () => {
    const fetchDeferred = deferred<void>();
    const pullDeferred = deferred<void>();
    mockIpc.fetchGit.mockReturnValueOnce(fetchDeferred.promise);
    mockIpc.pullGit.mockReturnValueOnce(pullDeferred.promise);

    const fetchPromise = useGitStore.getState().fetchRemote("/repo");
    const pullPromise = useGitStore.getState().pullRemote("/repo");
    await flushPromises();
    expect(useGitStore.getState().loading).toBe(true);

    fetchDeferred.resolve(undefined);
    await flushPromises();
    expect(useGitStore.getState().loading).toBe(true);

    pullDeferred.resolve(undefined);
    await Promise.all([fetchPromise, pullPromise]);
    expect(useGitStore.getState().loading).toBe(false);
  });

  it("tracks remote sync state only for remote operations", async () => {
    const pushDeferred = deferred<void>();
    mockIpc.pushGit.mockReturnValueOnce(pushDeferred.promise);

    const pushPromise = useGitStore.getState().pushRemote("/repo");
    await flushPromises();
    expect(useGitStore.getState().remoteSyncAction).toBe("push");
    expect(useGitStore.getState().remoteSyncRepoPath).toBe("/repo");

    pushDeferred.resolve(undefined);
    await pushPromise;
    expect(useGitStore.getState().remoteSyncAction).toBeNull();
    expect(useGitStore.getState().remoteSyncRepoPath).toBeNull();
  });

  it("ignores stale refresh responses after repo switch", async () => {
    const repoAStatus = deferred<GitStatus>();
    mockIpc.getGitStatus.mockImplementation((repoPath: string) => {
      if (repoPath === "/repo-a") {
        return repoAStatus.promise;
      }
      return Promise.resolve(makeStatus("repo-b-branch"));
    });

    useGitStore.getState().setActiveRepoPath("/repo-a");
    const repoARefresh = useGitStore.getState().refresh("/repo-a");
    await flushPromises();

    useGitStore.getState().setActiveRepoPath("/repo-b");
    await useGitStore.getState().refresh("/repo-b");
    expect(useGitStore.getState().status?.branch).toBe("repo-b-branch");

    repoAStatus.resolve(makeStatus("repo-a-branch"));
    await repoARefresh;
    expect(useGitStore.getState().status?.branch).toBe("repo-b-branch");
  });

  it("refreshes status after bulk stage mutation", async () => {
    const repoPath = "/repo-stage";
    mockIpc.getGitStatus
      .mockResolvedValueOnce(makeStatus("main", []))
      .mockResolvedValueOnce(makeStatus("main", [{ path: "a.ts", indexStatus: "added" }]));

    useGitStore.getState().setActiveRepoPath(repoPath);
    await useGitStore.getState().refresh(repoPath);
    expect(useGitStore.getState().status?.files).toHaveLength(0);

    await useGitStore.getState().stageMany(repoPath, ["a.ts"]);
    expect(mockIpc.stageFiles).toHaveBeenCalledWith(repoPath, ["a.ts"]);
    expect(useGitStore.getState().status?.files).toHaveLength(1);
    expect(useGitStore.getState().status?.files[0]?.path).toBe("a.ts");
  });
});
