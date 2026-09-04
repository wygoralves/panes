import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  Cloud,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  Loader2,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isValidBranchName,
  localNameForRemoteBranch,
  resolveBranchSelectionTarget,
  sanitizeNewBranchName,
} from "../../lib/gitBranchNames";
import {
  defaultWorktreePath,
  worktreeDisplayName,
  worktreeFolderNameForBranch,
} from "../../lib/gitWorktreePaths";
import { ipc } from "../../lib/ipc";
import { readThreadWorktreePath } from "../../lib/threadWorktree";
import { useGitStore } from "../../stores/gitStore";
import { useThreadStore } from "../../stores/threadStore";
import { toast } from "../../stores/toastStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { ProjectIcon } from "../sidebar/ProjectIcon";
import { Dropdown } from "../shared/Dropdown";
import { ToggleOptionCard } from "../shared/ToggleOptionCard";
import type { GitBranch as GitBranchEntry, GitWorktree, Repo, Thread } from "../../types";

const BRANCH_PAGE_LIMIT = 200;
const POPOVER_WIDTH = 320;

type BusyKind = "checkout" | "pull" | "create" | "detach" | "move";

interface Props {
  thread: Thread | null;
  /** Repo the thread runs in, or null while a multi-repo workspace thread has
   * not picked one yet. */
  repo: Repo | null;
  repos: Repo[];
  /** Branch changes wait for the engine: a checkout under a running turn
   * would swap the files it is editing. */
  turnActive: boolean;
}

interface BranchRow {
  key: string;
  branch: GitBranchEntry;
  /** Worktree that has this branch checked out, main checkout included. */
  worktreePath: string | null;
}

function isNoUpstreamError(error: unknown): boolean {
  return /no upstream/i.test(String(error));
}

function normalizePath(path: string): string {
  return path.replace(/[/\\]+$/, "");
}

