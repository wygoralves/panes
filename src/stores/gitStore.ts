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

export type GitPanelView = "changes" | "branches" | "commits" | "stash";

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
  refresh: (repoPath: string, options?: { force?: boolean }) => Promise<void>;
  invalidateRepoCache: (repoPath: string) => void;
  setActiveView: (view: GitPanelView) => void;
  setBranchScope: (scope: GitBranchScope) => void;
  selectFile: (repoPath: string, filePath: string, staged?: boolean) => Promise<void>;
  stage: (repoPath: string, filePath: string) => Promise<void>;
  unstage: (repoPath: string, filePath: string) => Promise<void>;
  discardFiles: (repoPath: string, files: string[]) => Promise<void>;
  commit: (repoPath: string, message: string) => Promise<string>;
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

export const useGitStore = create<GitState>((set, get) => ({
  loading: false,
  activeView: "changes",
  branchScope: "local",
  branches: [],
  commits: [],
  commitsOffset: 0,
  commitsHasMore: false,
  commitsTotal: 0,
  stashes: [],
  refresh: async (repoPath, options) => {
    set({ loading: true, error: undefined });
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

      set({
        ...viewState,
        status,
        selectedFile: nextSelectedFile,
        selectedFileStaged: nextSelectedFileStaged,
        diff: selectedDiff,
        loading: false,
      });
      recordPerfMetric("git.refresh.ms", performance.now() - startedAt, {
        repoPath,
        fileCount: status.files.length,
        cached: !(options?.force ?? false),
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
      recordPerfMetric("git.refresh.ms", performance.now() - startedAt, {
        repoPath,
        failed: true,
      });
    }
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
    const startedAt = performance.now();
    try {
      const diff = await getGitDiffCached(repoPath, filePath, staged);
      set({ selectedFile: filePath, selectedFileStaged: staged, diff, error: undefined });
      recordPerfMetric("git.file_diff.ms", performance.now() - startedAt, {
        repoPath,
        filePath,
        staged,
      });
    } catch (error) {
      set({ error: String(error) });
      recordPerfMetric("git.file_diff.ms", performance.now() - startedAt, {
        repoPath,
        filePath,
        staged,
        failed: true,
      });
    }
  },
  stage: async (repoPath, filePath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.stageFiles(repoPath, [filePath]);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  unstage: async (repoPath, filePath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.unstageFiles(repoPath, [filePath]);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  discardFiles: async (repoPath, files) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.discardFiles(repoPath, files);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  commit: async (repoPath, message) => {
    try {
      set({ loading: true, error: undefined });
      const hash = await ipc.commit(repoPath, message);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
      return hash;
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  fetchRemote: async (repoPath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.fetchGit(repoPath);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  pullRemote: async (repoPath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.pullGit(repoPath);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  pushRemote: async (repoPath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.pushGit(repoPath);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  loadBranches: async (repoPath, scope) => {
    const nextScope = scope ?? get().branchScope;
    set({ loading: true, error: undefined, branchScope: nextScope });

    try {
      const page = await ipc.listGitBranches(repoPath, nextScope, 0, BRANCH_PAGE_SIZE);
      set({ branches: page.entries, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  checkoutBranch: async (repoPath, branchName, isRemote) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.checkoutGitBranch(repoPath, branchName, isRemote);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  createBranch: async (repoPath, branchName, fromRef) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.createGitBranch(repoPath, branchName, fromRef ?? null);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  renameBranch: async (repoPath, oldName, newName) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.renameGitBranch(repoPath, oldName, newName);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  deleteBranch: async (repoPath, branchName, force) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.deleteGitBranch(repoPath, branchName, force);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  loadCommits: async (repoPath, append = false) => {
    const offset = append ? get().commitsOffset : 0;
    const previousEntries = append ? get().commits : [];

    set({ loading: true, error: undefined });

    try {
      const page = await ipc.listGitCommits(repoPath, offset, COMMIT_PAGE_SIZE);
      const entries = append ? [...previousEntries, ...page.entries] : page.entries;
      set({
        commits: entries,
        commitsOffset: page.offset + page.entries.length,
        commitsHasMore: page.hasMore,
        commitsTotal: page.total,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  loadMoreCommits: async (repoPath) => {
    if (!get().commitsHasMore || get().loading) {
      return;
    }
    await get().loadCommits(repoPath, true);
  },
  loadStashes: async (repoPath) => {
    set({ loading: true, error: undefined });
    try {
      const stashes = await ipc.listGitStashes(repoPath);
      set({ stashes, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  pushStash: async (repoPath, message) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.pushGitStash(repoPath, message);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  applyStash: async (repoPath, stashIndex) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.applyGitStash(repoPath, stashIndex);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  popStash: async (repoPath, stashIndex) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.popGitStash(repoPath, stashIndex);
      get().invalidateRepoCache(repoPath);
      await get().refresh(repoPath, { force: true });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  selectCommit: async (repoPath, commitHash) => {
    const current = get().selectedCommitHash;
    if (current === commitHash) {
      set({ selectedCommitHash: undefined, commitDiff: undefined });
      return;
    }
    set({ selectedCommitHash: commitHash, commitDiff: undefined });
    try {
      const diff = await ipc.getCommitDiff(repoPath, commitHash);
      if (get().selectedCommitHash === commitHash) {
        set({ commitDiff: diff });
      }
    } catch (error) {
      if (get().selectedCommitHash === commitHash) {
        set({ error: String(error), selectedCommitHash: undefined, commitDiff: undefined });
      }
    }
  },
  clearCommitSelection: () => {
    set({ selectedCommitHash: undefined, commitDiff: undefined });
  },
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
}));
