import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  PanelLeftClose,
  Search,
  Loader2,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import type { FileTreeEntry } from "../../types";

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

type TreeRow = DirRow | FileRow;

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

export function FileExplorer() {
  const { t } = useTranslation("app");
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === activeWorkspaceId),
  );
  const rootPath = activeWorkspace?.rootPath ?? "";

  const [dirContents, setDirContents] = useState<Map<string, FileTreeEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const openFile = useFileStore((s) => s.openFile);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);
  const toggleExplorer = useUiStore((s) => s.toggleExplorer);

  const prevRootPath = useRef(rootPath);
  const dirContentsRef = useRef(dirContents);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  dirContentsRef.current = dirContents;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (!rootPath) return;
      const isRoot = dirPath === "";
      if (isRoot) setRootLoading(true);
      else setLoadingDirs((prev) => new Set(prev).add(dirPath));

      try {
        const entries = await ipc.listDir(rootPath, dirPath);
        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirPath, entries);
          return next;
        });
      } catch (err) {
        console.warn(`[FileExplorer] failed to list directory "${dirPath}":`, err);
      } finally {
        if (isRoot) setRootLoading(false);
        else setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [rootPath],
  );

  useEffect(() => {
    if (!rootPath) return;
    if (prevRootPath.current !== rootPath) {
      setDirContents(new Map());
      setExpandedDirs(new Set());
      setLoadingDirs(new Set());
      setFilter("");
      prevRootPath.current = rootPath;
    }
    void loadDir("");
  }, [loadDir, rootPath]);

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

  const rows = useMemo(() => {
    const result: TreeRow[] = [];
    const lowerFilter = filter.toLowerCase();

    function visitDir(dirPath: string, depth: number) {
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
  }, [dirContents, expandedDirs, filter]);

  const filteredFileCount = useMemo(
    () => rows.reduce((count, row) => count + (row.type === "file" ? 1 : 0), 0),
    [rows],
  );

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

  if (!rootPath) return null;

  return (
    <div className="file-explorer">
      {/* Header */}
      <div className="file-explorer-header">
        <span className="file-explorer-title">{t("explorer.title")}</span>
        <button
          type="button"
          className="file-explorer-collapse-btn"
          title={t("explorer.collapse")}
          onClick={toggleExplorer}
        >
          <PanelLeftClose size={14} />
        </button>
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
          <div
            style={{
              height: virtualWindow.totalHeight,
              position: "relative",
            }}
          >
            {visibleRows.map((row, index) => {
              const absoluteIndex = virtualWindow.startIndex + index;
              return (
                <div
                  key={row.key}
                  onClick={() =>
                    row.type === "dir"
                      ? toggleDir(row.path)
                      : handleFileClick(row.path)
                  }
                  style={{
                    position: "absolute",
                    top: TREE_VERTICAL_PADDING + absoluteIndex * TREE_ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: TREE_ROW_HEIGHT,
                    paddingLeft: 10 + row.depth * 16,
                  }}
                  className={`file-explorer-row ${row.type === "dir" ? "file-explorer-row-dir" : ""}`}
                >
                  {row.type === "dir" ? (
                    <>
                      {loadingDirs.has(row.path) ? (
                        <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      ) : row.expanded ? (
                        <ChevronDown size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      ) : (
                        <ChevronRight size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      )}
                      {row.expanded ? (
                        <FolderOpen size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      ) : (
                        <Folder size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      )}
                      <span className="file-explorer-row-name">
                        {row.name}
                      </span>
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
                      <span className="file-explorer-row-name">
                        {row.name}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
