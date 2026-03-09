import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Plus,
  X,
  MoreHorizontal,
  GitFork,
  Loader2,
  Search,
  Trash2,
  ExternalLink,
  Scissors,
} from "lucide-react";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import type { Repo, GitWorktree } from "../../types";

interface Props {
  repo: Repo;
  onError: (error: string | undefined) => void;
}

function abbreviatePath(fullPath: string, repoPath: string): string {
  if (fullPath.startsWith(repoPath)) {
    const rel = fullPath.slice(repoPath.length);
    return rel.startsWith("/") ? `.${rel}` : `./${rel}`;
  }
  return fullPath;
}

function shortSha(sha: string | null): string {
  if (!sha) return "";
  return sha.slice(0, 7);
}

interface ActionMenuState {
  worktree: GitWorktree;
  top: number;
  left: number;
}

export function GitWorktreesView({ repo, onError }: Props) {
  const { t } = useTranslation("git");
  const {
    worktrees,
    loadWorktrees,
    addWorktree,
    removeWorktree,
    pruneWorktrees,
    setActiveRepoPath,
    setMainRepoPath,
  } = useGitStore();

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createBranch, setCreateBranch] = useState("");
  const [createBaseRef, setCreateBaseRef] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [confirmingRemoveWithBranch, setConfirmingRemoveWithBranch] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const createBranchInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void loadWorktrees(repo.path);
  }, [repo.path, loadWorktrees]);

  useEffect(() => {
    setFilterQuery("");
    setShowCreate(false);
    setCreateBranch("");
    setCreateBaseRef("");
  }, [repo.path]);

  useEffect(() => {
    if (showCreate) createBranchInputRef.current?.focus();
  }, [showCreate]);

  useEffect(() => {
    if (!confirmingRemove && !confirmingRemoveWithBranch) return;
    const timer = setTimeout(() => {
      setConfirmingRemove(null);
      setConfirmingRemoveWithBranch(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [confirmingRemove, confirmingRemoveWithBranch]);

  const closeMenu = useCallback(() => setActionMenu(null), []);

  useEffect(() => {
    if (!actionMenu) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        actionMenuRef.current?.contains(target) ||
        actionTriggerRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [actionMenu, closeMenu]);

  const filteredWorktrees = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return worktrees;
    return worktrees.filter(
      (wt) =>
        (wt.branch && wt.branch.toLowerCase().includes(q)) ||
        wt.path.toLowerCase().includes(q),
    );
  }, [worktrees, filterQuery]);

  const autoWorktreePath = createBranch.trim()
    ? `${repo.path}/.panes/worktrees/${createBranch.trim().replace(/[/\\]/g, "-")}/`
    : "";

  function openActionMenu(worktree: GitWorktree, e: React.MouseEvent<HTMLButtonElement>) {
    if (worktree.isMain) {
      closeMenu();
      return;
    }
    if (actionMenu?.worktree.path === worktree.path) {
      closeMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    actionTriggerRef.current = e.currentTarget;
    setActionMenu({
      worktree,
      top: rect.bottom + 4,
      left: rect.right - 160,
    });
  }

  async function onCreateWorktree() {
    const branch = createBranch.trim();
    if (!branch || !autoWorktreePath || loadingKey !== null) return;
    setLoadingKey("create");
    try {
      onError(undefined);
      const baseRef = createBaseRef.trim() || undefined;
      await addWorktree(repo.path, autoWorktreePath, branch, baseRef);
      setCreateBranch("");
      setCreateBaseRef("");
      setShowCreate(false);
      toast.success(t("worktrees.toasts.created", { branchName: branch }));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onPrune() {
    if (loadingKey !== null) return;
    setLoadingKey("prune");
    try {
      onError(undefined);
      await pruneWorktrees(repo.path);
      toast.success(t("worktrees.toasts.pruned"));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  function onOpenInPanel(wt: GitWorktree) {
    closeMenu();
    if (wt.isMain) return;
    setActiveRepoPath(wt.path);
    setMainRepoPath(repo.path);
  }

  async function onRemoveWorktree(wtPath: string, branch: string | null, deleteBranch: boolean) {
    const confirmKey = deleteBranch ? confirmingRemoveWithBranch : confirmingRemove;
    const setConfirm = deleteBranch ? setConfirmingRemoveWithBranch : setConfirmingRemove;

    if (confirmKey !== wtPath) {
      setConfirm(wtPath);
      return;
    }
    if (loadingKey !== null) return;
    setLoadingKey(`remove:${wtPath}`);
    try {
      onError(undefined);
      setConfirmingRemove(null);
      setConfirmingRemoveWithBranch(null);
      closeMenu();
      await removeWorktree(repo.path, wtPath, false, branch, deleteBranch);
      toast.success(t("worktrees.toasts.removed"));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  const menuWt = actionMenu?.worktree ?? null;

  const actionMenuPortal =
    actionMenu && menuWt && !menuWt.isMain
      ? createPortal(
          <div
            ref={actionMenuRef}
            className="git-action-menu"
            style={{
              position: "fixed",
              top: actionMenu.top,
              left: actionMenu.left,
            }}
          >
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => onOpenInPanel(menuWt)}
            >
              <ExternalLink size={13} />
              {t("worktrees.actions.openInPanel")}
            </button>
            <button
              type="button"
              className={`git-action-menu-item${
                confirmingRemove === menuWt.path
                  ? " git-action-menu-item-danger"
                  : ""
              }`}
              disabled={loadingKey !== null}
              onClick={() => {
                void onRemoveWorktree(menuWt.path, menuWt.branch, false);
                if (confirmingRemove === menuWt.path) closeMenu();
              }}
            >
              <Trash2 size={13} />
              {confirmingRemove === menuWt.path
                ? t("worktrees.actions.confirmRemove")
                : t("worktrees.actions.remove")}
            </button>
            {menuWt.branch && (
              <button
                type="button"
                className={`git-action-menu-item${
                  confirmingRemoveWithBranch === menuWt.path
                    ? " git-action-menu-item-danger"
                    : ""
                }`}
                disabled={loadingKey !== null}
                onClick={() => {
                  void onRemoveWorktree(menuWt.path, menuWt.branch, true);
                  if (confirmingRemoveWithBranch === menuWt.path) closeMenu();
                }}
              >
                <Trash2 size={13} />
                {confirmingRemoveWithBranch === menuWt.path
                  ? t("worktrees.actions.confirmRemove")
                  : t("worktrees.actions.removeDeleteBranch")}
              </button>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "3px 8px", fontSize: 11 }}
          disabled={loadingKey !== null}
          onClick={() => void onPrune()}
        >
          {loadingKey === "prune" ? <Loader2 size={11} className="git-spin" /> : <Scissors size={11} />}
          {t("worktrees.prune")}
        </button>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "3px 8px", fontSize: 11 }}
          onClick={() => {
            if (showCreate) {
              setCreateBranch("");
              setCreateBaseRef("");
            }
            setShowCreate(!showCreate);
          }}
        >
          {showCreate ? <X size={11} /> : <Plus size={11} />}
          {showCreate ? t("actions.cancel", { ns: "common" }) : t("worktrees.new")}
        </button>
      </div>

      {showCreate && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            <input
              ref={createBranchInputRef}
              type="text"
              className="git-inline-input"
              placeholder={t("worktrees.branchNamePlaceholder")}
              value={createBranch}
              onChange={(e) => setCreateBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateWorktree();
                if (e.key === "Escape") {
                  setShowCreate(false);
                  setCreateBranch("");
                  setCreateBaseRef("");
                }
              }}
              style={{ flex: 1, padding: "4px 8px", fontSize: 11 }}
            />
            <input
              type="text"
              className="git-inline-input"
              placeholder={t("worktrees.baseRefPlaceholder")}
              value={createBaseRef}
              onChange={(e) => setCreateBaseRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateWorktree();
              }}
              style={{ width: 120, padding: "4px 8px", fontSize: 11, flexShrink: 0 }}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "4px 10px", fontSize: 11, flexShrink: 0 }}
              disabled={!createBranch.trim() || loadingKey !== null}
              onClick={() => void onCreateWorktree()}
            >
              {loadingKey === "create" ? <Loader2 size={11} className="git-spin" /> : null}
              {loadingKey === "create" ? t("worktrees.creating") : t("worktrees.create")}
            </button>
          </div>
          {autoWorktreePath && (
            <span className="git-worktree-path" title={autoWorktreePath}>
              {abbreviatePath(autoWorktreePath, repo.path)}
            </span>
          )}
        </div>
      )}

      {worktrees.length > 0 && (
        <div className="git-filter-bar">
          <div className="git-filter-input-wrap">
            <Search size={12} className="git-filter-icon" />
            <input
              type="text"
              className="git-inline-input"
              placeholder={t("worktrees.filterPlaceholder")}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              style={{ padding: "3px 8px 3px 24px", fontSize: 11 }}
            />
          </div>
          {filterQuery && (
            <button
              type="button"
              className="git-toolbar-btn"
              style={{ padding: 2 }}
              onClick={() => setFilterQuery("")}
            >
              <X size={12} />
            </button>
          )}
          {filterQuery && (
            <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
              {filteredWorktrees.length}/{worktrees.length}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {worktrees.length === 0 ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <GitFork size={20} />
            </div>
            <p className="git-empty-title">{t("worktrees.emptyTitle")}</p>
            <p className="git-empty-sub">{t("worktrees.emptyHint")}</p>
          </div>
        ) : filteredWorktrees.length === 0 ? (
          <p className="git-empty-inline">{t("worktrees.emptyFiltered")}</p>
        ) : (
          filteredWorktrees.map((wt) => {
            const isLoading = loadingKey === `remove:${wt.path}`;

            return (
              <div key={wt.path} className="git-branch-row">
                <span
                  className="git-branch-current-dot"
                  style={{
                    background: wt.isMain ? "var(--accent)" : "transparent",
                    border: wt.isMain ? "none" : "1px solid var(--border)",
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
                      className="git-branch-name"
                      style={{
                        color: wt.isMain ? "var(--text-1)" : "var(--text-2)",
                        fontWeight: wt.isMain ? 600 : 400,
                      }}
                    >
                      {wt.branch ?? t("worktrees.detached")}
                    </span>

                    {wt.isMain && (
                      <span className="git-badge git-badge-accent">{t("worktrees.main")}</span>
                    )}
                    {wt.isLocked && (
                      <span className="git-badge git-badge-muted">{t("worktrees.locked")}</span>
                    )}
                    {wt.isPrunable && (
                      <span className="git-badge git-badge-warning">{t("worktrees.prunable")}</span>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 1,
                      fontSize: 11,
                      color: "var(--text-3)",
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <span
                      className="git-worktree-path"
                      title={wt.path}
                    >
                      {abbreviatePath(wt.path, repo.path)}
                    </span>
                    {wt.headSha && (
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        {shortSha(wt.headSha)}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className="git-branch-row-actions"
                  style={isLoading ? { opacity: 1 } : undefined}
                >
                  {isLoading ? (
                    <Loader2 size={14} className="git-spin" />
                  ) : !wt.isMain ? (
                    <button
                      type="button"
                      className="git-toolbar-btn"
                      style={{ padding: 3 }}
                      onClick={(e) => openActionMenu(wt, e)}
                      title={t("worktrees.actionsTitle")}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {actionMenuPortal}
    </>
  );
}