export function BranchPicker({ thread, repo, repos, turnActive }: Props) {
  const { t } = useTranslation("chat");
  const worktreePath = readThreadWorktreePath(thread);
  const cwd = repo ? (worktreePath ?? repo.path) : null;
  const needsRepoChoice = !repo && repos.length > 1;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"branches" | "create">("branches");
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ bottom: 0, right: 0 });
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<GitBranchEntry[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<GitBranchEntry[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ kind: BusyKind; branch?: string } | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [newName, setNewName] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [useWorktree, setUseWorktree] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const loadSeqRef = useRef(0);

  // The git panel already polls the directory it shows; when that is ours,
  // its branch is a free signal that HEAD moved outside this picker.
  const panelBranch = useGitStore((state) =>
    cwd && state.activeRepoPath === cwd ? (state.status?.branch ?? null) : null,
  );

  const loadStatus = useCallback(async () => {
    if (!cwd) {
      setCurrentBranch(null);
      return;
    }
    try {
      const status = await ipc.getGitStatus(cwd);
      setCurrentBranch(status.branch || null);
    } catch {
      // Keep the last known branch; the list load reports errors.
    }
  }, [cwd]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, panelBranch]);

  const loadBranches = useCallback(async () => {
    if (!cwd || !repo) return;
    const seq = ++loadSeqRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const [local, remote, worktreeList] = await Promise.all([
        ipc.listGitBranches(cwd, "local", 0, BRANCH_PAGE_LIMIT),
        ipc.listGitBranches(cwd, "remote", 0, BRANCH_PAGE_LIMIT),
        ipc.listGitWorktrees(repo.path).catch(() => [] as GitWorktree[]),
      ]);
      if (seq !== loadSeqRef.current) return;
      setLocalBranches(local.entries);
      setRemoteBranches(remote.entries);
      setWorktrees(worktreeList);
      const current = local.entries.find((entry) => entry.isCurrent);
      if (current) setCurrentBranch(current.name);
    } catch (error) {
      if (seq === loadSeqRef.current) setListError(String(error));
    } finally {
      if (seq === loadSeqRef.current) setListLoading(false);
    }
  }, [cwd, repo]);

  // Opening lists what is known right away, then fetches so remote branches
  // and ahead/behind counts are fresh without blocking the menu.
  useEffect(() => {
    if (!open || !cwd) return;
    void loadBranches();
    let cancelled = false;
    setFetching(true);
    void ipc
      .fetchGit(cwd)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setFetching(false);
        void loadBranches();
      });
    return () => {
      cancelled = true;
      setFetching(false);
    };
  }, [open, cwd, loadBranches]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let right = Math.max(8, window.innerWidth - rect.right);
    if (window.innerWidth - right - POPOVER_WIDTH < 8) {
      right = Math.max(8, window.innerWidth - POPOVER_WIDTH - 8);
    }
    setPos({ bottom: window.innerHeight - rect.top + 6, right });
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target) ||
        (target instanceof Element && target.closest(".dropdown-menu"))
      ) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setView("branches");
      setQuery("");
      setCreateError(null);
      setHighlightIndex(0);
      return;
    }
    if (view === "branches") searchInputRef.current?.focus();
    else nameInputRef.current?.focus();
  }, [open, view]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  const repoPathKey = repo ? normalizePath(repo.path) : null;
  const worktreeByBranch = useMemo(() => {
    const map = new Map<string, string>();
    for (const worktree of worktrees) {
      if (!worktree.branch) continue;
      map.set(worktree.branch, worktree.isMain && repo ? repo.path : worktree.path);
    }
    return map;
  }, [worktrees, repo]);

  const needle = query.trim().toLowerCase();
  const localNames = useMemo(
    () => new Set(localBranches.map((branch) => branch.name)),
    [localBranches],
  );
  const rows = useMemo<{ local: BranchRow[]; remote: BranchRow[] }>(() => {
    const matches = (branch: GitBranchEntry) =>
      !needle || branch.name.toLowerCase().includes(needle);
    const toRow = (branch: GitBranchEntry): BranchRow => ({
      key: branch.fullName,
      branch,
      worktreePath: branch.isRemote ? null : (worktreeByBranch.get(branch.name) ?? null),
    });
    return {
      local: localBranches.filter(matches).map(toRow),
      remote: remoteBranches
        .filter((branch) => !localNames.has(localNameForRemoteBranch(branch.name)))
        .filter(matches)
        .map(toRow),
    };
  }, [localBranches, remoteBranches, localNames, needle, worktreeByBranch]);
  const orderedRows = useMemo(() => [...rows.local, ...rows.remote], [rows]);
  const sanitizedQuery = sanitizeNewBranchName(query);
  const exactMatch = sanitizedQuery
    ? orderedRows.some((row) => row.branch.name === sanitizedQuery)
    : false;
  const showCreateAction = !needsRepoChoice && (!sanitizedQuery || !exactMatch);
  const navigableCount = orderedRows.length + (showCreateAction ? 1 : 0);
  const mutationsLocked = turnActive || busy !== null;

  function refreshGitPanel(path: string) {
    const git = useGitStore.getState();
    git.invalidateRepoCache(path);
    if (git.activeRepoPath === path) void git.refresh(path, { force: true });
    void loadStatus();
  }

  /** Point the thread (and the git panel) at a worktree, or back at the repo. */
  async function bindThreadWorktree(nextWorktreePath: string | null): Promise<boolean> {
    if (!thread || !repo) return false;
    const updated = await useThreadStore
      .getState()
      .setThreadWorktree(thread.id, repo.id, nextWorktreePath);
    if (!updated) return false;
    const workspace = useWorkspaceStore.getState();
    if (workspace.activeRepoId !== repo.id) {
      workspace.setActiveRepo(repo.id, { remember: false });
    }
    const git = useGitStore.getState();
    const target = nextWorktreePath ?? repo.path;
    git.invalidateRepoCache(target);
    if (git.activeRepoPath !== target) {
      git.setActiveRepoPath(target);
      if (nextWorktreePath) git.setMainRepoPath(repo.path);
    }
    void git.refresh(target, { force: true });
    return true;
  }

  function openCreate(prefill: string) {
    setNewName(sanitizeNewBranchName(prefill));
    setBaseRef(currentBranch ?? repo?.defaultBranch ?? "");
    setUseWorktree(false);
    setCreateError(null);
    setView("create");
  }

  async function selectBranch(row: BranchRow) {
    if (!cwd || !repo || mutationsLocked) return;
    const { branch } = row;
    const isCurrentHere = branch.isCurrent && normalizePath(row.worktreePath ?? cwd) === normalizePath(cwd);
    if (isCurrentHere) {
      setOpen(false);
      return;
    }

    const target = resolveBranchSelectionTarget({
      repoPath: repo.path,
      activeWorktreePath: worktreePath,
      branch: { name: branch.name, isRemote: branch.isRemote, worktreePath: row.worktreePath },
      defaultBranch: repo.defaultBranch || null,
    });
    const targetName = branch.isRemote ? localNameForRemoteBranch(branch.name) : branch.name;

    // The branch already lives in a worktree: move the chat there instead of
    // asking git to check it out twice.
    if (target.reuseExistingWorktree) {
      if (!thread) {
        toast.error(t("branchPicker.toasts.worktreeNeedsThread"));
        return;
      }
      setBusy({ kind: "move", branch: targetName });
      const bound = await bindThreadWorktree(target.nextWorktreePath);
      setBusy(null);
      if (!bound) {
        toast.error(
          t("branchPicker.toasts.moveFailed", {
            error: useThreadStore.getState().error ?? "",
          }),
        );
        return;
      }
      setOpen(false);
      toast.success(
        target.nextWorktreePath
          ? t("branchPicker.toasts.movedToWorktree", {
              branch: targetName,
              name: worktreeDisplayName(target.nextWorktreePath),
            })
          : t("branchPicker.toasts.movedToCheckout", { branch: targetName }),
      );
      return;
    }

    setBusy({ kind: "checkout", branch: targetName });
    try {
      await ipc.checkoutGitBranch(target.checkoutCwd, branch.name, branch.isRemote);
    } catch (error) {
      setBusy(null);
      toast.error(t("branchPicker.toasts.switchFailed", { error: String(error) }));
      return;
    }

    let pulled = false;
    let pullError: string | null = null;
    if (branch.isRemote || branch.upstream) {
      setBusy({ kind: "pull", branch: targetName });
      try {
        await ipc.pullGit(target.checkoutCwd);
        pulled = true;
      } catch (error) {
        if (!isNoUpstreamError(error)) pullError = String(error);
      }
    }

    // Picking the default branch from a worktree lands back in the checkout.
    if (target.nextWorktreePath !== worktreePath && thread) {
      setBusy({ kind: "move", branch: targetName });
      await bindThreadWorktree(target.nextWorktreePath);
    }

    setBusy(null);
    setCurrentBranch(targetName);
    refreshGitPanel(target.checkoutCwd);
    setOpen(false);
    if (pullError) {
      toast.warning(t("branchPicker.toasts.pullFailed", { branch: targetName, error: pullError }));
    } else if (pulled) {
      toast.success(t("branchPicker.toasts.switchedAndPulled", { branch: targetName }));
    } else {
      toast.success(t("branchPicker.toasts.switched", { branch: targetName }));
    }
  }

  async function submitCreate() {
    if (!repo || !cwd || mutationsLocked) return;
    const name = sanitizeNewBranchName(newName);
    if (!isValidBranchName(name)) {
      setCreateError(t("branchPicker.create.invalidName"));
      return;
    }
    if (useWorktree && !thread) {
      setCreateError(t("branchPicker.create.worktreeNeedsThread"));
      return;
    }
    setCreateError(null);
    setBusy({ kind: "create", branch: name });
    const base = baseRef.trim() || null;
    try {
      if (useWorktree && thread) {
        const path = defaultWorktreePath(repo.path, name);
        await ipc.addGitWorktree(repo.path, path, name, base);
        const bound = await bindThreadWorktree(path);
        if (!bound) {
          throw new Error(useThreadStore.getState().error ?? "thread update failed");
        }
        toast.success(t("branchPicker.toasts.worktreeCreated", { branch: name }));
      } else {
        await ipc.createGitBranch(cwd, name, base);
        refreshGitPanel(cwd);
        toast.success(t("branchPicker.toasts.created", { branch: name }));
      }
      setCurrentBranch(name);
      setOpen(false);
    } catch (error) {
      setCreateError(String(error));
    } finally {
      setBusy(null);
    }
  }

  async function detachWorktree() {
    if (!thread || !repo || !worktreePath || mutationsLocked) return;
    setBusy({ kind: "detach" });
    const bound = await bindThreadWorktree(null);
    setBusy(null);
    if (!bound) {
      toast.error(
        t("branchPicker.toasts.detachFailed", {
          error: useThreadStore.getState().error ?? "",
        }),
      );
      return;
    }
    toast.success(t("branchPicker.toasts.detached"));
    setOpen(false);
  }

  function chooseRepo(candidate: Repo) {
    useWorkspaceStore.getState().setActiveRepo(candidate.id, { remember: false });
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => (navigableCount === 0 ? 0 : (index + 1) % navigableCount));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) =>
        navigableCount === 0 ? 0 : (index - 1 + navigableCount) % navigableCount,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = orderedRows[highlightIndex];
      if (row) {
        void selectBranch(row);
      } else if (showCreateAction) {
        openCreate(query);
      }
    }
  }

  const busyLabel = busy ? t(`branchPicker.busy.${busy.kind}`) : null;
  const triggerLabel = needsRepoChoice
    ? t("branchPicker.chooseRepo")
    : (currentBranch ?? panelBranch ?? repo?.defaultBranch ?? "");
  const triggerTitle = worktreePath
    ? t("branchPicker.inWorktree", { name: worktreeDisplayName(worktreePath) })
    : t("branchPicker.openMenu");

  function renderBranchRow(row: BranchRow, index: number) {
    const { branch } = row;
    const active = index === highlightIndex;
    const localName = branch.isRemote ? localNameForRemoteBranch(branch.name) : branch.name;
    const rowWorktree = row.worktreePath ? normalizePath(row.worktreePath) : null;
    const inOtherWorktree = rowWorktree !== null && rowWorktree !== repoPathKey;
    const isCurrentHere = branch.isCurrent && normalizePath(row.worktreePath ?? cwd ?? "") === normalizePath(cwd ?? "");
    const isDefault = !branch.isRemote && repo?.defaultBranch === branch.name;
    return (
      <button
        key={row.key}
        type="button"
        className={`bp-row${active ? " bp-row--active" : ""}${isCurrentHere ? " bp-row--current" : ""}`}
        onClick={() => void selectBranch(row)}
        onMouseEnter={() => setHighlightIndex(index)}
        disabled={mutationsLocked && !isCurrentHere}
        title={
          inOtherWorktree && row.worktreePath
            ? t("branchPicker.rowInWorktree", { name: worktreeDisplayName(row.worktreePath) })
            : isCurrentHere
              ? t("branchPicker.current")
              : branch.name
        }
      >
        <span className="bp-row-icon">
          {inOtherWorktree ? <FolderGit2 size={12} /> : <GitBranch size={12} />}
        </span>
        <span className="bp-row-name">{branch.name}</span>
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span className="bp-row-meta">
            {branch.ahead > 0 && (
              <span title={t("branchPicker.ahead", { count: branch.ahead })}>
                <ArrowUp size={9} />
                {branch.ahead}
              </span>
            )}
            {branch.behind > 0 && (
              <span title={t("branchPicker.behind", { count: branch.behind })}>
                <ArrowDown size={9} />
                {branch.behind}
              </span>
            )}
          </span>
        )}
        {inOtherWorktree && row.worktreePath ? (
          <span className="bp-row-badge">{worktreeDisplayName(row.worktreePath)}</span>
        ) : isDefault && !isCurrentHere ? (
          <span className="bp-row-badge">{t("branchPicker.badges.default")}</span>
        ) : null}
        {busy?.branch === localName ? (
          <Loader2 size={12} className="git-spin bp-row-check" />
        ) : isCurrentHere ? (
          <Check size={12} className="bp-row-check" />
        ) : null}
      </button>
    );
  }

  const branchesView = (
    <>
      <div className="bp-search">
        <Search size={12} />
        <input
          ref={searchInputRef}
          type="text"
          className="dropdown-search-input"
          value={query}
          placeholder={
            needsRepoChoice
              ? t("branchPicker.chooseRepo")
              : t("branchPicker.searchPlaceholder")
          }
          aria-label={t("branchPicker.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          disabled={needsRepoChoice}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        {(fetching || listLoading) && (
          <Loader2
            size={12}
            className="git-spin"
            aria-label={fetching ? t("branchPicker.fetching") : t("branchPicker.loading")}
          />
        )}
      </div>

      {worktreePath && repo && (
        <div className="bp-context">
          <FolderGit2 size={12} />
          <span className="bp-context-name" title={worktreePath}>
            {worktreeDisplayName(worktreePath)}
          </span>
          <button
            type="button"
            className="bp-context-action"
            onClick={() => void detachWorktree()}
            disabled={mutationsLocked}
          >
            {busy?.kind === "detach"
              ? t("branchPicker.busy.detach")
              : t("branchPicker.leaveWorktree")}
          </button>
        </div>
      )}

      <div className="bp-list">
        {needsRepoChoice ? (
          repos.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="bp-row"
              onClick={() => chooseRepo(candidate)}
            >
              <span className="bp-row-icon">
                <ProjectIcon label={candidate.name} />
              </span>
              <span className="bp-row-name bp-row-name--sans">{candidate.name}</span>
            </button>
          ))
        ) : (
          <>
            {rows.local.length > 0 && (
              <div className="bp-section-label">{t("branchPicker.local")}</div>
            )}
            {rows.local.map((row, index) => renderBranchRow(row, index))}
            {rows.remote.length > 0 && (
              <div className="bp-section-label">{t("branchPicker.remote")}</div>
            )}
            {rows.remote.map((row, index) => renderBranchRow(row, rows.local.length + index))}
            {listError ? (
              <div className="bp-error">{t("branchPicker.toasts.loadFailed", { error: listError })}</div>
            ) : orderedRows.length === 0 && !listLoading ? (
              <div className="bp-empty">
                {needle ? t("branchPicker.noMatches") : t("branchPicker.noBranches")}
              </div>
            ) : null}
          </>
        )}
      </div>

      {(showCreateAction || turnActive) && (
        <div className="bp-footer">
          {turnActive && <div className="bp-note">{t("branchPicker.turnRunning")}</div>}
          {showCreateAction && (
            <button
              type="button"
              className={`bp-row${highlightIndex === orderedRows.length ? " bp-row--active" : ""}`}
              onClick={() => openCreate(query)}
              onMouseEnter={() => setHighlightIndex(orderedRows.length)}
              disabled={mutationsLocked || !repo}
            >
              <span className="bp-row-icon">
                <GitBranchPlus size={12} />
              </span>
              <span className="bp-row-name bp-row-name--sans">
                {sanitizedQuery
                  ? t("branchPicker.newBranchNamed", { name: sanitizedQuery })
                  : t("branchPicker.newBranch")}
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );

  const worktreeFolder = worktreeFolderNameForBranch(sanitizeNewBranchName(newName)) || "…";
  const baseRefOptions = useMemo(() => {
    const known = new Set<string>();
    const options: Array<{ value: string; label: string; icon: ReactNode }> = [];
    for (const branch of localBranches) {
      known.add(branch.name);
      options.push({ value: branch.name, label: branch.name, icon: <GitBranch size={12} /> });
    }
    for (const branch of remoteBranches) {
      known.add(branch.name);
      options.push({ value: branch.name, label: branch.name, icon: <Cloud size={12} /> });
    }
    // A base typed or inherited from elsewhere still shows as the selection.
    if (baseRef && !known.has(baseRef)) {
      options.unshift({ value: baseRef, label: baseRef, icon: <GitBranch size={12} /> });
    }
    return options;
  }, [localBranches, remoteBranches, baseRef]);
  const createView = (
    <>
      <div className="bp-create-header">
        <button
          type="button"
          className="bp-back"
          onClick={() => setView("branches")}
          aria-label={t("branchPicker.back")}
        >
          <ChevronLeft size={13} />
        </button>
        <span>{t("branchPicker.create.title")}</span>
      </div>
      <div className="bp-create-body">
        <input
          ref={nameInputRef}
          type="text"
          className="git-inline-input"
          value={newName}
          placeholder={t("branchPicker.create.namePlaceholder")}
          aria-label={t("branchPicker.create.title")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setNewName(event.target.value);
            setCreateError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitCreate();
            }
          }}
        />
        <div className="bp-field">
          <span>{t("branchPicker.create.from")}</span>
          <Dropdown
            value={baseRef}
            selectedLabel={baseRef || undefined}
            selectedIcon={
              baseRef && !localBranches.some((branch) => branch.name === baseRef) ? (
                <Cloud size={12} />
              ) : (
                <GitBranch size={12} />
              )
            }
            title={t("branchPicker.create.from")}
            searchable
            searchPlaceholder={t("branchPicker.searchPlaceholder")}
            noResultsLabel={t("branchPicker.noMatches")}
            options={baseRefOptions}
            onChange={setBaseRef}
            menuClassName="bp-base-menu"
            maxMenuHeight={240}
          />
        </div>
        {!worktreePath && (
          <ToggleOptionCard
            icon={<FolderGit2 size={13} />}
            title={t("branchPicker.create.worktreeTitle")}
            description={t("branchPicker.create.worktreeDescription", { folder: worktreeFolder })}
            checked={useWorktree}
            onChange={setUseWorktree}
            disabled={!thread}
          />
        )}
      </div>
      <div className="bp-footer bp-footer--actions">
        {createError ? <div className="bp-error">{createError}</div> : <span style={{ flex: 1 }} />}
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: "4px 10px", fontSize: 11 }}
          disabled={!newName.trim() || mutationsLocked}
          onClick={() => void submitCreate()}
        >
          {busy?.kind === "create" ? (
            <>
              <Loader2 size={11} className="git-spin" />
              {t("branchPicker.create.creating")}
            </>
          ) : useWorktree ? (
            t("branchPicker.create.submitWorktree")
          ) : (
            t("branchPicker.create.submit")
          )}
        </button>
      </div>
    </>
  );

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="bp-popover"
          style={{ bottom: pos.bottom, right: pos.right }}
          role="dialog"
          aria-label={t("branchPicker.title")}
        >
          {view === "create" ? createView : branchesView}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="chat-branch-root">
      <button
        ref={triggerRef}
        type="button"
        className={`chat-branch-trigger${open ? " chat-branch-trigger--open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        title={busyLabel ?? triggerTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {busy ? (
          <Loader2 size={11} className="git-spin" aria-hidden="true" />
        ) : (
          <GitBranch size={11} aria-hidden="true" />
        )}
        <span className="chat-branch-trigger-label">
          {busyLabel ?? triggerLabel}
        </span>
        {worktreePath && !busy && (
          <span className="chat-branch-trigger-pill" title={worktreePath}>
            <FolderGit2 size={9} aria-hidden="true" />
            {worktreeDisplayName(worktreePath)}
          </span>
        )}
        <ChevronDown size={9} className="chat-branch-chevron" aria-hidden="true" />
      </button>
      {popover}
    </div>
  );
}
