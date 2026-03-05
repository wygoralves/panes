import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RefreshCw,
  ArrowDown,
  ArrowUp,
  X,
  Undo2,
  FileDiff,
  FolderTree,
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  GitFork,
  Archive,
  MoreHorizontal,
  CornerUpLeft,
  Link,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore, type GitPanelView } from "../../stores/gitStore";
import { ipc, listenGitRepoChanged } from "../../lib/ipc";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { toast } from "../../stores/toastStore";
import { Dropdown } from "../shared/Dropdown";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type { GitInitRepoStatus } from "../../types";
import { GitChangesView } from "./GitChangesView";
import { GitBranchesView } from "./GitBranchesView";
import { GitCommitsView } from "./GitCommitsView";
import { GitStashView } from "./GitStashView";
import { GitFilesView } from "./GitFilesView";
import { GitWorktreesView } from "./GitWorktreesView";
import { GitRemotesView } from "./GitRemotesView";

const VIEW_OPTIONS = [
  { value: "changes", label: "Changes", icon: <FileDiff size={13} /> },
  { value: "branches", label: "Branches", icon: <GitBranchIcon size={13} /> },
  { value: "commits", label: "Commits", icon: <GitCommitHorizontal size={13} /> },
  { value: "stash", label: "Stash", icon: <Archive size={13} /> },
  { value: "files", label: "Files", icon: <FolderTree size={13} /> },
  { value: "worktrees", label: "Worktrees", icon: <GitFork size={13} /> },
];
const GIT_WATCHER_REFRESH_DEBOUNCE_MS_CHANGES = 550;
const GIT_WATCHER_REFRESH_DEBOUNCE_MS_BACKGROUND = 1100;

