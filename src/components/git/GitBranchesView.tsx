import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Plus, X, MoreHorizontal, GitBranch, GitBranchPlus, GitMerge, Pencil, Trash2, Loader2, Search } from "lucide-react";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Repo, GitBranchScope } from "../../types";

interface Props {
  repo: Repo;
  onError: (error: string | undefined) => void;
}

function formatDate(raw?: string): string {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ActionMenuState {
  branchName: string;
  top: number;
  left: number;
}

export function GitBranchesView({ repo, onError }: Props) {
  const {
    branchScope,
    setBranchScope,
    branches,
    status,
    loadBranches,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    mergeBranch,
    drafts,
    setBranchNameDraft,
    pushBranchHistory,
  } = useGitStore();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
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
  const [mergePrompt, setMergePrompt] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void loadBranches(repo.path, branchScope);
  }, [repo.path, branchScope, loadBranches]);

  useEffect(() => {
    setFilterQuery("");
  }, [repo.path, branchScope]);

  const filteredBranches = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, filterQuery]);

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

  function openActionMenu(branchName: string, e: React.MouseEvent<HTMLButtonElement>) {
    if (actionMenu?.branchName === branchName) {
      closeMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    actionTriggerRef.current = e.currentTarget;
    setActionMenu({
      branchName,
      top: rect.bottom + 4,
      left: rect.right - 140,
    });
  }

  async function onCheckout(branchName: string, isRemote: boolean) {
    if (loadingKey !== null) return;
    setLoadingKey(`checkout:${branchName}`);
    try {
      onError(undefined);
      await checkoutBranch(repo.path, branchName, isRemote);
      toast.success(`Switched to ${branchName}`);
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
      toast.success(`Created branch: ${name}`);
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
      toast.success("Renamed branch");
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
      toast.success(`Deleted branch: ${branchName}`);
    } catch (e) {
      try {
        await deleteBranch(repo.path, branchName, true);
        toast.success(`Deleted branch: ${branchName}`);
      } catch (e2) {
        onError(String(e2));
      }
    } finally {
      setLoadingKey(null);
    }
  }

  async function onMergeBranch(branchName: string) {
    if (loadingKey !== null) return;
    setMergePrompt(null);
    setLoadingKey(`merge:${branchName}`);
    try {
      onError(undefined);
      await mergeBranch(repo.path, branchName);
      toast.success(`Merged ${branchName} into ${status?.branch ?? "current branch"}`);
    } catch (e) {
      onError(String(e));
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
                Checkout
              </button>
            )}
            {!menuBranch.isCurrent && (
              <button
                type="button"
                className="git-action-menu-item"
                disabled={loadingKey !== null}
                onClick={() => {
                  closeMenu();
                  setMergePrompt(menuBranch.name);
                }}
              >
                <GitMerge size={13} />
                Merge into current
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
                Rename
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
                {confirmingDelete === menuBranch.name ? "Confirm delete?" : "Delete"}
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
          borderBottom: "1px solid var(--border)",
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
              {scope === "local" ? "Local" : "Remote"}
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
          {showNewBranch ? "Cancel" : "New branch"}
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
            placeholder="Branch name..."
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
            {loadingKey === "create" ? "Creating..." : "Create"}
          </button>
        </div>
      )}

      {branches.length > 0 && (
        <div className="git-filter-bar">
          <Search size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="text"
            className="git-inline-input"
            placeholder="Filter branches..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{ padding: "3px 8px", fontSize: 11 }}
          />
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
              {filteredBranches.length}/{branches.length}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {branches.length === 0 ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <GitBranch size={20} />
            </div>
            <p className="git-empty-title">No branches found</p>
            <p className="git-empty-sub">Create a branch to get started</p>
          </div>
        ) : filteredBranches.length === 0 ? (
          <p className="git-empty-inline">No matching branches</p>
        ) : (
          filteredBranches.map((branch) => {
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
                        Current
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
                        <span>{formatDate(branch.lastCommitAt)}</span>
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
                      title="Branch actions"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {actionMenuPortal}

      <ConfirmDialog
        open={mergePrompt !== null}
        title="Merge branch"
        message={mergePrompt ? `Merge "${mergePrompt}" into "${status?.branch ?? "current branch"}"?` : ""}
        confirmLabel="Merge"
        onConfirm={() => {
          if (mergePrompt) void onMergeBranch(mergePrompt);
        }}
        onCancel={() => setMergePrompt(null)}
      />
    </>
  );
}
