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
  archivedThreadsByWorkspace: Record<string, Thread[]>;
  activeThreadId: string | null;
  loading: boolean;
  error?: string;
  createThread: (input: CreateThreadInput) => Promise<string | null>;
  renameThread: (threadId: string, title: string) => Promise<void>;
  ensureThreadForScope: (input: EnsureThreadInput) => Promise<string | null>;
  refreshThreads: (workspaceId: string) => Promise<void>;
  refreshArchivedThreads: (workspaceId: string) => Promise<void>;
  refreshAllThreads: (workspaceIds: string[]) => Promise<void>;
  removeThread: (threadId: string) => Promise<void>;
  restoreThread: (threadId: string) => Promise<void>;
  setActiveThread: (threadId: string | null) => void;
  setThreadReasoningEffortLocal: (threadId: string, reasoningEffort: string | null) => void;
  setThreadLastModelLocal: (threadId: string, modelId: string | null) => void;
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

function applyThreadReasoningEffort(
  thread: Thread,
  reasoningEffort: string | null
): Thread {
  const metadata = { ...(thread.engineMetadata ?? {}) };
  if (reasoningEffort) {
    metadata.reasoningEffort = reasoningEffort;
  } else {
    delete metadata.reasoningEffort;
  }

  return {
    ...thread,
    engineMetadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

function applyThreadLastModel(
  thread: Thread,
  modelId: string | null
): Thread {
  const metadata = { ...(thread.engineMetadata ?? {}) };
  if (modelId) {
    metadata.lastModelId = modelId;
  } else {
    delete metadata.lastModelId;
  }

  return {
    ...thread,
    engineMetadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

function readThreadLastModelId(thread: Thread): string | null {
  const raw = thread.engineMetadata?.lastModelId;
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function threadMatchesRequestedModel(thread: Thread, modelId: string): boolean {
  return thread.modelId === modelId || readThreadLastModelId(thread) === modelId;
}

export const threadStoreInternals = {
  mergeWorkspaceThreads,
  flattenThreadsByWorkspace,
  applyThreadReasoningEffort,
  applyThreadLastModel,
  readThreadLastModelId,
  threadMatchesRequestedModel,
};

const LAST_THREAD_KEY = "panes:lastActiveThreadId";

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  threadsByWorkspace: {},
  archivedThreadsByWorkspace: {},
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

      localStorage.setItem(LAST_THREAD_KEY, created.id);
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
  renameThread: async (threadId, title) => {
    set({ loading: true, error: undefined });
    try {
      const updated = await ipc.renameThread(threadId, title);
      set((state) => {
        const updateThread = (thread: Thread) => (thread.id === updated.id ? updated : thread);
        const threadsByWorkspace = Object.entries(state.threadsByWorkspace).reduce<
          Record<string, Thread[]>
        >((acc, [workspaceId, threads]) => {
          acc[workspaceId] = threads.map(updateThread);
          return acc;
        }, {});
        const threads = flattenThreadsByWorkspace(threadsByWorkspace);

        return {
          threadsByWorkspace,
          threads,
          loading: false,
        };
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
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
          thread.engineId === effectiveEngine
      );
      const scopedForModel = scoped
        .filter((thread) => threadMatchesRequestedModel(thread, effectiveModel))
        .sort(
          (a, b) =>
            new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
        );

      const activeId = get().activeThreadId;
      let selected =
        scopedForModel.find((thread) => thread.id === activeId) ?? scopedForModel[0];
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
  refreshArchivedThreads: async (workspaceId) => {
    try {
      const archivedThreads = await ipc.listArchivedThreads(workspaceId);
      set((state) => ({
        archivedThreadsByWorkspace: {
          ...state.archivedThreadsByWorkspace,
          [workspaceId]: archivedThreads,
        },
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },
  refreshAllThreads: async (workspaceIds) => {
    if (!workspaceIds.length) {
      set({
        threads: [],
        threadsByWorkspace: {},
        archivedThreadsByWorkspace: {},
        activeThreadId: null,
        loading: false,
        error: undefined,
      });
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
      const savedId = localStorage.getItem(LAST_THREAD_KEY);
      const restoredId =
        (active && threads.some((item) => item.id === active)) ? active
        : (savedId && threads.some((item) => item.id === savedId)) ? savedId
        : null;

      set({
        threadsByWorkspace,
        threads,
        activeThreadId: restoredId,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  removeThread: async (threadId) => {
    set({ loading: true, error: undefined });
    try {
      await ipc.archiveThread(threadId);
      let archivedThread: Thread | null = null;
      let archivedWorkspaceId: string | null = null;
      const nextThreadsByWorkspace = Object.entries(get().threadsByWorkspace).reduce<
        Record<string, Thread[]>
      >((acc, [workspaceId, threads]) => {
        const target = threads.find((thread) => thread.id === threadId);
        if (target) {
          archivedThread = target;
          archivedWorkspaceId = workspaceId;
        }
        const remaining = threads.filter((thread) => thread.id !== threadId);
        acc[workspaceId] = remaining;
        return acc;
      }, {});
      const threads = flattenThreadsByWorkspace(nextThreadsByWorkspace);
      const active = get().activeThreadId;

      set((state) => {
        const archivedThreadsByWorkspace = { ...state.archivedThreadsByWorkspace };
        if (archivedThread && archivedWorkspaceId) {
          const currentArchived = archivedThreadsByWorkspace[archivedWorkspaceId] ?? [];
          archivedThreadsByWorkspace[archivedWorkspaceId] = [
            archivedThread,
            ...currentArchived.filter((thread) => thread.id !== threadId),
          ];
        }

        return {
          threadsByWorkspace: nextThreadsByWorkspace,
          archivedThreadsByWorkspace,
          threads,
          activeThreadId: active === threadId ? null : active,
          loading: false,
        };
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  restoreThread: async (threadId) => {
    set({ loading: true, error: undefined });
    try {
      const restored = await ipc.restoreThread(threadId);
      set((state) => {
        const workspaceId = restored.workspaceId;
        const workspaceThreads = state.threadsByWorkspace[workspaceId] ?? [];
        const nextWorkspaceThreads = [
          restored,
          ...workspaceThreads.filter((thread) => thread.id !== threadId),
        ];
        const threadsByWorkspace = mergeWorkspaceThreads(
          state.threadsByWorkspace,
          workspaceId,
          nextWorkspaceThreads,
        );
        const archivedThreads = state.archivedThreadsByWorkspace[workspaceId] ?? [];
        const archivedThreadsByWorkspace = {
          ...state.archivedThreadsByWorkspace,
          [workspaceId]: archivedThreads.filter((thread) => thread.id !== threadId),
        };

        return {
          threadsByWorkspace,
          archivedThreadsByWorkspace,
          threads: flattenThreadsByWorkspace(threadsByWorkspace),
          loading: false,
        };
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  setActiveThread: (threadId) => {
    if (threadId) {
      localStorage.setItem(LAST_THREAD_KEY, threadId);
    } else {
      localStorage.removeItem(LAST_THREAD_KEY);
    }
    set({ activeThreadId: threadId });
  },
  setThreadReasoningEffortLocal: (threadId, reasoningEffort) =>
    set((state) => {
      const updateThread = (thread: Thread) =>
        thread.id === threadId
          ? applyThreadReasoningEffort(thread, reasoningEffort)
          : thread;

      const threadsByWorkspace = Object.entries(state.threadsByWorkspace).reduce<
        Record<string, Thread[]>
      >((acc, [workspaceId, threads]) => {
        acc[workspaceId] = threads.map(updateThread);
        return acc;
      }, {});

      return {
        threadsByWorkspace,
        threads: state.threads.map(updateThread),
      };
    }),
  setThreadLastModelLocal: (threadId, modelId) =>
    set((state) => {
      const updateThread = (thread: Thread) =>
        thread.id === threadId
          ? applyThreadLastModel(thread, modelId)
          : thread;

      const threadsByWorkspace = Object.entries(state.threadsByWorkspace).reduce<
        Record<string, Thread[]>
      >((acc, [workspaceId, threads]) => {
        acc[workspaceId] = threads.map(updateThread);
        return acc;
      }, {});

      return {
        threadsByWorkspace,
        threads: state.threads.map(updateThread),
      };
    }),
}));
