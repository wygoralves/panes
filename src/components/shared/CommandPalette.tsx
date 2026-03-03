import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Columns2,
  SquareTerminal,
  FilePen,
  PanelLeft,
  GitBranch as GitBranchIcon,
  Search,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranchPlus,
  MessageSquare,
  Plus,
  Undo2,
  Archive,
  FolderOpen,
  Play,
  Send,
  File,
  ChevronRight,
  type LucideIcon,
  SplitSquareHorizontal,
  GitCommitHorizontal,
  ListTree,
  History,
  Layers,
} from "lucide-react";
import { ipc, writeCommandToNewSession } from "../../lib/ipc";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useThreadStore } from "../../stores/threadStore";
import { useChatStore } from "../../stores/chatStore";
import { useGitStore } from "../../stores/gitStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useFileStore } from "../../stores/fileStore";
import { useHarnessStore } from "../../stores/harnessStore";
import { toast } from "../../stores/toastStore";
import type { FileTreeEntry, GitBranch, HarnessInfo, Thread, Workspace } from "../../types";

/* ------------------------------------------------------------------ */
/*  Fuzzy search                                                       */
/* ------------------------------------------------------------------ */

function fuzzyScore(pattern: string, text: string): number | null {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  if (p.length === 0) return 0;

  let pi = 0;
  let score = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && pi < p.length; ti++) {
    if (t[ti] === p[pi]) {
      score += lastMatch === ti - 1 ? 3 : 1;
      if (ti === 0) score += 5;
      if (ti > 0 && /[\s/._-]/.test(t[ti - 1])) score += 3;
      lastMatch = ti;
      pi++;
    }
  }

  return pi === p.length ? score : null;
}

function fuzzyFilter<T>(
  items: T[],
  term: string,
  getText: (item: T) => string,
  limit: number,
): T[] {
  if (!term) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(term, getText(item)) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map((entry) => entry.item);
}

/* ------------------------------------------------------------------ */
/*  Mode detection                                                     */
/* ------------------------------------------------------------------ */

type PaletteMode = "default" | "command" | "thread" | "workspace" | "auto";

function detectMode(query: string): { mode: PaletteMode; term: string } {
  if (query === "") return { mode: "default", term: "" };
  if (query.startsWith(">") || query.startsWith("/")) {
    return { mode: "command", term: query.slice(1).trimStart() };
  }
  if (query.startsWith("@")) {
    return { mode: "thread", term: query.slice(1) };
  }
  if (query.startsWith("#")) {
    return { mode: "workspace", term: query.slice(1) };
  }
  return { mode: "auto", term: query };
}

/* ------------------------------------------------------------------ */
/*  Sub-flow types                                                     */
/* ------------------------------------------------------------------ */

type SubFlow =
  | { type: "checkout-branch"; query: string; branches: GitBranch[]; loading: boolean }
  | { type: "create-branch"; value: string }
  | { type: "commit"; value: string }
  | { type: "stash"; value: string };

/* ------------------------------------------------------------------ */
/*  Command registry types                                             */
/* ------------------------------------------------------------------ */

type CommandGroup = "layout" | "git" | "harness" | "navigation" | "view";

interface CommandContext {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
  close: () => void;
  openSubFlow: (flow: SubFlow) => void;
}

interface CommandEntry {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  group: CommandGroup;
  keywords?: string[];
  shortcut?: string;
  action: (ctx: CommandContext) => void | Promise<void>;
  isAvailable?: (ctx: CommandContext) => boolean;
}

/* ------------------------------------------------------------------ */
/*  Result item union                                                  */
/* ------------------------------------------------------------------ */

type ResultItem =
  | { type: "command"; entry: CommandEntry }
  | { type: "file"; entry: FileTreeEntry }
  | { type: "thread"; entry: Thread }
  | { type: "workspace"; entry: Workspace }
  | { type: "harness"; entry: HarnessInfo }
  | { type: "branch"; entry: GitBranch }
  | { type: "send-message"; query: string }
  | { type: "sub-action"; label: string; description?: string };

interface ResultGroup {
  label: string;
  items: ResultItem[];
}

/* ------------------------------------------------------------------ */
/*  Static commands                                                    */
/* ------------------------------------------------------------------ */

