import { listenChatTurnFinished, listenGitRepoChanged } from "./ipc";
import { isWithinRoot } from "./fileRootUtils";
import { useFileStore } from "../stores/fileStore";
import type { EditorTab } from "../types";

const RELOAD_DEBOUNCE_MS = 250;

/**
 * Reloads open editor tabs after an agent turn or a git change touches their
 * files. Clean tabs take the new disk content; dirty tabs get a conflict state.
 */
export function startEditorDiskSync(): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pendingTabIds = new Set<string>();
  const unlisteners: Array<() => void> = [];

  function schedule(matches: (tab: EditorTab) => boolean) {
    for (const tab of useFileStore.getState().tabs) {
      if (matches(tab)) pendingTabIds.add(tab.id);
    }
    if (pendingTabIds.size === 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const tabIds = [...pendingTabIds];
      pendingTabIds.clear();
      for (const tabId of tabIds) {
        void useFileStore.getState().reloadTabFromDisk(tabId);
      }
    }, RELOAD_DEBOUNCE_MS);
  }

  function keep(unlisten: () => void) {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }

  void listenChatTurnFinished((event) => {
    schedule((tab) => tab.workspaceId === event.workspaceId);
  }).then(keep);
  void listenGitRepoChanged((event) => {
    schedule((tab) => isWithinRoot(tab.absolutePath, event.repoPath));
  }).then(keep);

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    pendingTabIds.clear();
    for (const unlisten of unlisteners.splice(0)) unlisten();
  };
}
