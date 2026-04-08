import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Check,
  Undo2,
  Loader2,
  RotateCcw,
  GitBranch,
} from "lucide-react";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { useGitStore } from "../../stores/gitStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import {
  buildDirectoryFileMap,
  buildTreeRows,
  getStatusLabel,
  getStatusClass,
} from "./gitChangesUtils";
import type { ChangeSection, TreeRow } from "./gitChangesUtils";
import type { GitFileStatus, GitStatus, Repo } from "../../types";

interface Props {
  repos: Repo[];
  onError: (error: string | undefined) => void;
}

interface RepoStatusEntry {
  status: GitStatus | null;
  loading: boolean;
}

/**
 * Multi-repo accordion view for the Changes tab.
 * Renders when controlledRepos.length > 1.
 */
export function MultiRepoChangesView({ repos, onError }: Props) {
  const { t } = useTranslation("git");
  const { getStatusForRepo } = useGitStore();

  // ── Per-repo status ──
  const [repoStatuses, setRepoStatuses] = useState<
    Record<string, RepoStatusEntry>
  >({});

  const fetchStatusForAll = useCallback(async () => {
    const paths = repos.map((r) => r.path);
    // Mark all as loading
    setRepoStatuses((prev) => {
      const next = { ...prev };
      for (const p of paths) {
        next[p] = { status: next[p]?.status ?? null, loading: true };
      }
      return next;
    });

    const results = await Promise.allSettled(
      paths.map((p) => getStatusForRepo(p)),
    );

    setRepoStatuses((prev) => {
      const next = { ...prev };
      for (let i = 0; i < paths.length; i++) {
        const result = results[i];
        next[paths[i]] = {
          status:
            result.status === "fulfilled"
              ? result.value
              : prev[paths[i]]?.status ?? null,
          loading: false,
        };
      }
      return next;
    });
  }, [repos, getStatusForRepo]);

  // Initial fetch + re-fetch when repos change
  const prevRepoPathsRef = useRef<string>("");
  useEffect(() => {
    const key = repos.map((r) => r.path).join("|");
    if (key !== prevRepoPathsRef.current) {
      prevRepoPathsRef.current = key;
      void fetchStatusForAll();
    }
  }, [repos, fetchStatusForAll]);

  // Re-fetch on gitStore status updates (file watcher triggers)
  const storeStatus = useGitStore((s) => s.status);
  const storeActiveRepoPath = useGitStore((s) => s.activeRepoPath);
  useEffect(() => {
    if (storeStatus && storeActiveRepoPath) {
      setRepoStatuses((prev) => ({
        ...prev,
        [storeActiveRepoPath]: { status: storeStatus, loading: false },
      }));
    }
  }, [storeStatus, storeActiveRepoPath]);

  // ── Accordion state ──
  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>(
    {},
  );

  // Auto-expand dirty repos on first status load
  const autoExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    setExpandedRepos((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const repo of repos) {
        if (autoExpandedRef.current.has(repo.path)) continue;
        const entry = repoStatuses[repo.path];
        if (!entry || entry.loading) continue;
        autoExpandedRef.current.add(repo.path);
        const isDirty =
          entry.status !== null && entry.status.files.length > 0;
        if (isDirty && next[repo.path] === undefined) {
          next[repo.path] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [repos, repoStatuses]);

  const toggleRepo = useCallback((repoPath: string) => {
    setExpandedRepos((prev) => ({
      ...prev,
      [repoPath]: !prev[repoPath],
    }));
  }, []);

  // ── Sort: dirty repos first, then alphabetical ──
  const sortedRepos = useMemo(() => {
    return [...repos].sort((a, b) => {
      const aStatus = repoStatuses[a.path]?.status;
      const bStatus = repoStatuses[b.path]?.status;
      const aDirty =
        aStatus !== null &&
        aStatus !== undefined &&
        (aStatus.files.length > 0 ||
          aStatus.ahead > 0 ||
          aStatus.behind > 0);
      const bDirty =
        bStatus !== null &&
        bStatus !== undefined &&
        (bStatus.files.length > 0 ||
          bStatus.ahead > 0 ||
          bStatus.behind > 0);
      if (aDirty && !bDirty) return -1;
      if (!aDirty && bDirty) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [repos, repoStatuses]);

  return (
    <div className="multi-repo-changes" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {sortedRepos.map((repo) => (
        <RepoAccordionSection
          key={repo.id}
          repo={repo}
          entry={repoStatuses[repo.path] ?? { status: null, loading: true }}
          expanded={expandedRepos[repo.path] ?? false}
          onToggle={() => toggleRepo(repo.path)}
          onError={onError}
          onStatusRefresh={(repoPath, freshStatus) => {
            setRepoStatuses((prev) => ({
              ...prev,
              [repoPath]: { status: freshStatus, loading: false },
            }));
          }}
        />
      ))}
    </div>
  );
}

// ─── Single repo accordion section ───

interface SectionProps {
  repo: Repo;
  entry: RepoStatusEntry;
  expanded: boolean;
  onToggle: () => void;
  onError: (error: string | undefined) => void;
  onStatusRefresh: (repoPath: string, status: GitStatus) => void;
}

function RepoAccordionSection({
  repo,
  entry,
  expanded,
  onToggle,
  onError,
  onStatusRefresh,
}: SectionProps) {
  const { t } = useTranslation("git");
  const {
    getStatusForRepo,
    stage,
    stageMany,
    unstage,
    unstageMany,
    discardFiles,
    commit,
    pushCommitHistory,
  } = useGitStore();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const openGitDiffFile = useFileStore((s) => s.openGitDiffFile);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);

  const { status, loading } = entry;

  const unstagedFiles = useMemo(
    () => status?.files.filter((f) => Boolean(f.worktreeStatus)) ?? [],
    [status],
  );
  const stagedFiles = useMemo(
    () => status?.files.filter((f) => Boolean(f.indexStatus)) ?? [],
    [status],
  );
  const modifiedCount = unstagedFiles.length;
  const isClean = status !== null && status.files.length === 0 && status.ahead === 0 && status.behind === 0;

  // ── Per-section state ──
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [sectionCollapsed, setSectionCollapsed] = useState<
    Record<ChangeSection, boolean>
  >({ changes: false, staged: false });
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [discardPrompt, setDiscardPrompt] = useState<{
    title: string;
    message: string;
    files: string[];
  } | null>(null);

  // Per-repo commit message (not global draft — avoids cross-repo overwrite)
  const [commitMessage, setCommitMessage] = useState("");

  // Re-fetch status for THIS repo after any mutation
  const refreshThisRepo = useCallback(async () => {
    try {
      const fresh = await getStatusForRepo(repo.path);
      onStatusRefresh(repo.path, fresh);
    } catch {
      // silently keep previous status
    }
  }, [repo.path, getStatusForRepo, onStatusRefresh]);

  // ── Memos ──
  const unstagedRows = useMemo(
    () => buildTreeRows(unstagedFiles, "changes", collapsedDirs),
    [unstagedFiles, collapsedDirs],
  );
  const stagedRows = useMemo(
    () => buildTreeRows(stagedFiles, "staged", collapsedDirs),
    [stagedFiles, collapsedDirs],
  );
  const unstagedDirectoryFiles = useMemo(
    () => buildDirectoryFileMap(unstagedFiles),
    [unstagedFiles],
  );
  const stagedDirectoryFiles = useMemo(
    () => buildDirectoryFileMap(stagedFiles),
    [stagedFiles],
  );
  const hasStagedFiles = stagedFiles.length > 0;

  // ── Actions (all call refreshThisRepo after mutation) ──
  async function onCommit() {
    if (!commitMessage.trim() || loadingKey !== null) return;
    const msg = commitMessage.trim();
    setLoadingKey("commit");
    try {
      onError(undefined);
      await commit(repo.path, msg);
      if (activeWorkspaceId) pushCommitHistory(activeWorkspaceId, msg);
      setCommitMessage("");
      toast.success(
        t("changes.toasts.committed", { message: msg.split("\n")[0] }),
      );
      await refreshThisRepo();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onStageAll() {
    if (unstagedFiles.length === 0 || loadingKey !== null) return;
    setLoadingKey("stage-all");
    try {
      onError(undefined);
      await stageMany(repo.path, unstagedFiles.map((f) => f.path));
      await refreshThisRepo();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onUnstageAll() {
    if (stagedFiles.length === 0 || loadingKey !== null) return;
    setLoadingKey("unstage-all");
    try {
      onError(undefined);
      await unstageMany(repo.path, stagedFiles.map((f) => f.path));
      await refreshThisRepo();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onStageFile(filePath: string) {
    if (loadingKey !== null) return;
    setLoadingKey(`file:${filePath}`);
    try {
      onError(undefined);
      await stage(repo.path, filePath);
      await refreshThisRepo();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  async function onUnstageFile(filePath: string) {
    if (loadingKey !== null) return;
    setLoadingKey(`file:${filePath}`);
    try {
      onError(undefined);
      await unstage(repo.path, filePath);
      await refreshThisRepo();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  function onDiscardFile(filePath: string) {
    if (loadingKey !== null) return;
    const fileName = filePath.split("/").pop() ?? filePath;
    setDiscardPrompt({
      title: t("changes.discardChanges"),
      message: t("changes.discardPrompts.fileMessage", { name: fileName }),
      files: [filePath],
    });
  }

  function onDiscardDirectory(dirPath: string) {
    const directoryFiles = unstagedDirectoryFiles.get(dirPath) ?? [];
    if (directoryFiles.length === 0 || loadingKey !== null) return;
    const dirName = dirPath.split("/").pop() ?? dirPath;
    setDiscardPrompt({
      title: t("changes.discardChanges"),
      message: t("changes.discardPrompts.directoryMessage", {
        name: dirName,
        count: directoryFiles.length,
      }),
      files: directoryFiles,
    });
  }

  function onDiscardAll() {
    if (unstagedFiles.length === 0 || loadingKey !== null) return;
    setDiscardPrompt({
      title: t("changes.discardAllChanges"),
      message: t("changes.discardPrompts.allMessage", {
        count: unstagedFiles.length,
      }),
      files: unstagedFiles.map((f) => f.path),
    });
  }

  async function executeDiscard(files: string[]) {
    setDiscardPrompt(null);
    setLoadingKey("discard");
    try {
      onError(undefined);
      await discardFiles(repo.path, files);
      await refreshThisRepo();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoadingKey(null);
    }
  }

  function toggleSection(section: ChangeSection) {
    setSectionCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  function toggleDir(section: ChangeSection, dirPath: string) {
    const key = `${section}:${dirPath}`;
    setCollapsedDirs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const handleOpenInEditor = useCallback(
    (filePath: string) => {
      void openGitDiffFile(repo.path, filePath, { source: "changes" });
      if (activeWorkspaceId) {
        void setLayoutMode(activeWorkspaceId, "editor");
      }
    },
    [repo.path, openGitDiffFile, activeWorkspaceId, setLayoutMode],
  );

  // ── Render helpers ──
  function renderFileRow(row: TreeRow, section: ChangeSection, staged: boolean) {
    if (row.type === "dir") {
      const filesByDirectory = staged ? stagedDirectoryFiles : unstagedDirectoryFiles;
      const directoryFileCount = (filesByDirectory.get(row.path) ?? []).length;
      return (
        <div
          key={row.key}
          className="git-dir-row"
          style={{ paddingLeft: 12 + row.depth * 14 }}
        >
          <button
            type="button"
            className="git-dir-toggle"
            onClick={() => toggleDir(section, row.path)}
          >
            {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{row.name}</span>
          </button>
          {!staged && (
            <button
              type="button"
              className="git-stage-btn git-discard-btn"
              onClick={(e) => {
                e.stopPropagation();
                void onDiscardDirectory(row.path);
              }}
              disabled={directoryFileCount === 0 || loadingKey !== null}
              title={t("changes.discardFolderTitle")}
              style={{
                opacity: directoryFileCount === 0 || loadingKey !== null ? 0.35 : undefined,
              }}
            >
              <Undo2 size={13} />
            </button>
          )}
          <button
            type="button"
            className="git-stage-btn git-dir-stage-btn"
            onClick={(e) => {
              e.stopPropagation();
              void (staged
                ? unstageMany(repo.path, filesByDirectory.get(row.path) ?? [])
                : stageMany(repo.path, filesByDirectory.get(row.path) ?? []));
            }}
            disabled={directoryFileCount === 0 || loadingKey !== null}
            title={staged ? t("changes.unstageFolderTitle") : t("changes.stageFolderTitle")}
            style={{
              opacity: directoryFileCount === 0 || loadingKey !== null ? 0.35 : undefined,
            }}
          >
            {staged ? <Minus size={13} /> : <Plus size={13} />}
          </button>
        </div>
      );
    }

    const fileStatus = staged ? row.file.indexStatus : row.file.worktreeStatus;
    return (
      <div
        key={row.key}
        className="git-file-row"
        style={{ paddingLeft: 22 + row.depth * 14 }}
        onClick={() => handleOpenInEditor(row.file.path)}
      >
        <span className="git-file-name" title={row.path}>
          {row.name}
        </span>
        {!staged && (
          <button
            type="button"
            className="git-stage-btn git-discard-btn"
            onClick={(e) => {
              e.stopPropagation();
              void onDiscardFile(row.file.path);
            }}
            disabled={loadingKey !== null}
            title={t("changes.discardChanges")}
            style={{ opacity: loadingKey !== null ? 0.35 : undefined }}
          >
            <Undo2 size={13} />
          </button>
        )}
        <span className={`git-status ${getStatusClass(fileStatus)}`}>
          {getStatusLabel(fileStatus)}
        </span>
        <button
          type="button"
          className="git-stage-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (staged) {
              void onUnstageFile(row.file.path);
            } else {
              void onStageFile(row.file.path);
            }
          }}
          disabled={loadingKey !== null}
          title={staged ? t("changes.unstage") : t("changes.stage")}
          style={{
            opacity: loadingKey !== null && loadingKey !== `file:${row.file.path}` ? 0.35 : undefined,
          }}
        >
          {loadingKey === `file:${row.file.path}` ? (
            <Loader2 size={13} className="git-spin" />
          ) : staged ? (
            <Minus size={13} />
          ) : (
            <Plus size={13} />
          )}
        </button>
      </div>
    );
  }

  function renderSection(
    section: ChangeSection,
    title: string,
    rows: TreeRow[],
    files: GitFileStatus[],
    staged: boolean,
  ) {
    const isCollapsedSection = sectionCollapsed[section];
    return (
      <section key={section} className="git-section">
        <div
          className="git-section-header"
          onClick={() => toggleSection(section)}
        >
          {isCollapsedSection ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>{title}</span>
          <span className="git-section-count">{files.length}</span>
          <div className="git-section-actions" onClick={(e) => e.stopPropagation()}>
            {staged ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onUnstageAll()}
                disabled={files.length === 0 || loadingKey !== null}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  opacity: files.length === 0 || loadingKey !== null ? 0.4 : 1,
                }}
              >
                {loadingKey === "unstage-all" ? (
                  <Loader2 size={11} className="git-spin" />
                ) : (
                  <RotateCcw size={11} />
                )}
                {loadingKey === "unstage-all"
                  ? t("changes.unstaging")
                  : t("changes.unstageAll")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="git-toolbar-btn git-discard-btn"
                  onClick={() => void onDiscardAll()}
                  disabled={files.length === 0 || loadingKey !== null}
                  title={t("changes.discardAllChanges")}
                  style={{
                    opacity: files.length === 0 || loadingKey !== null ? 0.35 : undefined,
                  }}
                >
                  {loadingKey === "discard" ? (
                    <Loader2 size={13} className="git-spin" />
                  ) : (
                    <Undo2 size={13} />
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void onStageAll()}
                  disabled={files.length === 0 || loadingKey !== null}
                  style={{
                    padding: "3px 8px",
                    fontSize: 11,
                    opacity: files.length === 0 || loadingKey !== null ? 0.4 : 1,
                  }}
                >
                  {loadingKey === "stage-all" ? (
                    <Loader2 size={11} className="git-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                  {loadingKey === "stage-all"
                    ? t("changes.staging")
                    : t("changes.stageAll")}
                </button>
              </>
            )}
          </div>
        </div>

        {!isCollapsedSection && (
          <div>
            {rows.length === 0 ? (
              <p className="git-empty-inline">
                {staged ? t("changes.noStagedChanges") : t("changes.workingTreeClean")}
              </p>
            ) : (
              rows.map((row) => renderFileRow(row, section, staged))
            )}
          </div>
        )}
      </section>
    );
  }

  // ── Render ──
  return (
    <>
      {/* Repo accordion header */}
      <div
        className={`multi-repo-header${isClean ? " multi-repo-header-clean" : ""}`}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={10} className="multi-repo-chevron" />
        ) : (
          <ChevronRight size={10} className="multi-repo-chevron" />
        )}
        <span className="multi-repo-name">{repo.name}</span>
        <GitBranch size={9} className="multi-repo-branch-icon" />
        <span className="multi-repo-branch">{status?.branch ?? "…"}</span>
        <div style={{ flex: 1 }} />
        {status && status.behind > 0 && (
          <span className="multi-repo-sync multi-repo-behind">↓{status.behind}</span>
        )}
        {status && status.ahead > 0 && (
          <span className="multi-repo-sync multi-repo-ahead">↑{status.ahead}</span>
        )}
        {modifiedCount > 0 && (
          <span className="chip chip-modified" style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
            {modifiedCount}M
          </span>
        )}
        {isClean && (
          <Check size={12} className="multi-repo-clean-icon" />
        )}
        {loading && !status && (
          <Loader2 size={12} className="git-spin" style={{ color: "var(--text-3)" }} />
        )}
      </div>

      {/* Expanded content */}
      {expanded && status && (
        <div className="multi-repo-body">
          {status.files.length === 0 ? (
            <p className="git-empty-inline" style={{ paddingLeft: 26 }}>
              {t("changes.workingTreeClean")}
            </p>
          ) : (
            <>
              {unstagedFiles.length > 0 &&
                renderSection(
                  "changes",
                  t("changes.section.changes"),
                  unstagedRows,
                  unstagedFiles,
                  false,
                )}
              {hasStagedFiles &&
                renderSection(
                  "staged",
                  t("changes.section.staged"),
                  stagedRows,
                  stagedFiles,
                  true,
                )}
            </>
          )}

          {hasStagedFiles && (
            <div className="multi-repo-commit-area">
              <input
                type="text"
                className="git-commit-input"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={t("changes.commitMessagePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    void onCommit();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void onCommit()}
                disabled={!commitMessage.trim() || loadingKey !== null}
                className="btn btn-primary multi-repo-commit-btn"
                style={{
                  opacity: commitMessage.trim() && loadingKey === null ? 1 : 0.4,
                  cursor: commitMessage.trim() && loadingKey === null ? "pointer" : "default",
                }}
              >
                {loadingKey === "commit" ? (
                  <Loader2 size={13} className="git-spin" />
                ) : (
                  <Check size={13} />
                )}
                {loadingKey === "commit" ? t("changes.committing") : t("changes.commit")}
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={discardPrompt !== null}
        title={discardPrompt?.title ?? ""}
        message={discardPrompt?.message ?? ""}
        confirmLabel={t("changes.discard")}
        onConfirm={() => {
          if (discardPrompt) void executeDiscard(discardPrompt.files);
        }}
        onCancel={() => setDiscardPrompt(null)}
      />
    </>
  );
}
