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

  const stagedFiles = status?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = status?.files.filter((f) => !f.staged) ?? [];

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
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span className="section-label" style={{ flex: 1 }}>Source Control</span>
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
      </div>

      {/* Branch badge */}
      {status?.branch && (
        <div style={{ padding: "8px 14px 0" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 10px",
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              background: "var(--accent-dim)",
              color: "var(--accent)",
              border: "1px solid var(--border-accent)",
            }}
          >
            <GitBranch size={11} />
            {status.branch}
            {(status.ahead > 0 || status.behind > 0) && (
              <span style={{ color: "var(--text-3)" }}>
                {status.ahead > 0 && `+${status.ahead}`}
                {status.behind > 0 && `-${status.behind}`}
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── File List ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
        {!activeRepo ? (
          <p style={{ padding: "16px 4px", color: "var(--text-3)", fontSize: 12, textAlign: "center" }}>
            No repository selected
          </p>
        ) : status?.files.length === 0 ? (
          <p style={{ padding: "16px 4px", color: "var(--text-3)", fontSize: 12, textAlign: "center" }}>
            Working tree clean
          </p>
        ) : (
          <>
            {/* Staged */}
            {stagedFiles.length > 0 && (
              <FileGroup
                label="Staged Changes"
                count={stagedFiles.length}
                files={stagedFiles}
                activeRepo={activeRepo}
                selectedFile={selectedFile}
                onSelect={selectFile}
                onToggle={(path) => unstage(activeRepo.path, path)}
                toggleIcon={<Minus size={12} />}
                toggleLabel="Unstage"
              />
            )}

            {/* Unstaged */}
            {unstagedFiles.length > 0 && (
              <FileGroup
                label="Changes"
                count={unstagedFiles.length}
                files={unstagedFiles}
                activeRepo={activeRepo}
                selectedFile={selectedFile}
                onSelect={selectFile}
                onToggle={(path) => stage(activeRepo.path, path)}
                toggleIcon={<Plus size={12} />}
                toggleLabel="Stage"
              />
            )}
          </>
        )}
      </div>

      {/* ── Diff + Commit ── */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Diff preview */}
        {selectedFile && diff && (
          <div>
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              style={{
                width: "100%",
                padding: "6px 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--text-2)",
                cursor: "pointer",
                borderBottom: showDiff ? "1px solid var(--border)" : "none",
                transition: "background var(--duration-fast) var(--ease-out)",
              }}
            >
              {showDiff ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {selectedFile.split("/").pop()}
            </button>
            {showDiff && (
              <pre
                style={{
                  margin: 0,
                  padding: "8px 12px",
                  maxHeight: 140,
                  overflow: "auto",
                  fontSize: 11,
                  lineHeight: 1.5,
                  fontFamily: '"JetBrains Mono", monospace',
                  whiteSpace: "pre-wrap",
                  background: "var(--code-bg)",
                  color: "var(--text-2)",
                }}
              >
                {diff.split("\n").map((line, i) => (
                  <span
                    key={i}
                    style={{
                      display: "block",
                      ...(line.startsWith("+") && !line.startsWith("+++")
                        ? { color: "#aff5b4", background: "rgba(46,160,67,0.08)" }
                        : line.startsWith("-") && !line.startsWith("---")
                          ? { color: "#ffdcd7", background: "rgba(248,81,73,0.08)" }
                          : {}),
                    }}
                  >
                    {line}
                  </span>
                ))}
              </pre>
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
              background: "var(--bg-3)",
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

/* ── File Group Sub-component ── */
function FileGroup({
  label,
  count,
  files,
  activeRepo,
  selectedFile,
  onSelect,
  onToggle,
  toggleIcon,
  toggleLabel,
}: {
  label: string;
  count: number;
  files: { path: string; status: string; staged: boolean }[];
  activeRepo: { path: string };
  selectedFile?: string;
  onSelect: (repoPath: string, filePath: string, staged?: boolean) => void;
  onToggle: (path: string) => void;
  toggleIcon: React.ReactNode;
  toggleLabel: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 4px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <ChevronDown size={11} />
        {label}
        <span
          style={{
            padding: "0 5px",
            borderRadius: 99,
            background: "rgba(255,255,255,0.06)",
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          {count}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {files.map((file) => {
          const isSelected = file.path === selectedFile;
          const fileName = file.path.split("/").pop() || file.path;
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "";

          return (
            <div
              key={file.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 6px",
                borderRadius: "var(--radius-sm)",
                background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
                transition: "background var(--duration-fast) var(--ease-out)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "transparent";
              }}
              onClick={() => void onSelect(activeRepo.path, file.path, file.staged)}
            >
              <FileCode2
                size={13}
                style={{
                  flexShrink: 0,
                  color: statusColors[file.status] ?? "var(--text-3)",
                }}
              />
              <span style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
                <span style={{ color: "var(--text-1)" }}>{fileName}</span>
                {dirPath && (
                  <span style={{ color: "var(--text-3)", marginLeft: 4, fontSize: 11 }}>
                    {dirPath}
                  </span>
                )}
              </span>

              {/* Status letter */}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: '"JetBrains Mono", monospace',
                  color: statusColors[file.status] ?? "var(--text-3)",
                  width: 14,
                  textAlign: "center",
                }}
              >
                {file.status[0]?.toUpperCase()}
              </span>

              {/* Stage/Unstage button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onToggle(file.path);
                }}
                style={{
                  padding: 3,
                  borderRadius: 3,
                  cursor: "pointer",
                  display: "flex",
                  color: "var(--text-3)",
                  transition: "color var(--duration-fast) var(--ease-out)",
                }}
                title={toggleLabel}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-1)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-3)")}
              >
                {toggleIcon}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
