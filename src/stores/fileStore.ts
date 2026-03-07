import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { t } from "../i18n";
import { toast } from "./toastStore";
import { useWorkspaceStore } from "./workspaceStore";
import { useTerminalStore } from "./terminalStore";
import { useGitStore } from "./gitStore";
import { destroyCachedEditor } from "../components/editor/CodeMirrorEditor";
import type { EditorTab, GitCompareSource, GitFileCompare } from "../types";

function createPlainTab(id: string, repoPath: string, filePath: string): EditorTab {
  return {
    id,
    repoPath,
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    content: "",
    savedContent: "",
    isDirty: false,
    isLoading: true,
    isBinary: false,
    renderMode: "plain-editor",
    gitContext: null,
  };
}

function applyGitCompare(tab: EditorTab, compare: GitFileCompare): EditorTab {
  const preserveDirtyContent = tab.isDirty;
  const content = preserveDirtyContent ? tab.content : compare.modifiedContent;
  const savedContent = preserveDirtyContent ? tab.savedContent : compare.modifiedContent;

  return {
    ...tab,
    content,
    savedContent,
    isDirty: preserveDirtyContent ? tab.content !== tab.savedContent : false,
    isLoading: false,
    isBinary: compare.isBinary,
    renderMode: "git-diff-editor",
    gitContext: compare,
    loadError: undefined,
  };
}

interface FileStoreState {
  tabs: EditorTab[];
  activeTabId: string | null;
  pendingCloseTabId: string | null;
  openFile: (repoPath: string, filePath: string) => Promise<void>;
  openGitDiffFile: (
    repoPath: string,
    filePath: string,
    options: { source: GitCompareSource },
  ) => Promise<void>;
  refreshGitContext: (tabId: string, source?: GitCompareSource) => Promise<void>;
  closeTab: (tabId: string) => void;
  requestCloseTab: (tabId: string) => void;
  confirmCloseTab: () => void;
  cancelCloseTab: () => void;
  setActiveTab: (tabId: string) => void;
  setTabContent: (tabId: string, content: string) => void;
  saveTab: (tabId: string) => Promise<void>;
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  pendingCloseTabId: null,

  openFile: async (repoPath, filePath) => {
    const existing = get().tabs.find(
      (t) => t.repoPath === repoPath && t.filePath === filePath,
    );
    if (existing) {
      destroyCachedEditor(`${existing.id}:git-base`);
      destroyCachedEditor(`${existing.id}:git-modified`);
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                renderMode: "plain-editor",
                gitContext: null,
                loadError: undefined,
              }
            : tab,
        ),
      }));
      return;
    }

    const id = crypto.randomUUID();
    const tab = createPlainTab(id, repoPath, filePath);

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }));

    try {
      const result = await ipc.readFile(repoPath, filePath);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                content: result.content,
                savedContent: result.content,
                isBinary: result.isBinary,
                isLoading: false,
                renderMode: "plain-editor",
                gitContext: null,
                loadError: undefined,
              }
            : t,
        ),
      }));
    } catch (err) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? { ...t, isLoading: false, loadError: String(err) }
            : t,
        ),
      }));
    }
  },

  openGitDiffFile: async (repoPath, filePath, options) => {
    const existing = get().tabs.find(
      (tab) => tab.repoPath === repoPath && tab.filePath === filePath,
    );
    const tabId = existing?.id ?? crypto.randomUUID();

    if (existing) {
      destroyCachedEditor(existing.id);
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                isLoading: true,
                renderMode: "git-diff-editor",
                loadError: undefined,
              }
            : tab,
        ),
      }));
    } else {
      const tab = {
        ...createPlainTab(tabId, repoPath, filePath),
        renderMode: "git-diff-editor" as const,
      };
      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: tabId,
      }));
    }

    await get().refreshGitContext(tabId, options.source);
  },

  refreshGitContext: async (tabId, source) => {
    const tab = get().tabs.find((item) => item.id === tabId);
    if (!tab) return;

    const compareSource = source ?? tab.gitContext?.source;
    if (!compareSource) return;

    try {
      const compare = await ipc.getGitFileCompare(tab.repoPath, tab.filePath, compareSource);
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId ? applyGitCompare(item, compare) : item,
        ),
      }));
    } catch (err) {
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId
            ? {
                ...item,
                isLoading: false,
                renderMode: "git-diff-editor",
                loadError: String(err),
              }
            : item,
        ),
      }));
    }
  },

  closeTab: (tabId) => {
    destroyCachedEditor(tabId);
    destroyCachedEditor(`${tabId}:git-base`);
    destroyCachedEditor(`${tabId}:git-modified`);
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === tabId);
      if (index === -1) return state;

      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveId = null;
        } else {
          const nextIndex = Math.min(index, newTabs.length - 1);
          newActiveId = newTabs[nextIndex].id;
        }
      }

      return { tabs: newTabs, activeTabId: newActiveId, pendingCloseTabId: null };
    });

    // Auto-exit editor mode when all tabs are closed.
    // Safe to read here: Zustand's set() is synchronous, so get() reflects the updated state.
    if (get().tabs.length === 0) {
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (wsId) {
        const ws = useTerminalStore.getState().workspaces[wsId];
        if (ws?.layoutMode === "editor") {
          void useTerminalStore.getState().setLayoutMode(wsId, ws.preEditorLayoutMode ?? "chat");
        }
      }
    }
  },

  requestCloseTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.isDirty) {
      set({ pendingCloseTabId: tabId });
    } else {
      get().closeTab(tabId);
    }
  },

  confirmCloseTab: () => {
    const { pendingCloseTabId } = get();
    if (pendingCloseTabId) {
      get().closeTab(pendingCloseTabId);
    }
  },

  cancelCloseTab: () => {
    set({ pendingCloseTabId: null });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  setTabContent: (tabId, content) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, content, isDirty: content !== t.savedContent }
          : t,
      ),
    }));
  },

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.isDirty) return;

    // Check if the file was modified externally since we loaded/last-saved it
    try {
      const disk = await ipc.readFile(tab.repoPath, tab.filePath);
      if (!disk.isBinary && disk.content !== tab.savedContent) {
        toast.warning(t("app:editor.toasts.modifiedExternally", { name: tab.fileName }));
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? { ...t, savedContent: disk.content, isDirty: true }
              : t,
          ),
        }));
        return;
      }
    } catch {
      // File may have been deleted — proceed with save
    }

    const contentToSave = tab.content;
    try {
      await ipc.writeFile(tab.repoPath, tab.filePath, contentToSave);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, savedContent: contentToSave, isDirty: t.content !== contentToSave }
            : t,
        ),
      }));

      if (tab.gitContext) {
        const gitStore = useGitStore.getState();
        try {
          gitStore.invalidateRepoCache(tab.repoPath);
          await gitStore.refresh(tab.repoPath, { force: true });
          await get().refreshGitContext(tabId, tab.gitContext.source);
        } catch {
          // Saving already succeeded; leave the editor usable even if the git refresh fails.
        }
      }

      toast.success(t("app:editor.toasts.saved", { name: tab.fileName }));
    } catch (err) {
      toast.error(t("app:editor.toasts.saveFailed", { error: String(err) }));
    }
  },
}));
