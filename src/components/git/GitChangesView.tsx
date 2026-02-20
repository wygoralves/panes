import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Check,
  RotateCcw,
} from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { ipc } from "../../lib/ipc";
import type { Repo, GitFileStatus } from "../../types";

interface Props {
  repo: Repo;
  showDiff: boolean;
  onError: (error: string | undefined) => void;
}

type ChangeSection = "changes" | "staged";

interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: GitFileStatus[];
}

interface DirectoryRow {
  type: "dir";
  key: string;
  name: string;
  path: string;
  depth: number;
  collapsed: boolean;
}

interface FileRow {
  type: "file";
  key: string;
  file: GitFileStatus;
  name: string;
  path: string;
  depth: number;
}

type TreeRow = DirectoryRow | FileRow;

function buildTreeRows(
  files: GitFileStatus[],
  section: ChangeSection,
  collapsedDirs: Record<string, boolean>,
): TreeRow[] {
  const root: TreeNode = { name: "", path: "", dirs: new Map(), files: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const segPath = current.path ? `${current.path}/${seg}` : seg;
      let next = current.dirs.get(seg);
      if (!next) {
        next = { name: seg, path: segPath, dirs: new Map(), files: [] };
        current.dirs.set(seg, next);
      }
      current = next;
    }
    current.files.push(file);
  }

  const rows: TreeRow[] = [];

  function visit(node: TreeNode, depth: number) {
    const sortedDirs = Array.from(node.dirs.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const sortedFiles = [...node.files].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    for (const dir of sortedDirs) {
      const collapseKey = `${section}:${dir.path}`;
      const collapsed = Boolean(collapsedDirs[collapseKey]);
      rows.push({
        type: "dir",
        key: collapseKey,
        name: dir.name,
        path: dir.path,
        depth,
        collapsed,
      });
      if (!collapsed) visit(dir, depth + 1);
    }

    for (const file of sortedFiles) {
      rows.push({
        type: "file",
        key: `${section}:file:${file.path}`,
        file,
        name: file.path.split("/").pop() ?? file.path,
        path: file.path,
        depth,
      });
    }
  }

  visit(root, 0);
  return rows;
}

function getStatusLabel(status?: string): string {
  if (!status) return "";
  if (status === "added" || status === "untracked") return "A";
  if (status === "deleted") return "D";
  if (status === "modified") return "M";
  if (status === "renamed") return "R";
  if (status === "conflicted") return "C";
  return status[0]?.toUpperCase() ?? "?";
}

function getStatusClass(status?: string): string {
  if (!status) return "";
  if (status === "added" || status === "untracked") return "git-status-added";
  if (status === "deleted") return "git-status-deleted";
  if (status === "modified") return "git-status-modified";
  if (status === "renamed") return "git-status-renamed";
  if (status === "conflicted") return "git-status-conflicted";
  return "git-status-untracked";
}

interface ParsedLine {
  type: "add" | "del" | "context" | "hunk";
  content: string;
  gutter: string;
  lineNum: string;
}

function parseDiff(raw: string): ParsedLine[] {
  const lines = raw.split("\n");
  const result: ParsedLine[] = [];
  let newLine = 0;

  for (const line of lines) {
    // Skip noise: diff --git, index, --- a/, +++ b/, etc.
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity") ||
      line.startsWith("rename") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      newLine = match ? parseInt(match[1], 10) : 0;
      // Show just the function/context hint if present
      const hunkLabel = line.replace(/^@@[^@]*@@\s?/, "").trim();
      result.push({ type: "hunk", content: hunkLabel, gutter: "", lineNum: "" });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1), gutter: "+", lineNum: String(newLine) });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({ type: "del", content: line.slice(1), gutter: "-", lineNum: "" });
    } else {
      result.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line, gutter: "", lineNum: String(newLine || "") });
      if (newLine) newLine++;
    }
  }
  return result;
}

