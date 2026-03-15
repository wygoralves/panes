import { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus, X, MoreHorizontal, GitBranch, GitBranchPlus, Pencil, Trash2, Loader2, Search } from "lucide-react";
import { formatDateTime } from "../../lib/formatters";
import { getActionMenuPosition } from "./actionMenuPosition";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Repo, GitBranchScope } from "../../types";

interface Props {
  repo: Repo;
  onError: (error: string | undefined) => void;
}

interface ActionMenuState {
  branchName: string;
  triggerRect: {
    top: number;
    bottom: number;
    right: number;
  };
  top: number;
  left: number;
}

export function GitBranchesView({ repo, onError }: Props) {
  const { t, i18n } = useTranslation("git");
  const {
    branchScope,
    setBranchScope,
    branches,
    branchesTotal,
    branchesHasMore,
    branchSearch,
    loadBranches,
    loadMoreBranches,
    setBranchSearch,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    drafts,
    setBranchNameDraft,
    pushBranchHistory,
  } = useGitStore();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState(branchSearch);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const newBranchName = drafts.branchName;
  const setNewBranchName = useCallback(
    (value: string) => {
      if (activeWorkspaceId) setBranchNameDraft(activeWorkspaceId, value);
    },
    [activeWorkspaceId, setBranchNameDraft],
  );
  const branchHistCursorRef = useRef<number>(-1);
  const branchLiveDraftRef = useRef<string>("");
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setLocalSearch("");
    void loadBranches(repo.path, branchScope, "");
  }, [repo.path, branchScope, loadBranches]);

  const onSearchChange = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        void setBranchSearch(repo.path, value);
      }, 300);
    },
    [repo.path, setBranchSearch],
  );

  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    },
    [],
  );

  useEffect(() => {
    if (showNewBranch) newBranchInputRef.current?.focus();
  }, [showNewBranch]);

  useEffect(() => {
    if (renamingBranch) renameInputRef.current?.focus();
  }, [renamingBranch]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

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

  useLayoutEffect(() => {
    if (!actionMenu || !actionMenuRef.current) return;
    const next = getActionMenuPosition({
      triggerRect: actionMenu.triggerRect,
      menuWidth: actionMenuRef.current.offsetWidth,
      menuHeight: actionMenuRef.current.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    if (next.top === actionMenu.top && next.left === actionMenu.left) return;
    setActionMenu((current) =>
      current && current.branchName === actionMenu.branchName
        ? { ...current, ...next }
        : current,
    );
  }, [actionMenu]);

  function openActionMenu(branchName: string, e: React.MouseEvent<HTMLButtonElement>) {
    if (actionMenu?.branchName === branchName) {
      closeMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const branch = branches.find((item) => item.name === branchName);
    const actionCount =
      (branch && !branch.isCurrent ? 1 : 0) +
      (branch && !branch.isRemote ? 1 : 0) +
      (branch && !branch.isRemote && !branch.isCurrent ? 1 : 0);
    const estimatedHeight = Math.max(1, actionCount) * 32 + 8;
    actionTriggerRef.current = e.currentTarget;
    const triggerRect = {
      top: rect.top,
      bottom: rect.bottom,
      right: rect.right,
    };
    setActionMenu({
      branchName,
      triggerRect,
      ...getActionMenuPosition({
        triggerRect,
        menuWidth: 140,
        menuHeight: estimatedHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    });
  }

  async function onCheckout(branchName: string, isRemote: boolean) {
    if (loadingKey !== null) return;
    setLoadingKey(`checkout:${branchName}`);
    try {
      onError(undefined);
      await checkoutBranch(repo.path, branchName, isRemote);
      toast.success(t("branches.toasts.switchedTo", { branchName }));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onCreateBranch() {
    const name = newBranchName.trim();
    if (!name || loadingKey !== null) return;
    setLoadingKey("create");
    try {
      onError(undefined);
      await createBranch(repo.path, name, null);
      if (activeWorkspaceId) pushBranchHistory(activeWorkspaceId, name);
      branchHistCursorRef.current = -1;
      branchLiveDraftRef.current = "";
      setShowNewBranch(false);
      toast.success(t("branches.toasts.createdAndSwitched", { branchName: name }));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onRenameBranch(oldName: string) {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) {
      setRenamingBranch(null);
      return;
    }
    if (loadingKey !== null) return;
    setLoadingKey(`rename:${oldName}`);
    try {
      onError(undefined);
      await renameBranch(repo.path, oldName, newName);
      setRenamingBranch(null);
      toast.success(t("branches.toasts.renamed"));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onDeleteBranch(branchName: string) {
    if (confirmingDelete !== branchName) {
      setConfirmingDelete(branchName);
      return;
    }
    if (loadingKey !== null) return;
    setLoadingKey(`delete:${branchName}`);
    try {
      onError(undefined);
      setConfirmingDelete(null);
      await deleteBranch(repo.path, branchName, false);
      toast.success(t("branches.toasts.deleted", { branchName }));
    } catch (e) {
      try {
        await deleteBranch(repo.path, branchName, true);
        toast.success(t("branches.toasts.deleted", { branchName }));
      } catch (e2) {
        onError(String(e2));
      }
    } finally {
      setLoadingKey(null);
    }
  }

  const menuBranch = actionMenu
    ? branches.find((b) => b.name === actionMenu.branchName)
    : null;

  const actionMenuPortal =
    actionMenu && menuBranch
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
            {!menuBranch.isCurrent && (
              <button
                type="button"
                className="git-action-menu-item"
                disabled={loadingKey !== null}
                onClick={() => {
                  closeMenu();
                  void onCheckout(menuBranch.name, menuBranch.isRemote);
                }}
              >
                <GitBranchPlus size={13} />
                {t("branches.actions.checkout")}
              </button>
            )}
            {!menuBranch.isRemote && renamingBranch !== menuBranch.name && (
              <button
                type="button"
                className="git-action-menu-item"
                disabled={loadingKey !== null}
                onClick={() => {
                  closeMenu();
                  setRenamingBranch(menuBranch.name);
                  setRenameValue(menuBranch.name);
                }}
              >
                <Pencil size={13} />
                {t("branches.actions.rename")}
              </button>
            )}
            {!menuBranch.isRemote && !menuBranch.isCurrent && (
              <button
                type="button"
                className={`git-action-menu-item${
                  confirmingDelete === menuBranch.name
                    ? " git-action-menu-item-danger"
                    : ""
                }`}
                disabled={loadingKey !== null}
                onClick={() => {
                  void onDeleteBranch(menuBranch.name);
                  if (confirmingDelete === menuBranch.name) closeMenu();
                }}
              >
                <Trash2 size={13} />
                {confirmingDelete === menuBranch.name
                  ? t("branches.actions.confirmDelete")
                  : t("branches.actions.delete")}
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
        <div className="git-scope-toggle">
          {(["local", "remote"] as GitBranchScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              className={`git-scope-btn${branchScope === scope ? " git-scope-btn-active" : ""}`}
              onClick={() => setBranchScope(scope)}
            >
              {scope === "local"
                ? t("branches.scope.local")
                : t("branches.scope.remote")}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "3px 8px", fontSize: 11 }}
          onClick={() => {
            if (showNewBranch) setNewBranchName("");
            setShowNewBranch(!showNewBranch);
          }}
        >
          {showNewBranch ? <X size={11} /> : <Plus size={11} />}
          {showNewBranch ? t("actions.cancel", { ns: "common" }) : t("branches.new")}
        </button>
      </div>

      {showNewBranch && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 6,
          }}
        >
          <input
            ref={newBranchInputRef}
            type="text"
            className="git-inline-input"
            placeholder={t("branches.branchNamePlaceholder")}
            value={newBranchName}
            onChange={(e) => {
              setNewBranchName(e.target.value);
              branchHistCursorRef.current = -1;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void onCreateBranch();
                return;
              }
              if (e.key === "Escape") {
                setShowNewBranch(false);
                setNewBranchName("");
                return;
              }
              const history = drafts.branchHistory;
              if (e.key === "ArrowUp" && history.length > 0) {
                e.preventDefault();
                if (branchHistCursorRef.current === -1) {
                  branchLiveDraftRef.current = newBranchName;
                }
                const next = Math.min(branchHistCursorRef.current + 1, history.length - 1);
                branchHistCursorRef.current = next;
                setNewBranchName(history[next]);
                return;
              }
              if (e.key === "ArrowDown" && branchHistCursorRef.current >= 0) {
                e.preventDefault();
                const next = branchHistCursorRef.current - 1;
                branchHistCursorRef.current = next;
                setNewBranchName(next === -1 ? branchLiveDraftRef.current : history[next]);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "4px 10px", fontSize: 11 }}
            disabled={!newBranchName.trim() || loadingKey !== null}
            onClick={() => void onCreateBranch()}
          >
            {loadingKey === "create" ? (
              <Loader2 size={11} className="git-spin" />
            ) : null}
            {loadingKey === "create" ? t("branches.creating") : t("branches.create")}
          </button>
        </div>
      )}

      {(branchesTotal > 0 || localSearch) && (
        <div className="git-filter-bar">
          <div className="git-filter-input-wrap">
            <Search size={12} className="git-filter-icon" />
            <input
              type="text"
              className="git-inline-input"
              placeholder={t("branches.searchPlaceholder")}
              value={localSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ padding: "3px 8px 3px 24px", fontSize: 11 }}
            />
          </div>
          {localSearch && (
            <button
              type="button"
              className="git-toolbar-btn"
              style={{ padding: 2 }}
              onClick={() => onSearchChange("")}
            >
              <X size={12} />
            </button>
          )}
          {localSearch && (
            <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
              {branches.length}/{branchesTotal}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {branches.length === 0 && !localSearch ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <GitBranch size={20} />
            </div>
            <p className="git-empty-title">{t("branches.emptyTitle")}</p>
            <p className="git-empty-sub">{t("branches.emptyHint")}</p>
          </div>
        ) : branches.length === 0 ? (
          <p className="git-empty-inline">{t("branches.emptyFiltered")}</p>
        ) : (
          branches.map((branch) => {
            const isRenaming = renamingBranch === branch.name;
            const remoteName = branch.upstream
              ? branch.upstream.split("/")[0]
              : null;
            const hasSync = !!(branch.ahead || branch.behind);
            const hasSecondLine = !!(remoteName || hasSync || branch.lastCommitAt);

            const hasActions =
              !branch.isCurrent ||
              (!branch.isRemote && !isRenaming) ||
              (!branch.isRemote && !branch.isCurrent);

            return (
              <div
                key={branch.fullName}
                className="git-branch-row"
              >
                <span
                  className="git-branch-current-dot"
                  style={{
                    background: branch.isCurrent
                      ? "var(--accent)"
                      : "transparent",
                    border: branch.isCurrent
                      ? "none"
                      : "1px solid var(--border)",
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
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        className="git-inline-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            void onRenameBranch(branch.name);
                          if (e.key === "Escape") setRenamingBranch(null);
                        }}
                        onBlur={() => void onRenameBranch(branch.name)}
                        style={{ padding: "2px 6px", fontSize: 12 }}
                      />
                    ) : (
                      <span
                        className="git-branch-name"
                        style={{
                          color: branch.isCurrent
                            ? "var(--text-1)"
                            : "var(--text-2)",
                          fontWeight: branch.isCurrent ? 600 : 400,
                        }}
                      >
                        {branch.name}
                      </span>
                    )}

                    {branch.isCurrent && !isRenaming && (
                      <span className="git-badge git-badge-accent">
                        {t("branches.current")}
                      </span>
                    )}
                  </div>

                  {hasSecondLine && (
                    <div
                      style={{
                        marginTop: 1,
                        fontSize: 11,
                        color: "var(--text-3)",
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      {remoteName && <span>{remoteName}</span>}
                      {hasSync && (
                        <span className="git-ahead-behind">
                          {branch.ahead ? <span className="git-ahead">↑{branch.ahead}</span> : null}
                          {branch.behind ? <span className="git-behind">↓{branch.behind}</span> : null}
                        </span>
                      )}
                      {branch.lastCommitAt && (
                        <span>{formatDateTime(branch.lastCommitAt, i18n.language)}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="git-branch-row-actions">
                  {hasActions && (
                    <button
                      type="button"
                      className="git-toolbar-btn"
                      style={{ padding: 3 }}
                      onClick={(e) => openActionMenu(branch.name, e)}
                      title={t("branches.actionsTitle")}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        {branchesHasMore && (
          <div style={{ padding: "10px 12px" }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                if (loadingMore) return;
                setLoadingMore(true);
                void loadMoreBranches(repo.path).finally(() => setLoadingMore(false));
              }}
              disabled={loadingMore}
              style={{ width: "100%", justifyContent: "center", fontSize: 12, opacity: loadingMore ? 0.6 : 1 }}
            >
              {loadingMore ? <Loader2 size={13} className="git-spin" /> : null}
              {loadingMore
                ? t("branches.loadingMore")
                : t("branches.loadMore", {
                    current: branches.length,
                    total: branchesTotal,
                  })}
            </button>
          </div>
        )}
      </div>

      {actionMenuPortal}
    </>
  );
}
