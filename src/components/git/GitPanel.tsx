import { useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  FileCode2,
  RefreshCw,
  Check,
  RotateCcw,
  MoreHorizontal,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore, type GitPanelView } from "../../stores/gitStore";
import { ipc, listenGitRepoChanged } from "../../lib/ipc";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { Dropdown } from "../shared/Dropdown";
import type { GitBranchScope, GitFileStatus } from "../../types";

const statusColors: Record<string, string> = {
  added: "var(--success)",
  modified: "var(--warning)",
  deleted: "var(--danger)",
  renamed: "var(--info)",
  untracked: "var(--text-2)",
  conflicted: "var(--danger)",
};

const statusDotColors: Record<string, string> = {
  added: "#34d399",
  modified: "#fbbf24",
  deleted: "#f87171",
  renamed: "#60a5fa",
  untracked: "#737373",
  conflicted: "#f87171",
};

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

type ChangeSection = "changes" | "staged";

const VIEW_OPTIONS: Array<{ value: GitPanelView; label: string }> = [
  { value: "changes", label: "Changes" },
  { value: "branches", label: "Branches" },
  { value: "commits", label: "Commits" },
  { value: "stash", label: "Stash" },
];

function createNode(name: string, path: string): TreeNode {
  return {
    name,
    path,
    dirs: new Map(),
    files: [],
  };
}

