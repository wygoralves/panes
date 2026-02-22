import { useEffect, useState, useMemo } from "react";
import { Archive, Loader2, Package, Search, X } from "lucide-react";
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

export function GitStashView({ repo, onError }: Props) {
  const { status, stashes, loadStashes, pushStash, applyStash, popStash } = useGitStore();

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [stashMessage, setStashMessage] = useState("");

  useEffect(() => {
    void loadStashes(repo.path);
  }, [repo.path, loadStashes]);

  useEffect(() => {
    setFilterQuery("");
    setStashMessage("");
  }, [repo.path]);

  const hasChanges = (status?.files.length ?? 0) > 0;

  const filteredStashes = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return stashes;
    return stashes.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.branchHint && s.branchHint.toLowerCase().includes(q)),
    );
  }, [stashes, filterQuery]);

  async function onPushStash() {
    if (loadingKey !== null || !hasChanges) return;
    setLoadingKey("push");
    try {
      onError(undefined);
      const msg = stashMessage.trim() || undefined;
      await pushStash(repo.path, msg);
      setStashMessage("");
      toast.success("Stash saved");
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onApply(index: number) {
    if (loadingKey !== null) return;
    setLoadingKey(`apply:${index}`);
    try {
      onError(undefined);
      await applyStash(repo.path, index);
      toast.success("Stash applied");
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onPop(index: number) {
    if (loadingKey !== null) return;
    setLoadingKey(`pop:${index}`);
    try {
      onError(undefined);
      await popStash(repo.path, index);
      toast.success("Stash applied");
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
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <input
          type="text"
          className="git-inline-input"
          placeholder="Stash message (optional)"
          value={stashMessage}
          onChange={(e) => setStashMessage(e.target.value)}
          disabled={loadingKey !== null}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onPushStash();
          }}
          style={{ flex: 1, padding: "4px 8px", fontSize: 11 }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onPushStash()}
          disabled={loadingKey !== null || !hasChanges}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            flexShrink: 0,
            opacity: loadingKey !== null || !hasChanges ? 0.4 : 1,
            cursor: loadingKey !== null || !hasChanges ? "default" : "pointer",
          }}
        >
          {loadingKey === "push" ? (
            <Loader2 size={12} className="git-spin" />
          ) : (
            <Package size={12} />
          )}
          {loadingKey === "push" ? "Stashing..." : "Stash"}
        </button>
      </div>

      {stashes.length > 0 && (
        <div className="git-filter-bar">
          <Search size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <input
            type="text"
            className="git-inline-input"
            placeholder="Filter stashes..."
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
              {filteredStashes.length}/{stashes.length}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {stashes.length === 0 ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <Archive size={20} />
            </div>
            <p className="git-empty-title">No stashes</p>
            <p className="git-empty-sub">Stashed changes will appear here</p>
          </div>
        ) : filteredStashes.length === 0 ? (
          <p className="git-empty-inline">No matching stashes</p>
        ) : (
          filteredStashes.map((entry) => {
            const isLoading = loadingKey === `apply:${entry.index}` || loadingKey === `pop:${entry.index}`;

            return (
              <div key={entry.index} className="git-stash-row">
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
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        color: "var(--accent)",
                        flexShrink: 0,
                      }}
                    >
                      {`stash@{${entry.index}}`}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-2)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={entry.name}
                    >
                      {entry.name}
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
                    {entry.branchHint && <span>{entry.branchHint}</span>}
                    {entry.createdAt && (
                      <span>{formatDate(entry.createdAt)}</span>
                    )}
                  </div>
                </div>

                <div
                  className="git-stash-actions"
                  style={isLoading ? { opacity: 1 } : undefined}
                >
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "3px 6px", fontSize: 11 }}
                    disabled={loadingKey !== null}
                    onClick={() => void onApply(entry.index)}
                  >
                    {loadingKey === `apply:${entry.index}` ? (
                      <Loader2 size={11} className="git-spin" />
                    ) : (
                      "Apply"
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "3px 6px", fontSize: 11 }}
                    disabled={loadingKey !== null}
                    onClick={() => void onPop(entry.index)}
                  >
                    {loadingKey === `pop:${entry.index}` ? (
                      <Loader2 size={11} className="git-spin" />
                    ) : (
                      "Pop"
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
