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

interface ThreadState {
  threads: Thread[];
  activeThreadId: string | null;
  loading: boolean;
  error?: string;
  ensureThreadForScope: (input: EnsureThreadInput) => Promise<string | null>;
  refreshThreads: (workspaceId: string) => Promise<void>;
  setActiveThread: (threadId: string | null) => void;
}

const DEFAULT_ENGINE = "codex";
const DEFAULT_MODEL = "gpt-5-codex";

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  loading: false,
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

      const threads = [selected, ...all.filter((thread) => thread.id !== selected.id)];
      set({
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
      const threads = await ipc.listThreads(workspaceId);
      const active = get().activeThreadId;
      set({
        threads,
        activeThreadId: active && threads.some((item) => item.id === active) ? active : threads[0]?.id ?? null,
        loading: false
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
  setActiveThread: (threadId) => set({ activeThreadId: threadId })
}));
