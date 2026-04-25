import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { isMarkdownPreviewFile } from "../lib/editorFileTypes";
import {
  isWithinRoot,
  resolveAbsoluteFilePath,
  resolveOwningRepoForAbsolutePath,
  resolveRelativePathWithinRoot,
} from "../lib/fileRootUtils";
import { t } from "../i18n";
import { toast } from "./toastStore";
import { useWorkspaceStore } from "./workspaceStore";
import { useGitStore } from "./gitStore";
import { destroyCachedEditor } from "../components/editor/CodeMirrorEditor";
import type {
  EditorRevealLocation,
  EditorRevealRequest,
  EditorRenderMode,
  EditorTab,
  GitCompareSource,
  GitFileCompare,
} from "../types";

interface ResolvedFileContext {
  absolutePath: string;
  gitRepoPath: string | null;
  gitFilePath: string | null;
}

function remapAbsolutePathForRename(
  absolutePath: string,
  oldAbsolutePath: string,
  newAbsolutePath: string,
): string | null {
  if (!isWithinRoot(absolutePath, oldAbsolutePath)) {
    return null;
  }

  if (absolutePath === oldAbsolutePath) {
    return newAbsolutePath;
  }

  const suffix = absolutePath.slice(oldAbsolutePath.length).replace(/^\/+/, "");
  return suffix ? resolveAbsoluteFilePath(newAbsolutePath, suffix) : newAbsolutePath;
}

function resolveFileContext(rootPath: string, filePath: string): ResolvedFileContext {
  const absolutePath = resolveAbsoluteFilePath(rootPath, filePath);
  const workspaceState = useWorkspaceStore.getState();
  const ownership = resolveOwningRepoForAbsolutePath(
    absolutePath,
    workspaceState.repos,
    workspaceState.activeRepoId,
  );

  return {
    absolutePath,
    gitRepoPath: ownership?.repo.path ?? null,
    gitFilePath: ownership?.filePath ?? null,
  };
}

function createPlainTab(
  id: string,
  workspaceId: string | null,
  rootPath: string,
  filePath: string,
  resolved: ResolvedFileContext,
): EditorTab {
  return {
    id,
    workspaceId,
    rootPath,
    absolutePath: resolved.absolutePath,
    filePath,
    gitRepoPath: resolved.gitRepoPath,
    gitFilePath: resolved.gitFilePath,
    fileName: filePath.split("/").pop() ?? filePath,
    content: "",
    savedContent: "",
    isDirty: false,
    isLoading: true,
    isBinary: false,
    renderMode: "plain-editor",
    gitContext: null,
    pendingReveal: null,
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
    pendingReveal: null,
    loadError: undefined,
  };
}

function createRevealRequest(reveal: EditorRevealLocation | null | undefined): EditorRevealRequest | null {
  if (!reveal) {
    return null;
  }

  return {
    line: reveal.line,
    column: reveal.column ?? null,
    nonce: crypto.randomUUID(),
  };
}

function toPlainEditorTab(
  tab: EditorTab,
  pendingReveal: EditorRevealRequest | null,
): EditorTab {
  return {
    ...tab,
    renderMode: "plain-editor",
    gitContext: null,
    pendingReveal,
    loadError: undefined,
  };
}

function defaultOpenRenderMode(
  filePath: string,
  pendingReveal: EditorRevealRequest | null,
): EditorRenderMode {
  if (!pendingReveal && isMarkdownPreviewFile(filePath)) {
    return "markdown-preview";
  }
  return "plain-editor";
}

function toOpenedFileTab(
  tab: EditorTab,
  pendingReveal: EditorRevealRequest | null,
  renderMode: EditorRenderMode,
): EditorTab {
  return {
    ...tab,
    renderMode,
    gitContext: null,
    pendingReveal: renderMode === "plain-editor" ? pendingReveal : null,
    loadError: undefined,
  };
}

function toMarkdownPreviewTab(tab: EditorTab): EditorTab {
  return {
    ...tab,
    renderMode: "markdown-preview",
    gitContext: null,
    pendingReveal: null,
    loadError: undefined,
  };
}

interface FileStoreState {
  tabs: EditorTab[];
  activeTabId: string | null;
  pendingCloseTabId: string | null;
  openFile: (rootPath: string, filePath: string) => Promise<void>;
  openFileAtLocation: (
    rootPath: string,
    filePath: string,
    reveal?: EditorRevealLocation | null,
  ) => Promise<void>;
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
  setTabRenderMode: (tabId: string, renderMode: EditorRenderMode) => void;
  setTabContent: (tabId: string, content: string) => void;
  clearPendingReveal: (tabId: string, nonce: string) => void;
  retargetTabsAfterRename: (
    rootPath: string,
    oldPath: string,
    newPath: string,
  ) => void;
  saveTab: (tabId: string) => Promise<void>;
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  pendingCloseTabId: null,

  openFile: async (rootPath, filePath) => {
    await get().openFileAtLocation(rootPath, filePath);
  },

