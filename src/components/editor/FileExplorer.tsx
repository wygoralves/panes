import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  File,
  Plus,
  Folder,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  ipc,
  listenChatTurnFinished,
  listenGitRepoChanged,
} from "../../lib/ipc";
import {
  isWithinRoot,
  resolveAbsoluteFilePath,
} from "../../lib/fileRootUtils";
import { isMacDesktop } from "../../lib/windowActions";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { toast } from "../../stores/toastStore";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { getActionMenuPosition } from "../git/actionMenuPosition";
import type { FileTreeEntry } from "../../types";
import {
  isCurrentExplorerLoad,
  isKnownDirectoryPath,
  isPathEqualOrDescendant,
  pruneDeletedMapKeys,
  pruneDeletedSetPaths,
  pruneContainedPaths,
  remapDescendantPath,
} from "./fileExplorerState";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface DirRow {
  type: "dir";
  key: string;
  name: string;
  path: string;
  depth: number;
  expanded: boolean;
}

interface FileRow {
  type: "file";
  key: string;
  name: string;
  path: string;
  depth: number;
}

/** Synthetic row inserted at the top of a directory while creating a new item. */
interface CreateRow {
  type: "create";
  key: string;
  parentDir: string;
  createType: "file" | "dir";
  depth: number;
}

type TreeRow = DirRow | FileRow | CreateRow;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREE_ROW_HEIGHT = 24;
const TREE_VERTICAL_PADDING = 4;
const TREE_OVERSCAN_ROWS = 10;
const TREE_VIRTUALIZATION_THRESHOLD = 200;

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f0db4f",
  jsx: "#f0db4f",
  rs: "#f74c00",
  py: "#3572A5",
  go: "#00ADD8",
  rb: "#CC342D",
  java: "#b07219",
  html: "#e34c26",
  css: "#563d7c",
  scss: "#c6538c",
  json: "#f0db4f",
  yaml: "#cb171e",
  yml: "#cb171e",
  md: "#083fa1",
  toml: "#9c4221",
  sql: "#e38c00",
  sh: "#89e051",
};

function getExtColor(fileName: string): string | undefined {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_COLORS[ext];
}

function entryName(entry: FileTreeEntry): string {
  return entry.path.split("/").pop() ?? entry.path;
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function nameWithoutExtension(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0) return name; // hidden files or no extension
  return name.slice(0, dotIdx);
}

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------

type ContextMenuVariant =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string }
  | { kind: "empty" }
  | { kind: "multi"; paths: string[] };

interface ContextMenuState {
  variant: ContextMenuVariant;
  top: number;
  left: number;
  triggerRect: { top: number; bottom: number; right: number };
}

// ---------------------------------------------------------------------------
// Delete confirmation state
// ---------------------------------------------------------------------------

