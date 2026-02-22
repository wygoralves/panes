import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { toast } from "./toastStore";
import { useWorkspaceStore } from "./workspaceStore";
import { useTerminalStore } from "./terminalStore";
import { destroyCachedEditor } from "../components/editor/CodeMirrorEditor";
import type { EditorTab } from "../types";

interface FileStoreState {
  tabs: EditorTab[];
  activeTabId: string | null;
  pendingCloseTabId: string | null;
  openFile: (repoPath: string, filePath: string) => Promise<void>;
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
      set({ activeTabId: existing.id });
      return;
    }

    const id = crypto.randomUUID();
    const fileName = filePath.split("/").pop() ?? filePath;

    const tab: EditorTab = {
      id,
      repoPath,
      filePath,
      fileName,
      content: "",
      savedContent: "",
      isDirty: false,
      isLoading: true,
      isBinary: false,
    };

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

  closeTab: (tabId) => {
    destroyCachedEditor(tabId);
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
        toast.warning(`${tab.fileName} was modified externally. Save again to overwrite.`);
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
      toast.success(`Saved ${tab.fileName}`);
    } catch (err) {
      toast.error(`Failed to save: ${String(err)}`);
    }
  },
}));
