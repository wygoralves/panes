import { create } from "zustand";
import type { Repo, TrustLevel, Workspace } from "../types";
import { ipc } from "../lib/ipc";
import { useGitStore } from "./gitStore";

interface WorkspaceState {
  workspaces: Workspace[];
  archivedWorkspaces: Workspace[];
  activeWorkspaceId: string | null;
  repos: Repo[];
  activeRepoId: string | null;
  loading: boolean;
  error?: string;
  loadWorkspaces: () => Promise<void>;
  refreshArchivedWorkspaces: () => Promise<void>;
  openWorkspace: (path: string, scanDepth?: number) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  restoreWorkspace: (workspaceId: string) => Promise<void>;
  loadRepos: (workspaceId: string) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  setActiveRepo: (repoId: string | null) => void;
  setRepoGitActive: (repoId: string, isActive: boolean) => Promise<void>;
  setWorkspaceGitActiveRepos: (workspaceId: string, repoIds: string[]) => Promise<void>;
  hasWorkspaceGitSelection: (workspaceId: string) => Promise<boolean>;
  setRepoTrustLevel: (repoId: string, trustLevel: TrustLevel) => Promise<void>;
  setAllReposTrustLevel: (trustLevel: TrustLevel) => Promise<void>;
}

const LAST_WORKSPACE_KEY = "panes:lastActiveWorkspaceId";

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  archivedWorkspaces: [],
  activeWorkspaceId: null,
  repos: [],
  activeRepoId: null,
  loading: false,
  loadWorkspaces: async () => {
    set({ loading: true, error: undefined });
    try {
      const workspaces = await ipc.listWorkspaces();
      const savedId = localStorage.getItem(LAST_WORKSPACE_KEY);
      const restored = savedId ? workspaces.find((w) => w.id === savedId) : null;
      const activeWorkspaceId = restored?.id ?? null;
      set({ workspaces, activeWorkspaceId, loading: false });
      if (activeWorkspaceId) {
        useGitStore.getState().loadDraftsForWorkspace(activeWorkspaceId);
        await get().loadRepos(activeWorkspaceId);
      }
      await get().refreshArchivedWorkspaces();
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  refreshArchivedWorkspaces: async () => {
    try {
      const archivedWorkspaces = await ipc.listArchivedWorkspaces();
      set({ archivedWorkspaces });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  openWorkspace: async (path, scanDepth) => {
    set({ loading: true, error: undefined });
    try {
      const workspace = await ipc.openWorkspace(path, scanDepth);
      const current = get().workspaces.filter((item) => item.id !== workspace.id);
      const workspaces = [workspace, ...current];
      set((state) => ({
        workspaces,
        archivedWorkspaces: state.archivedWorkspaces.filter((item) => item.id !== workspace.id),
        activeWorkspaceId: workspace.id,
        loading: false,
      }));
      await get().loadRepos(workspace.id);
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  removeWorkspace: async (workspaceId) => {
    set({ loading: true, error: undefined });
    try {
      await ipc.archiveWorkspace(workspaceId);
      const removed = get().workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
      const remaining = get().workspaces.filter((workspace) => workspace.id !== workspaceId);
      const nextActive =
        get().activeWorkspaceId === workspaceId
          ? remaining[0]?.id ?? null
          : get().activeWorkspaceId;

      set((state) => ({
        workspaces: remaining,
        archivedWorkspaces: removed
          ? [
              removed,
              ...state.archivedWorkspaces.filter((workspace) => workspace.id !== workspaceId),
            ]
          : state.archivedWorkspaces,
        activeWorkspaceId: nextActive,
        loading: false,
      }));

      if (nextActive) {
        await get().loadRepos(nextActive);
      } else {
        set({ repos: [], activeRepoId: null });
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  restoreWorkspace: async (workspaceId) => {
    set({ loading: true, error: undefined });
    try {
      const restored = await ipc.restoreWorkspace(workspaceId);
      set((state) => {
        const workspaces = [
          restored,
          ...state.workspaces.filter((workspace) => workspace.id !== workspaceId),
        ];
        const nextActiveWorkspaceId = state.activeWorkspaceId ?? restored.id;
        return {
          workspaces,
          archivedWorkspaces: state.archivedWorkspaces.filter(
            (workspace) => workspace.id !== workspaceId,
          ),
          activeWorkspaceId: nextActiveWorkspaceId,
          loading: false,
        };
      });

      if (!get().activeWorkspaceId || get().activeWorkspaceId === restored.id) {
        await get().loadRepos(restored.id);
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  loadRepos: async (workspaceId) => {
    try {
      const repos = await ipc.getRepos(workspaceId);
      const currentActiveRepoId = get().activeRepoId;
      const activeStillExists = currentActiveRepoId
        ? repos.some((repo) => repo.id === currentActiveRepoId)
        : false;
      const fallbackActiveRepoId =
        repos.find((repo) => repo.isActive)?.id ?? repos[0]?.id ?? null;
      set({
        repos,
        activeRepoId: activeStillExists ? currentActiveRepoId : fallbackActiveRepoId,
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  setActiveWorkspace: async (workspaceId) => {
    const prevWorkspaceId = get().activeWorkspaceId;
    if (prevWorkspaceId) {
      useGitStore.getState().flushDrafts(prevWorkspaceId);
    }
    localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
    set({ activeWorkspaceId: workspaceId, activeRepoId: null, repos: [], error: undefined });
    await get().loadRepos(workspaceId);
    useGitStore.getState().loadDraftsForWorkspace(workspaceId);
  },
  setActiveRepo: (repoId) => set({ activeRepoId: repoId }),
  setRepoGitActive: async (repoId, isActive) => {
    try {
      await ipc.setRepoGitActive(repoId, isActive);
      set((state) => ({
        repos: state.repos.map((repo) =>
          repo.id === repoId
            ? {
                ...repo,
                isActive,
              }
            : repo,
        ),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
  setWorkspaceGitActiveRepos: async (workspaceId, repoIds) => {
    try {
      await ipc.setWorkspaceGitActiveRepos(workspaceId, repoIds);
      set((state) => {
        const selected = new Set(repoIds);
        return {
          repos: state.repos.map((repo) =>
            repo.workspaceId === workspaceId
              ? {
                  ...repo,
                  isActive: selected.has(repo.id),
                }
              : repo,
          ),
        };
      });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
  hasWorkspaceGitSelection: async (workspaceId) => {
    const status = await ipc.hasWorkspaceGitSelection(workspaceId);
    return status.configured;
  },
  setRepoTrustLevel: async (repoId, trustLevel) => {
    try {
      await ipc.setRepoTrustLevel(repoId, trustLevel);
      set((state) => ({
        repos: state.repos.map((repo) =>
          repo.id === repoId
            ? {
                ...repo,
                trustLevel
              }
            : repo
        )
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },
  setAllReposTrustLevel: async (trustLevel) => {
    const repos = get().repos;
    if (!repos.length) {
      return;
    }

    try {
      await Promise.all(
        repos.map((repo) => ipc.setRepoTrustLevel(repo.id, trustLevel))
      );
      set((state) => ({
        repos: state.repos.map((repo) => ({
          ...repo,
          trustLevel
        }))
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  }
}));