function buildTreeRows(
  files: GitFileStatus[],
  section: ChangeSection,
  collapsedDirectories: Record<string, boolean>,
): TreeRow[] {
  const root = createNode("", "");

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let current = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i];
      const segmentPath = current.path ? `${current.path}/${segment}` : segment;
      const existing = current.dirs.get(segment);
      if (existing) {
        current = existing;
        continue;
      }

      const next = createNode(segment, segmentPath);
      current.dirs.set(segment, next);
      current = next;
    }

    current.files.push(file);
  }

  const rows: TreeRow[] = [];

  function visit(node: TreeNode, depth: number) {
    const sortedDirs = Array.from(node.dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
    const sortedFiles = [...node.files].sort((a, b) => a.path.localeCompare(b.path));

    for (const dir of sortedDirs) {
      const collapseKey = `${section}:${dir.path}`;
      const collapsed = Boolean(collapsedDirectories[collapseKey]);
      rows.push({
        type: "dir",
        key: collapseKey,
        name: dir.name,
        path: dir.path,
        depth,
        collapsed,
      });

      if (!collapsed) {
        visit(dir, depth + 1);
      }
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
  if (!status) {
    return "";
  }

  if (status === "added" || status === "untracked") {
    return "+new";
  }
  if (status === "deleted") {
    return "-del";
  }
  if (status === "modified") {
    return "mod";
  }
  if (status === "renamed") {
    return "ren";
  }
  if (status === "conflicted") {
    return "conf";
  }

  return status.slice(0, 3);
}

function formatDate(raw?: string): string {
  if (!raw) {
    return "";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function GitPanel() {
  const { repos, activeRepoId } = useWorkspaceStore();
  const {
    status,
    diff,
    selectedFile,
    selectedFileStaged,
    refresh,
    selectFile,
    stage,
    unstage,
    commit,
    error,
    loading,
    activeView,
    setActiveView,
    branchScope,
    setBranchScope,
    branches,
    loadBranches,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    commits,
    commitsHasMore,
    commitsTotal,
    loadCommits,
    loadMoreCommits,
    stashes,
    loadStashes,
    applyStash,
    popStash,
  } = useGitStore();

  const [commitMessage, setCommitMessage] = useState("");
  const [showDiff, setShowDiff] = useState(true);
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<ChangeSection, boolean>>({
    changes: false,
    staged: false,
  });
  const [collapsedDirectories, setCollapsedDirectories] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === activeRepoId) ?? repos[0],
    [repos, activeRepoId],
  );
  const activeRepoPath = activeRepo?.path ?? null;

  const unstagedFiles = useMemo(
    () => status?.files.filter((file) => Boolean(file.worktreeStatus)) ?? [],
    [status],
  );

  const stagedFiles = useMemo(
    () => status?.files.filter((file) => Boolean(file.indexStatus)) ?? [],
    [status],
  );

  const unstagedRows = useMemo(
    () => buildTreeRows(unstagedFiles, "changes", collapsedDirectories),
    [unstagedFiles, collapsedDirectories],
  );

  const stagedRows = useMemo(
    () => buildTreeRows(stagedFiles, "staged", collapsedDirectories),
    [stagedFiles, collapsedDirectories],
  );

  const effectiveError = localError ?? error;

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }
    void refresh(activeRepoPath);
  }, [activeRepoPath, refresh]);

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }

    if (activeView === "branches") {
      void loadBranches(activeRepoPath, branchScope);
      return;
    }

    if (activeView === "commits") {
      void loadCommits(activeRepoPath, false);
      return;
    }

    if (activeView === "stash") {
      void loadStashes(activeRepoPath);
    }
  }, [activeRepoPath, activeView, branchScope, loadBranches, loadCommits, loadStashes]);

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;
    const repoPath = activeRepoPath;

    const attach = async () => {
      try {
        await ipc.watchGitRepo(repoPath);
      } catch {
        return;
      }

      const stop = await listenGitRepoChanged((event) => {
        if (event.repoPath !== repoPath) {
          return;
        }
        void refresh(repoPath);
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
      if (unlisten) {
        unlisten();
      }
    };
  }, [activeRepoPath, refresh]);

  async function onCommit() {
    if (!activeRepo || !commitMessage.trim()) {
      return;
    }

    try {
      setLocalError(undefined);
      await commit(activeRepo.path, commitMessage.trim());
      setCommitMessage("");
    } catch (commitError) {
      setLocalError(String(commitError));
    }
  }

  async function onStageAll() {
    if (!activeRepo || unstagedFiles.length === 0) {
      return;
    }

    try {
      setLocalError(undefined);
      await ipc.stageFiles(activeRepo.path, unstagedFiles.map((file) => file.path));
      await refresh(activeRepo.path);
    } catch (stageError) {
      setLocalError(String(stageError));
    }
  }

  async function onUnstageAll() {
    if (!activeRepo || stagedFiles.length === 0) {
      return;
    }

    try {
      setLocalError(undefined);
      await ipc.unstageFiles(activeRepo.path, stagedFiles.map((file) => file.path));
      await refresh(activeRepo.path);
    } catch (unstageError) {
      setLocalError(String(unstageError));
    }
  }

  async function onCheckoutBranch(branchName: string, isRemote: boolean) {
    if (!activeRepo) {
      return;
    }

    try {
      setLocalError(undefined);
      await checkoutBranch(activeRepo.path, branchName, isRemote);
    } catch (checkoutError) {
      setLocalError(String(checkoutError));
    }
  }

  async function onCreateBranch() {
    if (!activeRepo) {
      return;
    }

    const rawName = window.prompt("Branch name");
    const branchName = rawName?.trim();
    if (!branchName) {
      return;
    }

    const fromRefInput = window.prompt("Create from ref (optional)", "");
    const fromRef = fromRefInput?.trim() ?? "";

    try {
      setLocalError(undefined);
      await createBranch(activeRepo.path, branchName, fromRef || null);
    } catch (createError) {
      setLocalError(String(createError));
    }
  }

  async function onRenameBranch(oldName: string) {
    if (!activeRepo) {
      return;
    }

    const nextNameInput = window.prompt(`Rename branch \"${oldName}\" to`, oldName);
    const nextName = nextNameInput?.trim();
    if (!nextName || nextName === oldName) {
      return;
    }

    try {
      setLocalError(undefined);
      await renameBranch(activeRepo.path, oldName, nextName);
    } catch (renameError) {
      setLocalError(String(renameError));
    }
  }

  async function onDeleteBranch(branchName: string) {
    if (!activeRepo) {
      return;
    }

    const confirmed = window.confirm(`Delete branch \"${branchName}\"?`);
    if (!confirmed) {
      return;
    }

    try {
      setLocalError(undefined);
      await deleteBranch(activeRepo.path, branchName, false);
    } catch (deleteError) {
      const wantsForce = window.confirm(
        `Safe delete failed for \"${branchName}\". Force delete this branch?`,
      );
      if (!wantsForce) {
        setLocalError(String(deleteError));
        return;
      }

      try {
        await deleteBranch(activeRepo.path, branchName, true);
      } catch (forceDeleteError) {
        setLocalError(String(forceDeleteError));
      }
    }
  }

  async function onApplyStash(index: number) {
    if (!activeRepo) {
      return;
    }

    const confirmed = window.confirm(`Apply stash@{${index}}?`);
    if (!confirmed) {
      return;
    }

    try {
      setLocalError(undefined);
      await applyStash(activeRepo.path, index);
    } catch (applyError) {
      setLocalError(String(applyError));
    }
  }

  async function onPopStash(index: number) {
    if (!activeRepo) {
      return;
    }

    const confirmed = window.confirm(`Pop stash@{${index}}? This will remove it from the stash list.`);
    if (!confirmed) {
      return;
    }

    try {
      setLocalError(undefined);
      await popStash(activeRepo.path, index);
    } catch (popError) {
      setLocalError(String(popError));
    }
  }

  function toggleSection(section: ChangeSection) {
    setSectionCollapsed((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  }

  function toggleDirectory(section: ChangeSection, directoryPath: string) {
    const key = `${section}:${directoryPath}`;
    setCollapsedDirectories((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  }

  function renderFileSection(
    section: ChangeSection,
    title: string,
    rows: TreeRow[],
    files: GitFileStatus[],
    staged: boolean,
  ) {
    const isCollapsed = sectionCollapsed[section];

    return (
      <section key={section} style={{ borderBottom: "1px solid var(--border)" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "var(--bg-2)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={() => toggleSection(section)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--text-1)",
              cursor: "pointer",
            }}
            title={isCollapsed ? "Expand section" : "Collapse section"}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{title}</span>
            <span style={{ color: "var(--text-3)" }}>{files.length}</span>
          </button>

          <div style={{ flex: 1 }} />

          {staged ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void onUnstageAll()}
              disabled={!activeRepo || files.length === 0}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                opacity: !activeRepo || files.length === 0 ? 0.4 : 1,
              }}
            >
              <RotateCcw size={11} />
              Unstage all
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void onStageAll()}
              disabled={!activeRepo || files.length === 0}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                opacity: !activeRepo || files.length === 0 ? 0.4 : 1,
              }}
            >
              <Plus size={11} />
              Stage all
            </button>
          )}
        </header>

        {!isCollapsed && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  fontSize: 12,
                  color: "var(--text-3)",
                }}
              >
                {staged ? "No staged changes" : "No changes"}
              </p>
            ) : (
              rows.map((row) => {
                if (row.type === "dir") {
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => toggleDirectory(section, row.path)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        padding: "5px 12px",
                        paddingLeft: 12 + row.depth * 14,
                        fontSize: 12,
                        color: "var(--text-2)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span>{row.name}</span>
                    </button>
                  );
                }

                const status = staged ? row.file.indexStatus : row.file.worktreeStatus;
                const statusLabel = getStatusLabel(status);
                const isSelected =
                  row.file.path === selectedFile && Boolean(selectedFileStaged) === staged;

                return (
                  <div
                    key={row.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 12px",
                      paddingLeft: 30 + row.depth * 14,
                      background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
                      borderLeft: isSelected
                        ? "2px solid var(--text-1)"
                        : "2px solid transparent",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      if (!activeRepo) {
                        return;
                      }
                      setLocalError(undefined);
                      void selectFile(activeRepo.path, row.file.path, staged);
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        color: "var(--text-2)",
                      }}
                      title={row.path}
                    >
                      {row.name}
                    </span>

                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: statusColors[status ?? ""] ?? "var(--text-3)",
                        flexShrink: 0,
                      }}
                    >
                      {statusLabel}
                    </span>

                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: statusDotColors[status ?? ""] ?? "#555555",
                        flexShrink: 0,
                      }}
                    />

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!activeRepo) {
                          return;
                        }
                        setLocalError(undefined);
                        if (staged) {
                          void unstage(activeRepo.path, row.file.path);
                        } else {
                          void stage(activeRepo.path, row.file.path);
                        }
                      }}
                      style={{
                        padding: 3,
                        borderRadius: 3,
                        display: "inline-flex",
                        color: "var(--text-3)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      title={staged ? "Unstage" : "Stage"}
                    >
                      {staged ? <Minus size={12} /> : <Plus size={12} />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    );
  }

  function renderChangesView() {
    return (
      <>
        {selectedFile && diff && showDiff && (
          <div
            style={{
              borderBottom: "1px solid var(--border)",
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            <pre
              style={{
                margin: 0,
                padding: "8px 0",
                fontSize: 11,
                lineHeight: 1.5,
                fontFamily: '"JetBrains Mono", monospace',
                whiteSpace: "pre-wrap",
                background: "var(--code-bg)",
                color: "var(--text-2)",
              }}
            >
              {diff.split("\n").map((line, index) => {
                const isAdd = line.startsWith("+") && !line.startsWith("+++");
                const isDel = line.startsWith("-") && !line.startsWith("---");
                return (
                  <span
                    key={`${line}-${index}`}
                    style={{
                      display: "flex",
                      ...(isAdd
                        ? { color: "#aff5b4", background: "rgba(46,160,67,0.06)" }
                        : isDel
                          ? { color: "#ffdcd7", background: "rgba(248,81,73,0.06)" }
                          : {}),
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        textAlign: "right",
                        paddingRight: 10,
                        color: "var(--text-3)",
                        userSelect: "none",
                        flexShrink: 0,
                        opacity: 0.6,
                      }}
                    >
                      {index + 1}
                    </span>
                    <span style={{ flex: 1, paddingRight: 12 }}>{line}</span>
                  </span>
                );
              })}
            </pre>
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto" }}>
          {renderFileSection("changes", "Changes", unstagedRows, unstagedFiles, false)}
          {renderFileSection("staged", "Staged Changes", stagedRows, stagedFiles, true)}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            padding: "10px 12px",
            gap: 8,
          }}
        >
          <textarea
            rows={2}
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Commit message..."
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              fontSize: 12,
              resize: "none",
              fontFamily: "inherit",
              color: "var(--text-1)",
            }}
          />
          <button
            type="button"
            onClick={() => void onCommit()}
            disabled={!commitMessage.trim() || !activeRepo}
            className="btn btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "7px 12px",
              opacity: commitMessage.trim() && activeRepo ? 1 : 0.4,
              cursor: commitMessage.trim() && activeRepo ? "pointer" : "default",
            }}
          >
            <Check size={13} />
            Commit
          </button>
        </div>
      </>
    );
  }

  function renderBranchesView() {
    return (
      <>
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
            }}
          >
            {(["local", "remote"] as GitBranchScope[]).map((scope) => {
              const active = branchScope === scope;
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => {
                    setBranchScope(scope);
                    if (activeRepo) {
                      void loadBranches(activeRepo.path, scope);
                    }
                  }}
                  style={{
                    padding: "5px 10px",
                    fontSize: 11,
                    background: active ? "var(--bg-4)" : "transparent",
                    color: active ? "var(--text-1)" : "var(--text-3)",
                    cursor: "pointer",
                  }}
                >
                  {scope === "local" ? "Local" : "Remote"}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            className="btn-ghost"
            onClick={() => void onCreateBranch()}
            disabled={!activeRepo}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              opacity: activeRepo ? 1 : 0.4,
            }}
          >
            <Plus size={11} />
            New branch
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {branches.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "16px 14px",
                fontSize: 12,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No branches found
            </p>
          ) : (
            branches.map((branch) => {
              const trackSummary = branch.upstream
                ? `${branch.upstream}${branch.ahead || branch.behind ? ` \u00B7 +${branch.ahead} -${branch.behind}` : ""}`
                : "No upstream";

              return (
                <div
                  key={branch.fullName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                  }}
                  onDoubleClick={() => {
                    if (branch.isCurrent) {
                      return;
                    }
                    void onCheckoutBranch(branch.name, branch.isRemote);
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: branch.isCurrent ? "var(--accent)" : "transparent",
                      border: branch.isCurrent ? "none" : "1px solid var(--border)",
                      flexShrink: 0,
                    }}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: branch.isCurrent ? "var(--text-1)" : "var(--text-2)",
                          fontWeight: branch.isCurrent ? 600 : 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {branch.name}
                      </span>

                      {branch.isCurrent && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--accent)",
                            border: "1px solid var(--border-accent)",
                            background: "var(--accent-dim)",
                            borderRadius: 999,
                            padding: "1px 6px",
                            flexShrink: 0,
                          }}
                        >
                          Current
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 1,
                        fontSize: 11,
                        color: "var(--text-3)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>{trackSummary}</span>
                      {branch.lastCommitAt && <span>{formatDate(branch.lastCommitAt)}</span>}
                    </div>
                  </div>

                  {!branch.isCurrent && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 11 }}
                      onClick={() => void onCheckoutBranch(branch.name, branch.isRemote)}
                    >
                      Checkout
                    </button>
                  )}

                  {!branch.isRemote && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 11 }}
                      onClick={() => void onRenameBranch(branch.name)}
                    >
                      Rename
                    </button>
                  )}

                  {!branch.isRemote && !branch.isCurrent && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        color: "var(--danger)",
                      }}
                      onClick={() => void onDeleteBranch(branch.name)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </>
    );
  }

  function renderCommitsView() {
    return (
      <>
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "8px 12px",
            fontSize: 11,
            color: "var(--text-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Current branch history</span>
          <span>{commitsTotal} commits</span>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {commits.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "16px 14px",
                fontSize: 12,
                color: "var(--text-3)",
                textAlign: "center",
              }}
            >
              No commits found
            </p>
          ) : (
            commits.map((entry) => (
              <article
                key={entry.hash}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      color: "var(--accent)",
                    }}
                  >
                    {entry.shortHash}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-1)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={entry.subject}
                  >
                    {entry.subject}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{entry.authorName}</span>
                  <span>\u00B7</span>
                  <span>{formatDate(entry.authoredAt)}</span>
                </div>

                {entry.body && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: "var(--text-2)",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.4,
                    }}
                  >
                    {entry.body}
                  </p>
                )}
              </article>
            ))
          )}

          {commitsHasMore && (
            <div style={{ padding: "10px 12px" }}>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  if (!activeRepo) {
                    return;
                  }
                  void loadMoreCommits(activeRepo.path);
                }}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  fontSize: 12,
                }}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderStashView() {
    return (
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {stashes.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: "16px 14px",
              fontSize: 12,
              color: "var(--text-3)",
              textAlign: "center",
            }}
          >
            No stashes found
          </p>
        ) : (
          stashes.map((stashEntry) => (
            <div
              key={stashEntry.index}
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      color: "var(--accent)",
                      flexShrink: 0,
                    }}
                  >
                    {`stash@{${stashEntry.index}}`}
                  </span>

                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-2)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={stashEntry.name}
                  >
                    {stashEntry.name}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 1,
                    fontSize: 11,
                    color: "var(--text-3)",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {stashEntry.branchHint && <span>{stashEntry.branchHint}</span>}
                  {stashEntry.createdAt && <span>{formatDate(stashEntry.createdAt)}</span>}
                </div>
              </div>

              <button
                type="button"
                className="btn-ghost"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => void onApplyStash(stashEntry.index)}
              >
                Apply
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => void onPopStash(stashEntry.index)}
              >
                Pop
              </button>
            </div>
          ))
        )}
      </div>
    );
  }

  if (!activeRepo) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-1)",
          color: "var(--text-3)",
          fontSize: 12,
          padding: 16,
          textAlign: "center",
        }}
      >
        No repository selected
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
      }}
    >
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          padding: "10px 14px",
          paddingTop: 38,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-1)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <GitBranch size={13} />
          Git
        </span>

        <div className="no-drag" style={{ minWidth: 140 }}>
          <Dropdown
            options={VIEW_OPTIONS}
            value={activeView}
            onChange={(value) => {
              setLocalError(undefined);
              setActiveView(value as GitPanelView);
            }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }} />

        <span
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
          }}
          title={status?.branch}
        >
          <FileCode2 size={11} />
          {status?.branch ?? "detached"}
          {(status?.ahead ?? 0) > 0 || (status?.behind ?? 0) > 0
            ? ` \u00B7 +${status?.ahead ?? 0} -${status?.behind ?? 0}`
            : ""}
        </span>

        <button
          type="button"
          className="btn-ghost"
          onClick={() => void refresh(activeRepo.path)}
          style={{
            padding: 4,
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            display: "flex",
          }}
          title="Refresh"
        >
          <RefreshCw
            size={13}
            style={{
              opacity: 0.65,
              animation: loading ? "spin 1.2s linear infinite" : undefined,
            }}
          />
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowDiff((value) => !value)}
          style={{
            padding: 4,
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            display: "flex",
          }}
          title={showDiff ? "Hide diff" : "Show diff"}
        >
          <MoreHorizontal size={13} style={{ opacity: 0.65 }} />
        </button>
      </div>

      {activeView === "changes" && renderChangesView()}
      {activeView === "branches" && renderBranchesView()}
      {activeView === "commits" && renderCommitsView()}
      {activeView === "stash" && renderStashView()}

      {effectiveError && (
        <p
          style={{
            margin: 0,
            padding: "8px 12px",
            fontSize: 11,
            color: "var(--danger)",
            borderTop: "1px solid var(--border)",
            background: "rgba(248, 113, 113, 0.06)",
          }}
        >
          {effectiveError}
        </p>
      )}
    </div>
  );
}
