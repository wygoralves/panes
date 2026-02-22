import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Search,
  Loader2,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Repo, FileTreeEntry } from "../../types";

interface Props {
  repo: Repo;
}

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

export function GitFilesView({ repo }: Props) {
  // Map from dirPath -> children entries ("" = root)
  const [dirContents, setDirContents] = useState<Map<string, FileTreeEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const openFile = useFileStore((s) => s.openFile);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);

  // Track repo path to reset on change
  const prevRepoPath = useRef(repo.path);
  const dirContentsRef = useRef(dirContents);
  dirContentsRef.current = dirContents;

  const loadDir = useCallback(
    async (dirPath: string) => {
      const isRoot = dirPath === "";
      if (isRoot) setRootLoading(true);
      else setLoadingDirs((prev) => new Set(prev).add(dirPath));

      try {
        const entries = await ipc.listDir(repo.path, dirPath);
        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirPath, entries);
          return next;
        });
      } catch (err) {
        console.warn(`[GitFilesView] failed to list directory "${dirPath}":`, err);
      } finally {
        if (isRoot) setRootLoading(false);
        else setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [repo.path],
  );

  // Load root on mount or repo change
  useEffect(() => {
    if (prevRepoPath.current !== repo.path) {
      setDirContents(new Map());
      setExpandedDirs(new Set());
      setLoadingDirs(new Set());
      setFilter("");
      prevRepoPath.current = repo.path;
    }
    void loadDir("");
  }, [loadDir, repo.path]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          // Load children if not already loaded
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
      void openFile(repo.path, filePath);
      if (activeWorkspaceId) {
        void setLayoutMode(activeWorkspaceId, "editor");
      }
    },
    [repo.path, openFile, activeWorkspaceId, setLayoutMode],
  );

  // Build flat row list from loaded data
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

          // When filtering, skip dirs that don't match and have no matching descendants
          // But we can't know descendants without loading, so show all dirs when filtering
          if (lowerFilter && !name.toLowerCase().includes(lowerFilter)) {
            // Still show if expanded and has loaded children
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Search filter */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--bg-1)",
            borderRadius: "var(--radius-sm)",
            padding: "5px 8px",
            border: "1px solid var(--border)",
          }}
        >
          <Search size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 12,
              color: "var(--text-1)",
              fontFamily: '"JetBrains Mono", monospace',
            }}
          />
          {filter && (
            <span style={{ fontSize: 10, color: "var(--text-3)" }} title="Only expanded folders are searched">
              {rows.filter((r) => r.type === "file").length} files
            </span>
          )}
        </div>
      </div>

      {/* File tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {rootLoading && !dirContents.has("") ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
            Loading files...
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            {filter ? "No files match filter" : "No files found"}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.key}
              onClick={() =>
                row.type === "dir"
                  ? toggleDir(row.path)
                  : handleFileClick(row.path)
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 10px",
                paddingLeft: 10 + row.depth * 16,
                cursor: "pointer",
                fontSize: 12,
                color: row.type === "dir" ? "var(--text-2)" : "var(--text-1)",
                fontFamily: '"JetBrains Mono", monospace',
              }}
              className="git-file-row"
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
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.name}
                  </span>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
