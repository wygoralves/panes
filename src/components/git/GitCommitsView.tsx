import { useEffect } from "react";
import { GitCommitHorizontal } from "lucide-react";
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

  useEffect(() => {
    void loadCommits(repo.path, false);
  }, [repo.path, loadCommits]);

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
        <span>{commitsTotal} commits</span>
      </div>

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
          commits.map((entry) => (
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

        {commitsHasMore && (
          <div style={{ padding: "10px 12px" }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void loadMoreCommits(repo.path)}
              style={{
                width: "100%",
                justifyContent: "center",
                fontSize: 12,
              }}
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </>
  );
}
