import { useEffect, useState, useMemo } from "react";
import { Loader2, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import type { Repo } from "../../types";

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

export function GitTagsView({ repo, onError }: Props) {
  const { tags, loadTags, createTag, deleteTag } = useGitStore();

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [showNewTag, setShowNewTag] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<string | null>(null);

  useEffect(() => {
    void loadTags(repo.path);
  }, [repo.path, loadTags]);

  useEffect(() => {
    setFilterQuery("");
    setTagName("");
    setTagMessage("");
    setShowNewTag(false);
  }, [repo.path]);

  const filteredTags = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return tags;
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.message && t.message.toLowerCase().includes(q)) ||
        t.commitHash.toLowerCase().includes(q),
    );
  }, [tags, filterQuery]);

  async function onCreateTag() {
    const name = tagName.trim();
    if (!name || loadingKey !== null) return;
    setLoadingKey("create");
    try {
      onError(undefined);
      const msg = tagMessage.trim() || undefined;
      await createTag(repo.path, name, null, msg);
      setTagName("");
      setTagMessage("");
      setShowNewTag(false);
      toast.success(`Created tag: ${name}`);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onDeleteTag(name: string) {
    if (loadingKey !== null) return;
    setDeletePrompt(null);
    setLoadingKey(`delete:${name}`);
    try {
      onError(undefined);
      await deleteTag(repo.path, name);
      toast.success(`Deleted tag: ${name}`);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          {filterQuery
            ? `${filteredTags.length}/${tags.length} tags`
            : `${tags.length} tags`}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "3px 8px", fontSize: 11 }}
          onClick={() => {
            if (showNewTag) {
              setTagName("");
              setTagMessage("");
            }
            setShowNewTag(!showNewTag);
          }}
        >
          {showNewTag ? <X size={11} /> : <Plus size={11} />}
          {showNewTag ? "Cancel" : "New tag"}
        </button>
      </div>

      {showNewTag && (
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
              type="text"
              className="git-inline-input"
              placeholder="Tag name (e.g. v1.0.0)..."
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateTag();
                if (e.key === "Escape") {
                  setShowNewTag(false);
                  setTagName("");
                  setTagMessage("");
                }
              }}
              style={{ flex: 1, padding: "4px 8px", fontSize: 11 }}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "4px 10px", fontSize: 11, flexShrink: 0 }}
              disabled={!tagName.trim() || loadingKey !== null}
              onClick={() => void onCreateTag()}
            >
              {loadingKey === "create" ? (
                <Loader2 size={11} className="git-spin" />
              ) : null}
              {loadingKey === "create" ? "Creating..." : "Create"}
            </button>
          </div>
          <input
            type="text"
            className="git-inline-input"
            placeholder="Message (optional, creates annotated tag)..."
            value={tagMessage}
            onChange={(e) => setTagMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreateTag();
            }}
            style={{ padding: "4px 8px", fontSize: 11 }}
          />
        </div>
      )}

      {tags.length > 0 && (
        <div className="git-filter-bar">
          <Search size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="text"
            className="git-inline-input"
            placeholder="Filter tags..."
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
              {filteredTags.length}/{tags.length}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {tags.length === 0 ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <Tag size={20} />
            </div>
            <p className="git-empty-title">No tags</p>
            <p className="git-empty-sub">Tags will appear here</p>
          </div>
        ) : filteredTags.length === 0 ? (
          <p className="git-empty-inline">No matching tags</p>
        ) : (
          filteredTags.map((entry) => {
            const isLoading = loadingKey === `delete:${entry.name}`;

            return (
              <div key={entry.name} className="git-tag-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <Tag size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-1)",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.name}
                    </span>
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        color: "var(--text-3)",
                        flexShrink: 0,
                      }}
                    >
                      {entry.commitHash}
                    </span>
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
                    {entry.message && (
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={entry.message}
                      >
                        {entry.message}
                      </span>
                    )}
                    {entry.createdAt && <span>{formatDate(entry.createdAt)}</span>}
                  </div>
                </div>

                <div
                  className="git-tag-actions"
                  style={isLoading ? { opacity: 1 } : undefined}
                >
                  <button
                    type="button"
                    className="btn btn-ghost git-btn-danger"
                    style={{ padding: "3px 6px", fontSize: 11 }}
                    disabled={loadingKey !== null}
                    onClick={() => setDeletePrompt(entry.name)}
                    title="Delete tag"
                  >
                    {isLoading ? (
                      <Loader2 size={11} className="git-spin" />
                    ) : (
                      <Trash2 size={11} />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={deletePrompt !== null}
        title="Delete tag"
        message={deletePrompt ? `Delete tag "${deletePrompt}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deletePrompt) void onDeleteTag(deletePrompt);
        }}
        onCancel={() => setDeletePrompt(null)}
      />
    </div>
  );
}
