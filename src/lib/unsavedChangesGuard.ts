import { create } from "zustand";
import { useFileStore } from "../stores/fileStore";

export type UnsavedChangesChoice = "save-all" | "discard" | "cancel";

interface UnsavedChangesPromptState {
  fileNames: string[] | null;
  isSaving: boolean;
}

export const useUnsavedChangesPromptStore = create<UnsavedChangesPromptState>(() => ({
  fileNames: null,
  isSaving: false,
}));

let pendingPrompt: Promise<boolean> | null = null;
let resolvePendingPrompt: ((proceed: boolean) => void) | null = null;

/**
 * Asks the user what to do with dirty editor tabs before the window closes,
 * the app quits, or an update installs. Resolves true when it is safe to go on.
 * Concurrent callers share one prompt.
 */
export function confirmDiscardUnsavedWork(): Promise<boolean> {
  if (pendingPrompt) return pendingPrompt;

  const dirtyTabs = useFileStore.getState().tabs.filter((tab) => tab.isDirty);
  if (dirtyTabs.length === 0) return Promise.resolve(true);

  pendingPrompt = new Promise<boolean>((resolve) => {
    resolvePendingPrompt = resolve;
  });
  useUnsavedChangesPromptStore.setState({
    fileNames: dirtyTabs.map((tab) => tab.fileName),
    isSaving: false,
  });
  return pendingPrompt;
}

function settlePrompt(proceed: boolean) {
  const resolve = resolvePendingPrompt;
  pendingPrompt = null;
  resolvePendingPrompt = null;
  useUnsavedChangesPromptStore.setState({ fileNames: null, isSaving: false });
  resolve?.(proceed);
}

export async function resolveUnsavedChangesPrompt(choice: UnsavedChangesChoice): Promise<void> {
  if (!resolvePendingPrompt) return;
  if (choice === "cancel") {
    settlePrompt(false);
    return;
  }
  if (choice === "discard") {
    settlePrompt(true);
    return;
  }

  if (useUnsavedChangesPromptStore.getState().isSaving) return;
  useUnsavedChangesPromptStore.setState({ isSaving: true });
  // A failed or conflicted save keeps the window open so nothing is lost.
  const saved = await useFileStore.getState().saveAllDirtyTabs();
  settlePrompt(saved);
}

interface CloseRequestedTarget {
  onCloseRequested: (
    handler: (event: { preventDefault: () => void }) => void | Promise<void>,
  ) => Promise<() => void>;
}

export function registerUnsavedChangesCloseGuard(target: CloseRequestedTarget): Promise<() => void> {
  return target.onCloseRequested(async (event) => {
    if (!(await confirmDiscardUnsavedWork())) {
      event.preventDefault();
    }
  });
}
