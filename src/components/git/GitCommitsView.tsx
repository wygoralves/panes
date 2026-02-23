import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  GitCommitHorizontal,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import { DiffPanel } from "./GitChangesView";
import type { GitResetMode, Repo } from "../../types";

interface Props {
  repo: Repo;
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

interface CommitActionMenuState {
  commitHash: string;
  shortHash: string;
  subject: string;
  top: number;
  left: number;
}

interface ResetPromptState {
  commitHash: string;
  shortHash: string;
  mode: GitResetMode;
}

export function GitCommitsView({ repo }: Props) {
  const {
    commits,
    commitsHasMore,
    commitsTotal,
    loadCommits,
    loadMoreCommits,
    selectedCommitHash,
    commitDiff,
    selectCommit,
    clearCommitSelection,
    revertCommit,
    cherryPickCommit,
    resetToCommit,
  } = useGitStore();

  const [loadingMore, setLoadingMore] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<CommitActionMenuState | null>(null);
  const [revertPrompt, setRevertPrompt] = useState<{ hash: string; shortHash: string; subject: string } | null>(null);
  const [cherryPickPrompt, setCherryPickPrompt] = useState<{ hash: string; shortHash: string; subject: string } | null>(null);
  const [resetPrompt, setResetPrompt] = useState<ResetPromptState | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => setActionMenu(null), []);

