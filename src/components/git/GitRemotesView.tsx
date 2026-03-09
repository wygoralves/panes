import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("git");
  const {
    remotes,
    remotesRepoPath,
    remotesLoading,
    remotesError,
    loadRemotes,
    addRemote,
    removeRemote,
    renameRemote,
  } = useGitStore();

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("origin");
  const [addUrl, setAddUrl] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const [renamingRemote, setRenamingRemote] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInFlightRef = useRef(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    void loadRemotes(repo.path);
  }, [repo.path, loadRemotes]);

  const cancelRename = useCallback(() => {
    if (renameInFlightRef.current) {
      return;
    }
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
      toast.success(t("remotes.toasts.added", { name: trimmedName }));
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
        toast.success(t("remotes.toasts.removed", { name }));
      } catch (e) {
        toast.error(String(e));
      }
    },
    [removeRemote, repo.path],
  );

  const handleRename = useCallback(
    async (oldName: string) => {
      const newName = renameValue.trim();
      if (!newName || newName === oldName) {
        setRenamingRemote(null);
        return;
      }
      if (renameInFlightRef.current) return;
      renameInFlightRef.current = true;
      try {
        await renameRemote(repo.path, oldName, newName);
        toast.success(t("remotes.toasts.renamed", { name: newName }));
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
        className="git-remotes-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="git-remotes-header">
          <Link size={14} className="git-remotes-header-icon" />
          <h3 className="git-remotes-title">{t("remotes.title")}</h3>
          <button type="button" className="btn btn-ghost git-remotes-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="git-remotes-list">
          {remotesLoading && (
            <p className="git-remotes-empty">{t("remotes.loading")}</p>
          )}

          {!remotesLoading && remotesRepoPath === repo.path && remotesError && (
            <p className="git-remotes-error">{remotesError}</p>
          )}

          {!remotesLoading && !remotesError && visibleRemotes.length === 0 && (
            <p className="git-remotes-empty">{t("remotes.empty")}</p>
          )}

          {visibleRemotes.map((remote) => (
            <div key={remote.name} className="git-remotes-row">
              {renamingRemote === remote.name ? (
                <input
                  autoFocus
                  className="git-inline-input"
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
                  onBlur={cancelRename}
                />
              ) : (
                <>
                  <span className="git-remotes-name">{remote.name}</span>
                  <span className="git-remotes-url" title={remote.url}>
                    {remote.url}
                  </span>
                  <div className="git-remotes-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      title={t("remotes.rename")}
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
                      title={t("remotes.remove")}
                      onClick={() => setConfirmDelete(remote.name)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {showAdd ? (
          <div className="git-remotes-add-form">
            <div className="git-remotes-add-inputs">
              <input
                autoFocus
                className="git-inline-input"
                placeholder={t("remotes.namePlaceholder")}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                style={{ width: 100, flexShrink: 0 }}
              />
              <input
                className="git-inline-input"
                placeholder={t("remotes.urlPlaceholder")}
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAdd();
                }}
                style={{ flex: 1 }}
              />
            </div>
            <div className="git-remotes-add-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowAdd(false);
                  setAddName("origin");
                  setAddUrl("");
                }}
              >
                {t("actions.cancel", { ns: "common" })}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={addLoading || !addName.trim() || !addUrl.trim()}
                onClick={() => void handleAdd()}
              >
                {addLoading ? t("remotes.adding") : t("remotes.add")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
          className="btn btn-ghost git-remotes-add-btn"
          onClick={() => setShowAdd(true)}
        >
            <Plus size={13} /> {t("remotes.addRemote")}
          </button>
        )}
      </div>

      {createPortal(
        <ConfirmDialog
          open={confirmDelete !== null}
          title={t("remotes.removeTitle", { name: confirmDelete ?? "" })}
          message={t("remotes.removeMessage", { name: confirmDelete ?? "" })}
          confirmLabel={t("remotes.remove")}
          onConfirm={() => void handleDelete(confirmDelete!)}
          onCancel={() => setConfirmDelete(null)}
        />,
        document.body,
      )}
    </div>
  );
}