const LINE_CLASS: Record<string, string> = {
  add: "git-diff-add",
  del: "git-diff-del",
  hunk: "git-diff-hunk",
  context: "",
};

const MIN_DIFF_HEIGHT = 80;
const DEFAULT_DIFF_HEIGHT = 220;
const MAX_DIFF_RATIO = 0.55;

function DiffPanel({ diff }: { diff: string }) {
  const [height, setHeight] = useState(DEFAULT_DIFF_HEIGHT);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const parsed = useMemo(() => parseDiff(diff), [diff]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const maxH = window.innerHeight * MAX_DIFF_RATIO;
        const next = Math.min(maxH, Math.max(MIN_DIFF_HEIGHT, startH.current + (ev.clientY - startY.current)));
        setHeight(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height],
  );

  return (
    <div className="git-diff-viewer" style={{ height }}>
      <div className="git-diff-scroll">
        <pre style={{ margin: 0, padding: "4px 0" }}>
          {parsed.map((line, idx) => (
            <span key={idx} className={`git-diff-line ${LINE_CLASS[line.type]}`}>
              <span className="git-diff-gutter">{line.gutter}</span>
              <span className="git-diff-line-num">{line.lineNum}</span>
              <span className="git-diff-line-content">{line.content}</span>
            </span>
          ))}
        </pre>
      </div>
      <div
        className={`git-diff-resize-handle${dragging.current ? " git-diff-resize-handle-active" : ""}`}
        onMouseDown={onResizeStart}
      />
    </div>
  );
}

