import { useEffect, useMemo, useState } from "react";
import { FileDiff, GitBranch, GitCommitHorizontal, Loader2, RefreshCw } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useTranslation } from "react-i18next";
import { DiffPanel } from "../components/git/GitChangesView";
import { useGitStore } from "../stores/gitStore";
import type { GitBranch as GitBranchType, GitCommit, GitFileStatus, Repo } from "../types";

type RemoteGitView = "changes" | "branches" | "commits";

interface RemoteChangeEntry {
  key: string;
  path: string;
  staged: boolean;
  status: string;
}

interface RemoteGitPanelProps {
  repo: Repo | null;
}

function statusBadge(status: string): string {
  switch (status) {
    case "added":
    case "untracked":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "conflicted":
      return "C";
    default:
      return "M";
  }
}

function buildChangeEntries(files: GitFileStatus[]): RemoteChangeEntry[] {
  const entries: RemoteChangeEntry[] = [];
  for (const file of files) {
    if (file.worktreeStatus) {
      entries.push({
        key: `${file.path}:worktree`,
        path: file.path,
        staged: false,
        status: file.worktreeStatus,
      });
    }
    if (file.indexStatus) {
      entries.push({
        key: `${file.path}:index`,
        path: file.path,
        staged: true,
        status: file.indexStatus,
      });
    }
  }
  return entries;
}

