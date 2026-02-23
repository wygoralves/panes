import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Check,
  RotateCcw,
  Undo2,
  Loader2,
  Eye,
} from "lucide-react";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { ipc } from "../../lib/ipc";
import { parseDiff, LINE_CLASS } from "../../lib/parseDiff";
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

function buildDirectoryFileMap(files: GitFileStatus[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length <= 1) {
      continue;
    }

    let currentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}/${parts[index]}` : parts[index];
      const currentFiles = map.get(currentPath);
      if (currentFiles) {
        currentFiles.push(file.path);
      } else {
        map.set(currentPath, [file.path]);
      }
    }
  }

  return map;
}

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

export function DiffPanel({ diff }: { diff: string }) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);

  return (
    <div className="git-diff-viewer" style={{ flex: 1, minHeight: 0 }}>
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
    discardFiles,
    commit,
    refresh,
    drafts,
    setCommitMessageDraft,
    pushCommitHistory,
  } = useGitStore();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const openFile = useFileStore((s) => s.openFile);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);

  const handleOpenInEditor = useCallback(
    (filePath: string) => {
      void openFile(repo.path, filePath);
      if (activeWorkspaceId) {
        void setLayoutMode(activeWorkspaceId, "editor");
      }
    },
    [repo.path, openFile, activeWorkspaceId, setLayoutMode],
  );

  const commitMessage = drafts.commitMessage;
  const setCommitMessage = useCallback(
    (value: string) => {
      if (activeWorkspaceId) setCommitMessageDraft(activeWorkspaceId, value);
    },
    [activeWorkspaceId, setCommitMessageDraft],
  );
  const histCursorRef = useRef<number>(-1);
  const liveDraftRef = useRef<string>("");
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [sectionCollapsed, setSectionCollapsed] = useState<
    Record<ChangeSection, boolean>
  >({
    changes: false,
    staged: false,
  });
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>(
    {},
  );
  const [discardPrompt, setDiscardPrompt] = useState<{
    title: string;
    message: string;
    files: string[];
  } | null>(null);

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
  const unstagedDirectoryFiles = useMemo(
    () => buildDirectoryFileMap(unstagedFiles),
    [unstagedFiles],
  );
  const stagedDirectoryFiles = useMemo(
    () => buildDirectoryFileMap(stagedFiles),
    [stagedFiles],
  );

  const hasStagedFiles = stagedFiles.length > 0;
  const noChanges = unstagedFiles.length === 0 && !hasStagedFiles;

  async function onCommit() {
    if (!commitMessage.trim() || loadingKey !== null) return;
    const msg = commitMessage.trim();
    setLoadingKey("commit");
    try {
      onError(undefined);
      await commit(repo.path, msg);
      if (activeWorkspaceId) pushCommitHistory(activeWorkspaceId, msg);
      toast.success(`Committed: ${msg.split("\n")[0]}`);
      histCursorRef.current = -1;
      liveDraftRef.current = "";
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onStageAll() {
    if (unstagedFiles.length === 0 || loadingKey !== null) return;
    setLoadingKey("stage-all");
    try {
      onError(undefined);
      await ipc.stageFiles(
        repo.path,
        unstagedFiles.map((f) => f.path),
      );
      await refresh(repo.path);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onUnstageAll() {
    if (stagedFiles.length === 0 || loadingKey !== null) return;
    setLoadingKey("unstage-all");
    try {
      onError(undefined);
      await ipc.unstageFiles(
        repo.path,
        stagedFiles.map((f) => f.path),
      );
      await refresh(repo.path);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onToggleDirectoryStage(dirPath: string, staged: boolean) {
    const filesByDirectory = staged ? stagedDirectoryFiles : unstagedDirectoryFiles;
    const directoryFiles = filesByDirectory.get(dirPath) ?? [];
    if (directoryFiles.length === 0 || loadingKey !== null) {
      return;
    }

    setLoadingKey(`dir:${dirPath}`);
    try {
      onError(undefined);
      if (staged) {
        await ipc.unstageFiles(repo.path, directoryFiles);
      } else {
        await ipc.stageFiles(repo.path, directoryFiles);
      }
      await refresh(repo.path);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onStageFile(filePath: string) {
    if (loadingKey !== null) return;
    setLoadingKey(`file:${filePath}`);
    try {
      onError(undefined);
      await stage(repo.path, filePath);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onUnstageFile(filePath: string) {
    if (loadingKey !== null) return;
    setLoadingKey(`file:${filePath}`);
    try {
      onError(undefined);
      await unstage(repo.path, filePath);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  function onDiscardFile(filePath: string) {
    if (loadingKey !== null) return;
    const fileName = filePath.split("/").pop() ?? filePath;
    setDiscardPrompt({
      title: "Discard changes",
      message: `Discard all changes to "${fileName}"? This cannot be undone.`,
      files: [filePath],
    });
  }

  function onDiscardAll() {
    if (unstagedFiles.length === 0 || loadingKey !== null) return;
    setDiscardPrompt({
      title: "Discard all changes",
      message: `Discard all unstaged changes? ${unstagedFiles.length} file${unstagedFiles.length === 1 ? "" : "s"} will be reverted. This cannot be undone.`,
      files: unstagedFiles.map((f) => f.path),
    });
  }

  async function executeDiscard(files: string[]) {
    setDiscardPrompt(null);
    setLoadingKey("discard");
    try {
      onError(undefined);
      await discardFiles(repo.path, files);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
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
      const filesByDirectory = staged ? stagedDirectoryFiles : unstagedDirectoryFiles;
      const directoryFileCount = (filesByDirectory.get(row.path) ?? []).length;

      return (
        <div
          key={row.key}
          className="git-dir-row"
          style={{ paddingLeft: 12 + row.depth * 14 }}
        >
          <button
            type="button"
            className="git-dir-toggle"
            onClick={() => toggleDir(section, row.path)}
          >
            {row.collapsed ? (
              <ChevronRight size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
            <span>{row.name}</span>
          </button>
          <button
            type="button"
            className="git-stage-btn git-dir-stage-btn"
            onClick={(e) => {
              e.stopPropagation();
              void onToggleDirectoryStage(row.path, staged);
            }}
            disabled={directoryFileCount === 0 || loadingKey !== null}
            title={
              staged
                ? "Unstage all changes in this folder"
                : "Stage all changes in this folder"
            }
            style={{
              opacity: directoryFileCount === 0 || (loadingKey !== null && loadingKey !== `dir:${row.path}`) ? 0.35 : undefined,
              cursor: directoryFileCount === 0 || loadingKey !== null ? "default" : "pointer",
            }}
          >
            {loadingKey === `dir:${row.path}` ? (
              <Loader2 size={13} className="git-spin" />
            ) : staged ? (
              <Minus size={13} />
            ) : (
              <Plus size={13} />
            )}
          </button>
        </div>
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
        {!staged && (
          <button
            type="button"
            className="git-stage-btn git-discard-btn"
            onClick={(e) => {
              e.stopPropagation();
              void onDiscardFile(row.file.path);
            }}
            disabled={loadingKey !== null}
            title="Discard changes"
            style={{
              opacity: loadingKey !== null ? 0.35 : undefined,
            }}
          >
            <Undo2 size={13} />
          </button>
        )}
        <button
          type="button"
          className="git-stage-btn git-open-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenInEditor(row.file.path);
          }}
          title="Open in editor"
        >
          <Eye size={13} />
        </button>
        <span className={`git-status ${getStatusClass(fileStatus)}`}>
          {getStatusLabel(fileStatus)}
        </span>
        <button
          type="button"
          className="git-stage-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (staged) {
              void onUnstageFile(row.file.path);
            } else {
              void onStageFile(row.file.path);
            }
          }}
          disabled={loadingKey !== null}
          title={staged ? "Unstage" : "Stage"}
          style={{
            opacity: loadingKey !== null && loadingKey !== `file:${row.file.path}` ? 0.35 : undefined,
          }}
        >
          {loadingKey === `file:${row.file.path}` ? (
            <Loader2 size={13} className="git-spin" />
          ) : staged ? (
            <Minus size={13} />
          ) : (
            <Plus size={13} />
          )}
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
                disabled={files.length === 0 || loadingKey !== null}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  opacity: files.length === 0 || loadingKey !== null ? 0.4 : 1,
                }}
              >
                {loadingKey === "unstage-all" ? (
                  <Loader2 size={11} className="git-spin" />
                ) : (
                  <RotateCcw size={11} />
                )}
                {loadingKey === "unstage-all" ? "Unstaging..." : "Unstage all"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="git-toolbar-btn git-discard-btn"
                  onClick={() => void onDiscardAll()}
                  disabled={files.length === 0 || loadingKey !== null}
                  title="Discard all changes"
                  style={{
                    opacity: files.length === 0 || loadingKey !== null ? 0.35 : undefined,
                  }}
                >
                  {loadingKey === "discard" ? (
                    <Loader2 size={13} className="git-spin" />
                  ) : (
                    <Undo2 size={13} />
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void onStageAll()}
                  disabled={files.length === 0 || loadingKey !== null}
                  style={{
                    padding: "3px 8px",
                    fontSize: 11,
                    opacity: files.length === 0 || loadingKey !== null ? 0.4 : 1,
                  }}
                >
                  {loadingKey === "stage-all" ? (
                    <Loader2 size={11} className="git-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                  {loadingKey === "stage-all" ? "Staging..." : "Stage all"}
                </button>
              </>
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
      <div style={{ overflow: "auto", flexShrink: 0, maxHeight: "50%" }}>
        {noChanges ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <Check size={20} />
            </div>
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

      {selectedFile && diff && showDiff && (
        <DiffPanel diff={diff} />
      )}

      <ConfirmDialog
        open={discardPrompt !== null}
        title={discardPrompt?.title ?? ""}
        message={discardPrompt?.message ?? ""}
        confirmLabel="Discard"
        onConfirm={() => {
          if (discardPrompt) void executeDiscard(discardPrompt.files);
        }}
        onCancel={() => setDiscardPrompt(null)}
      />

      {hasStagedFiles && (
        <div className="git-commit-area">
          <textarea
            rows={2}
            value={commitMessage}
            onChange={(e) => {
              setCommitMessage(e.target.value);
              histCursorRef.current = -1;
            }}
            placeholder="Commit message..."
            className="git-commit-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void onCommit();
                return;
              }
              const ta = e.currentTarget;
              const history = drafts.commitHistory;
              if (e.key === "ArrowUp" && history.length > 0) {
                const onFirstLine = ta.value.lastIndexOf("\n", ta.selectionStart - 1) === -1;
                if (!onFirstLine && histCursorRef.current === -1) return;
                e.preventDefault();
                if (histCursorRef.current === -1) {
                  liveDraftRef.current = commitMessage;
                }
                const next = Math.min(histCursorRef.current + 1, history.length - 1);
                histCursorRef.current = next;
                setCommitMessage(history[next]);
                return;
              }
              if (e.key === "ArrowDown" && histCursorRef.current >= 0) {
                const onLastLine = ta.value.indexOf("\n", ta.selectionStart) === -1;
                if (!onLastLine) return;
                e.preventDefault();
                const next = histCursorRef.current - 1;
                histCursorRef.current = next;
                setCommitMessage(next === -1 ? liveDraftRef.current : history[next]);
              }
            }}
          />
          <button
            type="button"
            onClick={() => void onCommit()}
            disabled={!commitMessage.trim() || loadingKey !== null}
            className="btn btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "7px 12px",
              opacity: commitMessage.trim() && loadingKey === null ? 1 : 0.4,
              cursor: commitMessage.trim() && loadingKey === null ? "pointer" : "default",
            }}
          >
            {loadingKey === "commit" ? (
              <Loader2 size={13} className="git-spin" />
            ) : (
              <Check size={13} />
            )}
            {loadingKey === "commit" ? "Committing..." : "Commit"}
          </button>
        </div>
      )}
    </>
  );
}