export function GitChangesView({ repo, showDiff, onError }: Props) {
  const {
    status,
    diff,
    selectedFile,
    selectedFileStaged,
    selectFile,
    stage,
    unstage,
    commit,
    refresh,
  } = useGitStore();

  const [commitMessage, setCommitMessage] = useState("");
  const [sectionCollapsed, setSectionCollapsed] = useState<
    Record<ChangeSection, boolean>
  >({
    changes: false,
    staged: false,
  });
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>(
    {},
  );

  const unstagedFiles = useMemo(
    () => status?.files.filter((f) => Boolean(f.worktreeStatus)) ?? [],
    [status],
  );
  const stagedFiles = useMemo(
    () => status?.files.filter((f) => Boolean(f.indexStatus)) ?? [],
    [status],
  );
  const unstagedRows = useMemo(
    () => buildTreeRows(unstagedFiles, "changes", collapsedDirs),
    [unstagedFiles, collapsedDirs],
  );
  const stagedRows = useMemo(
    () => buildTreeRows(stagedFiles, "staged", collapsedDirs),
    [stagedFiles, collapsedDirs],
  );

  const hasStagedFiles = stagedFiles.length > 0;
  const noChanges = unstagedFiles.length === 0 && !hasStagedFiles;

  async function onCommit() {
    if (!commitMessage.trim()) return;
    try {
      onError(undefined);
      await commit(repo.path, commitMessage.trim());
      setCommitMessage("");
    } catch (e) {
      onError(String(e));
    }
  }

  async function onStageAll() {
    if (unstagedFiles.length === 0) return;
    try {
      onError(undefined);
      await ipc.stageFiles(
        repo.path,
        unstagedFiles.map((f) => f.path),
      );
      await refresh(repo.path);
    } catch (e) {
      onError(String(e));
    }
  }

  async function onUnstageAll() {
    if (stagedFiles.length === 0) return;
    try {
      onError(undefined);
      await ipc.unstageFiles(
        repo.path,
        stagedFiles.map((f) => f.path),
      );
      await refresh(repo.path);
    } catch (e) {
      onError(String(e));
    }
  }

  function toggleSection(section: ChangeSection) {
    setSectionCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  function toggleDir(section: ChangeSection, dirPath: string) {
    const key = `${section}:${dirPath}`;
    setCollapsedDirs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function renderFileRow(
    row: TreeRow,
    section: ChangeSection,
    staged: boolean,
  ) {
    if (row.type === "dir") {
      return (
        <button
          key={row.key}
          type="button"
          className="git-dir-row"
          onClick={() => toggleDir(section, row.path)}
          style={{ paddingLeft: 12 + row.depth * 14 }}
        >
          {row.collapsed ? (
            <ChevronRight size={12} />
          ) : (
            <ChevronDown size={12} />
          )}
          <span>{row.name}</span>
        </button>
      );
    }

    const fileStatus = staged ? row.file.indexStatus : row.file.worktreeStatus;
    const isSelected =
      row.file.path === selectedFile &&
      Boolean(selectedFileStaged) === staged;

    return (
      <div
        key={row.key}
        className={`git-file-row${isSelected ? " git-file-row-selected" : ""}`}
        style={{ paddingLeft: 22 + row.depth * 14 }}
        onClick={() => {
          onError(undefined);
          if (isSelected) {
            useGitStore.setState({ selectedFile: undefined, selectedFileStaged: undefined, diff: undefined });
          } else {
            void selectFile(repo.path, row.file.path, staged);
          }
        }}
      >
        <span className="git-file-name" title={row.path}>
          {row.name}
        </span>
        <span className={`git-status ${getStatusClass(fileStatus)}`}>
          {getStatusLabel(fileStatus)}
        </span>
        <button
          type="button"
          className="git-stage-btn"
          onClick={(e) => {
            e.stopPropagation();
            onError(undefined);
            if (staged) {
              void unstage(repo.path, row.file.path);
            } else {
              void stage(repo.path, row.file.path);
            }
          }}
          title={staged ? "Unstage" : "Stage"}
        >
          {staged ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      </div>
    );
  }

  function renderSection(
    section: ChangeSection,
    title: string,
    rows: TreeRow[],
    files: GitFileStatus[],
    staged: boolean,
  ) {
    const isCollapsed = sectionCollapsed[section];

    return (
      <section key={section} className="git-section">
        <div
          className="git-section-header"
          onClick={() => toggleSection(section)}
        >
          {isCollapsed ? (
            <ChevronRight size={12} />
          ) : (
            <ChevronDown size={12} />
          )}
          <span>{title}</span>
          <span className="git-section-count">{files.length}</span>
          <div
            className="git-section-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {staged ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onUnstageAll()}
                disabled={files.length === 0}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  opacity: files.length === 0 ? 0.4 : 1,
                }}
              >
                <RotateCcw size={11} />
                Unstage all
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onStageAll()}
                disabled={files.length === 0}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  opacity: files.length === 0 ? 0.4 : 1,
                }}
              >
                <Plus size={11} />
                Stage all
              </button>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div>
            {rows.length === 0 ? (
              <p className="git-empty-inline">
                {staged ? "No staged changes" : "Working tree clean"}
              </p>
            ) : (
              rows.map((row) => renderFileRow(row, section, staged))
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      {selectedFile && diff && showDiff && (
        <DiffPanel diff={diff} />
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {noChanges ? (
          <div className="git-empty">
            <Check size={28} className="git-empty-icon" />
            <p className="git-empty-title">Working tree clean</p>
            <p className="git-empty-sub">No uncommitted changes</p>
          </div>
        ) : (
          <>
            {unstagedFiles.length > 0 &&
              renderSection(
                "changes",
                "Changes",
                unstagedRows,
                unstagedFiles,
                false,
              )}
            {hasStagedFiles &&
              renderSection(
                "staged",
                "Staged",
                stagedRows,
                stagedFiles,
                true,
              )}
          </>
        )}
      </div>

      {hasStagedFiles && (
        <div className="git-commit-area">
          <textarea
            rows={2}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            className="git-commit-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void onCommit();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void onCommit()}
            disabled={!commitMessage.trim()}
            className="btn btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "7px 12px",
              opacity: commitMessage.trim() ? 1 : 0.4,
              cursor: commitMessage.trim() ? "pointer" : "default",
            }}
          >
            <Check size={13} />
            Commit
          </button>
        </div>
      )}
    </>
  );
}