interface DeletePending {
  requestedPaths: string[];
  deletePaths: string[];
  dirtyTabIds: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileExplorer() {
  const { t } = useTranslation("app");
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId),
  );
  const workspaceRepos = useWorkspaceStore((s) => s.repos);
  const rootPath = activeWorkspace?.rootPath ?? "";

  // -- Directory contents & loading --
  const [dirContents, setDirContents] = useState<Map<string, FileTreeEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = useState(false);
  const [filter, setFilter] = useState("");

  // -- Store bindings --
  const openFile = useFileStore((s) => s.openFile);
  const retargetTabsAfterRename = useFileStore((s) => s.retargetTabsAfterRename);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);
  const setExplorerOpen = useUiStore((s) => s.setExplorerOpen);

  // -- Scroll / virtualization --
  const prevRootPath = useRef(rootPath);
  const loadSignatureRef = useRef({ generation: 0, rootPath });
  const refreshRequestIdRef = useRef(0);
  const dirContentsRef = useRef(dirContents);
  const expandedDirsRef = useRef(expandedDirs);
  const refreshTimerRef = useRef<number | null>(null);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  dirContentsRef.current = dirContents;
  expandedDirsRef.current = expandedDirs;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // -- Explorer container (for keyboard shortcut capture) --
  const explorerRef = useRef<HTMLDivElement>(null);

  // -- Multi-select --
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // -- Context menu --
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextActivePath, setContextActivePath] = useState<string | null>(null);

  // -- Inline rename --
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameErrorMessage, setRenameErrorMessage] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // -- Inline create --
  const [creating, setCreating] = useState<{ parentDir: string; type: "file" | "dir" } | null>(
    null,
  );
  const [createValue, setCreateValue] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  // -- Delete confirmation --
  const [deletePending, setDeletePending] = useState<DeletePending | null>(null);

  // ---------------------------------------------------------------------------
  // Load directory
  // ---------------------------------------------------------------------------

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (!rootPath) return;
      const isRoot = dirPath === "";
      const requestSignature = {
        generation: loadSignatureRef.current.generation,
        rootPath,
      };
      if (isRoot) setRootLoading(true);
      else setLoadingDirs((prev) => new Set(prev).add(dirPath));

      try {
        const entries = await ipc.listDir(requestSignature.rootPath, dirPath);
        if (!isCurrentExplorerLoad(requestSignature, loadSignatureRef.current)) return;
        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirPath, entries);
          return next;
        });
      } catch (err) {
        if (!isCurrentExplorerLoad(requestSignature, loadSignatureRef.current)) return;
        console.warn(`[FileExplorer] failed to list directory "${dirPath}":`, err);
      } finally {
        if (!isCurrentExplorerLoad(requestSignature, loadSignatureRef.current)) return;
        if (isRoot) setRootLoading(false);
        else
          setLoadingDirs((prev) => {
            const next = new Set(prev);
            next.delete(dirPath);
            return next;
          });
      }
    },
    [rootPath],
  );

  // ---------------------------------------------------------------------------
  // Root path change / initial load
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (prevRootPath.current !== rootPath) {
      loadSignatureRef.current = {
        generation: loadSignatureRef.current.generation + 1,
        rootPath,
      };
      setDirContents(new Map());
      setExpandedDirs(new Set());
      setLoadingDirs(new Set());
      setRootLoading(false);
      setFilter("");
      setScrollTop(0);
      setSelectedPaths(new Set());
      setLastClickedIndex(null);
      setRenamingPath(null);
      setCreating(null);
      setContextMenu(null);
      setDeletePending(null);
      prevRootPath.current = rootPath;
    }
    if (!rootPath) return;
    void loadDir("");
  }, [loadDir, rootPath]);

  const refreshVisibleDirs = useCallback(async () => {
    if (!rootPath) return;

    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    setRefreshing(true);
    setLoadingDirs(new Set());
    setRootLoading(false);
    loadSignatureRef.current = {
      generation: loadSignatureRef.current.generation + 1,
      rootPath,
    };

    const dirsToRefresh = [...new Set(["", ...expandedDirsRef.current])]
      .sort((left, right) => {
        const depthDelta = left.split("/").length - right.split("/").length;
        return depthDelta !== 0 ? depthDelta : left.localeCompare(right);
      });

    try {
      await Promise.all(dirsToRefresh.map((dirPath) => loadDir(dirPath)));
    } finally {
      if (refreshRequestIdRef.current === requestId) {
        setRefreshing(false);
      }
    }
  }, [loadDir, rootPath]);

  const scheduleRefreshVisibleDirs = useCallback(() => {
    if (!rootPath) return;
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshVisibleDirs();
    }, 250);
  }, [refreshVisibleDirs, rootPath]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId || !rootPath) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const attach = async () => {
      const stop = await listenChatTurnFinished((event) => {
        if (event.workspaceId !== activeWorkspaceId) {
          return;
        }
        scheduleRefreshVisibleDirs();
      });

      if (disposed) {
        stop();
        return;
      }

      unlisten = stop;
    };

    void attach();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeWorkspaceId, rootPath, scheduleRefreshVisibleDirs]);

  useEffect(() => {
    if (!activeWorkspaceId || !rootPath) return;

    const repoPaths = workspaceRepos
      .filter((repo) => repo.workspaceId === activeWorkspaceId)
      .map((repo) => repo.path);

    if (repoPaths.length === 0) {
      return;
    }

    const visibleRepoPaths = new Set(repoPaths);
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const attach = async () => {
      await Promise.all(
        repoPaths.map(async (repoPath) => {
          try {
            await ipc.watchGitRepo(repoPath);
          } catch {
            // Ignore watch failures for individual repos.
          }
        }),
      );

      const stop = await listenGitRepoChanged((event) => {
        if (!visibleRepoPaths.has(event.repoPath)) {
          return;
        }
        scheduleRefreshVisibleDirs();
      });

      if (disposed) {
        stop();
        return;
      }

      unlisten = stop;
    };

    void attach();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeWorkspaceId, rootPath, scheduleRefreshVisibleDirs, workspaceRepos]);

  useEffect(() => {
    if (!rootPath) return;

    const handleFocus = () => {
      scheduleRefreshVisibleDirs();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefreshVisibleDirs();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [rootPath, scheduleRefreshVisibleDirs]);

  // ---------------------------------------------------------------------------
  // Toggle directory expand/collapse
  // ---------------------------------------------------------------------------

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          if (!dirContentsRef.current.has(dirPath)) {
            void loadDir(dirPath);
          }
        }
        return next;
      });
    },
    [loadDir],
  );

  /** Ensure a directory is expanded, loading if needed. */
  const expandDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        if (prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.add(dirPath);
        if (!dirContentsRef.current.has(dirPath)) {
          void loadDir(dirPath);
        }
        return next;
      });
    },
    [loadDir],
  );

  // ---------------------------------------------------------------------------
  // Open file
  // ---------------------------------------------------------------------------

  const handleFileClick = useCallback(
    (filePath: string) => {
      if (!rootPath) return;
      void openFile(rootPath, filePath);
      if (activeWorkspaceId) {
        void setLayoutMode(activeWorkspaceId, "editor");
      }
    },
    [rootPath, openFile, activeWorkspaceId, setLayoutMode],
  );

  // ---------------------------------------------------------------------------
  // Build flat visible rows list
  // ---------------------------------------------------------------------------

  const rows = useMemo(() => {
    const result: TreeRow[] = [];
    const lowerFilter = filter.toLowerCase();

    function visitDir(dirPath: string, depth: number) {
      // Insert "create" synthetic row at the top of the target dir
      if (creating && creating.parentDir === dirPath) {
        result.push({
          type: "create",
          key: `create:${dirPath}`,
          parentDir: dirPath,
          createType: creating.type,
          depth,
        });
      }

      const children = dirContents.get(dirPath);
      if (!children) return;

      for (const entry of children) {
        const name = entryName(entry);

        if (entry.isDir) {
          const expanded = expandedDirs.has(entry.path);

          if (lowerFilter && !name.toLowerCase().includes(lowerFilter)) {
            if (!expanded) continue;
          }

          result.push({
            type: "dir",
            key: `dir:${entry.path}`,
            name,
            path: entry.path,
            depth,
            expanded,
          });

          if (expanded) {
            visitDir(entry.path, depth + 1);
          }
        } else {
          if (lowerFilter && !name.toLowerCase().includes(lowerFilter)) {
            continue;
          }

          result.push({
            type: "file",
            key: `file:${entry.path}`,
            name,
            path: entry.path,
            depth,
          });
        }
      }
    }

    visitDir("", 0);
    return result;
  }, [dirContents, expandedDirs, filter, creating]);

  const filteredFileCount = useMemo(
    () => rows.reduce((count, row) => count + (row.type === "file" ? 1 : 0), 0),
    [rows],
  );

  // ---------------------------------------------------------------------------
  // Viewport height observation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    const updateViewportHeight = () => {
      setViewportHeight(viewport.clientHeight);
    };

    updateViewportHeight();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => updateViewportHeight());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Clamp scroll after row count shrinks
  useEffect(() => {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    const maxScrollTop = Math.max(
      0,
      rows.length * TREE_ROW_HEIGHT + TREE_VERTICAL_PADDING * 2 - viewport.clientHeight,
    );
    if (viewport.scrollTop > maxScrollTop) {
      viewport.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [rows.length]);

  // ---------------------------------------------------------------------------
  // Virtualization window
  // ---------------------------------------------------------------------------

  const virtualWindow = useMemo(() => {
    const virtualizationEnabled = rows.length >= TREE_VIRTUALIZATION_THRESHOLD;
    if (!virtualizationEnabled) {
      return {
        enabled: false,
        startIndex: 0,
        endIndexExclusive: rows.length,
        totalHeight: rows.length * TREE_ROW_HEIGHT + TREE_VERTICAL_PADDING * 2,
      };
    }

    const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / TREE_ROW_HEIGHT));
    const startIndex = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN_ROWS);
    const endIndexExclusive = Math.min(
      rows.length,
      startIndex + visibleRowCount + TREE_OVERSCAN_ROWS * 2,
    );

    return {
      enabled: true,
      startIndex,
      endIndexExclusive,
      totalHeight: rows.length * TREE_ROW_HEIGHT + TREE_VERTICAL_PADDING * 2,
    };
  }, [rows, scrollTop, viewportHeight]);

  const visibleRows = useMemo(
    () => rows.slice(virtualWindow.startIndex, virtualWindow.endIndexExclusive),
    [rows, virtualWindow.endIndexExclusive, virtualWindow.startIndex],
  );

  // ---------------------------------------------------------------------------
  // Context menu helpers
  // ---------------------------------------------------------------------------

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setContextActivePath(null);
  }, []);

  /** Build a synthetic DOMRect-like object from a MouseEvent's client coords. */
  function rectFromEvent(e: React.MouseEvent): { top: number; bottom: number; right: number } {
    return { top: e.clientY, bottom: e.clientY, right: e.clientX };
  }

  function openContextMenuAt(
    variant: ContextMenuVariant,
    triggerRect: { top: number; bottom: number; right: number },
  ) {
    // Estimate menu height so we can position before mount
    let itemCount = 0;
    let dividerCount = 0;
    switch (variant.kind) {
      case "file":
        itemCount = 6;
        dividerCount = 2;
        break;
      case "dir":
        itemCount = 7;
        dividerCount = 2;
        break;
      case "empty":
        itemCount = 3;
        dividerCount = 1;
        break;
      case "multi":
        itemCount = 4;
        dividerCount = 1;
        break;
    }
    const estimatedHeight = itemCount * 32 + dividerCount * 9 + 8;
    const pos = getActionMenuPosition({
      triggerRect,
      menuWidth: 200,
      menuHeight: estimatedHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setContextMenu({ variant, top: pos.top, left: pos.left, triggerRect });
  }

  // Reposition after menu actually mounts (true dimensions)
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const next = getActionMenuPosition({
      triggerRect: contextMenu.triggerRect,
      menuWidth: contextMenuRef.current.offsetWidth,
      menuHeight: contextMenuRef.current.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    if (next.top === contextMenu.top && next.left === contextMenu.left) return;
    setContextMenu((prev) => (prev ? { ...prev, ...next } : null));
  }, [contextMenu?.variant]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close context menu on click-outside, Escape, or scroll
  useEffect(() => {
    if (!contextMenu) return;

    function onPointerDown(e: PointerEvent) {
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      closeContextMenu();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeContextMenu();
      }
    }

    function onScroll() {
      closeContextMenu();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [contextMenu, closeContextMenu]);

  // ---------------------------------------------------------------------------
  // Context menu actions
  // ---------------------------------------------------------------------------

  const handleReveal = useCallback(
    (path: string | null) => {
      if (!rootPath) return;
      const fullPath = path ? `${rootPath}/${path}` : rootPath;
      void ipc.revealPath(fullPath);
    },
    [rootPath],
  );

  const handleOpenInDefaultApp = useCallback(
    async (path: string) => {
      if (!rootPath) return;
      try {
        await ipc.openPathWithDefaultApp(resolveAbsoluteFilePath(rootPath, path));
      } catch {
        toast.error(t("explorer.toasts.openExternalFailed"));
      }
    },
    [rootPath, t],
  );

  const handleCopyPath = useCallback(
    (path: string) => {
      if (!rootPath) return;
      const fullPath = `${rootPath}/${path}`;
      navigator.clipboard.writeText(fullPath).then(
        () => toast.success(t("explorer.toasts.pathCopied")),
        () => toast.error(t("explorer.toasts.pathCopied")),
      );
    },
    [rootPath, t],
  );

  const handleCopyRelativePath = useCallback(
    (path: string) => {
      navigator.clipboard.writeText(path).then(
        () => toast.success(t("explorer.toasts.pathCopied")),
        () => toast.error(t("explorer.toasts.pathCopied")),
      );
    },
    [t],
  );

  const handleCopyPaths = useCallback(
    (paths: string[]) => {
      if (!rootPath) return;
      const text = paths.map((p) => `${rootPath}/${p}`).join("\n");
      navigator.clipboard.writeText(text).then(
        () => toast.success(t("explorer.toasts.pathsCopied", { count: paths.length })),
        () => toast.error(t("explorer.toasts.pathsCopied", { count: paths.length })),
      );
    },
    [rootPath, t],
  );

  const handleCopyRelativePaths = useCallback(
    (paths: string[]) => {
      const text = paths.join("\n");
      navigator.clipboard.writeText(text).then(
        () => toast.success(t("explorer.toasts.pathsCopied", { count: paths.length })),
        () => toast.error(t("explorer.toasts.pathsCopied", { count: paths.length })),
      );
    },
    [t],
  );

  // ---------------------------------------------------------------------------
  // Inline rename
  // ---------------------------------------------------------------------------

  const startRename = useCallback((path: string) => {
    const name = baseName(path);
    setRenamingPath(path);
    setRenameValue(name);
    setRenameErrorMessage(null);
  }, []);

  // Auto-focus + auto-select rename input
  useEffect(() => {
    if (!renamingPath || !renameInputRef.current) return;
    const input = renameInputRef.current;
    input.focus();
    // Select without extension for files
    const name = baseName(renamingPath);
    const selectEnd = nameWithoutExtension(name).length;
    input.setSelectionRange(0, selectEnd);
  }, [renamingPath]);

  const commitRename = useCallback(async () => {
    if (!renamingPath || !rootPath) return;
    const newName = renameValue.trim();
    const oldName = baseName(renamingPath);
    if (!newName || newName === oldName) {
      setRenamingPath(null);
      return;
    }

    const renamedPath = parentPath(renamingPath)
      ? `${parentPath(renamingPath)}/${newName}`
      : newName;

    try {
      await ipc.renamePath(rootPath, renamingPath, newName, activeWorkspaceId ?? null);
      retargetTabsAfterRename(rootPath, renamingPath, renamedPath);
      setSelectedPaths((prev) => {
        const next = new Set<string>();
        for (const path of prev) {
          next.add(remapDescendantPath(path, renamingPath, renamedPath) ?? path);
        }
        return next;
      });
      setExpandedDirs((prev) => {
        return pruneDeletedSetPaths(prev, [renamingPath]);
      });
      setDirContents((prev) => {
        return pruneDeletedMapKeys(prev, [renamingPath]);
      });
      setRenamingPath(null);
      setRenameErrorMessage(null);
      await loadDir(parentPath(renamingPath));
      toast.success(t("explorer.toasts.renamed", { name: newName }));
    } catch (err) {
      const message = String(err);
      setRenameErrorMessage(
        message.includes("already exists")
          ? t("explorer.rename.errorExists")
          : t("explorer.rename.errorInvalid"),
      );
      console.warn("[FileExplorer] rename failed:", err);
    }
  }, [
    renamingPath,
    renameValue,
    rootPath,
    activeWorkspaceId,
    loadDir,
    retargetTabsAfterRename,
    t,
  ]);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameErrorMessage(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Inline create
  // ---------------------------------------------------------------------------

  // Auto-focus create input
  useEffect(() => {
    if (!creating || !createInputRef.current) return;
    createInputRef.current.focus();
  }, [creating]);

  const startCreate = useCallback(
    (parentDir: string, type: "file" | "dir") => {
      // Expand target dir so the synthetic row is visible
      if (parentDir !== "") expandDir(parentDir);
      setCreating({ parentDir, type });
      setCreateValue("");
    },
    [expandDir],
  );

  const commitCreate = useCallback(async () => {
    if (!creating || !rootPath) return;
    const name = createValue.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    const targetPath = creating.parentDir ? `${creating.parentDir}/${name}` : name;
    try {
      if (creating.type === "file") {
        await ipc.createFile(rootPath, targetPath, activeWorkspaceId ?? null);
        await loadDir(creating.parentDir);
        toast.success(t("explorer.toasts.created", { name }));
        void openFile(rootPath, targetPath);
        if (activeWorkspaceId) void setLayoutMode(activeWorkspaceId, "editor");
      } else {
        await ipc.createDir(rootPath, targetPath, activeWorkspaceId ?? null);
        await loadDir(creating.parentDir);
        toast.success(t("explorer.toasts.created", { name }));
      }
      setCreating(null);
    } catch (err) {
      toast.error(String(err));
      console.warn("[FileExplorer] create failed:", err);
      setCreating(null);
    }
  }, [creating, createValue, rootPath, activeWorkspaceId, loadDir, openFile, setLayoutMode, t]);

  const cancelCreate = useCallback(() => {
    setCreating(null);
    setCreateValue("");
  }, []);

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const requestDelete = useCallback((paths: string[]) => {
    if (!rootPath) return;

    const requestedPaths = [...new Set(paths)];
    const deletePaths = pruneContainedPaths(requestedPaths);
    if (deletePaths.length === 0) return;

    const dirtyTabIds = useFileStore
      .getState()
      .tabs.filter((tab) =>
        deletePaths.some((path) =>
          isWithinRoot(tab.absolutePath, resolveAbsoluteFilePath(rootPath, path)),
        ) && tab.isDirty,
      )
      .map((tab) => tab.id);

    setDeletePending({ requestedPaths, deletePaths, dirtyTabIds });
  }, [rootPath]);

  const confirmDelete = useCallback(async () => {
    if (!deletePending || !rootPath) return;
    const { deletePaths, requestedPaths } = deletePending;
    setDeletePending(null);

    const results = await Promise.allSettled(
      deletePaths.map((path) => ipc.deletePath(rootPath, path, activeWorkspaceId ?? null)),
    );

    const successfulPaths = deletePaths.filter((_, index) => results[index]?.status === "fulfilled");
    const failedResults = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const removedRequestedCount = requestedPaths.filter((path) =>
      successfulPaths.some((deletedPath) => isPathEqualOrDescendant(path, deletedPath)),
    ).length;

    if (successfulPaths.length > 0) {
      const fileStore = useFileStore.getState();
      const tabIdsToClose = fileStore.tabs
        .filter((tab) =>
          successfulPaths.some((path) =>
            isWithinRoot(tab.absolutePath, resolveAbsoluteFilePath(rootPath, path)),
          ),
        )
        .map((tab) => tab.id);

      for (const tabId of new Set(tabIdsToClose)) {
        fileStore.closeTab(tabId);
      }

      setExpandedDirs((prev) => pruneDeletedSetPaths(prev, successfulPaths));
      setDirContents((prev) => pruneDeletedMapKeys(prev, successfulPaths));

      const affectedDirs = new Set(successfulPaths.map(parentPath));
      for (const dir of affectedDirs) {
        await loadDir(dir);
      }

      setSelectedPaths((prev) => {
        const next = new Set(prev);
        for (const path of prev) {
          if (successfulPaths.some((deletedPath) => isPathEqualOrDescendant(path, deletedPath))) {
            next.delete(path);
          }
        }
        return next;
      });
    }

    if (failedResults.length > 0) {
      toast.error(String(failedResults[0].reason));
    } else if (removedRequestedCount === 1) {
      toast.success(t("explorer.toasts.deleted", { name: baseName(successfulPaths[0]) }));
    } else {
      toast.success(t("explorer.toasts.deletedItems", { count: removedRequestedCount }));
    }
  }, [deletePending, rootPath, activeWorkspaceId, loadDir, t]);

  // ---------------------------------------------------------------------------
  // Delete dialog content helpers
  // ---------------------------------------------------------------------------

  function deleteDialogContent(pending: DeletePending): { title: string; message: string; confirmLabel: string } {
    const { requestedPaths, dirtyTabIds } = pending;
    const unsavedWarning = dirtyTabIds.length
      ? ` ${t("explorer.delete.unsavedChanges", { count: dirtyTabIds.length })}`
      : "";

    if (requestedPaths.length === 1) {
      const isDir = isKnownDirectoryPath(dirContents, requestedPaths[0]);
      const name = baseName(requestedPaths[0]);
      if (isDir) {
        return {
          title: t("explorer.delete.folderTitle"),
          message: `${t("explorer.delete.folderMessage", { name })}${unsavedWarning}`,
          confirmLabel: t("explorer.delete.confirm"),
        };
      }
      return {
        title: t("explorer.delete.fileTitle"),
        message: `${t("explorer.delete.fileMessage", { name })}${unsavedWarning}`,
        confirmLabel: t("explorer.delete.confirm"),
      };
    }

    const names = requestedPaths.slice(0, 8).map(baseName);
    const extra = requestedPaths.length > 8 ? requestedPaths.length - 8 : 0;
    const list = names.join(", ") + (extra > 0 ? `, ${t("explorer.delete.andMore", { count: extra })}` : "");
    return {
      title: t("explorer.delete.bulkTitle", { count: requestedPaths.length }),
      message: `${t("explorer.delete.bulkMessage")} ${list}${unsavedWarning}`,
      confirmLabel: t("explorer.delete.confirmBulk", { count: requestedPaths.length }),
    };
  }

  // ---------------------------------------------------------------------------
  // Multi-select click logic
  // ---------------------------------------------------------------------------

  const isMac = isMacDesktop();

  const handleRowClick = useCallback(
    (row: TreeRow, absoluteIndex: number, e: React.MouseEvent) => {
      if (row.type === "create") return;
      explorerRef.current?.focus();

      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey) {
        // Cmd/Ctrl+click: toggle this item
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(row.path)) {
            next.delete(row.path);
          } else {
            next.add(row.path);
          }
          return next;
        });
        setLastClickedIndex(absoluteIndex);
        return;
      }

      if (e.shiftKey && lastClickedIndex !== null) {
        // Shift+click: select range
        const lo = Math.min(lastClickedIndex, absoluteIndex);
        const hi = Math.max(lastClickedIndex, absoluteIndex);
        const rangeRows = rows.slice(lo, hi + 1);
        setSelectedPaths(new Set(rangeRows.filter((r) => r.type !== "create").map((r) => (r as DirRow | FileRow).path)));
        return;
      }

      // Plain click: clear selection, open if file
      setSelectedPaths(new Set([row.path]));
      setLastClickedIndex(absoluteIndex);

      if (row.type === "dir") {
        toggleDir(row.path);
      } else if (row.type === "file") {
        handleFileClick(row.path);
      }
    },
    [isMac, lastClickedIndex, rows, toggleDir, handleFileClick],
  );

  // ---------------------------------------------------------------------------
  // Context menu open handler
  // ---------------------------------------------------------------------------

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, row?: TreeRow) => {
      e.preventDefault();
      e.stopPropagation();

      const triggerRect = rectFromEvent(e);

      // If multiple items are selected and the right-clicked item is one of them
      if (row && row.type !== "create" && selectedPaths.size > 1 && selectedPaths.has(row.path)) {
        setContextActivePath(null);
        openContextMenuAt({ kind: "multi", paths: [...selectedPaths] }, triggerRect);
        return;
      }

      if (!row || row.type === "create") {
        openContextMenuAt({ kind: "empty" }, triggerRect);
        return;
      }

      if (row.type === "dir") {
        setContextActivePath(row.path);
        openContextMenuAt({ kind: "dir", path: row.path }, triggerRect);
      } else {
        setContextActivePath(row.path);
        openContextMenuAt({ kind: "file", path: row.path }, triggerRect);
      }
    },
    [selectedPaths],
  );

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts for explorer container
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      // Cancel rename / create
      if (e.key === "Escape") {
        if (renamingPath) {
          cancelRename();
          e.stopPropagation();
          return;
        }
        if (creating) {
          cancelCreate();
          e.stopPropagation();
          return;
        }
        if (selectedPaths.size > 0) {
          setSelectedPaths(new Set());
          e.stopPropagation();
          return;
        }
        return;
      }

      // F2: rename single selected
      if (e.key === "F2") {
        if (selectedPaths.size === 1) {
          const [path] = selectedPaths;
          startRename(path);
          e.preventDefault();
        }
        return;
      }

      // Delete / Backspace: delete selected
      if ((e.key === "Delete" || e.key === "Backspace") && !renamingPath && !creating) {
        if (selectedPaths.size > 0) {
          requestDelete([...selectedPaths]);
          e.preventDefault();
        }
        return;
      }

      // Cmd+C: copy paths
      if (modKey && e.key === "c" && !renamingPath && !creating) {
        if (selectedPaths.size > 0) {
          handleCopyPaths([...selectedPaths]);
          e.preventDefault();
        }
        return;
      }

      // Cmd+A: select all visible items
      if (modKey && e.key === "a" && !renamingPath && !creating) {
        const all = rows
          .filter((r): r is DirRow | FileRow => r.type !== "create")
          .map((r) => r.path);
        setSelectedPaths(new Set(all));
        e.preventDefault();
        return;
      }
    },
    [
      isMac,
      renamingPath,
      creating,
      selectedPaths,
      cancelRename,
      cancelCreate,
      startRename,
      requestDelete,
      handleCopyPaths,
      rows,
    ],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!rootPath) return null;

  const deleteDialogInfo = deletePending ? deleteDialogContent(deletePending) : null;

  return (
    <div
      ref={explorerRef}
      className="file-explorer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* Header */}
      <div className="file-explorer-header">
        <span className="file-explorer-title">{t("explorer.title")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            className="file-explorer-collapse-btn"
            title={t("explorer.collapse")}
            aria-label={t("explorer.collapse")}
            onClick={() => setExplorerOpen(false)}
          >
            <PanelLeftClose size={14} />
          </button>
          <button
            type="button"
            className="file-explorer-collapse-btn"
            title={refreshing ? t("explorer.refreshing") : t("explorer.refresh")}
            aria-label={refreshing ? t("explorer.refreshing") : t("explorer.refresh")}
            onClick={() => void refreshVisibleDirs()}
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            type="button"
            className="file-explorer-collapse-btn"
            title={t("explorer.contextMenu.newFile")}
            onClick={() => startCreate("", "file")}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Search filter */}
      <div style={{ padding: "6px 8px" }}>
        <div className="file-explorer-search">
          <Search size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("explorer.filterPlaceholder")}
          />
          {filter && (
            <span
              style={{ fontSize: 10, color: "var(--text-3)" }}
              title={t("explorer.filterCountTitle")}
            >
              {t("explorer.filterCount", { count: filteredFileCount })}
            </span>
          )}
        </div>
      </div>

      {/* File tree */}
      <div
        ref={treeViewportRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="file-explorer-tree"
        onContextMenu={(e) => {
          // Only fire "empty" menu if clicking directly on the tree background
          if (e.currentTarget === e.target || (e.target as HTMLElement).closest(".file-explorer-row") === null) {
            handleContextMenu(e);
          }
        }}
      >
        {rootLoading && !dirContents.has("") ? (
          <div className="file-explorer-empty">
            <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
            {t("explorer.loading")}
          </div>
        ) : rows.length === 0 ? (
          <div className="file-explorer-empty">
            {filter ? t("explorer.emptyFiltered") : t("explorer.empty")}
          </div>
        ) : (
          <div style={{ height: virtualWindow.totalHeight, position: "relative" }}>
            {visibleRows.map((row, index) => {
              const absoluteIndex = virtualWindow.startIndex + index;
              const top = TREE_VERTICAL_PADDING + absoluteIndex * TREE_ROW_HEIGHT;

              // -- Inline create row --
              if (row.type === "create") {
                return (
                  <div
                    key={row.key}
                    className="file-explorer-inline-input"
                    style={{
                      position: "absolute",
                      top,
                      left: 0,
                      right: 0,
                      paddingLeft: 10 + row.depth * 16,
                    }}
                  >
                    {row.createType === "file" ? (
                      <File size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                    ) : (
                      <Folder size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                    )}
                    <input
                      ref={createInputRef}
                      type="text"
                      value={createValue}
                      placeholder={
                        row.createType === "file"
                          ? t("explorer.create.filePlaceholder")
                          : t("explorer.create.folderPlaceholder")
                      }
                      onChange={(e) => setCreateValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitCreate();
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          cancelCreate();
                        }
                      }}
                      onBlur={() => void commitCreate()}
                    />
                  </div>
                );
              }

              // -- Inline rename row --
              if (renamingPath === row.path) {
                return (
                  <div
                    key={row.key}
                    className="file-explorer-inline-input"
                    style={{
                      position: "absolute",
                      top,
                      left: 0,
                      right: 0,
                      paddingLeft: 10 + row.depth * 16,
                    }}
                  >
                    {row.type === "dir" ? (
                      row.expanded ? (
                        <FolderOpen size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      ) : (
                        <Folder size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      )
                    ) : (
                      <File
                        size={13}
                        style={{ color: getExtColor(row.name) ?? "var(--text-3)", flexShrink: 0 }}
                      />
                    )}
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      className={renameErrorMessage ? "error" : undefined}
                      title={renameErrorMessage ?? undefined}
                      onChange={(e) => {
                        setRenameValue(e.target.value);
                        setRenameErrorMessage(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename();
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          cancelRename();
                        }
                      }}
                      onBlur={() => void commitRename()}
                    />
                  </div>
                );
              }

              // -- Regular file / dir row --
              const isSelected = selectedPaths.has(row.path);
              const isContextActive = contextActivePath === row.path;
              const classNames = [
                "file-explorer-row",
                row.type === "dir" ? "file-explorer-row-dir" : "",
                isSelected ? "selected" : "",
                isContextActive ? "context-active" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={row.key}
                  onClick={(e) => handleRowClick(row, absoluteIndex, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleContextMenu(e, row);
                  }}
                  style={{
                    position: "absolute",
                    top,
                    left: 0,
                    right: 0,
                    height: TREE_ROW_HEIGHT,
                    paddingLeft: 10 + row.depth * 16,
                  }}
                  className={classNames}
                >
                  {row.type === "dir" ? (
                    <>
                      {loadingDirs.has(row.path) ? (
                        <Loader2
                          size={12}
                          className="animate-spin"
                          style={{ color: "var(--text-3)", flexShrink: 0 }}
                        />
                      ) : row.expanded ? (
                        <ChevronDown size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      ) : (
                        <ChevronRight
                          size={12}
                          style={{ color: "var(--text-3)", flexShrink: 0 }}
                        />
                      )}
                      {row.expanded ? (
                        <FolderOpen
                          size={13}
                          style={{ color: "var(--text-3)", flexShrink: 0 }}
                        />
                      ) : (
                        <Folder size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      )}
                      <span className="file-explorer-row-name">{row.name}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ width: 12, flexShrink: 0 }} />
                      <File
                        size={13}
                        style={{
                          color: getExtColor(row.name) ?? "var(--text-3)",
                          flexShrink: 0,
                        }}
                      />
                      <span className="file-explorer-row-name">{row.name}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Multi-select action bar */}
      {selectedPaths.size > 1 && (
        <div className="file-explorer-select-bar">
          <span className="select-count">
            {t("explorer.multiSelect.selected", { count: selectedPaths.size })}
          </span>
          <div className="select-actions">
            <button
              type="button"
              className="select-btn"
              onClick={() => handleCopyPaths([...selectedPaths])}
            >
              {t("explorer.multiSelect.copy")}
            </button>
            <button
              type="button"
              className="select-btn select-btn-danger"
              onClick={() => requestDelete([...selectedPaths])}
            >
              {t("explorer.multiSelect.delete")}
            </button>
          </div>
        </div>
      )}

      {/* Context menu portal */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="git-action-menu"
            style={{ position: "fixed", top: contextMenu.top, left: contextMenu.left, minWidth: 200 }}
          >
            {contextMenu.variant.kind === "file" && (
              <>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    handleFileClick(path);
                  }}
                >
                  {t("explorer.contextMenu.open")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    void handleOpenInDefaultApp(path);
                  }}
                >
                  {t("explorer.contextMenu.openInDefaultApp")}
                </button>
                <div className="git-action-menu-divider" />
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    handleCopyPath(path);
                  }}
                >
                  {t("explorer.contextMenu.copyPath")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    handleCopyRelativePath(path);
                  }}
                >
                  {t("explorer.contextMenu.copyRelativePath")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    handleReveal(path);
                  }}
                >
                  {t("explorer.contextMenu.revealInFinder")}
                </button>
                <div className="git-action-menu-divider" />
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    startRename(path);
                  }}
                >
                  {t("explorer.contextMenu.rename")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item git-action-menu-item-danger"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "file" }>;
                    closeContextMenu();
                    requestDelete([path]);
                  }}
                >
                  {t("explorer.contextMenu.delete")}
                </button>
              </>
            )}

            {contextMenu.variant.kind === "dir" && (
              <>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    startCreate(path, "file");
                  }}
                >
                  {t("explorer.contextMenu.newFile")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    startCreate(path, "dir");
                  }}
                >
                  {t("explorer.contextMenu.newFolder")}
                </button>
                <div className="git-action-menu-divider" />
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    handleCopyPath(path);
                  }}
                >
                  {t("explorer.contextMenu.copyPath")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    handleCopyRelativePath(path);
                  }}
                >
                  {t("explorer.contextMenu.copyRelativePath")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    handleReveal(path);
                  }}
                >
                  {t("explorer.contextMenu.revealInFinder")}
                </button>
                <div className="git-action-menu-divider" />
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    startRename(path);
                  }}
                >
                  {t("explorer.contextMenu.rename")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item git-action-menu-item-danger"
                  onClick={() => {
                    const { path } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "dir" }>;
                    closeContextMenu();
                    requestDelete([path]);
                  }}
                >
                  {t("explorer.contextMenu.delete")}
                </button>
              </>
            )}

            {contextMenu.variant.kind === "empty" && (
              <>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    closeContextMenu();
                    startCreate("", "file");
                  }}
                >
                  {t("explorer.contextMenu.newFile")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    closeContextMenu();
                    startCreate("", "dir");
                  }}
                >
                  {t("explorer.contextMenu.newFolder")}
                </button>
                <div className="git-action-menu-divider" />
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    closeContextMenu();
                    handleReveal(null);
                  }}
                >
                  {t("explorer.contextMenu.revealInFinder")}
                </button>
              </>
            )}

            {contextMenu.variant.kind === "multi" && (
              <>
                <div className="git-action-menu-section-label">
                  {t("explorer.contextMenu.itemsSelected", {
                    count: (contextMenu.variant as Extract<ContextMenuVariant, { kind: "multi" }>).paths.length,
                  })}
                </div>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { paths } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "multi" }>;
                    closeContextMenu();
                    handleCopyPaths(paths);
                  }}
                >
                  {t("explorer.contextMenu.copyPaths")}
                </button>
                <button
                  type="button"
                  className="git-action-menu-item"
                  onClick={() => {
                    const { paths } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "multi" }>;
                    closeContextMenu();
                    handleCopyRelativePaths(paths);
                  }}
                >
                  {t("explorer.contextMenu.copyRelativePaths")}
                </button>
                <div className="git-action-menu-divider" />
                <button
                  type="button"
                  className="git-action-menu-item git-action-menu-item-danger"
                  onClick={() => {
                    const { paths } = contextMenu.variant as Extract<ContextMenuVariant, { kind: "multi" }>;
                    closeContextMenu();
                    requestDelete(paths);
                  }}
                >
                  {t("explorer.contextMenu.deleteItems", {
                    count: (contextMenu.variant as Extract<ContextMenuVariant, { kind: "multi" }>).paths.length,
                  })}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* Delete confirmation dialog */}
      {deleteDialogInfo && (
        <ConfirmDialog
          open={!!deletePending}
          title={deleteDialogInfo.title}
          message={deleteDialogInfo.message}
          confirmLabel={deleteDialogInfo.confirmLabel}
          cancelLabel={t("explorer.delete.cancel")}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeletePending(null)}
        />
      )}
    </div>
  );
}
