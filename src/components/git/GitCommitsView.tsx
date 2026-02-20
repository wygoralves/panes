import { useEffect, useState, useMemo } from "react";
import { GitCommitHorizontal, Loader2, Search, X } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import type { Repo } from "../../types";

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

export function GitCommitsView({ repo }: Props) {
  const {
    commits,
    commitsHasMore,
    commitsTotal,
    loadCommits,
    loadMoreCommits,
  } = useGitStore();

  const [loadingMore, setLoadingMore] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  useEffect(() => {
    void loadCommits(repo.path, false);
  }, [repo.path, loadCommits]);

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
          ) : filteredCommits.map((entry) => (
            <div key={entry.hash} className="git-commit-row">
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
          ))
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
    </>
  );
}
