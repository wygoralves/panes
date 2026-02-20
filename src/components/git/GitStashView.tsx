import { useEffect } from "react";
import { Archive } from "lucide-react";
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
  const { stashes, loadStashes, applyStash, popStash } = useGitStore();

  useEffect(() => {
    void loadStashes(repo.path);
  }, [repo.path, loadStashes]);

  async function onApply(index: number) {
    try {
      onError(undefined);
      await applyStash(repo.path, index);
    } catch (e) {
      onError(String(e));
    }
  }

  async function onPop(index: number) {
    try {
      onError(undefined);
      await popStash(repo.path, index);
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      {stashes.length === 0 ? (
        <div className="git-empty">
          <div className="git-empty-icon-box">
            <Archive size={20} />
          </div>
          <p className="git-empty-title">No stashes</p>
          <p className="git-empty-sub">Stashed changes will appear here</p>
        </div>
      ) : (
        stashes.map((entry) => (
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

            <div className="git-stash-actions">
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "3px 6px", fontSize: 11 }}
                onClick={() => void onApply(entry.index)}
              >
                Apply
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "3px 6px", fontSize: 11 }}
                onClick={() => void onPop(entry.index)}
              >
                Pop
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
