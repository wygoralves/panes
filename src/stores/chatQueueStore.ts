import { create } from "zustand";
import type { ChatAttachment, ChatInputItem } from "../types";

const STORAGE_KEY = "panes:chat.queue";

export interface QueuedMessage {
  id: string;
  threadId: string;
  text: string;
  attachments?: ChatAttachment[];
  inputItems?: ChatInputItem[];
  planMode?: boolean;
  engineId?: string | null;
  modelId?: string | null;
  reasoningEffort?: string | null;
  createdAt: number;
}

export type QueuedMessageInput = Omit<QueuedMessage, "id" | "createdAt">;

interface ChatQueueState {
  queuesByThread: Record<string, QueuedMessage[]>;
  enqueue: (input: QueuedMessageInput) => QueuedMessage;
  remove: (threadId: string, id: string) => void;
  /** Puts a message back at the front, for a send that failed. */
  restoreFront: (message: QueuedMessage) => void;
  clear: (threadId: string) => void;
  peek: (threadId: string) => QueuedMessage | null;
}

/**
 * A message the user queued a day ago is no longer what they meant to send,
 * and its thread may not even exist any more.
 */
export const QUEUE_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

/** Reads the stored shape, dropping malformed and expired entries. */
export function parsePersistedQueues(
  raw: string | null,
  now: number = Date.now(),
): Record<string, QueuedMessage[]> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: Record<string, QueuedMessage[]> = {};
  for (const [threadId, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const items = list.filter((item): item is QueuedMessage => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as QueuedMessage;
      if (typeof candidate.id !== "string" || typeof candidate.text !== "string") return false;
      if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt)) {
        return false;
      }
      return now - candidate.createdAt < QUEUE_ENTRY_TTL_MS;
    });
    if (items.length > 0) result[threadId] = items;
  }
  return result;
}

function readPersisted(): Record<string, QueuedMessage[]> {
  try {
    return parsePersistedQueues(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function persist(queuesByThread: Record<string, QueuedMessage[]>) {
  try {
    const compact = Object.fromEntries(
      Object.entries(queuesByThread).filter(([, list]) => list.length > 0),
    );
    if (Object.keys(compact).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    }
  } catch {
    // Storage is a convenience; the in-memory queue still works.
  }
}

/**
 * Messages held while a turn runs, sent one at a time when the thread goes
 * idle. Draining lives in chatStore, which sees the turn completions.
 */
export const useChatQueueStore = create<ChatQueueState>((set, get) => ({
  queuesByThread: readPersisted(),

  enqueue: (input) => {
    const message: QueuedMessage = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    set((state) => {
      const next = {
        ...state.queuesByThread,
        [input.threadId]: [...(state.queuesByThread[input.threadId] ?? []), message],
      };
      persist(next);
      return { queuesByThread: next };
    });
    return message;
  },

  remove: (threadId, id) => {
    set((state) => {
      const list = state.queuesByThread[threadId];
      if (!list) return state;
      const filtered = list.filter((item) => item.id !== id);
      const next = { ...state.queuesByThread };
      if (filtered.length > 0) {
        next[threadId] = filtered;
      } else {
        delete next[threadId];
      }
      persist(next);
      return { queuesByThread: next };
    });
  },

  restoreFront: (message) => {
    set((state) => {
      const list = state.queuesByThread[message.threadId] ?? [];
      if (list.some((item) => item.id === message.id)) return state;
      const next = { ...state.queuesByThread, [message.threadId]: [message, ...list] };
      persist(next);
      return { queuesByThread: next };
    });
  },

  clear: (threadId) => {
    set((state) => {
      if (!state.queuesByThread[threadId]) return state;
      const next = { ...state.queuesByThread };
      delete next[threadId];
      persist(next);
      return { queuesByThread: next };
    });
  },

  peek: (threadId) => get().queuesByThread[threadId]?.[0] ?? null,
}));

const EMPTY_QUEUE: QueuedMessage[] = [];

export function selectThreadQueue(threadId: string | null | undefined) {
  return (state: ChatQueueState): QueuedMessage[] =>
    threadId ? (state.queuesByThread[threadId] ?? EMPTY_QUEUE) : EMPTY_QUEUE;
}
