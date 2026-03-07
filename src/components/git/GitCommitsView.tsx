import { useEffect, useState, useMemo } from "react";
import { GitCommitHorizontal, Loader2, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../lib/formatters";
import { useGitStore } from "../../stores/gitStore";
import { DiffPanel } from "./GitChangesView";
import type { Repo } from "../../types";

interface Props {
  repo: Repo;
}

export function GitCommitsView({ repo }: Props) {
  const { t, i18n } = useTranslation("git");
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
  } = useGitStore();

  const [loadingMore, setLoadingMore] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

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

  return (
    <>
      <div
        style={{
          padding: "8px 12px",
          fontSize: 11,
          color: "var(--text-3)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{t("commits.title")}</span>
        <span>
          {filterQuery
            ? t("commits.filteredCount", {
                current: filteredCommits.length,
                total: commitsTotal,
              })
            : t("commits.count", { count: commitsTotal })}
        </span>
      </div>

      {commits.length > 0 && (
        <div className="git-filter-bar">
          <div className="git-filter-input-wrap">
            <Search size={12} className="git-filter-icon" />
            <input
              type="text"
              className="git-inline-input"
              placeholder={t("commits.filterPlaceholder")}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              style={{ padding: "3px 8px 3px 24px", fontSize: 11 }}
            />
          </div>
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
            <p className="git-empty-title">{t("commits.emptyTitle")}</p>
            <p className="git-empty-sub">{t("commits.emptyHint")}</p>
          </div>
        ) : (
          filteredCommits.length === 0 ? (
            <p className="git-empty-inline">{t("commits.emptyFiltered")}</p>
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
                  </div>
                  <div className="git-commit-meta">
                    <span>{entry.authorName}</span>
                    <span>{"\u00B7"}</span>
                    <span>{formatDateTime(entry.authoredAt, i18n.language)}</span>
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
                        {t("commits.loadingDiff")}
                      </div>
                    ) : commitDiff ? (
                      <DiffPanel diff={commitDiff} />
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
                        {t("commits.noChanges")}
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
              {loadingMore ? t("commits.loadingMore") : t("commits.loadMore")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