export function GitPanel() {
  const {
    workspaces,
    repos,
    activeWorkspaceId,
    activeRepoId,
    reposLoading,
    setActiveRepo,
    setWorkspaceGitActiveRepos,
    rescanWorkspace,
  } = useWorkspaceStore();
  const {
    status,
    refresh,
    invalidateRepoCache,
    loading,
    error,
    remoteSyncAction,
    remoteSyncRepoPath,
    activeRepoPath: storeActiveRepoPath,
    worktrees,
    setActiveRepoPath,
    mainRepoPath,
    setMainRepoPath,
    activeView,
    setActiveView,
    fetchRemote,
    pullRemote,
    pushRemote,
    softResetLastCommit,
    loadWorktrees,
    flushDrafts,
    clearError,
  } = useGitStore();

  const [localError, setLocalError] = useState<string | undefined>();
  const [softResetConfirmOpen, setSoftResetConfirmOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [initRepoStatus, setInitRepoStatus] = useState<GitInitRepoStatus | null>(null);
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
  const activeWorkspaceRootPath = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.rootPath ?? null,
    [activeWorkspaceId, workspaces],
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

  const baseRepoPath = activeRepo?.path ?? null;
  const effectiveRepoPath = storeActiveRepoPath ?? baseRepoPath;
  const effectiveRepo = useMemo(() => {
    if (!activeRepo || !effectiveRepoPath || effectiveRepoPath === activeRepo.path) {
      return activeRepo;
    }
    return {
      ...activeRepo,
      path: effectiveRepoPath,
    };
  }, [activeRepo, effectiveRepoPath]);
  const effectiveError = localError ?? error;
  const isActiveRepoSyncing = Boolean(
    effectiveRepoPath &&
    remoteSyncAction &&
    remoteSyncRepoPath === effectiveRepoPath,
  );
  const initBlockedByRepoPath = initRepoStatus?.canInitialize === false
    ? initRepoStatus.blockingRepoPath
    : null;
  const syncDisabled = !effectiveRepoPath || loading || isActiveRepoSyncing;
  const pushCount = status?.ahead ?? 0;
  const pullCount = status?.behind ?? 0;

  const runSyncAction = useCallback(async (action: "fetch" | "pull" | "push") => {
    if (!effectiveRepoPath || isActiveRepoSyncing) {
      return;
    }

    setLocalError(undefined);
    try {
      if (action === "fetch") {
        await fetchRemote(effectiveRepoPath);
        toast.success("Fetched from remote");
        return;
      }
      if (action === "pull") {
        await pullRemote(effectiveRepoPath);
        toast.success("Pulled from remote");
        return;
      }
      await pushRemote(effectiveRepoPath);
      toast.success("Pushed to remote");
    } catch (syncError) {
      setLocalError(String(syncError));
    }
  }, [effectiveRepoPath, fetchRemote, isActiveRepoSyncing, pullRemote, pushRemote]);

  const runSyncActionFromMore = useCallback((action: "fetch" | "pull" | "push") => {
    closeMoreMenu();
    void runSyncAction(action);
  }, [closeMoreMenu, runSyncAction]);

  const onSyncClick = useCallback(async () => {
    if (!effectiveRepoPath || syncDisabled) return;
    try {
      setLocalError(undefined);
      await fetchRemote(effectiveRepoPath);
      toast.success("Refreshed");
    } catch (e) {
      setLocalError(String(e));
    }
  }, [effectiveRepoPath, syncDisabled, fetchRemote]);

  const onSoftResetLastCommit = useCallback(async () => {
    if (!effectiveRepoPath || syncDisabled) {
      setSoftResetConfirmOpen(false);
      return;
    }
    setSoftResetConfirmOpen(false);
    setLocalError(undefined);
    try {
      await softResetLastCommit(effectiveRepoPath);
      toast.success("Soft reset completed");
    } catch (e) {
      setLocalError(String(e));
    }
  }, [effectiveRepoPath, syncDisabled, softResetLastCommit]);

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
    if (!baseRepoPath) {
      setActiveRepoPath(null);
      setMainRepoPath(null);
      return;
    }

    if (mainRepoPath && mainRepoPath !== baseRepoPath) {
      setMainRepoPath(null);
      setActiveRepoPath(baseRepoPath);
      return;
    }

    if (!storeActiveRepoPath) {
      setActiveRepoPath(baseRepoPath);
      return;
    }

    if (!mainRepoPath && storeActiveRepoPath !== baseRepoPath) {
      setActiveRepoPath(baseRepoPath);
    }
  }, [
    baseRepoPath,
    mainRepoPath,
    setActiveRepoPath,
    setMainRepoPath,
    storeActiveRepoPath,
  ]);

  useEffect(() => {
    if (!effectiveRepoPath) {
      return;
    }
    void refresh(
      effectiveRepoPath,
      activeView === "changes" ? { force: true } : undefined,
    );
  }, [activeView, effectiveRepoPath, refresh]);

  useEffect(() => {
    if (!effectiveRepoPath) return;

    let unlisten: (() => void) | null = null;
    let disposed = false;
    const repoPath = effectiveRepoPath;

    function scheduleRefresh() {
      if (watcherRefreshTimerRef.current !== null) {
        return;
      }
      const gitState = useGitStore.getState();
      const debounceMs =
        gitState.activeView === "changes"
          ? GIT_WATCHER_REFRESH_DEBOUNCE_MS_CHANGES
          : GIT_WATCHER_REFRESH_DEBOUNCE_MS_BACKGROUND;
      watcherRefreshTimerRef.current = window.setTimeout(() => {
        watcherRefreshTimerRef.current = null;
        void flushRefresh();
      }, debounceMs);
    }

    async function flushRefresh() {
      if (disposed) {
        return;
      }

      const syncState = useGitStore.getState();
      const syncInProgressForRepo =
        syncState.remoteSyncRepoPath === repoPath &&
        syncState.remoteSyncAction !== null;
      if (syncInProgressForRepo) {
        watcherRefreshQueuedRef.current = true;
        return;
      }

      if (watcherRefreshInFlightRef.current) {
        watcherRefreshQueuedRef.current = true;
        return;
      }

      watcherRefreshInFlightRef.current = true;
      try {
        watcherRefreshQueuedRef.current = false;
        const gitState = useGitStore.getState();
        const prioritizeStatusRefresh = gitState.activeView === "changes";
        if (prioritizeStatusRefresh) {
          invalidateRepoCache(repoPath);
          await refresh(repoPath, { force: true });
        } else {
          await refresh(repoPath);
        }
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
  }, [effectiveRepoPath, invalidateRepoCache, refresh]);

  useEffect(() => {
    if (reposLoading || effectiveRepo || !activeWorkspaceRootPath) {
      setInitRepoStatus(null);
      return;
    }

    let cancelled = false;
    void ipc.initGitRepo(activeWorkspaceRootPath, true)
      .then((status) => {
        if (!cancelled) {
          setInitRepoStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setInitRepoStatus(null);
          setLocalError(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceRootPath, effectiveRepo, reposLoading]);

  useEffect(() => {
    if (!effectiveRepoPath || isActiveRepoSyncing) {
      return;
    }
    if (!watcherRefreshQueuedRef.current || watcherRefreshInFlightRef.current) {
      return;
    }

    watcherRefreshQueuedRef.current = false;
    watcherRefreshInFlightRef.current = true;
    void (async () => {
      try {
        const gitState = useGitStore.getState();
        const prioritizeStatusRefresh = gitState.activeView === "changes";
        if (prioritizeStatusRefresh) {
          invalidateRepoCache(effectiveRepoPath);
          await refresh(effectiveRepoPath, { force: true });
        } else {
          await refresh(effectiveRepoPath);
        }
      } finally {
        watcherRefreshInFlightRef.current = false;
      }
    })();
  }, [effectiveRepoPath, invalidateRepoCache, isActiveRepoSyncing, refresh]);

  useEffect(() => {
    const worktreeRootPath = mainRepoPath ?? baseRepoPath;
    if (!worktreeRootPath) {
      return;
    }
    void loadWorktrees(worktreeRootPath);
  }, [baseRepoPath, mainRepoPath, loadWorktrees]);

  const repoOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const repo of repos) {
      options.push({ value: repo.id, label: repo.name });
      if (repo.id === activeRepo?.id) {
        const nonMain = worktrees.filter((wt) => !wt.isMain);
        for (const wt of nonMain) {
          options.push({
            value: `wt::${wt.path}`,
            label: `  \u2514 ${wt.branch ?? wt.path}`,
          });
        }
      }
    }
    return options;
  }, [repos, activeRepo?.id, worktrees]);

  const showRepoPicker =
    repos.length > 1 ||
    worktrees.some((wt) => !wt.isMain) ||
    Boolean(mainRepoPath);

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

        {effectiveRepo && (
          <span className="git-branch-meta" title={effectiveRepo.path}>
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
          title={isActiveRepoSyncing ? "Syncing..." : "Refresh & fetch"}
          onClick={() => void onSyncClick()}
        >
          <RefreshCw size={14} className={isActiveRepoSyncing ? "git-spin" : ""} />
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

      {showRepoPicker && (
        <div className="git-repo-bar no-drag">
          <Dropdown
            options={repoOptions}
            value={mainRepoPath ? `wt::${effectiveRepoPath ?? ""}` : (activeRepo?.id ?? "")}
            onChange={(value) => {
              if (value.startsWith("wt::")) {
                const wtPath = value.slice(4);
                setActiveRepoPath(wtPath);
                if (activeRepo) setMainRepoPath(activeRepo.path);
              } else {
                const selectedRepo = repos.find((repo) => repo.id === value);
                setActiveRepo(value);
                setMainRepoPath(null);
                setActiveRepoPath(selectedRepo?.path ?? null);
              }
            }}
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
          {mainRepoPath && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "2px 6px", fontSize: 11, marginLeft: 4 }}
              title="Back to main repo"
              onClick={() => {
                if (activeRepo) {
                  setActiveRepoPath(activeRepo.path);
                }
                setMainRepoPath(null);
              }}
            >
              <CornerUpLeft size={11} />
              Main repo
            </button>
          )}
        </div>
      )}

      {effectiveRepo ? (
        <>
          {activeView === "changes" && (
            <GitChangesView
              repo={effectiveRepo}
              showDiff
              onError={setLocalError}
            />
          )}
          {activeView === "branches" && (
            <GitBranchesView repo={effectiveRepo} onError={setLocalError} />
          )}
          {activeView === "commits" && <GitCommitsView repo={effectiveRepo} />}
          {activeView === "stash" && (
            <GitStashView repo={effectiveRepo} onError={setLocalError} />
          )}
          {activeView === "files" && <GitFilesView repo={effectiveRepo} />}
          {activeView === "worktrees" && activeRepo && (
            <GitWorktreesView repo={activeRepo} onError={setLocalError} />
          )}
        </>
      ) : (
        <div className="git-empty">
          <div className="git-empty-icon-box">
            <GitBranchIcon size={20} />
          </div>
          <p className="git-empty-title">
            {reposLoading ? "Scanning repositories..." : "No repositories found"}
          </p>
          <p className="git-empty-sub">
            {reposLoading
              ? "Checking this workspace for git repositories"
              : initBlockedByRepoPath
              ? `This workspace is already inside the Git repository at ${initBlockedByRepoPath}.`
              : "Open a folder with a git repository"}
          </p>
          {!reposLoading &&
            activeWorkspaceId &&
            activeWorkspaceRootPath &&
            initRepoStatus?.canInitialize === true && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12, fontSize: 13 }}
              disabled={initLoading}
              onClick={() => {
                setInitLoading(true);
                void (async () => {
                  try {
                    await ipc.initGitRepo(activeWorkspaceRootPath);
                    await rescanWorkspace(activeWorkspaceId);
                    toast.success("Repository initialized");
                  } catch (e) {
                    toast.error(String(e));
                  } finally {
                    setInitLoading(false);
                  }
                })();
              }}
            >
              {initLoading ? "Initializing..." : "Initialize Repository"}
            </button>
          )}
        </div>
      )}

      {effectiveError && (
        <div className="git-error-bar">
          <span style={{ flex: 1 }}>{effectiveError}</span>
          <button
            type="button"
            className="git-error-dismiss"
            onClick={() => { setLocalError(undefined); clearError(); }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={softResetConfirmOpen}
        title="Soft reset last commit"
        message="This will undo the latest commit and keep all its changes staged. This cannot be undone from Panes."
        confirmLabel="Soft reset"
        onConfirm={() => void onSoftResetLastCommit()}
        onCancel={() => setSoftResetConfirmOpen(false)}
      />

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
              <ArrowDown size={13} className={isActiveRepoSyncing && remoteSyncAction === "pull" ? "git-spin" : ""} />
              <span style={{ flex: 1 }}>Pull</span>
              <span className="git-sync-counter">↓{pullCount}</span>
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => runSyncActionFromMore("push")}
              disabled={syncDisabled}
            >
              <ArrowUp size={13} className={isActiveRepoSyncing && remoteSyncAction === "push" ? "git-spin" : ""} />
              <span style={{ flex: 1 }}>Push</span>
              <span className="git-sync-counter">↑{pushCount}</span>
            </button>
            <button
              type="button"
              className="git-action-menu-item git-action-menu-item-danger-hover"
              onClick={() => {
                closeMoreMenu();
                setSoftResetConfirmOpen(true);
              }}
              disabled={syncDisabled}
            >
              <Undo2 size={13} />
              <span style={{ flex: 1 }}>Soft reset last commit</span>
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => {
                closeMoreMenu();
                setRemotesOpen(true);
              }}
              disabled={!effectiveRepoPath}
            >
              <Link size={13} />
              <span style={{ flex: 1 }}>Manage Remotes...</span>
            </button>
          </div>,
          document.body,
        )}

      {remotesOpen && effectiveRepo &&
        createPortal(
          <GitRemotesView
            repo={effectiveRepo}
            onClose={() => setRemotesOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}
