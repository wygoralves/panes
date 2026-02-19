import { useMemo, useState } from "react";
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
          void selectFile(repo.path, row.file.path, staged);
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
              <p className="git-empty" style={{ padding: "12px 14px" }}>
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
        <div className="git-diff-viewer" style={{ maxHeight: 260 }}>
          <pre style={{ margin: 0, padding: "8px 0" }}>
            {diff.split("\n").map((line, idx) => {
              const isAdd =
                line.startsWith("+") && !line.startsWith("+++");
              const isDel =
                line.startsWith("-") && !line.startsWith("---");
              const lineClass = isAdd
                ? " git-diff-add"
                : isDel
                  ? " git-diff-del"
                  : "";
              return (
                <span key={idx} className={`git-diff-line${lineClass}`}>
                  <span className="git-diff-line-num">{idx + 1}</span>
                  <span className="git-diff-line-content">{line}</span>
                </span>
              );
            })}
          </pre>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {noChanges ? (
          <div className="git-empty">
            <Check
              size={24}
              style={{ opacity: 0.2, marginBottom: 8 }}
            />
            <p style={{ margin: 0 }}>Working tree clean</p>
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