const STATIC_COMMANDS: CommandEntry[] = [
  // Layout
  {
    id: "layout-chat",
    label: "Switch to Chat",
    icon: Columns2,
    group: "layout",
    keywords: ["chat", "mode", "view"],
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "chat");
      close();
    },
  },
  {
    id: "layout-split",
    label: "Switch to Split View",
    icon: SplitSquareHorizontal,
    group: "layout",
    keywords: ["split", "terminal", "half"],
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "split");
      close();
    },
  },
  {
    id: "layout-terminal",
    label: "Switch to Terminal",
    icon: SquareTerminal,
    group: "layout",
    keywords: ["terminal", "full", "shell"],
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "terminal");
      close();
    },
  },
  {
    id: "layout-editor",
    label: "Switch to Editor",
    icon: FilePen,
    group: "layout",
    keywords: ["editor", "code", "file"],
    shortcut: "\u2318E",
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "editor");
      close();
    },
  },
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    icon: PanelLeft,
    group: "layout",
    keywords: ["sidebar", "panel", "left"],
    shortcut: "\u2318B",
    action: ({ close }) => {
      useUiStore.getState().toggleSidebar();
      close();
    },
  },
  {
    id: "toggle-git-panel",
    label: "Toggle Git Panel",
    icon: GitBranchIcon,
    group: "layout",
    keywords: ["git", "panel", "right"],
    shortcut: "\u2318\u21E7B",
    action: ({ close }) => {
      useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "open-search",
    label: "Search Messages",
    icon: Search,
    group: "layout",
    keywords: ["search", "find", "messages", "fts"],
    shortcut: "\u2318\u21E7F",
    action: ({ close }) => {
      close();
      useUiStore.getState().setSearchOpen(true);
    },
  },
  // Git
  {
    id: "git-fetch",
    label: "Git Fetch",
    icon: RefreshCw,
    group: "git",
    keywords: ["fetch", "remote", "sync"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().fetchRemote(activeRepoPath);
        toast.success("Fetch complete");
      } catch {
        toast.error("Fetch failed");
      }
    },
  },
  {
    id: "git-pull",
    label: "Git Pull",
    icon: ArrowDownToLine,
    group: "git",
    keywords: ["pull", "download", "sync"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().pullRemote(activeRepoPath);
        toast.success("Pull complete");
      } catch {
        toast.error("Pull failed");
      }
    },
  },
  {
    id: "git-push",
    label: "Git Push",
    icon: ArrowUpFromLine,
    group: "git",
    keywords: ["push", "upload", "remote"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().pushRemote(activeRepoPath);
        toast.success("Push complete");
      } catch {
        toast.error("Push failed");
      }
    },
  },
  {
    id: "git-checkout-branch",
    label: "Checkout Branch\u2026",
    icon: GitBranchIcon,
    group: "git",
    keywords: ["checkout", "switch", "branch"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "checkout-branch", query: "", branches: [], loading: true });
    },
  },
  {
    id: "git-create-branch",
    label: "Create Branch\u2026",
    icon: GitBranchPlus,
    group: "git",
    keywords: ["create", "new", "branch"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "create-branch", value: "" });
    },
  },
  {
    id: "git-commit",
    label: "Commit Staged Changes\u2026",
    icon: GitCommitHorizontal,
    group: "git",
    keywords: ["commit", "save", "staged"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "commit", value: "" });
    },
  },
  {
    id: "git-stash-push",
    label: "Stash Changes\u2026",
    icon: Archive,
    group: "git",
    keywords: ["stash", "save", "shelve"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "stash", value: "" });
    },
  },
  {
    id: "git-soft-reset",
    label: "Soft Reset Last Commit",
    icon: Undo2,
    group: "git",
    keywords: ["reset", "undo", "uncommit"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().softResetLastCommit(activeRepoPath);
        toast.success("Last commit reset");
      } catch {
        toast.error("Reset failed");
      }
    },
  },
  // Navigation
  {
    id: "new-thread",
    label: "New Thread",
    icon: Plus,
    group: "navigation",
    keywords: ["new", "thread", "conversation", "chat"],
    action: async ({ activeWorkspaceId, close }) => {
      close();
      if (!activeWorkspaceId) return;
      const threadId = await useThreadStore.getState().createThread({
        workspaceId: activeWorkspaceId,
        repoId: null,
        title: "New Thread",
      });
      if (threadId) {
        useThreadStore.getState().setActiveThread(threadId);
        await useChatStore.getState().setActiveThread(threadId);
      }
    },
  },
  {
    id: "switch-thread",
    label: "Switch Thread\u2026",
    description: "Search threads by name",
    icon: MessageSquare,
    group: "navigation",
    keywords: ["thread", "conversation", "switch"],
    action: (_ctx) => {
      // Handled by the component — sets query to "@"
    },
  },
  {
    id: "switch-workspace",
    label: "Switch Workspace\u2026",
    description: "Search workspaces",
    icon: FolderOpen,
    group: "navigation",
    keywords: ["workspace", "project", "folder", "switch"],
    action: (_ctx) => {
      // Handled by the component — sets query to "#"
    },
  },
  // View
  {
    id: "view-changes",
    label: "Open Git Changes",
    icon: ListTree,
    group: "view",
    keywords: ["changes", "status", "diff", "staged"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("changes");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-branches",
    label: "Open Git Branches",
    icon: GitBranchIcon,
    group: "view",
    keywords: ["branches", "branch", "list"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("branches");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-commits",
    label: "Open Git Commits",
    icon: History,
    group: "view",
    keywords: ["commits", "log", "history"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("commits");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-stash",
    label: "Open Git Stash",
    icon: Layers,
    group: "view",
    keywords: ["stash", "shelve", "list"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("stash");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-harnesses",
    label: "Open Agents Panel",
    icon: Play,
    group: "view",
    keywords: ["agents", "harnesses", "tools", "ai"],
    action: ({ close }) => {
      useUiStore.getState().setActiveView("harnesses");
      close();
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCommandSearchText(cmd: CommandEntry): string {
  return [cmd.label, ...(cmd.keywords ?? [])].join(" ");
}

function fileBaseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function fileDirName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx + 1) : "";
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Inline style constants                                             */
/* ------------------------------------------------------------------ */

const STYLES = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 10001,
    background: "rgba(8, 9, 12, 0.65)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "flex-start" as const,
    justifyContent: "center" as const,
    padding: "12vh 20px 20px",
  },
  card: {
    width: "min(680px, calc(100% - 40px))",
    maxHeight: "72vh",
    overflow: "hidden" as const,
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    boxShadow: "0 22px 70px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)",
    animation: "slide-up 150ms cubic-bezier(0.16, 1, 0.3, 1) both",
  },
  inputRow: {
    display: "flex",
    alignItems: "center" as const,
    gap: 6,
    padding: "14px 14px 12px",
    borderBottom: "1px solid var(--border)",
  },
  modeBadge: {
    display: "inline-flex",
    alignItems: "center" as const,
    padding: "2px 7px",
    background: "var(--accent-dim)",
    color: "var(--accent)",
    borderRadius: "var(--radius-sm)",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "monospace",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-1)",
    fontSize: 14,
    fontFamily: "inherit",
    lineHeight: 1.5,
  },
  results: {
    overflowY: "auto" as const,
    maxHeight: "calc(72vh - 100px)",
  },
  groupHeader: {
    padding: "8px 12px 4px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--text-3)",
    userSelect: "none" as const,
  },
  item: (active: boolean) => ({
    display: "grid",
    gridTemplateColumns: "28px 1fr auto",
    alignItems: "center" as const,
    gap: 8,
    padding: "0 12px",
    minHeight: 40,
    width: "100%",
    border: "none",
    background: active ? "rgba(14, 240, 195, 0.08)" : "transparent",
    cursor: "pointer",
    textAlign: "left" as const,
    fontFamily: "inherit",
    transition: "background 60ms ease",
  }),
  itemIcon: (active: boolean) => ({
    display: "flex",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    color: active ? "var(--accent)" : "var(--text-3)",
  }),
  itemLabel: {
    fontSize: 13,
    color: "var(--text-1)",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  itemDescription: {
    fontSize: 11.5,
    color: "var(--text-3)",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  itemShortcut: {
    fontSize: 11,
    color: "var(--text-3)",
    fontFamily: "monospace",
    flexShrink: 0,
  },
  footer: {
    display: "flex",
    alignItems: "center" as const,
    gap: 16,
    padding: "7px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--text-3)",
    userSelect: "none" as const,
  },
  footerKbd: {
    fontFamily: "monospace",
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "var(--bg-4)",
    color: "var(--text-2)",
    marginRight: 3,
  },
  emptyState: {
    padding: "32px 16px",
    textAlign: "center" as const,
    color: "var(--text-3)",
    fontSize: 12.5,
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [subFlow, setSubFlow] = useState<SubFlow | null>(null);
  const [fileEntries, setFileEntries] = useState<FileTreeEntry[]>([]);
  const [fileLoading, setFileLoading] = useState(false);

  const fileCacheRef = useRef<Map<string, FileTreeEntry[]>>(new Map());

  // Store selectors
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const repos = useWorkspaceStore((s) => s.repos);
  const activeRepoId = useWorkspaceStore((s) => s.activeRepoId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const threads = useThreadStore((s) => s.threads);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const harnesses = useHarnessStore((s) => s.harnesses);

  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const activeRepoPath = activeRepo?.path ?? null;

  const workspaceThreads = useMemo(
    () => threads.filter((t) => t.workspaceId === activeWorkspaceId),
    [threads, activeWorkspaceId],
  );

  const installedHarnesses = useMemo(
    () => harnesses.filter((h) => h.found),
    [harnesses],
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId],
  );

  // Derived mode
  const { mode, term } = useMemo(() => detectMode(query), [query]);

  // Context object for command actions
  const commandCtx = useMemo<CommandContext>(
    () => ({
      activeWorkspaceId,
      activeRepoPath,
      close: onClose,
      openSubFlow: setSubFlow,
    }),
    [activeWorkspaceId, activeRepoPath, onClose],
  );

  // Available commands filtered by context
  const availableCommands = useMemo(
    () => STATIC_COMMANDS.filter((c) => !c.isAvailable || c.isAvailable(commandCtx)),
    [commandCtx],
  );

  /* ---- Reset on open/close ---- */
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setSubFlow(null);
      setFileEntries([]);
      setFileLoading(false);
      fileCacheRef.current.clear();
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  /* ---- File search (lazy, debounced) ---- */
  useEffect(() => {
    if (!open || mode !== "auto" || term.length < 2 || !activeRepoPath) {
      if (mode !== "auto") setFileEntries([]);
      return;
    }

    const cached = fileCacheRef.current.get(activeRepoPath);
    if (cached) {
      setFileEntries(cached);
      return;
    }

    let cancelled = false;
    setFileLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const page = await ipc.getFileTreePage(activeRepoPath, 0, 2000);
        if (cancelled) return;
        const files = page.entries.filter((e) => !e.isDir);
        fileCacheRef.current.set(activeRepoPath, files);
        setFileEntries(files);
      } catch {
        // Degrade gracefully — no file results
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, term, activeRepoPath]);

  /* ---- Branch search for sub-flow ---- */
  useEffect(() => {
    if (!open || subFlow?.type !== "checkout-branch" || !activeRepoPath) return;

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const page = await ipc.listGitBranches(
          activeRepoPath,
          "local",
          0,
          50,
          subFlow.query || undefined,
        );
        if (!cancelled) {
          setSubFlow((prev) =>
            prev?.type === "checkout-branch"
              ? { ...prev, branches: page.entries, loading: false }
              : prev,
          );
        }
      } catch {
        if (!cancelled) {
          setSubFlow((prev) =>
            prev?.type === "checkout-branch" ? { ...prev, loading: false } : prev,
          );
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, subFlow?.type, subFlow?.type === "checkout-branch" ? subFlow.query : null, activeRepoPath]);

  /* ---- Build result groups ---- */
  const groups = useMemo<ResultGroup[]>(() => {
    // Sub-flow mode — special results
    if (subFlow) {
      if (subFlow.type === "checkout-branch") {
        const items: ResultItem[] = subFlow.branches.map((b) => ({
          type: "branch" as const,
          entry: b,
        }));
        if (subFlow.loading && items.length === 0) {
          return [{ label: "Branches", items: [{ type: "sub-action", label: "Loading branches\u2026" }] }];
        }
        if (items.length === 0) {
          return [{ label: "Branches", items: [{ type: "sub-action", label: "No branches found" }] }];
        }
        return [{ label: "Branches", items }];
      }
      if (subFlow.type === "create-branch") {
        const valid = subFlow.value.length > 0 && !/\s/.test(subFlow.value);
        return [{
          label: "Create Branch",
          items: [{
            type: "sub-action",
            label: valid
              ? `Create branch "${subFlow.value}"`
              : subFlow.value.length === 0
                ? "Type a branch name\u2026"
                : "Branch names cannot contain spaces",
          }],
        }];
      }
      if (subFlow.type === "commit") {
        return [{
          label: "Commit",
          items: [{
            type: "sub-action",
            label: subFlow.value.length > 0
              ? `Commit with: "${subFlow.value}"`
              : "Type a commit message\u2026",
          }],
        }];
      }
      if (subFlow.type === "stash") {
        return [{
          label: "Stash",
          items: [{
            type: "sub-action",
            label: subFlow.value.length > 0
              ? `Stash with message: "${subFlow.value}"`
              : "Press Enter to stash (or type a message)",
          }],
        }];
      }
    }

    if (mode === "default") {
      const result: ResultGroup[] = [];

      // Quick actions
      const quickIds = ["layout-chat", "layout-split", "layout-terminal", "layout-editor", "toggle-sidebar", "toggle-git-panel"];
      const quickItems: ResultItem[] = availableCommands
        .filter((c) => quickIds.includes(c.id))
        .map((c) => ({ type: "command", entry: c }));
      if (quickItems.length > 0) result.push({ label: "Quick Actions", items: quickItems });

      // Installed harnesses
      if (installedHarnesses.length > 0) {
        result.push({
          label: "Launch Agent",
          items: installedHarnesses.map((h) => ({ type: "harness", entry: h })),
        });
      }

      // Recent threads
      const recentThreads = workspaceThreads.slice(0, 5);
      if (recentThreads.length > 0) {
        result.push({
          label: "Recent Threads",
          items: recentThreads.map((t) => ({ type: "thread", entry: t })),
        });
      }

      // Git shortcuts
      const gitIds = ["git-fetch", "git-pull", "git-push"];
      const gitItems: ResultItem[] = availableCommands
        .filter((c) => gitIds.includes(c.id))
        .map((c) => ({ type: "command", entry: c }));
      if (gitItems.length > 0) result.push({ label: "Git", items: gitItems });

      return result;
    }

    if (mode === "command") {
      const filtered = fuzzyFilter(availableCommands, term, getCommandSearchText, 20);

      // Group by command group
      const groupMap = new Map<CommandGroup, CommandEntry[]>();
      for (const cmd of filtered) {
        const list = groupMap.get(cmd.group) ?? [];
        list.push(cmd);
        groupMap.set(cmd.group, list);
      }

      const groupOrder: Array<{ key: CommandGroup; label: string }> = [
        { key: "layout", label: "Layout" },
        { key: "navigation", label: "Navigation" },
        { key: "git", label: "Git" },
        { key: "view", label: "Views" },
        { key: "harness", label: "Agents" },
      ];

      const result: ResultGroup[] = [];
      for (const g of groupOrder) {
        const items = groupMap.get(g.key);
        if (items && items.length > 0) {
          result.push({
            label: g.label,
            items: items.map((c) => ({ type: "command", entry: c })),
          });
        }
      }
      return result;
    }

    if (mode === "thread") {
      const filtered = fuzzyFilter(workspaceThreads, term, (t) => t.title, 15);
      if (filtered.length === 0) {
        return [{ label: "Threads", items: [{ type: "sub-action", label: "No threads found" }] }];
      }
      return [{ label: "Threads", items: filtered.map((t) => ({ type: "thread", entry: t })) }];
    }

    if (mode === "workspace") {
      const filtered = fuzzyFilter(workspaces, term, (w) => w.name, 10);
      if (filtered.length === 0) {
        return [{ label: "Workspaces", items: [{ type: "sub-action", label: "No workspaces found" }] }];
      }
      return [{
        label: "Workspaces",
        items: filtered.map((w) => ({ type: "workspace", entry: w })),
      }];
    }

    // Auto mode
    const result: ResultGroup[] = [];

    // Send as message (sticky)
    if (term.length >= 1 && activeThread) {
      result.push({
        label: "",
        items: [{ type: "send-message", query: term }],
      });
    }

    // Files
    if (fileEntries.length > 0 && term.length >= 2) {
      const filteredFiles = fuzzyFilter(fileEntries, term, (f) => f.path, 10);
      if (filteredFiles.length > 0) {
        result.push({
          label: fileLoading ? "Files (loading\u2026)" : "Files",
          items: filteredFiles.map((f) => ({ type: "file", entry: f })),
        });
      }
    }

    // Commands
    const filteredCmds = fuzzyFilter(availableCommands, term, getCommandSearchText, 8);
    if (filteredCmds.length > 0) {
      result.push({
        label: "Commands",
        items: filteredCmds.map((c) => ({ type: "command", entry: c })),
      });
    }

    // Threads
    const filteredThreads = fuzzyFilter(workspaceThreads, term, (t) => t.title, 5);
    if (filteredThreads.length > 0) {
      result.push({
        label: "Threads",
        items: filteredThreads.map((t) => ({ type: "thread", entry: t })),
      });
    }

    // Harnesses
    if (installedHarnesses.length > 0) {
      const filteredHarnesses = fuzzyFilter(installedHarnesses, term, (h) => `${h.name} ${h.command}`, 4);
      if (filteredHarnesses.length > 0) {
        result.push({
          label: "Agents",
          items: filteredHarnesses.map((h) => ({ type: "harness", entry: h })),
        });
      }
    }

    return result;
  }, [
    mode, term, subFlow, availableCommands, workspaceThreads, workspaces,
    installedHarnesses, fileEntries, fileLoading, activeThread,
  ]);

  // Flat items for keyboard navigation
  const flatItems = useMemo<ResultItem[]>(() => {
    return groups.flatMap((g) => g.items);
  }, [groups]);

  // Clamp active index
  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(flatItems.length - 1, 0)));
  }, [flatItems.length]);

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /* ---- Actions ---- */

  const launchHarness = useCallback(
    async (harness: HarnessInfo) => {
      if (!activeWorkspaceId) return;
      const command = await useHarnessStore.getState().launch(harness.id);
      if (!command) return;

      const ws = useTerminalStore.getState().workspaces[activeWorkspaceId];
      if (!ws || (ws.layoutMode !== "terminal" && ws.layoutMode !== "split")) {
        await useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "terminal");
      }
      const sessionId = await useTerminalStore.getState().createSession(activeWorkspaceId);
      if (sessionId) {
        void writeCommandToNewSession(activeWorkspaceId, sessionId, command);
      }
      useUiStore.getState().setActiveView("chat");
    },
    [activeWorkspaceId],
  );

  const executeItem = useCallback(
    async (item: ResultItem) => {
      switch (item.type) {
        case "command": {
          const cmd = item.entry;
          // Special: switch-thread / switch-workspace set the query prefix
          if (cmd.id === "switch-thread") {
            setQuery("@");
            setActiveIndex(0);
            return;
          }
          if (cmd.id === "switch-workspace") {
            setQuery("#");
            setActiveIndex(0);
            return;
          }
          await cmd.action(commandCtx);
          break;
        }
        case "file": {
          onClose();
          if (activeRepoPath) {
            await useFileStore.getState().openFile(activeRepoPath, item.entry.path);
          }
          break;
        }
        case "thread": {
          onClose();
          const thread = item.entry;
          if (thread.workspaceId !== activeWorkspaceId) {
            await useWorkspaceStore.getState().setActiveWorkspace(thread.workspaceId);
          }
          useThreadStore.getState().setActiveThread(thread.id);
          await useChatStore.getState().setActiveThread(thread.id);
          useUiStore.getState().setActiveView("chat");
          break;
        }
        case "workspace": {
          onClose();
          await useWorkspaceStore.getState().setActiveWorkspace(item.entry.id);
          break;
        }
        case "harness": {
          onClose();
          await launchHarness(item.entry);
          break;
        }
        case "branch": {
          onClose();
          if (activeRepoPath) {
            try {
              await useGitStore.getState().checkoutBranch(activeRepoPath, item.entry.name, item.entry.isRemote);
              toast.success(`Checked out ${item.entry.name}`);
            } catch {
              toast.error("Checkout failed");
            }
          }
          break;
        }
        case "send-message": {
          onClose();
          if (activeThreadId) {
            await useChatStore.getState().send(item.query);
          }
          break;
        }
        case "sub-action":
          // Non-interactive placeholder items
          break;
      }
    },
    [commandCtx, activeRepoPath, activeWorkspaceId, activeThreadId, onClose, launchHarness],
  );

  const executeSubFlow = useCallback(async () => {
    if (!subFlow || !activeRepoPath) return;

    if (subFlow.type === "create-branch") {
      if (subFlow.value.length === 0 || /\s/.test(subFlow.value)) return;
      onClose();
      try {
        await useGitStore.getState().createBranch(activeRepoPath, subFlow.value);
        toast.success(`Branch "${subFlow.value}" created`);
      } catch {
        toast.error("Failed to create branch");
      }
      return;
    }

    if (subFlow.type === "commit") {
      if (subFlow.value.length === 0) return;
      onClose();
      try {
        await useGitStore.getState().commit(activeRepoPath, subFlow.value);
        toast.success("Committed");
      } catch {
        toast.error("Commit failed");
      }
      return;
    }

    if (subFlow.type === "stash") {
      onClose();
      try {
        await useGitStore.getState().pushStash(activeRepoPath, subFlow.value || undefined);
        toast.success("Changes stashed");
      } catch {
        toast.error("Stash failed");
      }
      return;
    }
  }, [subFlow, activeRepoPath, onClose]);

  /* ---- Keyboard handler ---- */

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (subFlow) {
          setSubFlow(null);
          setQuery("");
          setActiveIndex(0);
        } else {
          onClose();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((idx) => Math.min(idx + 1, Math.max(flatItems.length - 1, 0)));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((idx) => Math.max(idx - 1, 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (subFlow) {
          void executeSubFlow();
          return;
        }
        const selected = flatItems[activeIndex];
        if (selected) void executeItem(selected);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (subFlow) return;
        // Cycle through mode prefixes
        const currentPrefix = query.length > 0 && [">", "@", "#"].includes(query[0]) ? query[0] : "";
        const prefixes = [">", "@", "#", ""];
        const currentIdx = prefixes.indexOf(currentPrefix);
        const nextIdx = (currentIdx + 1) % prefixes.length;
        setQuery(prefixes[nextIdx]);
        setActiveIndex(0);
        return;
      }
    },
    [flatItems, activeIndex, subFlow, query, onClose, executeItem, executeSubFlow],
  );

  /* ---- Input change handler ---- */

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (subFlow) {
        if (subFlow.type === "checkout-branch") {
          setSubFlow({ ...subFlow, query: value, loading: true });
        } else if (subFlow.type === "create-branch") {
          setSubFlow({ ...subFlow, value });
        } else if (subFlow.type === "commit") {
          setSubFlow({ ...subFlow, value });
        } else if (subFlow.type === "stash") {
          setSubFlow({ ...subFlow, value });
        }
      } else {
        setQuery(value);
        setActiveIndex(0);
      }
    },
    [subFlow],
  );

  /* ---- Render helpers ---- */

  const getInputValue = (): string => {
    if (subFlow) {
      if (subFlow.type === "checkout-branch") return subFlow.query;
      if (subFlow.type === "create-branch") return subFlow.value;
      if (subFlow.type === "commit") return subFlow.value;
      if (subFlow.type === "stash") return subFlow.value;
    }
    return query;
  };

  const getPlaceholder = (): string => {
    if (subFlow) {
      if (subFlow.type === "checkout-branch") return "Search branches\u2026";
      if (subFlow.type === "create-branch") return "Enter branch name\u2026";
      if (subFlow.type === "commit") return "Enter commit message\u2026";
      if (subFlow.type === "stash") return "Stash message (optional)\u2026";
    }
    return "Search files, commands, threads\u2026";
  };

  const getModeBadge = (): ReactNode => {
    if (subFlow) {
      const labels: Record<string, string> = {
        "checkout-branch": "branch",
        "create-branch": "new branch",
        commit: "commit",
        stash: "stash",
      };
      return <span style={STYLES.modeBadge}>{labels[subFlow.type]}</span>;
    }
    if (mode === "command") return <span style={STYLES.modeBadge}>&gt;</span>;
    if (mode === "thread") return <span style={STYLES.modeBadge}>@</span>;
    if (mode === "workspace") return <span style={STYLES.modeBadge}>#</span>;
    return null;
  };

  function renderItem(item: ResultItem, index: number): ReactNode {
    const active = index === activeIndex;
    const key = `${item.type}-${index}`;

    switch (item.type) {
      case "command": {
        const Icon = item.entry.icon;
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><Icon size={16} /></span>
            <span style={STYLES.itemLabel}>{item.entry.label}</span>
            {item.entry.shortcut && <span style={STYLES.itemShortcut}>{item.entry.shortcut}</span>}
            {(item.entry.id === "switch-thread" || item.entry.id === "switch-workspace") && (
              <ChevronRight size={14} style={{ color: "var(--text-3)" }} />
            )}
          </button>
        );
      }
      case "file": {
        const base = fileBaseName(item.entry.path);
        const dir = fileDirName(item.entry.path);
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><File size={16} /></span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6, overflow: "hidden" }}>
              <span style={{ ...STYLES.itemLabel, fontWeight: 500, flexShrink: 0 }}>{base}</span>
              {dir && <span style={STYLES.itemDescription}>{dir}</span>}
            </span>
            <span />
          </button>
        );
      }
      case "thread": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><MessageSquare size={16} /></span>
            <span style={{ overflow: "hidden" }}>
              <span style={STYLES.itemLabel}>{item.entry.title}</span>
            </span>
            <span style={STYLES.itemDescription}>{relativeTime(item.entry.lastActivityAt)}</span>
          </button>
        );
      }
      case "workspace": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><FolderOpen size={16} /></span>
            <span style={STYLES.itemLabel}>{item.entry.name}</span>
            <span style={STYLES.itemDescription}>{item.entry.rootPath}</span>
          </button>
        );
      }
      case "harness": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><Play size={16} /></span>
            <span style={STYLES.itemLabel}>{item.entry.name}</span>
            {item.entry.version && <span style={STYLES.itemDescription}>v{item.entry.version}</span>}
          </button>
        );
      }
      case "branch": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><GitBranchIcon size={16} /></span>
            <span style={STYLES.itemLabel}>
              {item.entry.name}
              {item.entry.isCurrent && <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 11 }}>current</span>}
            </span>
            <span />
          </button>
        );
      }
      case "send-message": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><Send size={16} /></span>
            <span style={{ overflow: "hidden" }}>
              <span style={{ ...STYLES.itemLabel, fontSize: 12.5 }}>
                Send to {activeThread?.title ?? "chat"}
              </span>
            </span>
            <span style={STYLES.itemShortcut}>Enter</span>
          </button>
        );
      }
      case "sub-action": {
        return (
          <div
            key={key}
            ref={active ? (activeItemRef as React.Ref<HTMLDivElement>) : undefined}
            style={{ ...STYLES.item(false), cursor: "default", color: "var(--text-3)" }}
          >
            <span />
            <span style={{ ...STYLES.itemLabel, color: "var(--text-3)" }}>{item.label}</span>
            <span />
          </div>
        );
      }
    }
  }

  /* ---- Early return ---- */
  if (!open) return null;

  /* ---- Render ---- */

  let flatIndex = 0;

  return createPortal(
    <div style={STYLES.backdrop} onClick={onClose}>
      <div
        className="surface"
        style={STYLES.card}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div style={STYLES.inputRow}>
          {getModeBadge()}
          <input
            ref={inputRef}
            style={STYLES.input}
            value={getInputValue()}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder={getPlaceholder()}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Results */}
        <div ref={resultsRef} style={STYLES.results}>
          {flatItems.length === 0 && (
            <p style={STYLES.emptyState}>
              {!activeWorkspaceId ? "No active workspace" : "No results"}
            </p>
          )}
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && <div style={STYLES.groupHeader}>{group.label}</div>}
              {group.items.map((item) => {
                const node = renderItem(item, flatIndex);
                flatIndex++;
                return node;
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={STYLES.footer}>
          <span><kbd style={STYLES.footerKbd}>{"\u2191\u2193"}</kbd> navigate</span>
          <span><kbd style={STYLES.footerKbd}>{"\u21B5"}</kbd> select</span>
          <span><kbd style={STYLES.footerKbd}>esc</kbd> {subFlow ? "back" : "close"}</span>
          {!subFlow && <span><kbd style={STYLES.footerKbd}>tab</kbd> switch mode</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
