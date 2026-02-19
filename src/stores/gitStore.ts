import { create } from "zustand";
import type { GitStatus } from "../types";
import { ipc } from "../lib/ipc";

interface GitState {
  status?: GitStatus;
  selectedFile?: string;
  diff?: string;
  loading: boolean;
  error?: string;
  refresh: (repoPath: string) => Promise<void>;
  selectFile: (repoPath: string, filePath: string, staged?: boolean) => Promise<void>;
  stage: (repoPath: string, filePath: string) => Promise<void>;
  unstage: (repoPath: string, filePath: string) => Promise<void>;
  commit: (repoPath: string, message: string) => Promise<string>;
}

export const useGitStore = create<GitState>((set, get) => ({
  loading: false,
  refresh: async (repoPath) => {
    set({ loading: true, error: undefined });
    try {
      const status = await ipc.getGitStatus(repoPath);
      set({ status, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  selectFile: async (repoPath, filePath, staged = false) => {
    try {
      const diff = await ipc.getFileDiff(repoPath, filePath, staged);
      set({ selectedFile: filePath, diff });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  stage: async (repoPath, filePath) => {
    await ipc.stageFiles(repoPath, [filePath]);
    await get().refresh(repoPath);
  },
  unstage: async (repoPath, filePath) => {
    await ipc.unstageFiles(repoPath, [filePath]);
    await get().refresh(repoPath);
  },
  commit: async (repoPath, message) => {
    const hash = await ipc.commit(repoPath, message);
    await get().refresh(repoPath);
    return hash;
  }
}));