  openFileAtLocation: async (rootPath, filePath, reveal) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const resolved = resolveFileContext(rootPath, filePath);
    const existing = get().tabs.find((tab) => tab.absolutePath === resolved.absolutePath);
    const pendingReveal = createRevealRequest(reveal);
    const renderMode = defaultOpenRenderMode(filePath, pendingReveal);
    if (existing) {
      destroyCachedEditor(`${existing.id}:git-base`);
      destroyCachedEditor(`${existing.id}:git-modified`);
      const nextRenderMode = existing.isBinary ? "plain-editor" : renderMode;
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...toOpenedFileTab(tab, pendingReveal, nextRenderMode),
                workspaceId,
                rootPath,
                filePath,
                gitRepoPath: resolved.gitRepoPath ?? tab.gitRepoPath,
                gitFilePath: resolved.gitFilePath ?? tab.gitFilePath,
              }
            : tab,
        ),
      }));
      return;
    }

    const id = crypto.randomUUID();
    const tab = createPlainTab(id, workspaceId, rootPath, filePath, resolved);

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }));

    try {
      const result = await ipc.readFile(rootPath, filePath);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...toOpenedFileTab(
                  t,
                  pendingReveal,
                  result.isBinary ? "plain-editor" : renderMode,
                ),
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

  openGitDiffFile: async (repoPath, filePath, options) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    const resolved = {
      absolutePath: resolveAbsoluteFilePath(repoPath, filePath),
      gitRepoPath: repoPath,
      gitFilePath: filePath,
    };
    const existing = get().tabs.find((tab) => tab.absolutePath === resolved.absolutePath);
    const tabId = existing?.id ?? crypto.randomUUID();

    if (existing) {
      destroyCachedEditor(existing.id);
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                workspaceId,
                gitRepoPath: repoPath,
                gitFilePath: filePath,
                isLoading: true,
                renderMode: "git-diff-editor",
                pendingReveal: null,
                loadError: undefined,
              }
            : tab,
        ),
      }));
    } else {
      const tab = {
        ...createPlainTab(tabId, workspaceId, repoPath, filePath, resolved),
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
    if (!compareSource || !tab.gitRepoPath || !tab.gitFilePath) return;

    try {
      const compare = await ipc.getGitFileCompare(
        tab.gitRepoPath,
        tab.gitFilePath,
        compareSource,
      );
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

  setTabRenderMode: (tabId, renderMode) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }

        if (renderMode === "plain-editor") {
          return toPlainEditorTab(tab, null);
        }

        if (renderMode === "markdown-preview") {
          return toMarkdownPreviewTab(tab);
        }

        return tab;
      }),
    }));
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

  clearPendingReveal: (tabId, nonce) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.pendingReveal?.nonce === nonce
          ? { ...tab, pendingReveal: null }
          : tab,
      ),
    }));
  },

  retargetTabsAfterRename: (rootPath, oldPath, newPath) => {
    const oldAbsolutePath = resolveAbsoluteFilePath(rootPath, oldPath);
    const newAbsolutePath = resolveAbsoluteFilePath(rootPath, newPath);
    const workspaceState = useWorkspaceStore.getState();

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        const nextAbsolutePath = remapAbsolutePathForRename(
          tab.absolutePath,
          oldAbsolutePath,
          newAbsolutePath,
        );
        if (!nextAbsolutePath) {
          return tab;
        }

        const nextRootPath =
          remapAbsolutePathForRename(tab.rootPath, oldAbsolutePath, newAbsolutePath) ??
          tab.rootPath;
        const nextGitRepoPath = tab.gitRepoPath
          ? remapAbsolutePathForRename(tab.gitRepoPath, oldAbsolutePath, newAbsolutePath) ??
            tab.gitRepoPath
          : null;
        const nextFilePath = resolveRelativePathWithinRoot(
          nextAbsolutePath,
          nextRootPath,
        );
        if (nextFilePath === null) {
          return tab;
        }

        const ownership =
          !nextGitRepoPath || nextGitRepoPath === tab.gitRepoPath
            ? resolveOwningRepoForAbsolutePath(
                nextAbsolutePath,
                workspaceState.repos,
                workspaceState.activeRepoId,
              )
            : null;
        const resolvedGitRepoPath = nextGitRepoPath ?? ownership?.repo.path ?? null;
        const resolvedGitFilePath = resolvedGitRepoPath
          ? resolveRelativePathWithinRoot(nextAbsolutePath, resolvedGitRepoPath)
          : ownership?.filePath ?? null;

        return {
          ...tab,
          rootPath: nextRootPath,
          absolutePath: nextAbsolutePath,
          filePath: nextFilePath,
          fileName: nextFilePath.split("/").pop() ?? nextFilePath,
          gitRepoPath: resolvedGitRepoPath,
          gitFilePath:
            resolvedGitFilePath && resolvedGitFilePath.length > 0
              ? resolvedGitFilePath
              : null,
        };
      }),
    }));
  },

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.isDirty) return;

    // Check if the file was modified externally since we loaded/last-saved it
    try {
      const disk = await ipc.readFile(tab.rootPath, tab.filePath);
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
      await ipc.writeFile(tab.rootPath, tab.filePath, contentToSave, tab.workspaceId);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, savedContent: contentToSave, isDirty: t.content !== contentToSave }
            : t,
        ),
      }));

      if (tab.gitContext && tab.gitRepoPath) {
        const gitStore = useGitStore.getState();
        try {
          gitStore.invalidateRepoCache(tab.gitRepoPath);
          await gitStore.refresh(tab.gitRepoPath, { force: true });
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
