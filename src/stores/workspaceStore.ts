import { create } from "zustand";
import type { Repo, Workspace } from "../types";
import { ipc } from "../lib/ipc";

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  repos: Repo[];
  activeRepoId: string | null;
  loading: boolean;
  error?: string;
  loadWorkspaces: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  loadRepos: (workspaceId: string) => Promise<void>;
  setActiveRepo: (repoId: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  repos: [],
  activeRepoId: null,
  loading: false,
  loadWorkspaces: async () => {
    set({ loading: true, error: undefined });
    try {
      const workspaces = await ipc.listWorkspaces();
      const activeWorkspaceId = workspaces[0]?.id ?? null;
      set({ workspaces, activeWorkspaceId, loading: false });
      if (activeWorkspaceId) {
        await get().loadRepos(activeWorkspaceId);
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  openWorkspace: async (path) => {
    set({ loading: true, error: undefined });
    try {
      const workspace = await ipc.openWorkspace(path);
      const current = get().workspaces.filter((item) => item.id !== workspace.id);
      const workspaces = [workspace, ...current];
      set({ workspaces, activeWorkspaceId: workspace.id, loading: false });
      await get().loadRepos(workspace.id);
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  loadRepos: async (workspaceId) => {
    try {
      const repos = await ipc.getRepos(workspaceId);
      set({ repos, activeRepoId: repos[0]?.id ?? null });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  setActiveRepo: (repoId) => set({ activeRepoId: repoId })
}));
