import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Pencil, Plus, Trash2, X } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { toast } from "../../stores/toastStore";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type { Repo } from "../../types";

interface Props {
  repo: Repo;
  onClose: () => void;
}

export function GitRemotesView({ repo, onClose }: Props) {
  const { remotes, remotesRepoPath, remotesLoading, loadRemotes, addRemote, removeRemote, renameRemote } =
    useGitStore();

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("origin");
  const [addUrl, setAddUrl] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const [renamingRemote, setRenamingRemote] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInFlightRef = useRef(false);
  const cancelRenameOnBlurRef = useRef(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    void loadRemotes(repo.path);
  }, [repo.path, loadRemotes]);

  const cancelRename = useCallback(() => {
    if (renameInFlightRef.current) {
      return;
    }
    cancelRenameOnBlurRef.current = true;
    setRenamingRemote(null);
    setRenameValue("");
  }, []);

  useEffect(() => {
    setShowAdd(false);
    setAddName("origin");
    setAddUrl("");
    setRenamingRemote(null);
    setRenameValue("");
    setConfirmDelete(null);
    cancelRenameOnBlurRef.current = false;
  }, [repo.path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (renamingRemote !== null) {
          e.preventDefault();
          e.stopPropagation();
          cancelRename();
          return;
        }
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [cancelRename, onClose, renamingRemote]);

  const handleAdd = useCallback(async () => {
    const trimmedName = addName.trim();
    const trimmedUrl = addUrl.trim();
    if (!trimmedName || !trimmedUrl) return;
    setAddLoading(true);
    try {
      await addRemote(repo.path, trimmedName, trimmedUrl);
      toast.success(`Remote "${trimmedName}" added`);
      setShowAdd(false);
      setAddName("origin");
      setAddUrl("");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAddLoading(false);
    }
  }, [addName, addUrl, addRemote, repo.path]);

  const handleDelete = useCallback(
    async (name: string) => {
      setConfirmDelete(null);
      try {
        await removeRemote(repo.path, name);
        toast.success(`Remote "${name}" removed`);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [removeRemote, repo.path],
  );

  const handleRename = useCallback(
    async (oldName: string) => {
      cancelRenameOnBlurRef.current = false;
      const newName = renameValue.trim();
      if (!newName || newName === oldName) {
        setRenamingRemote(null);
        return;
      }
      if (renameInFlightRef.current) return;
      renameInFlightRef.current = true;
      try {
        await renameRemote(repo.path, oldName, newName);
        toast.success(`Remote renamed to "${newName}"`);
        setRenamingRemote(null);
      } catch (e) {
        toast.error(String(e));
      } finally {
        renameInFlightRef.current = false;
      }
    },
    [renameValue, renameRemote, repo.path],
  );

  const visibleRemotes = remotesLoading || remotesRepoPath !== repo.path ? [] : remotes;

  return (
    <div className="confirm-dialog-backdrop" onMouseDown={onClose}>
      <div
        className="confirm-dialog-card"
        style={{ width: 420, maxHeight: "70vh", overflow: "auto", textAlign: "left" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <Link size={16} style={{ marginRight: 8, color: "var(--text-2)" }} />
          <h3 style={{ flex: 1, margin: 0, fontSize: 14, fontWeight: 600 }}>
            Manage Remotes
          </h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: "2px 4px" }}>
            <X size={14} />
          </button>
        </div>

        {remotesLoading && (
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "8px 0" }}>Loading...</p>
        )}

        {!remotesLoading && visibleRemotes.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "8px 0" }}>
            No remotes configured.
          </p>
        )}

        {visibleRemotes.map((remote) => (
          <div
            key={remote.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            {renamingRemote === remote.name ? (
              <input
                autoFocus
                className="git-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleRename(remote.name);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelRename();
                  }
                }}
                onBlur={() => {
                  if (cancelRenameOnBlurRef.current) {
                    cancelRenameOnBlurRef.current = false;
                    return;
                  }
                  void handleRename(remote.name);
                }}
                style={{ flex: 1, fontSize: 12 }}
              />
            ) : (
              <>
                <span style={{ fontWeight: 600, fontSize: 12, minWidth: 56, flexShrink: 0 }}>
                  {remote.name}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    color: "var(--text-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={remote.url}
                >
                  {remote.url}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  title="Rename"
                  style={{ padding: "2px 4px" }}
                  onClick={() => {
                    setRenamingRemote(remote.name);
                    setRenameValue(remote.name);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  title="Remove"
                  style={{ padding: "2px 4px" }}
                  onClick={() => setConfirmDelete(remote.name)}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        ))}

        {showAdd ? (
          <div style={{ marginTop: 12 }}>
            <input
              autoFocus
              className="git-input"
              placeholder="Name (e.g. origin)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              style={{ display: "block", width: "100%", fontSize: 12, marginBottom: 6 }}
            />
            <input
              className="git-input"
              placeholder="URL (e.g. https://github.com/user/repo.git)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              style={{ display: "block", width: "100%", fontSize: 12, marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowAdd(false);
                  setAddName("origin");
                  setAddUrl("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={addLoading || !addName.trim() || !addUrl.trim()}
                onClick={() => void handleAdd()}
              >
                {addLoading ? "Adding..." : "Add Remote"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => setShowAdd(true)}
          >
            <Plus size={13} /> Add Remote
          </button>
        )}

      </div>

      {createPortal(
        <ConfirmDialog
          open={confirmDelete !== null}
          title={`Remove remote "${confirmDelete ?? ""}"`}
          message={`This will remove the remote "${confirmDelete ?? ""}" from this repository. You can re-add it later.`}
          confirmLabel="Remove"
          onConfirm={() => void handleDelete(confirmDelete!)}
          onCancel={() => setConfirmDelete(null)}
        />,
        document.body,
      )}
    </div>
  );
}
