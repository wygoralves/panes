import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Thread } from "../types";

interface EnsureThreadInput {
  workspaceId: string;
  repoId: string | null;
  engineId?: string;
  modelId?: string;
  title?: string;
}

interface CreateThreadInput {
  workspaceId: string;
  repoId: string | null;
  engineId?: string;
  modelId?: string;
  title?: string;
}

interface ThreadState {
  threads: Thread[];
  threadsByWorkspace: Record<string, Thread[]>;
  activeThreadId: string | null;
  loading: boolean;
  error?: string;
  createThread: (input: CreateThreadInput) => Promise<string | null>;
  ensureThreadForScope: (input: EnsureThreadInput) => Promise<string | null>;
  refreshThreads: (workspaceId: string) => Promise<void>;
  refreshAllThreads: (workspaceIds: string[]) => Promise<void>;
  removeThread: (threadId: string) => Promise<void>;
  setActiveThread: (threadId: string | null) => void;
}

const DEFAULT_ENGINE = "codex";
const DEFAULT_MODEL = "gpt-5.3-codex";

function mergeWorkspaceThreads(
  current: Record<string, Thread[]>,
  workspaceId: string,
  threads: Thread[],
): Record<string, Thread[]> {
  return {
    ...current,
    [workspaceId]: threads,
  };
}

function flattenThreadsByWorkspace(threadsByWorkspace: Record<string, Thread[]>): Thread[] {
  return Object.values(threadsByWorkspace)
    .flat()
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  threadsByWorkspace: {},
  activeThreadId: null,
  loading: false,
  createThread: async ({ workspaceId, repoId, engineId, modelId, title }) => {
    const effectiveEngine = engineId ?? DEFAULT_ENGINE;
    const effectiveModel = modelId ?? DEFAULT_MODEL;

    set({ loading: true, error: undefined });

    try {
      const created = await ipc.createThread(
        workspaceId,
        repoId,
        effectiveEngine,
        effectiveModel,
        title ?? (repoId ? "Repo Chat" : "Workspace Chat")
      );

      const existingWorkspaceThreads = get().threadsByWorkspace[workspaceId] ?? [];
      const workspaceThreads = [created, ...existingWorkspaceThreads.filter((thread) => thread.id !== created.id)];
      const threadsByWorkspace = mergeWorkspaceThreads(get().threadsByWorkspace, workspaceId, workspaceThreads);
      const threads = flattenThreadsByWorkspace(threadsByWorkspace);

      set({
        threadsByWorkspace,
        threads,
        activeThreadId: created.id,
        loading: false,
      });

      return created.id;
    } catch (error) {
      set({ loading: false, error: String(error) });
      return null;
    }
  },
  ensureThreadForScope: async ({ workspaceId, repoId, engineId, modelId, title }) => {
    const effectiveEngine = engineId ?? DEFAULT_ENGINE;
    const effectiveModel = modelId ?? DEFAULT_MODEL;

    set({ loading: true, error: undefined });

    try {
      const all = await ipc.listThreads(workspaceId);
      const scoped = all.filter(
        (thread) =>
          thread.repoId === repoId &&
          thread.engineId === effectiveEngine &&
          thread.modelId === effectiveModel
      );

      const activeId = get().activeThreadId;
      let selected = scoped.find((thread) => thread.id === activeId) ?? scoped[0];
      if (!selected) {
        selected = await ipc.createThread(
          workspaceId,
          repoId,
          effectiveEngine,
          effectiveModel,
          title ?? (repoId ? "Repo Chat" : "General")
        );
      }

      const workspaceThreads = [selected, ...all.filter((thread) => thread.id !== selected.id)];
      const threadsByWorkspace = mergeWorkspaceThreads(get().threadsByWorkspace, workspaceId, workspaceThreads);
      const threads = flattenThreadsByWorkspace(threadsByWorkspace);
      set({
        threadsByWorkspace,
        threads,
        activeThreadId: selected.id,
        loading: false
      });
      return selected.id;
    } catch (error) {
      set({ loading: false, error: String(error) });
      return null;
    }
  },
  refreshThreads: async (workspaceId) => {
    set({ loading: true, error: undefined });
    try {
      const workspaceThreads = await ipc.listThreads(workspaceId);
      const threadsByWorkspace = mergeWorkspaceThreads(get().threadsByWorkspace, workspaceId, workspaceThreads);
      const threads = flattenThreadsByWorkspace(threadsByWorkspace);
      const active = get().activeThreadId;
      set({
        threadsByWorkspace,
        threads,
        activeThreadId:
          active && threads.some((item) => item.id === active)
            ? active
            : workspaceThreads[0]?.id ?? null,
        loading: false
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  refreshAllThreads: async (workspaceIds) => {
    if (!workspaceIds.length) {
      set({ threads: [], threadsByWorkspace: {}, activeThreadId: null, loading: false, error: undefined });
      return;
    }

    set({ loading: true, error: undefined });
    try {
      const results = await Promise.all(
        workspaceIds.map(async (workspaceId) => ({
          workspaceId,
          threads: await ipc.listThreads(workspaceId),
        })),
      );

      const threadsByWorkspace = results.reduce<Record<string, Thread[]>>((acc, item) => {
        acc[item.workspaceId] = item.threads;
        return acc;
      }, {});
      const threads = flattenThreadsByWorkspace(threadsByWorkspace);
      const active = get().activeThreadId;

      set({
        threadsByWorkspace,
        threads,
        activeThreadId: active && threads.some((item) => item.id === active) ? active : threads[0]?.id ?? null,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  removeThread: async (threadId) => {
    set({ loading: true, error: undefined });
    try {
      await ipc.deleteThread(threadId);
      const nextThreadsByWorkspace = Object.entries(get().threadsByWorkspace).reduce<Record<string, Thread[]>>(
        (acc, [workspaceId, threads]) => {
          const remaining = threads.filter((thread) => thread.id !== threadId);
          acc[workspaceId] = remaining;
          return acc;
        },
        {},
      );
      const threads = flattenThreadsByWorkspace(nextThreadsByWorkspace);
      const active = get().activeThreadId;

      set({
        threadsByWorkspace: nextThreadsByWorkspace,
        threads,
        activeThreadId: active === threadId ? null : active,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  setActiveThread: (threadId) => set({ activeThreadId: threadId })
}));
