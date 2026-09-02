import { create } from "zustand";

const STORAGE_KEY = "panes:composerDrafts";
const MAX_TRACKED_DRAFTS = 300;
const PERSIST_DELAY_MS = 250;

export type ComposerPromptMap = Record<string, string>;

interface ComposerDraftState {
  /** The unsent composer text per thread. Empty text is never stored: the
   * absence of an entry is what "no draft" means. */
  promptByThread: ComposerPromptMap;
  setPrompt: (threadId: string, text: string) => void;
  clearPrompt: (threadId: string) => void;
}

/** A draft counts once the user has typed something that is not whitespace. */
export function hasDraftContent(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

/** The first non-empty line, which is what a draft row shows in place of a
 * title the thread does not have yet. */
export function draftPreview(text: string | null | undefined): string | null {
  if (!hasDraftContent(text)) return null;
  const line = (text as string)
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? null;
}

export function applyPrompt(
  prompts: ComposerPromptMap,
  threadId: string,
  text: string,
): ComposerPromptMap {
  if (!hasDraftContent(text)) {
    if (!(threadId in prompts)) return prompts;
    const { [threadId]: _removed, ...rest } = prompts;
    return rest;
  }
  if (prompts[threadId] === text) return prompts;
  // Re-insert so the map keeps recency order for trimming.
  const { [threadId]: _previous, ...rest } = prompts;
  return trimPromptMap({ ...rest, [threadId]: text });
}

/** Local UI state, so the map keeps the most recent drafts instead of growing
 * without bound. Insertion order is recency order. */
export function trimPromptMap(
  prompts: ComposerPromptMap,
  limit = MAX_TRACKED_DRAFTS,
): ComposerPromptMap {
  const entries = Object.entries(prompts);
  if (entries.length <= limit) return prompts;
  return Object.fromEntries(entries.slice(entries.length - limit));
}

function readPersistedPrompts(): ComposerPromptMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const prompts: ComposerPromptMap = {};
    for (const [threadId, text] of Object.entries(parsed)) {
      if (hasDraftContent(text as string)) prompts[threadId] = text as string;
    }
    return prompts;
  } catch {
    return {};
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Keystrokes arrive faster than storage deserves, so writes coalesce. */
function schedulePersist(read: () => ComposerPromptMap) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(read()));
    } catch {
      // Local UI state only: a full or blocked store must not break typing.
    }
  }, PERSIST_DELAY_MS);
}

export const useComposerDraftStore = create<ComposerDraftState>((set, get) => ({
  promptByThread: readPersistedPrompts(),

  setPrompt: (threadId, text) => {
    const current = get().promptByThread;
    const next = applyPrompt(current, threadId, text);
    if (next === current) return;
    set({ promptByThread: next });
    schedulePersist(() => get().promptByThread);
  },

  clearPrompt: (threadId) => {
    get().setPrompt(threadId, "");
  },
}));
