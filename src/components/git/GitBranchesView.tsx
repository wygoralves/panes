import { useEffect, useState, useRef } from "react";
import { Plus, X } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
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

export function GitBranchesView({ repo, onError }: Props) {
  const {
    branchScope,
    setBranchScope,
    branches,
    loadBranches,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
  } = useGitStore();

  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadBranches(repo.path, branchScope);
  }, [repo.path, branchScope, loadBranches]);

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

  async function onCheckout(branchName: string, isRemote: boolean) {
    try {
      onError(undefined);
      await checkoutBranch(repo.path, branchName, isRemote);
    } catch (e) {
      onError(String(e));
    }
  }

  async function onCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    try {
      onError(undefined);
      await createBranch(repo.path, name, null);
      setNewBranchName("");
      setShowNewBranch(false);
    } catch (e) {
      onError(String(e));
    }
  }

  async function onRenameBranch(oldName: string) {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) {
      setRenamingBranch(null);
      return;
    }
    try {
      onError(undefined);
      await renameBranch(repo.path, oldName, newName);
      setRenamingBranch(null);
    } catch (e) {
      onError(String(e));
    }
  }

  async function onDeleteBranch(branchName: string) {
    if (confirmingDelete !== branchName) {
      setConfirmingDelete(branchName);
      return;
    }
    try {
      onError(undefined);
      setConfirmingDelete(null);
      await deleteBranch(repo.path, branchName, false);
    } catch (e) {
      try {
        await deleteBranch(repo.path, branchName, true);
      } catch (e2) {
        onError(String(e2));
      }
    }
  }

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
            setShowNewBranch(!showNewBranch);
            setNewBranchName("");
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
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreateBranch();
              if (e.key === "Escape") {
                setShowNewBranch(false);
                setNewBranchName("");
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "4px 10px", fontSize: 11 }}
            disabled={!newBranchName.trim()}
            onClick={() => void onCreateBranch()}
          >
            Create
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {branches.length === 0 ? (
          <p className="git-empty">No branches found</p>
        ) : (
          branches.map((branch) => {
            const isRenaming = renamingBranch === branch.name;
            const trackSummary = branch.upstream
              ? `${branch.upstream}${
                  branch.ahead || branch.behind
                    ? ` \u00B7 +${branch.ahead} -${branch.behind}`
                    : ""
                }`
              : "No upstream";

            return (
              <div
                key={branch.fullName}
                className="git-branch-row"
                onDoubleClick={() => {
                  if (!branch.isCurrent)
                    void onCheckout(branch.name, branch.isRemote);
                }}
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

                  <div
                    style={{
                      marginTop: 1,
                      fontSize: 11,
                      color: "var(--text-3)",
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <span>{trackSummary}</span>
                    {branch.lastCommitAt && (
                      <span>{formatDate(branch.lastCommitAt)}</span>
                    )}
                  </div>
                </div>

                <div className="git-branch-row-actions">
                  {!branch.isCurrent && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "3px 6px", fontSize: 11 }}
                      onClick={() =>
                        void onCheckout(branch.name, branch.isRemote)
                      }
                    >
                      Checkout
                    </button>
                  )}

                  {!branch.isRemote && !isRenaming && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "3px 6px", fontSize: 11 }}
                      onClick={() => {
                        setRenamingBranch(branch.name);
                        setRenameValue(branch.name);
                      }}
                    >
                      Rename
                    </button>
                  )}

                  {!branch.isRemote && !branch.isCurrent && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{
                        padding: "3px 6px",
                        fontSize: 11,
                        color:
                          confirmingDelete === branch.name
                            ? "var(--danger)"
                            : undefined,
                      }}
                      onClick={() => void onDeleteBranch(branch.name)}
                    >
                      {confirmingDelete === branch.name
                        ? "Confirm?"
                        : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
