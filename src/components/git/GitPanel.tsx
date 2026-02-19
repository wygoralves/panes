import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Eye,
  EyeOff,
  X,
  FileDiff,
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  Archive,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore, type GitPanelView } from "../../stores/gitStore";
import { ipc, listenGitRepoChanged } from "../../lib/ipc";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { Dropdown } from "../shared/Dropdown";
import { GitChangesView } from "./GitChangesView";
import { GitBranchesView } from "./GitBranchesView";
import { GitCommitsView } from "./GitCommitsView";
import { GitStashView } from "./GitStashView";

const VIEW_OPTIONS = [
  { value: "changes", label: "Changes", icon: <FileDiff size={13} /> },
  { value: "branches", label: "Branches", icon: <GitBranchIcon size={13} /> },
  { value: "commits", label: "Commits", icon: <GitCommitHorizontal size={13} /> },
  { value: "stash", label: "Stash", icon: <Archive size={13} /> },
];

export function GitPanel() {
  const { repos, activeRepoId } = useWorkspaceStore();
  const { status, refresh, loading, error, activeView, setActiveView } =
    useGitStore();

  const [showDiff, setShowDiff] = useState(true);
  const [localError, setLocalError] = useState<string | undefined>();

  const activeRepo = useMemo(
    () => repos.find((r) => r.id === activeRepoId) ?? repos[0],
    [repos, activeRepoId],
  );
  const activeRepoPath = activeRepo?.path ?? null;
  const effectiveError = localError ?? error;

  useEffect(() => {
    if (!activeRepoPath) return;
    void refresh(activeRepoPath);
  }, [activeRepoPath, refresh]);

  useEffect(() => {
    if (!activeRepoPath) return;

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
        if (event.repoPath !== repoPath) return;
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
      unlisten?.();
    };
  }, [activeRepoPath, refresh]);

  if (!activeRepo) {
    return (
      <div
        className="git-panel"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <p className="git-empty">No repository selected</p>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div
        className="git-header"
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
      >
        <div className="no-drag">
          <Dropdown
            options={VIEW_OPTIONS}
            value={activeView}
            onChange={(value) => {
              setLocalError(undefined);
              setActiveView(value as GitPanelView);
            }}
            triggerStyle={{
              background: "none",
              border: "none",
              borderRadius: 0,
              padding: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              gap: 4,
            }}
          />
        </div>

        <div style={{ flex: 1 }} />

        <span className="git-branch-meta" title={status?.branch}>
          <GitBranchIcon size={11} />
          {status?.branch ?? "detached"}
          {((status?.ahead ?? 0) > 0 || (status?.behind ?? 0) > 0) && (
            <span className="git-ahead-behind">
              {(status?.ahead ?? 0) > 0 && (
                <span className="git-ahead">+{status?.ahead}</span>
              )}
              {(status?.behind ?? 0) > 0 && (
                <span className="git-behind">-{status?.behind}</span>
              )}
            </span>
          )}
        </span>

        {activeView === "changes" && (
          <button
            type="button"
            className="git-toolbar-btn"
            onClick={() => setShowDiff((v) => !v)}
            title={showDiff ? "Hide diff preview" : "Show diff preview"}
          >
            {showDiff ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        )}

        <button
          type="button"
          className="git-toolbar-btn"
          onClick={() => void refresh(activeRepo.path)}
          title="Refresh"
        >
          <RefreshCw
            size={13}
            className={loading ? "git-spin" : ""}
          />
        </button>
      </div>

      {activeView === "changes" && (
        <GitChangesView
          repo={activeRepo}
          showDiff={showDiff}
          onError={setLocalError}
        />
      )}
      {activeView === "branches" && (
        <GitBranchesView repo={activeRepo} onError={setLocalError} />
      )}
      {activeView === "commits" && <GitCommitsView repo={activeRepo} />}
      {activeView === "stash" && (
        <GitStashView repo={activeRepo} onError={setLocalError} />
      )}

      {effectiveError && (
        <div className="git-error-bar">
          <span style={{ flex: 1 }}>{effectiveError}</span>
          <button
            type="button"
            className="git-error-dismiss"
            onClick={() => setLocalError(undefined)}
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
