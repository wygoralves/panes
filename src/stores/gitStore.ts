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

export type GitPanelView = "changes" | "branches" | "commits" | "stash";

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
  refresh: (repoPath: string) => Promise<void>;
  setActiveView: (view: GitPanelView) => void;
  setBranchScope: (scope: GitBranchScope) => void;
  selectFile: (repoPath: string, filePath: string, staged?: boolean) => Promise<void>;
  stage: (repoPath: string, filePath: string) => Promise<void>;
  unstage: (repoPath: string, filePath: string) => Promise<void>;
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
  applyStash: (repoPath: string, stashIndex: number) => Promise<void>;
  popStash: (repoPath: string, stashIndex: number) => Promise<void>;
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
  refresh: async (repoPath) => {
    set({ loading: true, error: undefined });
    const startedAt = performance.now();

    try {
      const status = await ipc.getGitStatus(repoPath);
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
            selectedDiff = await ipc.getFileDiff(repoPath, selectedFile, selectedFileStaged);
          } catch {
            selectedDiff = undefined;
          }
        } else if (oppositeStateExists) {
          const flippedStaged = !selectedFileStaged;
          nextSelectedFileStaged = flippedStaged;
          try {
            selectedDiff = await ipc.getFileDiff(repoPath, selectedFile, flippedStaged);
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
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
      recordPerfMetric("git.refresh.ms", performance.now() - startedAt, {
        repoPath,
        failed: true,
      });
    }
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
      const diff = await ipc.getFileDiff(repoPath, filePath, staged);
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
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  unstage: async (repoPath, filePath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.unstageFiles(repoPath, [filePath]);
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  commit: async (repoPath, message) => {
    try {
      set({ loading: true, error: undefined });
      const hash = await ipc.commit(repoPath, message);
      await get().refresh(repoPath);
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
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  pullRemote: async (repoPath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.pullGit(repoPath);
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  pushRemote: async (repoPath) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.pushGit(repoPath);
      await get().refresh(repoPath);
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
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  createBranch: async (repoPath, branchName, fromRef) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.createGitBranch(repoPath, branchName, fromRef ?? null);
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  renameBranch: async (repoPath, oldName, newName) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.renameGitBranch(repoPath, oldName, newName);
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  deleteBranch: async (repoPath, branchName, force) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.deleteGitBranch(repoPath, branchName, force);
      await get().refresh(repoPath);
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
  applyStash: async (repoPath, stashIndex) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.applyGitStash(repoPath, stashIndex);
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  popStash: async (repoPath, stashIndex) => {
    try {
      set({ loading: true, error: undefined });
      await ipc.popGitStash(repoPath, stashIndex);
      await get().refresh(repoPath);
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
}));
