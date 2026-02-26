import { create } from "zustand";
import type {
  GitBranch,
  GitBranchScope,
  GitCommit,
  GitStash,
  GitStatus,
} from "../types";
import { ipc } from "../lib/ipc";
import { recordPerfMetric } from "../lib/perfTelemetry";

const BRANCH_PAGE_SIZE = 200;
const COMMIT_PAGE_SIZE = 100;
const GIT_STATUS_CACHE_TTL_MS = 1_000;
const GIT_DIFF_CACHE_TTL_MS = 1_200;
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

export type GitPanelView = "changes" | "branches" | "commits" | "stash" | "files";
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
  statusCacheByRepo.delete(repoPath);
  statusInFlightByRepo.delete(repoPath);
  for (const key of diffCacheByKey.keys()) {
    if (key.startsWith(`${repoPath}::`)) {
      diffCacheByKey.delete(key);
    }
  }
  for (const key of diffInFlightByKey.keys()) {
    if (key.startsWith(`${repoPath}::`)) {
      diffInFlightByKey.delete(key);
    }
  }
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
        statusCacheByRepo.set(repoPath, {
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
        diffCacheByKey.set(key, {
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
  commits: GitCommit[];
  commitsOffset: number;
  commitsHasMore: boolean;
  commitsTotal: number;
  stashes: GitStash[];
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
  loadBranches: (repoPath: string, scope?: GitBranchScope) => Promise<void>;
  checkoutBranch: (repoPath: string, branchName: string, isRemote: boolean) => Promise<void>;
  createBranch: (repoPath: string, branchName: string, fromRef?: string | null) => Promise<void>;
  renameBranch: (repoPath: string, oldName: string, newName: string) => Promise<void>;
  deleteBranch: (repoPath: string, branchName: string, force: boolean) => Promise<void>;
  loadCommits: (repoPath: string, append?: boolean) => Promise<void>;
  loadMoreCommits: (repoPath: string) => Promise<void>;
  loadStashes: (repoPath: string) => Promise<void>;
  pushStash: (repoPath: string, message?: string) => Promise<void>;
  applyStash: (repoPath: string, stashIndex: number) => Promise<void>;
  popStash: (repoPath: string, stashIndex: number) => Promise<void>;
  selectCommit: (repoPath: string, commitHash: string) => Promise<void>;
  clearCommitSelection: () => void;
  clearError: () => void;
  drafts: GitDraftsPayload;
  loadDraftsForWorkspace: (workspaceId: string) => void;
  setCommitMessageDraft: (workspaceId: string, message: string) => void;
  setBranchNameDraft: (workspaceId: string, name: string) => void;
  pushCommitHistory: (workspaceId: string, message: string) => void;
  pushBranchHistory: (workspaceId: string, name: string) => void;
  flushDrafts: (workspaceId: string) => void;
}

async function refreshActiveView(repoPath: string, state: Pick<GitState, "activeView" | "branchScope">) {
  if (state.activeView === "branches") {
    const branchesPage = await ipc.listGitBranches(repoPath, state.branchScope, 0, BRANCH_PAGE_SIZE);
    return {
      branches: branchesPage.entries,
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

  return {};
}

export const useGitStore = create<GitState>((set, get) => {
  let loadingOps = 0;
  let refreshSeq = 0;
  let selectFileSeq = 0;
  let branchesSeq = 0;
  let commitsSeq = 0;
  let stashesSeq = 0;
  let commitDiffSeq = 0;

  const isRepoActive = (repoPath: string): boolean => {
    const activeRepoPath = get().activeRepoPath;
    return activeRepoPath === null || activeRepoPath === repoPath;
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

      if (selectedFile) {
        const selectedStatus = status.files.find((file) => file.path === selectedFile);
        const sameStateExists = selectedStatus
          ? (selectedFileStaged ? Boolean(selectedStatus.indexStatus) : Boolean(selectedStatus.worktreeStatus))
          : false;
        const oppositeStateExists = selectedStatus
          ? (selectedFileStaged ? Boolean(selectedStatus.worktreeStatus) : Boolean(selectedStatus.indexStatus))
          : false;

        if (sameStateExists) {
          try {
            selectedDiff = await getGitDiffCached(repoPath, selectedFile, selectedFileStaged);
          } catch {
            selectedDiff = undefined;
          }
        } else if (oppositeStateExists) {
          const flippedStaged = !selectedFileStaged;
          nextSelectedFileStaged = flippedStaged;
          try {
            selectedDiff = await getGitDiffCached(repoPath, selectedFile, flippedStaged);
          } catch {
            selectedDiff = undefined;
          }
        } else {
          selectedDiff = undefined;
          nextSelectedFile = undefined;
          nextSelectedFileStaged = undefined;
        }
      }

      const viewState = await refreshActiveView(repoPath, {
        activeView: currentState.activeView,
        branchScope: currentState.branchScope,
      });

      if (requestSeq === refreshSeq && isRepoActive(repoPath)) {
        set({
          ...viewState,
          status,
          selectedFile: nextSelectedFile,
          selectedFileStaged: nextSelectedFileStaged,
          diff: selectedDiff,
          error: undefined,
        });
      }

      recordPerfMetric("git.refresh.ms", performance.now() - startedAt, {
        repoPath,
        fileCount: status.files.length,
        cached: !(options?.force ?? false),
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
    commits: [],
    commitsOffset: 0,
    commitsHasMore: false,
    commitsTotal: 0,
    stashes: [],
    setActiveRepoPath: (repoPath) => {
      if (get().activeRepoPath === repoPath) {
        return;
      }

      set({
        activeRepoPath: repoPath,
        status: undefined,
        selectedFile: undefined,
        selectedFileStaged: undefined,
        diff: undefined,
        branches: [],
        commits: [],
        commitsOffset: 0,
        commitsHasMore: false,
        commitsTotal: 0,
        stashes: [],
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
    loadBranches: async (repoPath, scope) => {
      const requestSeq = ++branchesSeq;
      const nextScope = scope ?? get().branchScope;
      beginLoading();
      set({ error: undefined, branchScope: nextScope });

      try {
        const page = await ipc.listGitBranches(repoPath, nextScope, 0, BRANCH_PAGE_SIZE);
        if (requestSeq === branchesSeq && isRepoActive(repoPath)) {
          set({ branches: page.entries });
        }
      } catch (error) {
        if (requestSeq === branchesSeq && isRepoActive(repoPath)) {
          set({ error: String(error) });
        }
      } finally {
        endLoading();
      }
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
