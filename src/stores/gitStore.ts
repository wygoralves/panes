import { create } from "zustand";
import type {
  GitBranch,
  GitBranchScope,
  GitCommit,
  GitRemote,
  GitStash,
  GitStatus,
  GitWorktree,
} from "../types";
import { ipc } from "../lib/ipc";
import { recordPerfMetric } from "../lib/perfTelemetry";

const BRANCH_PAGE_SIZE = 200;
const COMMIT_PAGE_SIZE = 100;
const GIT_STATUS_CACHE_TTL_MS = 1_000;
const GIT_DIFF_CACHE_TTL_MS = 1_200;
const GIT_ACTIVE_VIEW_REFRESH_MIN_INTERVAL_MS = 1_500;
const GIT_STATUS_CACHE_MAX_ENTRIES = 32;
const GIT_DIFF_CACHE_MAX_ENTRIES = 320;
const GIT_STATUS_CACHE_MAX_BYTES = 3 * 1024 * 1024;
const GIT_DIFF_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const DRAFT_HISTORY_MAX = 3;

export interface GitDraftsPayload {
  commitMessage: string;
  branchName: string;
  commitHistory: string[];
  branchHistory: string[];
}

const EMPTY_DRAFTS: GitDraftsPayload = {
  commitMessage: "",
  branchName: "",
  commitHistory: [],
  branchHistory: [],
};

function draftStorageKey(workspaceId: string): string {
  return `panes:git.drafts:${workspaceId}`;
}

function loadDraftsFromStorage(workspaceId: string): GitDraftsPayload {
  try {
    const raw = localStorage.getItem(draftStorageKey(workspaceId));
    if (!raw) return { ...EMPTY_DRAFTS };
    const parsed = JSON.parse(raw) as Partial<GitDraftsPayload>;
    return {
      commitMessage: typeof parsed.commitMessage === "string" ? parsed.commitMessage : "",
      branchName: typeof parsed.branchName === "string" ? parsed.branchName : "",
      commitHistory: Array.isArray(parsed.commitHistory)
        ? parsed.commitHistory.filter((v): v is string => typeof v === "string").slice(0, DRAFT_HISTORY_MAX)
        : [],
      branchHistory: Array.isArray(parsed.branchHistory)
        ? parsed.branchHistory.filter((v): v is string => typeof v === "string").slice(0, DRAFT_HISTORY_MAX)
        : [],
    };
  } catch {
    return { ...EMPTY_DRAFTS };
  }
}

