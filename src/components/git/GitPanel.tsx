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
import { useGitStore } from "../../stores/gitStore";
import { ipc, listenGitRepoChanged } from "../../lib/ipc";

const statusColors: Record<string, string> = {
  added: "var(--success)",
  modified: "var(--warning)",
  deleted: "var(--danger)",
  renamed: "var(--info)",
  untracked: "var(--text-3)",
};

const statusDotColors: Record<string, string> = {
  added: "#34d399",
  modified: "#fbbf24",
  deleted: "#f87171",
  renamed: "#60a5fa",
  untracked: "#555555",
};

type GitTab = "unstaged" | "staged";

export function GitPanel() {
  const { repos, activeRepoId } = useWorkspaceStore();
  const {
    status,
    diff,
    selectedFile,
    refresh,
    selectFile,
    stage,
    unstage,
    commit,
    error,
    loading,
  } = useGitStore();
  const [commitMessage, setCommitMessage] = useState("");
  const [showDiff, setShowDiff] = useState(true);
  const [activeTab, setActiveTab] = useState<GitTab>("unstaged");

  const activeRepo = useMemo(
    () => repos.find((r) => r.id === activeRepoId) ?? repos[0],
    [repos, activeRepoId],
  );
  const activeRepoPath = activeRepo?.path ?? null;

  useEffect(() => {
    if (!activeRepoPath) return;
    void refresh(activeRepoPath);
  }, [activeRepoPath, refresh]);

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
    if (!activeRepo || !commitMessage.trim()) return;
    await commit(activeRepo.path, commitMessage.trim());
    setCommitMessage("");
  }

  async function onStageAll() {
    if (!activeRepo) return;
    const files = unstagedFiles.map((f) => f.path);
    for (const file of files) {
      await stage(activeRepo.path, file);
    }
  }

  async function onUnstageAll() {
    if (!activeRepo) return;
    const files = stagedFiles.map((f) => f.path);
    for (const file of files) {
      await unstage(activeRepo.path, file);
    }
  }

  const stagedFiles = status?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = status?.files.filter((f) => !f.staged) ?? [];
  const displayFiles = activeTab === "unstaged" ? unstagedFiles : stagedFiles;

  function abbreviatePath(filePath: string): string {
    const parts = filePath.split("/");
    if (parts.length <= 2) return filePath;
    const abbreviated = parts.slice(0, -1).map((p) =>
      p.length > 12 ? "..." + p.slice(-12) : p
    );
    return abbreviated.join("/") + "/" + parts[parts.length - 1];
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
      {/* ── Header ── */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Uncommitted changes
          <ChevronDown size={12} style={{ opacity: 0.4 }} />
        </span>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => activeRepo && void refresh(activeRepo.path)}
          style={{
            padding: 4,
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            display: "flex",
          }}
        >
          <RefreshCw size={13} style={{ opacity: 0.5 }} />
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={{
            padding: 4,
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            display: "flex",
          }}
        >
          <MoreHorizontal size={13} style={{ opacity: 0.5 }} />
        </button>
      </div>

      {/* ── Tabs: Unstaged / Staged ── */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("unstaged")}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: activeTab === "unstaged" ? 600 : 400,
            color: activeTab === "unstaged" ? "var(--text-1)" : "var(--text-3)",
            background: "transparent",
            cursor: "pointer",
            borderBottom: activeTab === "unstaged" ? "2px solid var(--text-1)" : "2px solid transparent",
            transition: "all var(--duration-fast)",
          }}
        >
          Unstaged{unstagedFiles.length > 0 ? ` \u00B7 ${unstagedFiles.length}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("staged")}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: activeTab === "staged" ? 600 : 400,
            color: activeTab === "staged" ? "var(--text-1)" : "var(--text-3)",
            background: "transparent",
            cursor: "pointer",
            borderBottom: activeTab === "staged" ? "2px solid var(--text-1)" : "2px solid transparent",
            transition: "all var(--duration-fast)",
          }}
        >
          Staged{stagedFiles.length > 0 ? ` \u00B7 ${stagedFiles.length}` : ""}
        </button>
      </div>

      {/* ── Diff Viewer with Line Numbers ── */}
      {selectedFile && diff && showDiff && (
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            maxHeight: 200,
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
            {diff.split("\n").map((line, i) => {
              const isAdd = line.startsWith("+") && !line.startsWith("+++");
              const isDel = line.startsWith("-") && !line.startsWith("---");
              return (
                <span
                  key={i}
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
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, paddingRight: 12 }}>{line}</span>
                </span>
              );
            })}
          </pre>
        </div>
      )}

      {/* ── File List ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {!activeRepo ? (
          <p style={{ padding: "16px 14px", color: "var(--text-3)", fontSize: 12, textAlign: "center" }}>
            No repository selected
          </p>
        ) : displayFiles.length === 0 ? (
          <p style={{ padding: "16px 14px", color: "var(--text-3)", fontSize: 12, textAlign: "center" }}>
            {activeTab === "unstaged" ? "No unstaged changes" : "No staged changes"}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {displayFiles.map((file) => {
              const isSelected = file.path === selectedFile;
              const fileName = file.path.split("/").pop() || file.path;
              const displayPath = abbreviatePath(file.path);
              const dotColor = statusDotColors[file.status] ?? "#555555";

              return (
                <div
                  key={file.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 14px",
                    background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
                    transition: "background var(--duration-fast) var(--ease-out)",
                    cursor: "pointer",
                    borderLeft: isSelected ? "2px solid var(--text-1)" : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                  onClick={() => void selectFile(activeRepo.path, file.path, file.staged)}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-2)",
                    }}
                    title={file.path}
                  >
                    {displayPath}
                  </span>

                  {/* +/- stats placeholder — we show status letter as fallback */}
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono", monospace',
                      color: statusColors[file.status] ?? "var(--text-3)",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {file.status === "added" || file.status === "untracked" ? (
                      <span style={{ color: "var(--success)" }}>+new</span>
                    ) : file.status === "deleted" ? (
                      <span style={{ color: "var(--danger)" }}>-del</span>
                    ) : file.status === "modified" ? (
                      <span style={{ color: "var(--warning)" }}>mod</span>
                    ) : (
                      <span>{file.status[0]?.toUpperCase()}</span>
                    )}
                  </span>

                  {/* Status dot */}
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />

                  {/* Stage/Unstage button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeTab === "unstaged") {
                        void stage(activeRepo.path, file.path);
                      } else {
                        void unstage(activeRepo.path, file.path);
                      }
                    }}
                    style={{
                      padding: 3,
                      borderRadius: 3,
                      cursor: "pointer",
                      display: "flex",
                      color: "var(--text-3)",
                      transition: "color var(--duration-fast) var(--ease-out)",
                      flexShrink: 0,
                    }}
                    title={activeTab === "unstaged" ? "Stage" : "Unstage"}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-3)")}
                  >
                    {activeTab === "unstaged" ? <Plus size={12} /> : <Minus size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bottom: Bulk actions + Commit ── */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Bulk action buttons */}
        {activeRepo && displayFiles.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {activeTab === "unstaged" && (
              <>
                <button
                  type="button"
                  onClick={() => void onStageAll()}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-3)",
                    border: "1px solid var(--border)",
                    color: "var(--text-1)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    transition: "all var(--duration-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-3)";
                  }}
                >
                  <Plus size={12} />
                  Stage all
                </button>
              </>
            )}
            {activeTab === "staged" && (
              <button
                type="button"
                onClick={() => void onUnstageAll()}
                style={{
                  padding: "5px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-3)",
                  border: "1px solid var(--border)",
                  color: "var(--text-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  transition: "all var(--duration-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-3)";
                }}
              >
                <RotateCcw size={12} />
                Revert all
              </button>
            )}
          </div>
        )}

        {/* Commit input */}
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            rows={2}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
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
              transition: "border-color var(--duration-fast) var(--ease-out)",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border-active)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <button
            type="button"
            onClick={() => void onCommit()}
            disabled={!commitMessage.trim() || !activeRepo}
            className="btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "7px 12px",
              cursor: commitMessage.trim() && activeRepo ? "pointer" : "default",
              opacity: commitMessage.trim() && activeRepo ? 1 : 0.4,
            }}
          >
            <Check size={13} />
            Commit
          </button>

          {error && (
            <p style={{ margin: 0, fontSize: 11, color: "var(--danger)" }}>{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