function BranchList({ branches }: { branches: GitBranchType[] }) {
  const { t, i18n } = useTranslation("git");

  if (branches.length === 0) {
    return (
      <div className="git-empty">
        <div className="git-empty-icon-box">
          <GitBranch size={20} />
        </div>
        <p className="git-empty-title">{t("branches.emptyTitle")}</p>
        <p className="git-empty-sub">{t("branches.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      {branches.map((branch) => (
        <div
          key={branch.fullName}
          className="git-branch-row"
          style={{
            borderLeft: branch.isCurrent ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {branch.name}
              </span>
              {branch.isCurrent ? (
                <span className="git-branch-chip">{t("app:commandPalette.status.current")}</span>
              ) : null}
              {branch.isRemote ? (
                <span className="git-branch-chip">{t("app:commandPalette.status.remote")}</span>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 4,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                fontSize: 11,
                color: "var(--text-3)",
              }}
            >
              {branch.upstream ? <span>{branch.upstream}</span> : null}
              {branch.ahead > 0 ? <span>{`\u2191${branch.ahead}`}</span> : null}
              {branch.behind > 0 ? <span>{`\u2193${branch.behind}`}</span> : null}
              {branch.lastCommitAt ? (
                <span>{new Date(branch.lastCommitAt).toLocaleString(i18n.language)}</span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommitList({
  commits,
  selectedCommitHash,
  selectCommit,
  commitDiff,
  repoPath,
  loading,
  onLoadMore,
  hasMore,
}: {
  commits: GitCommit[];
  selectedCommitHash?: string;
  selectCommit: (repoPath: string, commitHash: string) => Promise<void>;
  commitDiff?: { content: string; truncated: boolean; originalBytes: number; returnedBytes: number };
  repoPath: string;
  loading: boolean;
  onLoadMore: () => Promise<void>;
  hasMore: boolean;
}) {
  const { t, i18n } = useTranslation("git");

  if (commits.length === 0) {
    return (
      <div className="git-empty">
        <div className="git-empty-icon-box">
          <GitCommitHorizontal size={20} />
        </div>
        <p className="git-empty-title">{t("commits.emptyTitle")}</p>
        <p className="git-empty-sub">{t("commits.emptyHint")}</p>
      </div>
    );
  }

  return (
    <PanelGroup direction="vertical" style={{ height: "100%" }}>
      <Panel defaultSize={commitDiff ? 54 : 100} minSize={28}>
        <div style={{ overflow: "auto", height: "100%" }}>
          {commits.map((commit) => {
            const isSelected = selectedCommitHash === commit.hash;
            return (
              <button
                key={commit.hash}
                type="button"
                className="git-commit-row"
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: isSelected ? "rgba(96, 165, 250, 0.08)" : "transparent",
                }}
                onClick={() => void selectCommit(repoPath, commit.hash)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span className="git-commit-hash">{commit.shortHash}</span>
                  <span className="git-commit-subject" title={commit.subject}>
                    {commit.subject}
                  </span>
                </div>
                <div className="git-commit-meta">
                  <span>{commit.authorName}</span>
                  <span>{"\u00B7"}</span>
                  <span>{new Date(commit.authoredAt).toLocaleString(i18n.language)}</span>
                </div>
              </button>
            );
          })}
          {hasMore ? (
            <div style={{ padding: "10px 12px" }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: "100%", justifyContent: "center", fontSize: 12 }}
                disabled={loading}
                onClick={() => void onLoadMore()}
              >
                {loading ? <Loader2 size={13} className="git-spin" /> : null}
                {loading ? t("commits.loadingMore") : t("commits.loadMore")}
              </button>
            </div>
          ) : null}
        </div>
      </Panel>
      {commitDiff ? <PanelResizeHandle className="resize-handle" /> : null}
      {commitDiff ? (
        <Panel defaultSize={46} minSize={22}>
          <DiffPanel diff={commitDiff} fillAvailableHeight />
        </Panel>
      ) : null}
    </PanelGroup>
  );
}

export function RemoteGitPanel({ repo }: RemoteGitPanelProps) {
  const { t } = useTranslation(["app", "git"]);
  const {
    activeView,
    setActiveRepoPath,
    setActiveView,
    refresh,
    loading,
    error,
    status,
    diff,
    selectedFile,
    selectedFileStaged,
    selectFile,
    branches,
    commits,
    commitsHasMore,
    loadMoreCommits,
    selectedCommitHash,
    commitDiff,
    selectCommit,
    clearCommitSelection,
    clearError,
  } = useGitStore();
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);

  const view = (["changes", "branches", "commits"].includes(activeView)
    ? activeView
    : "changes") as RemoteGitView;
  const changeEntries = useMemo(
    () => buildChangeEntries(status?.files ?? []),
    [status?.files],
  );

  useEffect(() => {
    setActiveRepoPath(repo?.path ?? null);
  }, [repo?.path, setActiveRepoPath]);

  useEffect(() => {
    if (!repo) {
      return;
    }
    if (view === "commits") {
      clearCommitSelection();
    }
    void refresh(repo.path, view === "changes" ? { force: true } : undefined);
  }, [clearCommitSelection, refresh, repo, view]);

  useEffect(() => {
    if (!repo || changeEntries.length === 0 || selectedFile) {
      return;
    }
    const first = changeEntries[0];
    void selectFile(repo.path, first.path, first.staged);
  }, [changeEntries, repo, selectFile, selectedFile]);

  const selectedChangeLabel = selectedFile
    ? `${selectedFile}${selectedFileStaged ? " (staged)" : ""}`
    : null;

  async function handleLoadMoreCommits() {
    if (!repo || loadingMoreCommits) {
      return;
    }
    setLoadingMoreCommits(true);
    try {
      await loadMoreCommits(repo.path);
    } finally {
      setLoadingMoreCommits(false);
    }
  }

  if (!repo) {
    return (
      <div className="git-panel">
        <div className="git-header">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t("app:commandPalette.group.git")}</span>
        </div>
        <div className="git-empty">
          <div className="git-empty-icon-box">
            <GitBranch size={20} />
          </div>
          <p className="git-empty-title">{t("app:remoteAttach.git.emptyTitle")}</p>
          <p className="git-empty-sub">{t("app:remoteAttach.git.emptyHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-header">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className={`git-toolbar-btn ${view === "changes" ? "chat-toolbar-btn-active" : ""}`}
            onClick={() => setActiveView("changes")}
            title={t("git:panel.tabs.changes")}
          >
            <FileDiff size={13} />
          </button>
          <button
            type="button"
            className={`git-toolbar-btn ${view === "branches" ? "chat-toolbar-btn-active" : ""}`}
            onClick={() => setActiveView("branches")}
            title={t("git:panel.tabs.branches")}
          >
            <GitBranch size={13} />
          </button>
          <button
            type="button"
            className={`git-toolbar-btn ${view === "commits" ? "chat-toolbar-btn-active" : ""}`}
            onClick={() => setActiveView("commits")}
            title={t("git:panel.tabs.commits")}
          >
            <GitCommitHorizontal size={13} />
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <span className="git-branch-meta" title={repo.path}>
          <GitBranch size={11} />
          <span>{status?.branch ?? repo.defaultBranch}</span>
        </span>
        <button
          type="button"
          className="git-toolbar-btn"
          title={t("git:panel.refreshAndFetch")}
          onClick={() => void refresh(repo.path, { force: true })}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "git-spin" : ""} />
        </button>
      </div>

      {error ? (
        <div className="git-error-bar">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="git-error-dismiss" onClick={() => clearError()}>
            ×
          </button>
        </div>
      ) : null}

      {view === "changes" ? (
        changeEntries.length === 0 ? (
          <div className="git-empty">
            <div className="git-empty-icon-box">
              <FileDiff size={20} />
            </div>
            <p className="git-empty-title">{t("git:changes.noChanges")}</p>
            <p className="git-empty-sub">{t("app:remoteAttach.git.readOnlyHint")}</p>
          </div>
        ) : (
          <PanelGroup direction="horizontal" style={{ height: "100%" }}>
            <Panel defaultSize={42} minSize={24}>
              <div style={{ overflow: "auto", height: "100%" }}>
                {changeEntries.map((entry) => {
                  const active =
                    selectedFile === entry.path && selectedFileStaged === entry.staged;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      className="git-file-row"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: active ? "rgba(96, 165, 250, 0.08)" : "transparent",
                      }}
                      onClick={() => void selectFile(repo.path, entry.path, entry.staged)}
                    >
                      <span
                        className={`git-status-chip ${
                          entry.status === "added" || entry.status === "untracked"
                            ? "git-status-added"
                            : entry.status === "deleted"
                              ? "git-status-deleted"
                              : "git-status-modified"
                        }`}
                      >
                        {statusBadge(entry.status)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text-1)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={entry.path}
                        >
                          {entry.path}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                          {entry.staged
                            ? t("app:remoteAttach.git.staged")
                            : t("app:remoteAttach.git.workingTree")}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel defaultSize={58} minSize={26}>
              {diff ? (
                <DiffPanel diff={diff} fillAvailableHeight emptyLabel={selectedChangeLabel ?? undefined} />
              ) : (
                <div className="git-empty">
                  <div className="git-empty-icon-box">
                    <FileDiff size={20} />
                  </div>
                  <p className="git-empty-title">{t("app:remoteAttach.git.selectChangeTitle")}</p>
                  <p className="git-empty-sub">{t("app:remoteAttach.git.selectChangeHint")}</p>
                </div>
              )}
            </Panel>
          </PanelGroup>
        )
      ) : null}

      {view === "branches" ? <BranchList branches={branches} /> : null}

      {view === "commits" ? (
        <CommitList
          commits={commits}
          selectedCommitHash={selectedCommitHash}
          selectCommit={selectCommit}
          commitDiff={commitDiff}
          repoPath={repo.path}
          loading={loadingMoreCommits}
          onLoadMore={handleLoadMoreCommits}
          hasMore={commitsHasMore}
        />
      ) : null}
    </div>
  );
}