function saveDraftsToStorage(workspaceId: string, payload: GitDraftsPayload): void {
  try {
    localStorage.setItem(draftStorageKey(workspaceId), JSON.stringify(payload));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function addToHistory(history: string[], entry: string): string[] {
  const trimmed = entry.trim();
  if (!trimmed) return history;
  const deduped = history.filter((h) => h !== trimmed);
  return [trimmed, ...deduped].slice(0, DRAFT_HISTORY_MAX);
}

export type GitPanelView = "changes" | "branches" | "commits" | "stash" | "files" | "worktrees";
export type GitRemoteSyncAction = "fetch" | "pull" | "push";

interface GitStatusCacheEntry {
  status: GitStatus;
  revision: number;
  updatedAt: number;
}

interface GitDiffCacheEntry {
  diff: string;
  revision: number;
  updatedAt: number;
}

const repoRevisionByPath = new Map<string, number>();
const statusCacheByRepo = new Map<string, GitStatusCacheEntry>();
const statusInFlightByRepo = new Map<string, Promise<GitStatus>>();
const diffCacheByKey = new Map<string, GitDiffCacheEntry>();
const diffInFlightByKey = new Map<string, Promise<string>>();
const activeViewRefreshedAtByKey = new Map<string, number>();
let statusCacheBytes = 0;
let diffCacheBytes = 0;

function estimateStatusCacheEntryBytes(repoPath: string, entry: GitStatusCacheEntry): number {
  let bytes = repoPath.length * 2 + entry.status.branch.length * 2 + 96;
  for (const file of entry.status.files) {
    bytes += file.path.length * 2;
    bytes += (file.indexStatus?.length ?? 0) * 2;
    bytes += (file.worktreeStatus?.length ?? 0) * 2;
    bytes += 48;
  }
  return bytes;
}

function estimateDiffCacheEntryBytes(key: string, entry: GitDiffCacheEntry): number {
  return (key.length + entry.diff.length) * 2 + 96;
}

function removeStatusCacheEntry(repoPath: string) {
  const existing = statusCacheByRepo.get(repoPath);
  if (!existing) {
    return;
  }
  statusCacheBytes = Math.max(
    0,
    statusCacheBytes - estimateStatusCacheEntryBytes(repoPath, existing),
  );
  statusCacheByRepo.delete(repoPath);
}

function removeDiffCacheEntry(key: string) {
  const existing = diffCacheByKey.get(key);
  if (!existing) {
    return;
  }
  diffCacheBytes = Math.max(0, diffCacheBytes - estimateDiffCacheEntryBytes(key, existing));
  diffCacheByKey.delete(key);
}

function trimStatusCacheToLimits() {
  while (
    statusCacheByRepo.size > GIT_STATUS_CACHE_MAX_ENTRIES ||
    statusCacheBytes > GIT_STATUS_CACHE_MAX_BYTES
  ) {
    let oldestKey: string | null = null;
    let oldestUpdatedAt = Number.POSITIVE_INFINITY;

    for (const [key, entry] of statusCacheByRepo.entries()) {
      if (entry.updatedAt < oldestUpdatedAt) {
        oldestUpdatedAt = entry.updatedAt;
        oldestKey = key;
      }
    }

    if (!oldestKey) {
      break;
    }
    removeStatusCacheEntry(oldestKey);
  }
}

function trimDiffCacheToLimits() {
  while (
    diffCacheByKey.size > GIT_DIFF_CACHE_MAX_ENTRIES ||
    diffCacheBytes > GIT_DIFF_CACHE_MAX_BYTES
  ) {
    let oldestKey: string | null = null;
    let oldestUpdatedAt = Number.POSITIVE_INFINITY;

    for (const [key, entry] of diffCacheByKey.entries()) {
      if (entry.updatedAt < oldestUpdatedAt) {
        oldestUpdatedAt = entry.updatedAt;
        oldestKey = key;
      }
    }

    if (!oldestKey) {
      break;
    }
    removeDiffCacheEntry(oldestKey);
  }
}

function setStatusCacheEntry(repoPath: string, entry: GitStatusCacheEntry) {
  removeStatusCacheEntry(repoPath);
  statusCacheByRepo.set(repoPath, entry);
  statusCacheBytes += estimateStatusCacheEntryBytes(repoPath, entry);
  trimStatusCacheToLimits();
}

function setDiffCacheEntry(key: string, entry: GitDiffCacheEntry) {
  removeDiffCacheEntry(key);
  diffCacheByKey.set(key, entry);
  diffCacheBytes += estimateDiffCacheEntryBytes(key, entry);
  trimDiffCacheToLimits();
}

function getRepoRevision(repoPath: string): number {
  return repoRevisionByPath.get(repoPath) ?? 0;
}

function incrementRepoRevision(repoPath: string): number {
  const next = getRepoRevision(repoPath) + 1;
  repoRevisionByPath.set(repoPath, next);
  return next;
}

function buildDiffCacheKey(repoPath: string, filePath: string, staged: boolean): string {
  return `${repoPath}::${staged ? "staged" : "worktree"}::${filePath}`;
}

function invalidateRepoCaches(repoPath: string) {
  incrementRepoRevision(repoPath);
  removeStatusCacheEntry(repoPath);
  statusInFlightByRepo.delete(repoPath);
  for (const key of [...diffCacheByKey.keys()]) {
    if (key.startsWith(`${repoPath}::`)) {
      removeDiffCacheEntry(key);
    }
  }
  for (const key of diffInFlightByKey.keys()) {
    if (key.startsWith(`${repoPath}::`)) {
      diffInFlightByKey.delete(key);
    }
  }
  for (const key of activeViewRefreshedAtByKey.keys()) {
    if (key.startsWith(`${repoPath}::`)) {
      activeViewRefreshedAtByKey.delete(key);
    }
  }
}

function shouldRefreshActiveView(
  repoPath: string,
  view: GitPanelView,
  force: boolean,
): boolean {
  if (view === "changes") {
    return false;
  }
  if (force) {
    return true;
  }
  const key = `${repoPath}::${view}`;
  const now = performance.now();
  const last = activeViewRefreshedAtByKey.get(key);
  if (last !== undefined && now - last < GIT_ACTIVE_VIEW_REFRESH_MIN_INTERVAL_MS) {
    return false;
  }
  return true;
}

function markActiveViewRefreshed(repoPath: string, view: GitPanelView) {
  if (view === "changes") {
    return;
  }
  activeViewRefreshedAtByKey.set(`${repoPath}::${view}`, performance.now());
}

async function getGitStatusCached(repoPath: string, force = false): Promise<GitStatus> {
  const revision = getRepoRevision(repoPath);
  const now = performance.now();
  const cached = statusCacheByRepo.get(repoPath);
  if (
    !force &&
    cached &&
    cached.revision === revision &&
    now - cached.updatedAt <= GIT_STATUS_CACHE_TTL_MS
  ) {
    setStatusCacheEntry(repoPath, {
      ...cached,
      updatedAt: now,
    });
    return cached.status;
  }

  const inFlight = statusInFlightByRepo.get(repoPath);
  if (inFlight) {
    return inFlight;
  }

  const requestRevision = revision;
  const requestPromise = ipc
    .getGitStatus(repoPath)
    .then((status) => {
      if (getRepoRevision(repoPath) === requestRevision) {
        setStatusCacheEntry(repoPath, {
          status,
          revision: requestRevision,
          updatedAt: performance.now(),
        });
      }
      return status;
    })
    .finally(() => {
      statusInFlightByRepo.delete(repoPath);
    });

  statusInFlightByRepo.set(repoPath, requestPromise);
  return requestPromise;
}

async function getGitDiffCached(
  repoPath: string,
  filePath: string,
  staged: boolean,
  force = false,
): Promise<string> {
  const key = buildDiffCacheKey(repoPath, filePath, staged);
  const revision = getRepoRevision(repoPath);
  const now = performance.now();
  const cached = diffCacheByKey.get(key);
  if (
    !force &&
    cached &&
    cached.revision === revision &&
    now - cached.updatedAt <= GIT_DIFF_CACHE_TTL_MS
  ) {
    setDiffCacheEntry(key, {
      ...cached,
      updatedAt: now,
    });
    return cached.diff;
  }

  const inFlight = diffInFlightByKey.get(key);
  if (inFlight) {
    return inFlight;
  }

  const requestRevision = revision;
  const requestPromise = ipc
    .getFileDiff(repoPath, filePath, staged)
    .then((diff) => {
      if (getRepoRevision(repoPath) === requestRevision) {
        setDiffCacheEntry(key, {
          diff,
          revision: requestRevision,
          updatedAt: performance.now(),
        });
      }
      return diff;
    })
    .finally(() => {
      diffInFlightByKey.delete(key);
    });

  diffInFlightByKey.set(key, requestPromise);
  return requestPromise;
}

interface GitState {
  status?: GitStatus;
  selectedFile?: string;
  selectedFileStaged?: boolean;
  diff?: string;
  loading: boolean;
  error?: string;
  activeRepoPath: string | null;
  remoteSyncAction: GitRemoteSyncAction | null;
  remoteSyncRepoPath: string | null;
  activeView: GitPanelView;
  branchScope: GitBranchScope;
  branches: GitBranch[];
  branchesTotal: number;
  branchesHasMore: boolean;
  branchesOffset: number;
  branchSearch: string;
  commits: GitCommit[];
  commitsOffset: number;
  commitsHasMore: boolean;
  commitsTotal: number;
  stashes: GitStash[];
  worktrees: GitWorktree[];
  remotes: GitRemote[];
  remotesRepoPath: string | null;
  remotesLoading: boolean;
  remotesError?: string;
  mainRepoPath: string | null;
  selectedCommitHash?: string;
  commitDiff?: string;
  setActiveRepoPath: (repoPath: string | null) => void;
  refresh: (repoPath: string, options?: { force?: boolean }) => Promise<void>;
  invalidateRepoCache: (repoPath: string) => void;
  setActiveView: (view: GitPanelView) => void;
  setBranchScope: (scope: GitBranchScope) => void;
  selectFile: (repoPath: string, filePath: string, staged?: boolean) => Promise<void>;
  stage: (repoPath: string, filePath: string) => Promise<void>;
  stageMany: (repoPath: string, files: string[]) => Promise<void>;
  unstage: (repoPath: string, filePath: string) => Promise<void>;
  unstageMany: (repoPath: string, files: string[]) => Promise<void>;
  discardFiles: (repoPath: string, files: string[]) => Promise<void>;
  commit: (repoPath: string, message: string) => Promise<string>;
  softResetLastCommit: (repoPath: string) => Promise<void>;
  fetchRemote: (repoPath: string) => Promise<void>;
  pullRemote: (repoPath: string) => Promise<void>;
  pushRemote: (repoPath: string) => Promise<void>;
  loadBranches: (repoPath: string, scope?: GitBranchScope, search?: string) => Promise<void>;
  loadMoreBranches: (repoPath: string) => Promise<void>;
  setBranchSearch: (repoPath: string, query: string) => Promise<void>;
  checkoutBranch: (repoPath: string, branchName: string, isRemote: boolean) => Promise<void>;
  createBranch: (repoPath: string, branchName: string, fromRef?: string | null) => Promise<void>;
  renameBranch: (repoPath: string, oldName: string, newName: string) => Promise<void>;
  deleteBranch: (repoPath: string, branchName: string, force: boolean) => Promise<void>;
  loadCommits: (repoPath: string, append?: boolean) => Promise<void>;
  loadMoreCommits: (repoPath: string) => Promise<void>;
  setMainRepoPath: (path: string | null) => void;
  loadWorktrees: (repoPath: string) => Promise<void>;
  addWorktree: (repoPath: string, worktreePath: string, branchName: string, baseRef?: string | null) => Promise<GitWorktree>;
  removeWorktree: (repoPath: string, worktreePath: string, force: boolean, branchName?: string | null, deleteBranch?: boolean) => Promise<void>;
  pruneWorktrees: (repoPath: string) => Promise<void>;
  loadStashes: (repoPath: string) => Promise<void>;
  pushStash: (repoPath: string, message?: string) => Promise<void>;
  applyStash: (repoPath: string, stashIndex: number) => Promise<void>;
  popStash: (repoPath: string, stashIndex: number) => Promise<void>;
  selectCommit: (repoPath: string, commitHash: string) => Promise<void>;
  clearCommitSelection: () => void;
  loadRemotes: (repoPath: string) => Promise<void>;
  addRemote: (repoPath: string, name: string, url: string) => Promise<void>;
  removeRemote: (repoPath: string, name: string) => Promise<void>;
  renameRemote: (repoPath: string, oldName: string, newName: string) => Promise<void>;
  clearError: () => void;
  drafts: GitDraftsPayload;
  loadDraftsForWorkspace: (workspaceId: string) => void;
  setCommitMessageDraft: (workspaceId: string, message: string) => void;
  setBranchNameDraft: (workspaceId: string, name: string) => void;
  pushCommitHistory: (workspaceId: string, message: string) => void;
  pushBranchHistory: (workspaceId: string, name: string) => void;
  flushDrafts: (workspaceId: string) => void;
}

async function refreshActiveView(repoPath: string, state: Pick<GitState, "activeView" | "branchScope" | "branchSearch">) {
  if (state.activeView === "branches") {
    const branchesPage = await ipc.listGitBranches(
      repoPath,
      state.branchScope,
      0,
      BRANCH_PAGE_SIZE,
      state.branchSearch || undefined,
    );
    return {
      branches: branchesPage.entries,
      branchesTotal: branchesPage.total,
      branchesHasMore: branchesPage.hasMore,
      branchesOffset: branchesPage.offset + branchesPage.entries.length,
    } satisfies Partial<GitState>;
  }

  if (state.activeView === "commits") {
    const commitsPage = await ipc.listGitCommits(repoPath, 0, COMMIT_PAGE_SIZE);
    return {
      commits: commitsPage.entries,
      commitsOffset: commitsPage.offset + commitsPage.entries.length,
      commitsHasMore: commitsPage.hasMore,
      commitsTotal: commitsPage.total,
    } satisfies Partial<GitState>;
  }

  if (state.activeView === "stash") {
    const stashes = await ipc.listGitStashes(repoPath);
    return {
      stashes,
    } satisfies Partial<GitState>;
  }

  if (state.activeView === "worktrees") {
    const worktrees = await ipc.listGitWorktrees(repoPath);
    return {
      worktrees,
    } satisfies Partial<GitState>;
  }

  return {};
}

export const useGitStore = create<GitState>((set, get) => {
  let loadingOps = 0;
  let refreshSeq = 0;
  let selectFileSeq = 0;
  let branchesSeq = 0;
  let commitsSeq = 0;
  let stashesSeq = 0;
  let worktreesSeq = 0;
  let commitDiffSeq = 0;
  let remotesSeq = 0;

  const isRepoActive = (repoPath: string): boolean => {
    const activeRepoPath = get().activeRepoPath;
    return activeRepoPath === null || activeRepoPath === repoPath;
  };

  const isRepoInWorktreeContext = (repoPath: string): boolean => {
    const { activeRepoPath, mainRepoPath } = get();
    if (activeRepoPath === null) {
      return true;
    }
    return activeRepoPath === repoPath || mainRepoPath === repoPath;
  };

  const resolveRefreshRepoPathForWorktreeMutation = (repoPath: string): string => {
    const { activeRepoPath, mainRepoPath } = get();
    if (mainRepoPath && mainRepoPath === repoPath && activeRepoPath) {
      return activeRepoPath;
    }
    return repoPath;
  };

  const beginLoading = () => {
    loadingOps += 1;
    if (loadingOps === 1) {
      set({ loading: true });
    }
  };

  const endLoading = () => {
    loadingOps = Math.max(0, loadingOps - 1);
    if (loadingOps === 0) {
      set({ loading: false });
    }
  };

  const runRefresh = async (repoPath: string, options?: { force?: boolean }) => {
    const requestSeq = ++refreshSeq;
    const startedAt = performance.now();

    try {
      const status = await getGitStatusCached(repoPath, options?.force ?? false);
      const currentState = get();
      const selectedFile = currentState.selectedFile;
      const selectedFileStaged = currentState.selectedFileStaged ?? false;
      let selectedDiff: string | undefined = currentState.diff;
      let nextSelectedFile = selectedFile;
      let nextSelectedFileStaged = currentState.selectedFileStaged;
      const shouldRefreshSelectedDiff = currentState.activeView === "changes";
      let selectedDiffRefreshed = false;

      if (selectedFile) {
        const selectedStatus = status.files.find((file) => file.path === selectedFile);
        const sameStateExists = selectedStatus
          ? (selectedFileStaged ? Boolean(selectedStatus.indexStatus) : Boolean(selectedStatus.worktreeStatus))
          : false;
        const oppositeStateExists = selectedStatus
          ? (selectedFileStaged ? Boolean(selectedStatus.worktreeStatus) : Boolean(selectedStatus.indexStatus))
          : false;

        if (!sameStateExists && !oppositeStateExists) {
          selectedDiff = undefined;
          nextSelectedFile = undefined;
          nextSelectedFileStaged = undefined;
        } else if (shouldRefreshSelectedDiff) {
          if (sameStateExists) {
            try {
              selectedDiff = await getGitDiffCached(repoPath, selectedFile, selectedFileStaged);
              selectedDiffRefreshed = true;
            } catch {
              selectedDiff = undefined;
            }
          } else {
            const flippedStaged = !selectedFileStaged;
            nextSelectedFileStaged = flippedStaged;
            try {
              selectedDiff = await getGitDiffCached(repoPath, selectedFile, flippedStaged);
              selectedDiffRefreshed = true;
            } catch {
              selectedDiff = undefined;
            }
          }
        } else {
          if (!sameStateExists && oppositeStateExists) {
            nextSelectedFileStaged = !selectedFileStaged;
          }
          selectedDiff = undefined;
        }
      }

      const forceRefresh = options?.force ?? false;
      const refreshView = shouldRefreshActiveView(
        repoPath,
        currentState.activeView,
        forceRefresh,
      );
      const viewState = refreshView
        ? await refreshActiveView(repoPath, {
            activeView: currentState.activeView,
            branchScope: currentState.branchScope,
            branchSearch: currentState.branchSearch,
          })
        : {};

      if (requestSeq === refreshSeq && isRepoActive(repoPath)) {
        set({
          ...viewState,
          status,
          selectedFile: nextSelectedFile,
          selectedFileStaged: nextSelectedFileStaged,
          diff: selectedDiff,
          error: undefined,
        });
        if (refreshView) {
          markActiveViewRefreshed(repoPath, currentState.activeView);
        }
      }

      recordPerfMetric("git.refresh.ms", performance.now() - startedAt, {
        repoPath,
        fileCount: status.files.length,
        cached: !forceRefresh,
        viewRefreshed: refreshView,
        selectedDiffRefreshed,
      });
    } catch (error) {
      if (requestSeq === refreshSeq && isRepoActive(repoPath)) {
        set({ error: String(error) });
      }
      recordPerfMetric("git.refresh.ms", performance.now() - startedAt, {
        repoPath,
        failed: true,
      });
    }
  };

  const runRepoMutationWithRefresh = async <T>(
    repoPath: string,
    mutation: () => Promise<T>,
    options?: { remoteSyncAction?: GitRemoteSyncAction },
  ): Promise<T> => {
    beginLoading();
    set({ error: undefined });

    if (options?.remoteSyncAction) {
      set({ remoteSyncAction: options.remoteSyncAction, remoteSyncRepoPath: repoPath });
    }

    try {
      const result = await mutation();
      get().invalidateRepoCache(repoPath);
      await runRefresh(repoPath, { force: true });
      return result;
    } catch (error) {
      if (isRepoActive(repoPath)) {
        set({ error: String(error) });
      }
      throw error;
    } finally {
      if (
        options?.remoteSyncAction &&
        get().remoteSyncAction === options.remoteSyncAction &&
        get().remoteSyncRepoPath === repoPath
      ) {
        set({ remoteSyncAction: null, remoteSyncRepoPath: null });
      }
      endLoading();
    }
  };

  return {
    loading: false,
    activeRepoPath: null,
    remoteSyncAction: null,
    remoteSyncRepoPath: null,
    activeView: "changes",
    branchScope: "local",
    branches: [],
    branchesTotal: 0,
    branchesHasMore: false,
    branchesOffset: 0,
    branchSearch: "",
    commits: [],
    commitsOffset: 0,
    commitsHasMore: false,
    commitsTotal: 0,
    stashes: [],
    worktrees: [],
    remotes: [],
    remotesRepoPath: null,
    remotesLoading: false,
    remotesError: undefined,
    mainRepoPath: null,
    setActiveRepoPath: (repoPath) => {
      if (get().activeRepoPath === repoPath) {
        return;
      }

      set({
        activeRepoPath: repoPath,
        mainRepoPath: null,
        status: undefined,
        selectedFile: undefined,
        selectedFileStaged: undefined,
        diff: undefined,
        branches: [],
        branchesTotal: 0,
        branchesHasMore: false,
        branchesOffset: 0,
        branchSearch: "",
        commits: [],
        commitsOffset: 0,
        commitsHasMore: false,
        commitsTotal: 0,
        stashes: [],
        worktrees: [],
        remotes: [],
        remotesRepoPath: null,
        remotesLoading: false,
        remotesError: undefined,
        selectedCommitHash: undefined,
        commitDiff: undefined,
        error: undefined,
      });
    },
    refresh: async (repoPath, options) => {
      beginLoading();
      await runRefresh(repoPath, options);
      endLoading();
    },
    invalidateRepoCache: (repoPath) => {
      invalidateRepoCaches(repoPath);
    },
    setActiveView: (view) => {
      set({ activeView: view, error: undefined });
    },
    setBranchScope: (scope) => {
      set({ branchScope: scope, error: undefined });
    },
    selectFile: async (repoPath, filePath, staged = false) => {
      const requestSeq = ++selectFileSeq;
      const startedAt = performance.now();
      try {
        const diff = await getGitDiffCached(repoPath, filePath, staged);
        if (requestSeq === selectFileSeq && isRepoActive(repoPath)) {
          set({ selectedFile: filePath, selectedFileStaged: staged, diff, error: undefined });
        }
        recordPerfMetric("git.file_diff.ms", performance.now() - startedAt, {
          repoPath,
          filePath,
          staged,
        });
      } catch (error) {
        if (requestSeq === selectFileSeq && isRepoActive(repoPath)) {
          set({ error: String(error) });
        }
        recordPerfMetric("git.file_diff.ms", performance.now() - startedAt, {
          repoPath,
          filePath,
          staged,
          failed: true,
        });
      }
    },
    stage: async (repoPath, filePath) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.stageFiles(repoPath, [filePath]));
    },
    stageMany: async (repoPath, files) => {
      if (files.length === 0) {
        return;
      }
      await runRepoMutationWithRefresh(repoPath, () => ipc.stageFiles(repoPath, files));
    },
    unstage: async (repoPath, filePath) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.unstageFiles(repoPath, [filePath]));
    },
    unstageMany: async (repoPath, files) => {
      if (files.length === 0) {
        return;
      }
      await runRepoMutationWithRefresh(repoPath, () => ipc.unstageFiles(repoPath, files));
    },
    discardFiles: async (repoPath, files) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.discardFiles(repoPath, files));
    },
    commit: async (repoPath, message) => {
      return runRepoMutationWithRefresh(repoPath, () => ipc.commit(repoPath, message));
    },
    softResetLastCommit: async (repoPath) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.softResetLastCommit(repoPath));
    },
    fetchRemote: async (repoPath) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.fetchGit(repoPath), {
        remoteSyncAction: "fetch",
      });
    },
    pullRemote: async (repoPath) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.pullGit(repoPath), {
        remoteSyncAction: "pull",
      });
    },
    pushRemote: async (repoPath) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.pushGit(repoPath), {
        remoteSyncAction: "push",
      });
    },
    loadBranches: async (repoPath, scope, search) => {
      const requestSeq = ++branchesSeq;
      const nextScope = scope ?? get().branchScope;
      const searchQuery = search !== undefined ? search : get().branchSearch;
      beginLoading();
      set({ error: undefined, branchScope: nextScope, branchSearch: searchQuery });

      try {
        const page = await ipc.listGitBranches(repoPath, nextScope, 0, BRANCH_PAGE_SIZE, searchQuery || undefined);
        if (requestSeq === branchesSeq && isRepoActive(repoPath)) {
          set({
            branches: page.entries,
            branchesTotal: page.total,
            branchesHasMore: page.hasMore,
            branchesOffset: page.offset + page.entries.length,
          });
        }
      } catch (error) {
        if (requestSeq === branchesSeq && isRepoActive(repoPath)) {
          set({ error: String(error) });
        }
      } finally {
        endLoading();
      }
    },
    loadMoreBranches: async (repoPath) => {
      if (!get().branchesHasMore) return;
      const requestSeq = ++branchesSeq;
      const { branchScope, branchSearch, branchesOffset, branches } = get();

      beginLoading();
      set({ error: undefined });

      try {
        const page = await ipc.listGitBranches(
          repoPath,
          branchScope,
          branchesOffset,
          BRANCH_PAGE_SIZE,
          branchSearch || undefined,
        );
        if (requestSeq === branchesSeq && isRepoActive(repoPath)) {
          set({
            branches: [...branches, ...page.entries],
            branchesTotal: page.total,
            branchesHasMore: page.hasMore,
            branchesOffset: page.offset + page.entries.length,
          });
        }
      } catch (error) {
        if (requestSeq === branchesSeq && isRepoActive(repoPath)) {
          set({ error: String(error) });
        }
      } finally {
        endLoading();
      }
    },
    setBranchSearch: async (repoPath, query) => {
      await get().loadBranches(repoPath, undefined, query);
    },
    checkoutBranch: async (repoPath, branchName, isRemote) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.checkoutGitBranch(repoPath, branchName, isRemote));
    },
    createBranch: async (repoPath, branchName, fromRef) => {
      await runRepoMutationWithRefresh(repoPath, () =>
        ipc.createGitBranch(repoPath, branchName, fromRef ?? null),
      );
    },
    renameBranch: async (repoPath, oldName, newName) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.renameGitBranch(repoPath, oldName, newName));
    },
    deleteBranch: async (repoPath, branchName, force) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.deleteGitBranch(repoPath, branchName, force));
    },
    loadCommits: async (repoPath, append = false) => {
      const requestSeq = ++commitsSeq;
      const offset = append ? get().commitsOffset : 0;
      const previousEntries = append ? get().commits : [];

      beginLoading();
      set({ error: undefined });

      try {
        const page = await ipc.listGitCommits(repoPath, offset, COMMIT_PAGE_SIZE);
        if (requestSeq !== commitsSeq || !isRepoActive(repoPath)) {
          return;
        }

        const entries = append ? [...previousEntries, ...page.entries] : page.entries;
        set({
          commits: entries,
          commitsOffset: page.offset + page.entries.length,
          commitsHasMore: page.hasMore,
          commitsTotal: page.total,
        });
      } catch (error) {
        if (requestSeq === commitsSeq && isRepoActive(repoPath)) {
          set({ error: String(error) });
        }
      } finally {
        endLoading();
      }
    },
    loadMoreCommits: async (repoPath) => {
      if (!get().commitsHasMore) {
        return;
      }
      await get().loadCommits(repoPath, true);
    },
    setMainRepoPath: (path) => {
      set({ mainRepoPath: path });
    },
    loadWorktrees: async (repoPath) => {
      const requestSeq = ++worktreesSeq;
      beginLoading();
      set({ error: undefined });
      try {
        const worktrees = await ipc.listGitWorktrees(repoPath);
        if (requestSeq === worktreesSeq && isRepoInWorktreeContext(repoPath)) {
          set({ worktrees });
        }
      } catch (error) {
        if (requestSeq === worktreesSeq && isRepoInWorktreeContext(repoPath)) {
          set({ error: String(error) });
        }
      } finally {
        endLoading();
      }
    },
    addWorktree: async (repoPath, worktreePath, branchName, baseRef) => {
      const refreshRepoPath = resolveRefreshRepoPathForWorktreeMutation(repoPath);
      return runRepoMutationWithRefresh(refreshRepoPath, () =>
        ipc.addGitWorktree(repoPath, worktreePath, branchName, baseRef),
      );
    },
    removeWorktree: async (repoPath, worktreePath, force, branchName, deleteBranch) => {
      const { activeRepoPath, mainRepoPath } = get();
      const removingActiveWorktree =
        activeRepoPath !== null &&
        activeRepoPath === worktreePath &&
        mainRepoPath === repoPath;

      if (removingActiveWorktree) {
        beginLoading();
        set({ error: undefined });
        try {
          await ipc.removeGitWorktree(repoPath, worktreePath, force, branchName, deleteBranch);
          get().setActiveRepoPath(repoPath);
          set({ mainRepoPath: null });
          get().invalidateRepoCache(repoPath);
          await runRefresh(repoPath, { force: true });
        } catch (error) {
          if (isRepoInWorktreeContext(repoPath)) {
            set({ error: String(error) });
          }
          throw error;
        } finally {
          endLoading();
        }
        return;
      }

      const refreshRepoPath = resolveRefreshRepoPathForWorktreeMutation(repoPath);
      await runRepoMutationWithRefresh(refreshRepoPath, () =>
        ipc.removeGitWorktree(repoPath, worktreePath, force, branchName, deleteBranch),
      );
    },
    pruneWorktrees: async (repoPath) => {
      const refreshRepoPath = resolveRefreshRepoPathForWorktreeMutation(repoPath);
      await runRepoMutationWithRefresh(refreshRepoPath, () => ipc.pruneGitWorktrees(repoPath));
    },
    loadStashes: async (repoPath) => {
      const requestSeq = ++stashesSeq;
      beginLoading();
      set({ error: undefined });
      try {
        const stashes = await ipc.listGitStashes(repoPath);
        if (requestSeq === stashesSeq && isRepoActive(repoPath)) {
          set({ stashes });
        }
      } catch (error) {
        if (requestSeq === stashesSeq && isRepoActive(repoPath)) {
          set({ error: String(error) });
        }
      } finally {
        endLoading();
      }
    },
    pushStash: async (repoPath, message) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.pushGitStash(repoPath, message));
    },
    applyStash: async (repoPath, stashIndex) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.applyGitStash(repoPath, stashIndex));
    },
    popStash: async (repoPath, stashIndex) => {
      await runRepoMutationWithRefresh(repoPath, () => ipc.popGitStash(repoPath, stashIndex));
    },
    selectCommit: async (repoPath, commitHash) => {
      const current = get().selectedCommitHash;
      if (current === commitHash) {
        set({ selectedCommitHash: undefined, commitDiff: undefined });
        return;
      }

      const requestSeq = ++commitDiffSeq;
      set({ selectedCommitHash: commitHash, commitDiff: undefined });
      try {
        const diff = await ipc.getCommitDiff(repoPath, commitHash);
        if (
          requestSeq === commitDiffSeq &&
          isRepoActive(repoPath) &&
          get().selectedCommitHash === commitHash
        ) {
          set({ commitDiff: diff });
        }
      } catch (error) {
        if (
          requestSeq === commitDiffSeq &&
          isRepoActive(repoPath) &&
          get().selectedCommitHash === commitHash
        ) {
          set({ error: String(error), selectedCommitHash: undefined, commitDiff: undefined });
        }
      }
    },
    clearCommitSelection: () => {
      set({ selectedCommitHash: undefined, commitDiff: undefined });
    },
    loadRemotes: async (repoPath) => {
      const requestSeq = ++remotesSeq;
      const { remotes, remotesRepoPath } = get();
      const shouldClearRemotes = remotesRepoPath !== repoPath;

      set({
        remotes: shouldClearRemotes ? [] : remotes,
        remotesRepoPath: repoPath,
        remotesLoading: true,
        remotesError: undefined,
        error: undefined,
      });
      try {
        const remotes = await ipc.listGitRemotes(repoPath);
        if (requestSeq === remotesSeq && isRepoActive(repoPath)) {
          set({ remotes, remotesRepoPath: repoPath, remotesError: undefined });
        }
      } catch (error) {
        if (requestSeq === remotesSeq && isRepoActive(repoPath)) {
          set({ error: String(error), remotesError: String(error) });
        }
      } finally {
        if (requestSeq === remotesSeq) {
          set({ remotesLoading: false });
        }
      }
    },
    addRemote: async (repoPath, name, url) => {
      await runRepoMutationWithRefresh(repoPath, async () => {
        await ipc.addGitRemote(repoPath, name, url);
      });
      await get().loadRemotes(repoPath);
      // Auto-fetch from the new remote and refresh cached git state so new refs
      // appear immediately. Swallow network/empty-remote failures.
      try {
        await ipc.fetchGit(repoPath);
        get().invalidateRepoCache(repoPath);
        beginLoading();
        try {
          await runRefresh(repoPath, { force: true });
        } finally {
          endLoading();
        }
      } catch {
        // Swallow: remote may be unreachable or empty
      }
    },
    removeRemote: async (repoPath, name) => {
      await runRepoMutationWithRefresh(repoPath, async () => {
        await ipc.removeGitRemote(repoPath, name);
      });
      await get().loadRemotes(repoPath);
    },
    renameRemote: async (repoPath, oldName, newName) => {
      await runRepoMutationWithRefresh(repoPath, async () => {
        await ipc.renameGitRemote(repoPath, oldName, newName);
      });
      await get().loadRemotes(repoPath);
    },
    clearError: () => set({ error: undefined }),
    drafts: { ...EMPTY_DRAFTS },
    loadDraftsForWorkspace: (workspaceId) => {
      set({ drafts: loadDraftsFromStorage(workspaceId) });
    },
    setCommitMessageDraft: (_workspaceId, message) => {
      set((state) => ({ drafts: { ...state.drafts, commitMessage: message } }));
    },
    setBranchNameDraft: (_workspaceId, name) => {
      set((state) => ({ drafts: { ...state.drafts, branchName: name } }));
    },
    pushCommitHistory: (workspaceId, message) => {
      const drafts = get().drafts;
      const next: GitDraftsPayload = {
        ...drafts,
        commitMessage: "",
        commitHistory: addToHistory(drafts.commitHistory, message),
      };
      set({ drafts: next });
      saveDraftsToStorage(workspaceId, next);
    },
    pushBranchHistory: (workspaceId, name) => {
      const drafts = get().drafts;
      const next: GitDraftsPayload = {
        ...drafts,
        branchName: "",
        branchHistory: addToHistory(drafts.branchHistory, name),
      };
      set({ drafts: next });
      saveDraftsToStorage(workspaceId, next);
    },
    flushDrafts: (workspaceId) => {
      saveDraftsToStorage(workspaceId, get().drafts);
    },
  };
});
