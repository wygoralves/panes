import React from "react";
import {
  RefreshCw,
  GitBranch as GitBranchIcon,
  FileDiff,
  FolderTree,
  GitCommitHorizontal,
  Archive,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Check,
  X,
} from "lucide-react";
import {
  gitBranch,
  gitAhead,
  gitBehind,
  gitStagedFiles,
  gitUnstagedFiles,
  gitCommits,
  gitDiffContent,
  repos,
  type MockGitFile,
  type MockGitCommit,
} from "../data/mockData";

/* ── Git status badge ── */

function GitStatusBadge({ status }: { status: MockGitFile["status"] }) {
  const labels: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    untracked: "?",
  };
  const classMap: Record<string, string> = {
    added: "git-status-added",
    modified: "git-status-modified",
    deleted: "git-status-deleted",
    renamed: "git-status-renamed",
    untracked: "git-status-untracked",
  };

  return (
    <span className={`git-status ${classMap[status] || ""}`}>
      {labels[status] || status}
    </span>
  );
}

/* ── Diff viewer ── */

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");

  return (
    <div className="git-diff-viewer" style={{ maxHeight: 200 }}>
      <div className="git-diff-scroll">
        <pre style={{ width: "fit-content", minWidth: "100%" }}>
          {lines.map((line, i) => {
            let lineClass = "";
            let gutter = " ";

            if (line.startsWith("@@")) {
              lineClass = "git-diff-hunk";
            } else if (line.startsWith("+")) {
              lineClass = "git-diff-add";
              gutter = "+";
            } else if (line.startsWith("-")) {
              lineClass = "git-diff-del";
              gutter = "-";
            }

            return (
              <div key={i} className={`git-diff-line ${lineClass}`}>
                <span className="git-diff-gutter">{gutter}</span>
                <span className="git-diff-line-num">{i + 1}</span>
                <span className="git-diff-line-content">{line.replace(/^[+-]/, "") || " "}</span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

/* ── File row ── */

function GitFileRow({
  file,
  selected = false,
}: {
  file: MockGitFile;
  selected?: boolean;
}) {
  return (
    <div className={`git-file-row ${selected ? "git-file-row-selected" : ""}`}>
      <GitStatusBadge status={file.status} />
      <span className="git-file-name" title={file.path}>
        {file.name}
      </span>
      <span className="git-stage-btn" style={{ opacity: 0 }}>
        {file.status === "deleted" ? <X size={12} /> : <Plus size={12} />}
      </span>
    </div>
  );
}

/* ── Commit row ── */

function GitCommitRow({ commit }: { commit: MockGitCommit }) {
  return (
    <div className="git-commit-row">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="git-commit-hash">{commit.hash}</span>
        <span className="git-commit-subject">{commit.subject}</span>
      </div>
      <div className="git-commit-meta">
        <span>{commit.author}</span>
        <span>&middot;</span>
        <span>{commit.date}</span>
      </div>
    </div>
  );
}

/* ── Main Git Panel ── */

export function PanesGitPanel({
  activeView = "changes" as "changes" | "branches" | "commits" | "stash" | "files",
  selectedFile = "ThreeColumnLayout.tsx",
  showMultiRepo = false,
  activeRepoId = "repo-1",
}: {
  activeView?: "changes" | "branches" | "commits" | "stash" | "files";
  selectedFile?: string;
  showMultiRepo?: boolean;
  activeRepoId?: string;
}) {
  const activeRepo = repos.find((r) => r.id === activeRepoId) || repos[0];

  return (
    <div className="git-panel">
      {/* ── Header (74px) ── */}
      <div className="git-header">
        {/* View selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-1)",
            cursor: "pointer",
          }}
        >
          <FileDiff size={13} />
          <span>
            {activeView === "changes"
              ? "Changes"
              : activeView === "branches"
                ? "Branches"
                : activeView === "commits"
                  ? "Commits"
                  : activeView === "stash"
                    ? "Stash"
                    : "Files"}
          </span>
          <ChevronDown size={11} style={{ opacity: 0.5 }} />
        </div>

        <div style={{ flex: 1 }} />

        {/* Branch info */}
        <span className="git-branch-meta">
          <GitBranchIcon size={11} />
          <span>{gitBranch}</span>
          {(gitAhead > 0 || gitBehind > 0) && (
            <span className="git-ahead-behind">
              {gitAhead > 0 && <span className="git-ahead">&uarr;{gitAhead}</span>}
              {gitBehind > 0 && <span className="git-behind">&darr;{gitBehind}</span>}
            </span>
          )}
        </span>

        {/* Refresh button */}
        <button type="button" className="git-toolbar-btn">
          <RefreshCw size={14} />
        </button>

        {/* More button */}
        <button type="button" className="git-toolbar-btn">
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* ── Multi-repo bar ── */}
      {showMultiRepo && (
        <div className="git-repo-bar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <span>{activeRepo.name}</span>
            <ChevronDown size={10} style={{ opacity: 0.5 }} />
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeView === "changes" && (
          <>
            {/* Staged section */}
            <div className="git-section">
              <div className="git-section-header">
                <ChevronDown size={11} style={{ opacity: 0.5 }} />
                <span>Staged</span>
                <span className="git-section-count">({gitStagedFiles.length})</span>
              </div>
              {gitStagedFiles.map((file) => (
                <GitFileRow
                  key={file.path}
                  file={file}
                  selected={file.name === selectedFile}
                />
              ))}
            </div>

            {/* Diff viewer for selected file */}
            {selectedFile && <DiffViewer diff={gitDiffContent} />}

            {/* Unstaged section */}
            <div className="git-section">
              <div className="git-section-header">
                <ChevronDown size={11} style={{ opacity: 0.5 }} />
                <span>Unstaged</span>
                <span className="git-section-count">({gitUnstagedFiles.length})</span>
              </div>
              {gitUnstagedFiles.map((file) => (
                <GitFileRow key={file.path} file={file} />
              ))}
            </div>

            {/* Commit area */}
            <div className="git-commit-area">
              <textarea
                className="git-commit-input"
                placeholder="Commit message..."
                rows={2}
                readOnly
                value="refactor: use CSS custom props for panel sizing"
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ alignSelf: "flex-end" }}
              >
                <Check size={12} />
                Commit
              </button>
            </div>
          </>
        )}

        {activeView === "commits" && (
          <>
            {gitCommits.map((commit) => (
              <GitCommitRow key={commit.hash} commit={commit} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
