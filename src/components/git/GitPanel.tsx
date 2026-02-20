import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  X,
  FileDiff,
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  Archive,
  MoreHorizontal,
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
const GIT_WATCHER_REFRESH_DEBOUNCE_MS = 550;

export function GitPanel() {
  const {
    repos,
    activeWorkspaceId,
    activeRepoId,
    setActiveRepo,
    setWorkspaceGitActiveRepos,
  } = useWorkspaceStore();
  const {
    status,
    refresh,
    invalidateRepoCache,
    loading,
    error,
    activeView,
    setActiveView,
    fetchRemote,
    pullRemote,
    pushRemote,
    flushDrafts,
  } = useGitStore();

  const [showDiff, setShowDiff] = useState(true);
  const [localError, setLocalError] = useState<string | undefined>();
  const [syncingAction, setSyncingAction] = useState<"fetch" | "pull" | "push" | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const [moreMenuPos, setMoreMenuPos] = useState({ top: 0, left: 0 });
  const watcherRefreshTimerRef = useRef<number | null>(null);
  const watcherRefreshInFlightRef = useRef(false);
  const watcherRefreshQueuedRef = useRef(false);

  const closeMoreMenu = useCallback(() => setMoreMenuOpen(false), []);

  useEffect(() => {
    if (!moreMenuOpen) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        moreMenuRef.current?.contains(target) ||
        moreTriggerRef.current?.contains(target)
      ) return;
      closeMoreMenu();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMoreMenu();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [moreMenuOpen, closeMoreMenu]);

  const controlledRepos = useMemo(
    () => repos.filter((repo) => repo.isActive),
    [repos],
  );

  const activeRepo = useMemo(() => {
    if (controlledRepos.length === 0) {
      return null;
    }
    return (
      controlledRepos.find((repo) => repo.id === activeRepoId) ??
      controlledRepos[0]
    );
  }, [controlledRepos, activeRepoId]);

  const activeRepoPath = activeRepo?.path ?? null;
  const effectiveError = localError ?? error;
  const syncDisabled = !activeRepo || loading || syncingAction !== null;
  const pushCount = status?.ahead ?? 0;
  const pullCount = status?.behind ?? 0;

  const runSyncAction = useCallback(async (action: "fetch" | "pull" | "push") => {
    if (!activeRepo) {
      return;
    }

    setLocalError(undefined);
    setSyncingAction(action);
    try {
      if (action === "fetch") {
        await fetchRemote(activeRepo.path);
        return;
      }
      if (action === "pull") {
        await pullRemote(activeRepo.path);
        return;
      }
      await pushRemote(activeRepo.path);
    } catch (syncError) {
      setLocalError(String(syncError));
    } finally {
      setSyncingAction(null);
    }
  }, [activeRepo, fetchRemote, pullRemote, pushRemote]);

  const runSyncActionFromMore = useCallback((action: "fetch" | "pull" | "push") => {
    closeMoreMenu();
    void runSyncAction(action);
  }, [closeMoreMenu, runSyncAction]);

  const onSyncClick = useCallback(async () => {
    if (!activeRepo || syncDisabled) return;
    setSyncingAction("fetch");
    try {
      setLocalError(undefined);
      invalidateRepoCache(activeRepo.path);
      await Promise.all([
        refresh(activeRepo.path, { force: true }),
        fetchRemote(activeRepo.path),
      ]);
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setSyncingAction(null);
    }
  }, [activeRepo, syncDisabled, invalidateRepoCache, refresh, fetchRemote]);

  // Auto-activate all repos when none are active
  useEffect(() => {
    if (!activeWorkspaceId || repos.length === 0) return;
    const anyActive = repos.some((repo) => repo.isActive);
    if (anyActive) return;

    const allIds = repos.map((repo) => repo.id);
    void setWorkspaceGitActiveRepos(activeWorkspaceId, allIds).then(() => {
      setActiveRepo(allIds[0] ?? null);
    });
  }, [activeWorkspaceId, repos, setWorkspaceGitActiveRepos, setActiveRepo]);

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }
    void refresh(activeRepoPath);
  }, [activeRepoPath, refresh]);

  useEffect(() => {
    if (!activeRepoPath) return;

    let unlisten: (() => void) | null = null;
    let disposed = false;
    const repoPath = activeRepoPath;

    function scheduleRefresh() {
      if (watcherRefreshTimerRef.current !== null) {
        return;
      }
      watcherRefreshTimerRef.current = window.setTimeout(() => {
        watcherRefreshTimerRef.current = null;
        void flushRefresh();
      }, GIT_WATCHER_REFRESH_DEBOUNCE_MS);
    }

    async function flushRefresh() {
      if (disposed) {
        return;
      }

      if (watcherRefreshInFlightRef.current) {
        watcherRefreshQueuedRef.current = true;
        return;
      }

      watcherRefreshInFlightRef.current = true;
      try {
        watcherRefreshQueuedRef.current = false;
        invalidateRepoCache(repoPath);
        await refresh(repoPath);
      } finally {
        watcherRefreshInFlightRef.current = false;
        if (watcherRefreshQueuedRef.current) {
          watcherRefreshQueuedRef.current = false;
          scheduleRefresh();
        }
      }
    }

    const attach = async () => {
      try {
        await ipc.watchGitRepo(repoPath);
      } catch {
        return;
      }

      const stop = await listenGitRepoChanged((event) => {
        if (event.repoPath !== repoPath) return;
        watcherRefreshQueuedRef.current = true;
        scheduleRefresh();
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
      if (watcherRefreshTimerRef.current !== null) {
        window.clearTimeout(watcherRefreshTimerRef.current);
        watcherRefreshTimerRef.current = null;
      }
      watcherRefreshInFlightRef.current = false;
      watcherRefreshQueuedRef.current = false;
      unlisten?.();
    };
  }, [activeRepoPath, invalidateRepoCache, refresh]);

  const repoOptions = useMemo(
    () => repos.map((repo) => ({ value: repo.id, label: repo.name })),
    [repos],
  );

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
              if (activeWorkspaceId) flushDrafts(activeWorkspaceId);
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

        {activeRepo && (
          <span className="git-branch-meta" title={activeRepo.path}>
            <GitBranchIcon size={11} />
            <span>{status?.branch ?? "detached"}</span>
            {((status?.ahead ?? 0) > 0 || (status?.behind ?? 0) > 0) && (
              <span className="git-ahead-behind">
                {(status?.ahead ?? 0) > 0 && (
                  <span className="git-ahead">↑{status?.ahead}</span>
                )}
                {(status?.behind ?? 0) > 0 && (
                  <span className="git-behind">↓{status?.behind}</span>
                )}
              </span>
            )}
          </span>
        )}

        <button
          type="button"
          className="git-toolbar-btn no-drag"
          disabled={syncDisabled}
          title={loading || syncingAction !== null ? "Syncing..." : "Refresh & fetch"}
          onClick={() => void onSyncClick()}
        >
          <RefreshCw size={14} className={loading || syncingAction !== null ? "git-spin" : ""} />
        </button>

        <button
          ref={moreTriggerRef}
          type="button"
          className="git-toolbar-btn no-drag"
          onClick={() => {
            if (moreMenuOpen) {
              closeMoreMenu();
              return;
            }
            const rect = moreTriggerRef.current?.getBoundingClientRect();
            if (rect) {
              setMoreMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
            }
            setMoreMenuOpen(true);
          }}
          title="More actions"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {repos.length > 1 && (
        <div className="git-repo-bar no-drag">
          <Dropdown
            options={repoOptions}
            value={activeRepo?.id ?? ""}
            onChange={(repoId) => setActiveRepo(repoId)}
            triggerStyle={{
              background: "none",
              border: "none",
              borderRadius: 0,
              padding: 0,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-2)",
              gap: 4,
            }}
          />
        </div>
      )}

      {activeRepo ? (
        <>
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
        </>
      ) : (
        <div className="git-empty">
          <div className="git-empty-icon-box">
            <GitBranchIcon size={20} />
          </div>
          <p className="git-empty-title">No repositories found</p>
          <p className="git-empty-sub">Open a folder with a git repository</p>
        </div>
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

      {moreMenuOpen &&
        createPortal(
          <div
            ref={moreMenuRef}
            className="git-action-menu"
            style={{
              position: "fixed",
              top: moreMenuPos.top,
              left: moreMenuPos.left,
            }}
          >
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => runSyncActionFromMore("pull")}
              disabled={syncDisabled}
            >
              <ArrowDown size={13} className={syncingAction === "pull" ? "git-spin" : ""} />
              <span style={{ flex: 1 }}>Pull</span>
              <span className="git-sync-counter">↓{pullCount}</span>
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => runSyncActionFromMore("push")}
              disabled={syncDisabled}
            >
              <ArrowUp size={13} className={syncingAction === "push" ? "git-spin" : ""} />
              <span style={{ flex: 1 }}>Push</span>
              <span className="git-sync-counter">↑{pushCount}</span>
            </button>
            {activeView === "changes" && (
              <button
                type="button"
                className="git-action-menu-item"
                onClick={() => {
                  closeMoreMenu();
                  setShowDiff((v) => !v);
                }}
              >
                {showDiff ? <EyeOff size={13} /> : <Eye size={13} />}
                {showDiff ? "Hide diff preview" : "Show diff preview"}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