  useEffect(() => {
    if (!actionMenu) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        actionMenuRef.current?.contains(target) ||
        actionTriggerRef.current?.contains(target)
      ) return;
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

  useEffect(() => {
    void loadCommits(repo.path, false);
    clearCommitSelection();
  }, [repo.path, loadCommits, clearCommitSelection]);

  useEffect(() => {
    setFilterQuery("");
  }, [repo.path]);

  const filteredCommits = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return commits;
    return commits.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.shortHash.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q),
    );
  }, [commits, filterQuery]);

  async function onLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      await loadMoreCommits(repo.path);
    } finally {
      setLoadingMore(false);
    }
  }

  function openCommitMenu(commit: { hash: string; shortHash: string; subject: string }, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (actionMenu?.commitHash === commit.hash) {
      closeMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    actionTriggerRef.current = e.currentTarget;
    setActionMenu({
      commitHash: commit.hash,
      shortHash: commit.shortHash,
      subject: commit.subject,
      top: rect.bottom + 4,
      left: rect.right - 180,
    });
  }

  async function onRevert(hash: string, shortHash: string) {
    if (loadingAction !== null) return;
    setRevertPrompt(null);
    setLoadingAction(`revert:${hash}`);
    try {
      await revertCommit(repo.path, hash);
      toast.success(`Reverted commit ${shortHash}`);
    } catch {
      // error is set in store
    } finally {
      setLoadingAction(null);
    }
  }

  async function onCherryPick(hash: string, shortHash: string) {
    if (loadingAction !== null) return;
    setCherryPickPrompt(null);
    setLoadingAction(`cherry-pick:${hash}`);
    try {
      await cherryPickCommit(repo.path, hash);
      toast.success(`Cherry-picked commit ${shortHash}`);
    } catch {
      // error is set in store
    } finally {
      setLoadingAction(null);
    }
  }

  async function onReset(hash: string, shortHash: string, mode: GitResetMode) {
    if (loadingAction !== null) return;
    setResetPrompt(null);
    setLoadingAction(`reset:${hash}`);
    try {
      await resetToCommit(repo.path, hash, mode);
      toast.success(`Reset (${mode}) to ${shortHash}`);
    } catch {
      // error is set in store
    } finally {
      setLoadingAction(null);
    }
  }

  const commitActionMenuPortal = actionMenu
    ? createPortal(
        <div
          ref={actionMenuRef}
          className="git-action-menu"
          style={{
            position: "fixed",
            top: actionMenu.top,
            left: actionMenu.left,
            minWidth: 180,
          }}
        >
          <button
            type="button"
            className="git-action-menu-item"
            disabled={loadingAction !== null}
            onClick={() => {
              closeMenu();
              setRevertPrompt({ hash: actionMenu.commitHash, shortHash: actionMenu.shortHash, subject: actionMenu.subject });
            }}
          >
            <Undo2 size={13} />
            Revert commit
          </button>
          <button
            type="button"
            className="git-action-menu-item"
            disabled={loadingAction !== null}
            onClick={() => {
              closeMenu();
              setCherryPickPrompt({ hash: actionMenu.commitHash, shortHash: actionMenu.shortHash, subject: actionMenu.subject });
            }}
          >
            <Copy size={13} />
            Cherry-pick
          </button>
          <div className="git-action-menu-separator" />
          <button
            type="button"
            className="git-action-menu-item"
            disabled={loadingAction !== null}
            onClick={() => {
              closeMenu();
              setResetPrompt({ commitHash: actionMenu.commitHash, shortHash: actionMenu.shortHash, mode: "soft" });
            }}
          >
            <RotateCcw size={13} />
            Reset soft
          </button>
          <button
            type="button"
            className="git-action-menu-item"
            disabled={loadingAction !== null}
            onClick={() => {
              closeMenu();
              setResetPrompt({ commitHash: actionMenu.commitHash, shortHash: actionMenu.shortHash, mode: "mixed" });
            }}
          >
            <RotateCcw size={13} />
            Reset mixed
          </button>
          <button
            type="button"
            className="git-action-menu-item git-action-menu-item-danger"
            disabled={loadingAction !== null}
            onClick={() => {
              closeMenu();
              setResetPrompt({ commitHash: actionMenu.commitHash, shortHash: actionMenu.shortHash, mode: "hard" });
            }}
          >
            <RotateCcw size={13} />
            Reset hard
          </button>
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
          fontSize: 11,
          color: "var(--text-3)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>History</span>
        <span>
          {filterQuery
            ? `${filteredCommits.length}/${commitsTotal} commits`
            : `${commitsTotal} commits`}
        </span>
      </div>

      {commits.length > 0 && (
        <div className="git-filter-bar">
          <Search size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="text"
            className="git-inline-input"
            placeholder="Filter commits..."
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
              {filteredCommits.length}/{commits.length}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {commits.length === 0 ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <GitCommitHorizontal size={20} />
            </div>
            <p className="git-empty-title">No commits yet</p>
            <p className="git-empty-sub">Commit changes to build history</p>
          </div>
        ) : (
          filteredCommits.length === 0 ? (
            <p className="git-empty-inline">No matching commits</p>
          ) : filteredCommits.map((entry) => {
            const isSelected = selectedCommitHash === entry.hash;
            const isLoadingDiff = isSelected && !commitDiff;

            return (
              <div key={entry.hash}>
                <div
                  className={`git-commit-row${isSelected ? " git-commit-row-selected" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => void selectCommit(repo.path, entry.hash)}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span className="git-commit-hash">
                      {entry.shortHash}
                    </span>
                    <span
                      className="git-commit-subject"
                      title={entry.subject}
                    >
                      {entry.subject}
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="git-toolbar-btn git-commit-action-btn"
                      style={{ padding: 3, flexShrink: 0 }}
                      onClick={(e) => openCommitMenu(entry, e)}
                      title="Commit actions"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                  <div className="git-commit-meta">
                    <span>{entry.authorName}</span>
                    <span>{"\u00B7"}</span>
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
                </div>
                {isSelected && (
                  <div style={{ borderBottom: "1px solid var(--border)" }}>
                    {isLoadingDiff ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          padding: "12px",
                          fontSize: 11,
                          color: "var(--text-3)",
                        }}
                      >
                        <Loader2 size={13} className="git-spin" />
                        Loading diff...
                      </div>
                    ) : commitDiff ? (
                      <div style={{ maxHeight: 400, overflow: "auto" }}>
                        <DiffPanel diff={commitDiff} />
                      </div>
                    ) : (
                      <p
                        style={{
                          margin: 0,
                          padding: "12px",
                          fontSize: 11,
                          color: "var(--text-3)",
                          textAlign: "center",
                        }}
                      >
                        No changes in this commit
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {commitsHasMore && !filterQuery && (
          <div style={{ padding: "10px 12px" }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void onLoadMore()}
              disabled={loadingMore}
              style={{
                width: "100%",
                justifyContent: "center",
                fontSize: 12,
                opacity: loadingMore ? 0.6 : 1,
              }}
            >
              {loadingMore ? (
                <Loader2 size={13} className="git-spin" />
              ) : null}
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>

      {commitActionMenuPortal}

      <ConfirmDialog
        open={revertPrompt !== null}
        title="Revert commit"
        message={revertPrompt ? `Create a new commit that undoes the changes from ${revertPrompt.shortHash} "${revertPrompt.subject}"?` : ""}
        confirmLabel="Revert"
        onConfirm={() => {
          if (revertPrompt) void onRevert(revertPrompt.hash, revertPrompt.shortHash);
        }}
        onCancel={() => setRevertPrompt(null)}
      />

      <ConfirmDialog
        open={cherryPickPrompt !== null}
        title="Cherry-pick commit"
        message={cherryPickPrompt ? `Apply changes from ${cherryPickPrompt.shortHash} "${cherryPickPrompt.subject}" to the current branch?` : ""}
        confirmLabel="Cherry-pick"
        onConfirm={() => {
          if (cherryPickPrompt) void onCherryPick(cherryPickPrompt.hash, cherryPickPrompt.shortHash);
        }}
        onCancel={() => setCherryPickPrompt(null)}
      />

      <ConfirmDialog
        open={resetPrompt !== null}
        title={`Reset ${resetPrompt?.mode ?? ""}`}
        message={
          resetPrompt
            ? resetPrompt.mode === "hard"
              ? `Reset to ${resetPrompt.shortHash}? All uncommitted changes will be permanently lost. This cannot be undone.`
              : resetPrompt.mode === "soft"
                ? `Soft reset to ${resetPrompt.shortHash}? Changes from later commits will be kept in the staging area.`
                : `Mixed reset to ${resetPrompt.shortHash}? Changes from later commits will be kept as unstaged changes.`
            : ""
        }
        confirmLabel={resetPrompt?.mode === "hard" ? "Reset hard" : "Reset"}
        onConfirm={() => {
          if (resetPrompt) void onReset(resetPrompt.commitHash, resetPrompt.shortHash, resetPrompt.mode);
        }}
        onCancel={() => setResetPrompt(null)}
      />
    </>
  );
}
