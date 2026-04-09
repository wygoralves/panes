import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Columns2,
  SquareTerminal,
  FilePen,
  Focus,
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
  Trash2,
  ListChecks,
  ListX,
  FolderGit2,
  Power,
  RotateCcw,
  Minimize2,
} from "lucide-react";
import { ipc, writeCommandToNewSession } from "../../lib/ipc";
import {
  COMMAND_PALETTE_DEFAULT_LAUNCH,
  detectCommandPaletteMode,
  getNextCommandPalettePrefix,
  getNextCommandPaletteSearchScope,
  normalizeCommandPaletteInput,
  shouldTabCycleCommandPaletteSearchScope,
  type CommandPaletteSearchScope,
} from "../../lib/commandPalette";
import {
  getActiveGitRepos,
  hasMultipleActiveGitRepos,
  isRepoScopedGitCommandAvailable,
  resolveCommandPaletteGitStatus,
  shouldPersistPickedRepoSelection,
} from "../../lib/commandPaletteGit";
import { formatRelativeTime } from "../../lib/formatters";
import { createAndActivateWorkspaceThread } from "../../lib/newThreadActions";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useThreadStore } from "../../stores/threadStore";
import { useChatStore } from "../../stores/chatStore";
import { useGitStore } from "../../stores/gitStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useFileStore } from "../../stores/fileStore";
import { useHarnessStore } from "../../stores/harnessStore";
import { canToggleKeepAwake, useKeepAwakeStore } from "../../stores/keepAwakeStore";
import { toast } from "../../stores/toastStore";
import type { FileTreeEntry, GitBranch, GitStash, GitStatus, HarnessInfo, Repo, SearchResult, Thread, Workspace } from "../../types";

const FILE_SEARCH_PAGE_SIZE = 500;
const FILE_SEARCH_PAGE_DELAY_MS = 80;

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
/*  Sub-flow types                                                     */
/* ------------------------------------------------------------------ */

type SubFlow =
  | { type: "checkout-branch"; query: string; branches: GitBranch[]; loading: boolean }
  | { type: "create-branch"; value: string }
  | { type: "commit"; value: string }
  | { type: "stash"; value: string }
  | { type: "delete-branch"; query: string; branches: GitBranch[]; loading: boolean }
  | { type: "apply-stash"; query: string; stashes: GitStash[]; loading: boolean }
  | { type: "pop-stash"; query: string; stashes: GitStash[]; loading: boolean }
  | { type: "switch-repo"; query: string }
  | { type: "codex-rollback"; value: string }
  | { type: "pick-repo"; query: string; nextAction: string };

/* ------------------------------------------------------------------ */
/*  Command registry types                                             */
/* ------------------------------------------------------------------ */

type CommandGroup = "layout" | "git" | "harness" | "navigation" | "view" | "codex";

interface CommandContext {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
  repos: Repo[];
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
  | { type: "message-search"; entry: SearchResult }
  | { type: "file"; entry: FileTreeEntry }
  | { type: "thread"; entry: Thread }
  | { type: "workspace"; entry: Workspace }
  | { type: "harness"; entry: HarnessInfo }
  | { type: "branch"; entry: GitBranch }
  | { type: "stash"; entry: GitStash }
  | { type: "repo"; entry: Repo }
  | { type: "send-message"; query: string }
  | { type: "sub-action"; label: string; description?: string };

interface ResultGroup {
  label: string;
  items: ResultItem[];
}

interface StaticCommandOptions {
  keepAwakeAvailable?: boolean;
}

function isGitCommandAvailable(ctx: CommandContext): boolean {
  return isRepoScopedGitCommandAvailable(ctx.activeRepoPath, ctx.repos);
}

/* ------------------------------------------------------------------ */
/*  Static commands                                                    */
/* ------------------------------------------------------------------ */

export function getStaticCommands(
  t: TFunction<"app">,
  options: StaticCommandOptions = {},
): CommandEntry[] {
  const { keepAwakeAvailable = true } = options;
  return [
  // Layout
  {
    id: "layout-chat",
    label: t("commandPalette.commands.layoutChat"),
    icon: Columns2,
    group: "layout",
    keywords: ["chat", "mode", "view", "conversa", "layout"],
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "chat");
      close();
    },
  },
  {
    id: "layout-split",
    label: t("commandPalette.commands.layoutSplit"),
    icon: SplitSquareHorizontal,
    group: "layout",
    keywords: ["split", "terminal", "half", "dividir", "metade"],
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "split");
      close();
    },
  },
  {
    id: "layout-terminal",
    label: t("commandPalette.commands.layoutTerminal"),
    icon: SquareTerminal,
    group: "layout",
    keywords: ["terminal", "full", "shell", "inteiro"],
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "terminal");
      close();
    },
  },
  {
    id: "layout-editor",
    label: t("commandPalette.commands.layoutEditor"),
    icon: FilePen,
    group: "layout",
    keywords: ["editor", "code", "file", "arquivo"],
    shortcut: "\u2318E",
    action: ({ activeWorkspaceId, close }) => {
      if (activeWorkspaceId) void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "editor");
      close();
    },
  },
  {
    id: "toggle-sidebar",
    label: t("commandPalette.commands.toggleSidebar"),
    icon: PanelLeft,
    group: "layout",
    keywords: ["sidebar", "panel", "left", "barra"],
    shortcut: "\u2318B",
    action: ({ close }) => {
      useUiStore.getState().toggleSidebar();
      close();
    },
  },
  {
    id: "toggle-git-panel",
    label: t("commandPalette.commands.toggleGitPanel"),
    icon: GitBranchIcon,
    group: "layout",
    keywords: ["git", "panel", "right", "painel"],
    shortcut: "\u2318\u21E7B",
    action: ({ close }) => {
      useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "toggle-focus-mode",
    label: t("commandPalette.commands.toggleFocusMode"),
    icon: Focus,
    group: "layout",
    keywords: ["focus", "zen", "center", "chrome", "foco", "central"],
    shortcut: "\u2318\u2325F",
    action: ({ close }) => {
      useUiStore.getState().toggleFocusMode();
      close();
    },
  },
  {
    id: "toggle-keep-awake",
    label: t("commandPalette.commands.toggleKeepAwake"),
    icon: Power,
    group: "layout",
    keywords: ["keep", "awake", "sleep", "idle", "system", "manter", "acordado", "sleep"],
    isAvailable: () => keepAwakeAvailable,
    action: async ({ close }) => {
      close();
      await useKeepAwakeStore.getState().toggle();
    },
  },
  {
    id: "power-settings",
    label: t("commandPalette.commands.powerSettings"),
    icon: Power,
    group: "layout",
    keywords: ["power", "settings", "display", "battery", "session", "energia", "configurações"],
    action: ({ close }) => {
      close();
      useKeepAwakeStore.getState().openPowerSettings();
    },
  },
  {
    id: "open-search",
    label: t("commandPalette.commands.searchWorkspace"),
    icon: Search,
    group: "layout",
    keywords: ["search", "find", "workspace", "messages", "files", "threads", "buscar", "workspace"],
    shortcut: "\u2318\u21E7F",
    action: () => {
      useUiStore.getState().openCommandPalette({ variant: "search", initialQuery: "?" });
    },
  },
  // Git
  {
    id: "git-fetch",
    label: t("commandPalette.commands.gitFetch"),
    icon: RefreshCw,
    group: "git",
    keywords: ["fetch", "remote", "sync", "buscar", "sincronizar"],
    isAvailable: isGitCommandAvailable,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().fetchRemote(activeRepoPath);
        toast.success(t("commandPalette.toasts.fetchComplete"));
      } catch {
        toast.error(t("commandPalette.toasts.fetchFailed"));
      }
    },
  },
  {
    id: "git-pull",
    label: t("commandPalette.commands.gitPull"),
    icon: ArrowDownToLine,
    group: "git",
    keywords: ["pull", "download", "sync", "baixar", "sincronizar"],
    isAvailable: isGitCommandAvailable,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().pullRemote(activeRepoPath);
        toast.success(t("commandPalette.toasts.pullComplete"));
      } catch {
        toast.error(t("commandPalette.toasts.pullFailed"));
      }
    },
  },
  {
    id: "git-push",
    label: t("commandPalette.commands.gitPush"),
    icon: ArrowUpFromLine,
    group: "git",
    keywords: ["push", "upload", "remote", "enviar", "publicar"],
    isAvailable: isGitCommandAvailable,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().pushRemote(activeRepoPath);
        toast.success(t("commandPalette.toasts.pushComplete"));
      } catch {
        toast.error(t("commandPalette.toasts.pushFailed"));
      }
    },
  },
  {
    id: "git-checkout-branch",
    label: t("commandPalette.commands.checkoutBranch"),
    icon: GitBranchIcon,
    group: "git",
    keywords: ["checkout", "switch", "branch", "trocar", "mudar"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "checkout-branch", query: "", branches: [], loading: true });
    },
  },
  {
    id: "git-create-branch",
    label: t("commandPalette.commands.createBranch"),
    icon: GitBranchPlus,
    group: "git",
    keywords: ["create", "new", "branch", "criar", "nova"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "create-branch", value: "" });
    },
  },
  {
    id: "git-commit",
    label: t("commandPalette.commands.commitStaged"),
    icon: GitCommitHorizontal,
    group: "git",
    keywords: ["commit", "save", "staged", "preparado", "salvar"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "commit", value: "" });
    },
  },
  {
    id: "git-stash-push",
    label: t("commandPalette.commands.stashChanges"),
    icon: Archive,
    group: "git",
    keywords: ["stash", "save", "shelve", "guardar"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "stash", value: "" });
    },
  },
  {
    id: "git-stage-all",
    label: t("commandPalette.commands.stageAll"),
    icon: ListChecks,
    group: "git",
    keywords: ["stage", "add", "all", "preparar", "tudo"],
    isAvailable: isGitCommandAvailable,
    action: async ({ activeRepoPath, close }) => {
      if (!activeRepoPath) return;
      const status = await resolveCommandPaletteGitStatus({
        repoPath: activeRepoPath,
        activeRepoPath: useGitStore.getState().activeRepoPath,
        activeStatus: useGitStore.getState().status,
        loadStatus: ipc.getGitStatus,
      });
      const unstaged = status?.files.filter((f) => f.worktreeStatus) ?? [];
      if (unstaged.length === 0) {
        toast.warning(t("commandPalette.toasts.noUnstagedFiles"));
        return;
      }
      close();
      try {
        await useGitStore.getState().stageMany(activeRepoPath, unstaged.map((f) => f.path));
        toast.success(t("commandPalette.toasts.stagedFiles", { count: unstaged.length }));
      } catch {
        toast.error(t("commandPalette.toasts.stageFailed"));
      }
    },
  },
  {
    id: "git-unstage-all",
    label: t("commandPalette.commands.unstageAll"),
    icon: ListX,
    group: "git",
    keywords: ["unstage", "remove", "all", "retirar", "tudo"],
    isAvailable: isGitCommandAvailable,
    action: async ({ activeRepoPath, close }) => {
      if (!activeRepoPath) return;
      const status = await resolveCommandPaletteGitStatus({
        repoPath: activeRepoPath,
        activeRepoPath: useGitStore.getState().activeRepoPath,
        activeStatus: useGitStore.getState().status,
        loadStatus: ipc.getGitStatus,
      });
      const staged = status?.files.filter((f) => f.indexStatus) ?? [];
      if (staged.length === 0) {
        toast.warning(t("commandPalette.toasts.noStagedFiles"));
        return;
      }
      close();
      try {
        await useGitStore.getState().unstageMany(activeRepoPath, staged.map((f) => f.path));
        toast.success(t("commandPalette.toasts.unstagedFiles", { count: staged.length }));
      } catch {
        toast.error(t("commandPalette.toasts.unstageFailed"));
      }
    },
  },
  {
    id: "git-discard-all",
    label: t("commandPalette.commands.discardAll"),
    icon: Trash2,
    group: "git",
    keywords: ["discard", "revert", "clean", "all", "descartar", "reverter"],
    isAvailable: isGitCommandAvailable,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("changes");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "git-apply-stash",
    label: t("commandPalette.commands.applyStash"),
    icon: Layers,
    group: "git",
    keywords: ["stash", "apply", "restore", "aplicar", "restaurar"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "apply-stash", query: "", stashes: [], loading: true });
    },
  },
  {
    id: "git-pop-stash",
    label: t("commandPalette.commands.popStash"),
    icon: Layers,
    group: "git",
    keywords: ["stash", "pop", "restore", "drop", "restaurar"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "pop-stash", query: "", stashes: [], loading: true });
    },
  },
  {
    id: "git-delete-branch",
    label: t("commandPalette.commands.deleteBranch"),
    icon: Trash2,
    group: "git",
    keywords: ["delete", "remove", "branch", "excluir", "apagar"],
    isAvailable: isGitCommandAvailable,
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "delete-branch", query: "", branches: [], loading: true });
    },
  },
  {
    id: "git-soft-reset",
    label: t("commandPalette.commands.softReset"),
    icon: Undo2,
    group: "git",
    keywords: ["reset", "undo", "uncommit", "desfazer"],
    isAvailable: isGitCommandAvailable,
    action: async ({ activeRepoPath, close }) => {
      close();
      if (!activeRepoPath) return;
      try {
        await useGitStore.getState().softResetLastCommit(activeRepoPath);
        toast.success(t("commandPalette.toasts.lastCommitReset"));
      } catch {
        toast.error(t("commandPalette.toasts.resetFailed"));
      }
    },
  },
  {
    id: "git-switch-repo",
    label: t("commandPalette.commands.switchRepo"),
    icon: FolderGit2,
    group: "git",
    keywords: ["repo", "repository", "switch", "multi", "repositório", "trocar"],
    isAvailable: (ctx) => hasMultipleActiveGitRepos(ctx.repos),
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "switch-repo", query: "" });
    },
  },
  // Navigation
  {
    id: "new-thread",
    label: t("commandPalette.commands.newThread"),
    icon: Plus,
    group: "navigation",
    keywords: ["new", "thread", "conversation", "chat", "nova", "conversa"],
    action: async ({ activeWorkspaceId, close }) => {
      close();
      await createAndActivateWorkspaceThread(activeWorkspaceId);
    },
  },
  {
    id: "switch-thread",
    label: t("commandPalette.commands.switchThread"),
    description: t("commandPalette.descriptions.switchThread"),
    icon: MessageSquare,
    group: "navigation",
    keywords: ["thread", "conversation", "switch", "trocar", "conversa"],
    action: (_ctx) => {
      // Handled by the component — sets query to "@"
    },
  },
  {
    id: "switch-workspace",
    label: t("commandPalette.commands.switchWorkspace"),
    description: t("commandPalette.descriptions.switchWorkspace"),
    icon: FolderOpen,
    group: "navigation",
    keywords: ["workspace", "project", "folder", "switch", "projeto", "pasta", "trocar"],
    action: (_ctx) => {
      // Handled by the component — sets query to "#"
    },
  },
  // View
  {
    id: "view-changes",
    label: t("commandPalette.commands.viewChanges"),
    icon: ListTree,
    group: "view",
    keywords: ["changes", "status", "diff", "staged", "alterações"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("changes");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-branches",
    label: t("commandPalette.commands.viewBranches"),
    icon: GitBranchIcon,
    group: "view",
    keywords: ["branches", "branch", "list", "listar"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("branches");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-commits",
    label: t("commandPalette.commands.viewCommits"),
    icon: History,
    group: "view",
    keywords: ["commits", "log", "history", "histórico"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("commits");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-stash",
    label: t("commandPalette.commands.viewStash"),
    icon: Layers,
    group: "view",
    keywords: ["stash", "shelve", "list", "listar"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("stash");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-files",
    label: t("commandPalette.commands.viewFiles"),
    icon: File,
    group: "view",
    keywords: ["files", "tree", "explorer", "arquivos", "explorador"],
    isAvailable: (ctx) => !!ctx.activeWorkspaceId,
    action: ({ close }) => {
      const uiState = useUiStore.getState();
      uiState.setActiveView("chat");
      uiState.setExplorerOpen(true);
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (wsId) {
        void useTerminalStore.getState().setLayoutMode(wsId, "editor");
      }
      close();
    },
  },
  {
    id: "view-worktrees",
    label: t("commandPalette.commands.viewWorktrees"),
    icon: FolderGit2,
    group: "view",
    keywords: ["worktrees", "worktree", "working", "árvore"],
    isAvailable: (ctx) => !!ctx.activeRepoPath,
    action: ({ close }) => {
      useGitStore.getState().setActiveView("worktrees");
      if (!useUiStore.getState().showGitPanel) useUiStore.getState().toggleGitPanel();
      close();
    },
  },
  {
    id: "view-harnesses",
    label: t("commandPalette.commands.viewHarnesses"),
    icon: Play,
    group: "view",
    keywords: ["agents", "harnesses", "tools", "ai", "agentes", "ferramentas"],
    action: ({ close }) => {
      useUiStore.getState().setActiveView("harnesses");
      close();
    },
  },
  // Codex thread actions
  {
    id: "codex-fork",
    label: t("commandPalette.commands.codexFork"),
    description: t("commandPalette.descriptions.codexFork"),
    icon: GitBranchIcon,
    group: "codex",
    keywords: ["fork", "codex", "thread", "branch", "duplicate"],
    isAvailable: () => {
      const { threads, activeThreadId } = useThreadStore.getState();
      const thread = threads.find((th) => th.id === activeThreadId);
      return !!thread && thread.engineId === "codex" && !!thread.engineThreadId;
    },
    action: async ({ close }) => {
      close();
      const { activeThreadId, forkCodexThread } = useThreadStore.getState();
      if (!activeThreadId) return;
      try {
        const forked = await forkCodexThread(activeThreadId);
        if (forked) {
          useThreadStore.getState().setActiveThread(forked.id);
          toast.success(t("commandPalette.toasts.codexForked"));
        }
      } catch (err) {
        toast.error(String(err));
      }
    },
  },
  {
    id: "codex-compact",
    label: t("commandPalette.commands.codexCompact"),
    description: t("commandPalette.descriptions.codexCompact"),
    icon: Minimize2,
    group: "codex",
    keywords: ["compact", "context", "compress", "codex"],
    isAvailable: () => {
      const { threads, activeThreadId } = useThreadStore.getState();
      const thread = threads.find((th) => th.id === activeThreadId);
      return !!thread && thread.engineId === "codex" && !!thread.engineThreadId;
    },
    action: async ({ close }) => {
      close();
      const { activeThreadId, compactCodexThread } = useThreadStore.getState();
      if (!activeThreadId) return;
      try {
        await compactCodexThread(activeThreadId);
        toast.success(t("commandPalette.toasts.codexCompacted"));
      } catch (err) {
        toast.error(String(err));
      }
    },
  },
  {
    id: "codex-rollback",
    label: t("commandPalette.commands.codexRollback"),
    description: t("commandPalette.descriptions.codexRollback"),
    icon: RotateCcw,
    group: "codex",
    keywords: ["rollback", "undo", "turns", "codex"],
    isAvailable: () => {
      const { threads, activeThreadId } = useThreadStore.getState();
      const thread = threads.find((th) => th.id === activeThreadId);
      return !!thread && thread.engineId === "codex" && !!thread.engineThreadId;
    },
    action: ({ openSubFlow }) => {
      openSubFlow({ type: "codex-rollback" as SubFlow["type"], value: "1" } as SubFlow);
    },
  },
  {
    id: "codex-review",
    label: t("commandPalette.commands.codexReview"),
    description: t("commandPalette.descriptions.codexReview"),
    icon: Search,
    group: "codex",
    keywords: ["review", "code review", "codex", "diff"],
    isAvailable: () => {
      const { threads, activeThreadId } = useThreadStore.getState();
      const thread = threads.find((th) => th.id === activeThreadId);
      return !!thread && thread.engineId === "codex" && !!thread.engineThreadId;
    },
    action: async ({ close }) => {
      close();
      const { activeThreadId } = useThreadStore.getState();
      if (!activeThreadId) return;
      try {
        await ipc.startCodexReview(activeThreadId, { type: "uncommittedChanges" }, "inline");
        toast.success(t("commandPalette.toasts.codexReviewStarted"));
      } catch (err) {
        toast.error(String(err));
      }
    },
  },
  ];
}

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

/* ------------------------------------------------------------------ */
/*  Inline style constants                                             */
/* ------------------------------------------------------------------ */

const STYLES = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 10001,
    background: "rgba(0, 0, 0, 0.55)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    display: "flex",
    alignItems: "flex-start" as const,
    justifyContent: "center" as const,
    padding: "min(12vh, 120px) 20px 20px",
  },
  card: {
    width: "min(640px, calc(100% - 40px))",
    maxHeight: "min(520px, 72vh)",
    overflow: "hidden" as const,
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    borderRadius: "var(--radius-lg)",
    background: "rgba(14, 14, 16, 0.95)",
    boxShadow:
      "0 0 0 1px rgba(255, 255, 255, 0.08), " +
      "0 24px 68px rgba(0, 0, 0, 0.55)",
    animation: "slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
  },
  inputRow: {
    display: "flex",
    alignItems: "center" as const,
    gap: 10,
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
  },
  inputIcon: {
    display: "flex",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    color: "var(--text-2)",
    flexShrink: 0,
  },
  modeBadge: {
    display: "inline-flex",
    alignItems: "center" as const,
    padding: "2px 8px",
    background: "var(--accent-dim)",
    color: "var(--accent)",
    border: "1px solid var(--border-accent)",
    borderRadius: "var(--radius-sm)",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "monospace",
    flexShrink: 0,
    letterSpacing: "0.02em",
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-1)",
    fontSize: 15,
    fontFamily: "inherit",
    lineHeight: 1.5,
    minWidth: 0,
  },
  results: {
    overflowY: "auto" as const,
    padding: "6px 0",
  },
  groupHeader: {
    padding: "10px 16px 4px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--text-3)",
    userSelect: "none" as const,
  },
  groupDivider: {
    height: 1,
    margin: "4px 16px",
    background: "var(--border)",
  },
  item: (active: boolean) => ({
    display: "grid",
    gridTemplateColumns: "24px 1fr auto",
    alignItems: "center" as const,
    gap: 8,
    padding: "0 12px",
    margin: "1px 6px",
    minHeight: 40,
    width: "calc(100% - 12px)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: active ? "rgba(255, 255, 255, 0.07)" : "transparent",
    cursor: "pointer",
    textAlign: "left" as const,
    fontFamily: "inherit",
    transition: "background 80ms ease-out",
  }),
  itemIcon: (active: boolean) => ({
    display: "flex",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    color: active ? "var(--accent)" : "var(--text-3)",
    transition: "color 80ms ease-out",
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
    fontSize: 10.5,
    color: "var(--text-3)",
    padding: "2px 6px",
    background: "var(--bg-4)",
    borderRadius: 4,
    fontFamily: "monospace",
    flexShrink: 0,
    letterSpacing: "0.02em",
  },
  inlineBadge: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-4)",
    border: "1px solid var(--border)",
    color: "var(--text-3)",
    flexShrink: 0,
  },
  chip: (active: boolean) => ({
    display: "inline-flex",
    alignItems: "center" as const,
    gap: 4,
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    fontFamily: "inherit",
    background: active ? "var(--accent-dim)" : "var(--bg-4)",
    color: active ? "var(--accent)" : "var(--text-3)",
    transition: "background 100ms ease-out, color 100ms ease-out",
  }),
  chipBar: {
    display: "flex" as const,
    gap: 6,
    padding: "8px 16px",
    borderBottom: "1px solid var(--border)",
  },
  footer: {
    display: "flex",
    alignItems: "center" as const,
    flexWrap: "wrap" as const,
    gap: "6px 16px",
    padding: "8px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--text-3)",
    userSelect: "none" as const,
  },
  footerKbd: {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 1,
    padding: "2px 5px",
    minWidth: 18,
    borderRadius: 4,
    background: "var(--bg-4)",
    border: "1px solid var(--border)",
    color: "var(--text-2)",
    marginRight: 3,
  },
  emptyState: {
    padding: "40px 16px",
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
  const { t, i18n } = useTranslation("app");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<CommandPaletteSearchScope>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [subFlow, setSubFlow] = useState<SubFlow | null>(null);
  const [fileEntries, setFileEntries] = useState<FileTreeEntry[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [messageResults, setMessageResults] = useState<SearchResult[]>([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [showFilesInAuto, setShowFilesInAuto] = useState(false);
  const [showThreadsInAuto, setShowThreadsInAuto] = useState(false);
  const [scopedRepo, setScopedRepo] = useState<{ id: string; path: string; name: string } | null>(null);
  const [scopedGitStatus, setScopedGitStatus] = useState<GitStatus | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);

  const fileCacheRef = useRef<Map<string, FileTreeEntry[]>>(new Map());

  // Store selectors
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveRepo = useWorkspaceStore((s) => s.setActiveRepo);
  const repos = useWorkspaceStore((s) => s.repos);
  const activeRepoId = useWorkspaceStore((s) => s.activeRepoId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const threads = useThreadStore((s) => s.threads);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const setActiveThread = useThreadStore((s) => s.setActiveThread);
  const harnesses = useHarnessStore((s) => s.harnesses);
  const harnessesLoadedOnce = useHarnessStore((s) => s.loadedOnce);
  const ensureHarnessesScanned = useHarnessStore((s) => s.ensureScanned);
  const bindChatThread = useChatStore((s) => s.setActiveThread);
  const setMessageFocusTarget = useUiStore((s) => s.setMessageFocusTarget);
  const commandPaletteLaunch = useUiStore((s) => s.commandPaletteLaunch);
  const activeGitRepos = useMemo(() => getActiveGitRepos(repos), [repos]);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeRepo = useMemo(
    () => activeGitRepos.find((repo) => repo.id === activeRepoId) ?? activeGitRepos[0] ?? null,
    [activeGitRepos, activeRepoId],
  );
  const activeRepoPath = activeRepo?.path ?? null;
  const effectiveRepoPath = scopedRepo?.path ?? activeRepoPath;
  const activeWorkspaceRootPath = activeWorkspace?.rootPath ?? null;
  const gitStatus = useGitStore((s) => s.status);
  const gitStoreActiveRepoPath = useGitStore((s) => s.activeRepoPath);
  const workspaceNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const workspace of workspaces) {
      byId.set(workspace.id, workspace.name);
    }
    return byId;
  }, [workspaces]);

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
  const { mode, term } = useMemo(() => detectCommandPaletteMode(query), [query]);
  const trimmedTerm = term.trim();
  const isSearchMode = mode === "search";
  const shouldShowFileResultsInSearch = isSearchMode && (searchScope === "all" || searchScope === "files");
  const shouldShowMessageResultsInSearch = isSearchMode && (searchScope === "all" || searchScope === "messages");
  const shouldShowThreadResultsInSearch = isSearchMode && (searchScope === "all" || searchScope === "threads");
  const keepAwakeAvailable = useKeepAwakeStore((state) => canToggleKeepAwake(state.state));

  // Context object for command actions
  const commandCtx = useMemo<CommandContext>(
    () => ({
      activeWorkspaceId,
      activeRepoPath,
      repos: activeGitRepos,
      close: onClose,
      openSubFlow: setSubFlow,
    }),
    [activeWorkspaceId, activeRepoPath, activeGitRepos, onClose],
  );

  // Available commands filtered by context
  const availableCommands = useMemo(
    () =>
      getStaticCommands(t, { keepAwakeAvailable }).filter(
        (c) => !c.isAvailable || c.isAvailable(commandCtx),
      ),
    [commandCtx, keepAwakeAvailable, t],
  );

  const resolveRepoStatus = useCallback(
    (repoPath: string | null) =>
      resolveCommandPaletteGitStatus({
        repoPath,
        activeRepoPath: gitStoreActiveRepoPath,
        activeStatus: gitStatus,
        loadStatus: ipc.getGitStatus,
      }),
    [gitStatus, gitStoreActiveRepoPath],
  );

  useEffect(() => {
    if (!open || harnessesLoadedOnce) {
      return;
    }
    void ensureHarnessesScanned();
  }, [ensureHarnessesScanned, harnessesLoadedOnce, open]);

  /* ---- Reset on open/close ---- */
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSearchScope(COMMAND_PALETTE_DEFAULT_LAUNCH.searchScope);
      setActiveIndex(0);
      setSubFlow(null);
      setScopedRepo(null);
      setScopedGitStatus(null);
      setPendingCommandId(null);
      setFileEntries([]);
      setFileLoading(false);
      setMessageResults([]);
      setMessageLoading(false);
      setMessageError(null);
      fileCacheRef.current.clear();
      setShowFilesInAuto(false);
      setShowThreadsInAuto(false);
      return;
    }
    const nextQuery =
      commandPaletteLaunch.variant === "search"
        ? `?${commandPaletteLaunch.initialQuery.replace(/^\?/, "")}`
        : commandPaletteLaunch.initialQuery;
    setQuery(nextQuery);
    setSearchScope(commandPaletteLaunch.searchScope);
    setActiveIndex(0);
    setSubFlow(null);
    setScopedRepo(null);
    setScopedGitStatus(null);
    setPendingCommandId(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, commandPaletteLaunch]);

  /* ---- File search (lazy, debounced, progressive) ---- */
  useEffect(() => {
    const isFileMode =
      mode === "auto" ||
      mode === "file" ||
      (mode === "search" && (searchScope === "all" || searchScope === "files"));
    if (!open || !isFileMode || !activeWorkspaceId || !activeWorkspaceRootPath) {
      setFileLoading(false);
      if (!isFileMode || !activeWorkspaceId || !activeWorkspaceRootPath) setFileEntries([]);
      return;
    }
    // In auto and search modes, require 2+ chars before loading; in file mode, load immediately.
    if ((mode === "auto" || mode === "search") && trimmedTerm.length < 2) {
      setFileLoading(false);
      return;
    }

    const cacheKey = activeWorkspaceRootPath;
    const cached = fileCacheRef.current.get(cacheKey);
    if (cached) {
      setFileEntries(cached);
      setFileLoading(false);
      return;
    }

    let cancelled = false;
    setFileLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const accumulated: FileTreeEntry[] = [];

        for (let page = 0; ; page++) {
          if (cancelled) return;

          const result = await ipc.getWorkspaceFileTreePage(
            activeWorkspaceId,
            page * FILE_SEARCH_PAGE_SIZE,
            FILE_SEARCH_PAGE_SIZE,
            page === 0,
          );
          if (cancelled) return;

          const files = result.entries.filter((e) => !e.isDir);
          accumulated.push(...files);
          setFileEntries([...accumulated]);

          if (!result.hasMore) break;

          // Let the UI breathe between pages
          await new Promise((r) => setTimeout(r, FILE_SEARCH_PAGE_DELAY_MS));
        }

        if (!cancelled) {
          fileCacheRef.current.set(cacheKey, accumulated);
        }
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
  }, [open, mode, trimmedTerm, activeWorkspaceId, activeWorkspaceRootPath, searchScope]);

  /* ---- Workspace message search ---- */
  useEffect(() => {
    if (!open || !shouldShowMessageResultsInSearch || !activeWorkspaceId) {
      setMessageResults([]);
      setMessageLoading(false);
      setMessageError(null);
      return;
    }

    if (trimmedTerm.length < 2) {
      setMessageResults([]);
      setMessageLoading(false);
      setMessageError(null);
      return;
    }

    let cancelled = false;
    setMessageResults([]);
    setMessageLoading(true);
    setMessageError(null);

    const timer = window.setTimeout(async () => {
      try {
        const found = await ipc.searchMessages(activeWorkspaceId, trimmedTerm);
        if (cancelled) {
          return;
        }
        setMessageResults(found);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setMessageError(String(error));
      } finally {
        if (!cancelled) {
          setMessageLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, activeWorkspaceId, shouldShowMessageResultsInSearch, trimmedTerm]);

  /* ---- Branch search for checkout sub-flow (local + remote) ---- */
  useEffect(() => {
    if (!open || subFlow?.type !== "checkout-branch" || !effectiveRepoPath) return;

    let cancelled = false;
    const searchQuery = subFlow.query || undefined;

    const timer = window.setTimeout(async () => {
      try {
        const [localPage, remotePage] = await Promise.all([
          ipc.listGitBranches(effectiveRepoPath, "local", 0, 50, searchQuery),
          ipc.listGitBranches(effectiveRepoPath, "remote", 0, 50, searchQuery),
        ]);
        if (cancelled) return;
        const localNames = new Set(localPage.entries.map((b) => b.name));
        const remotes = remotePage.entries.filter((b) => {
          const shortName = b.name.includes("/") ? b.name.slice(b.name.indexOf("/") + 1) : b.name;
          return !localNames.has(shortName);
        });
        const merged = [...localPage.entries, ...remotes].slice(0, 80);
        setSubFlow((prev) =>
          prev?.type === "checkout-branch"
            ? { ...prev, branches: merged, loading: false }
            : prev,
        );
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
  }, [open, subFlow?.type, subFlow?.type === "checkout-branch" ? subFlow.query : null, effectiveRepoPath]);

  /* ---- Branch search for delete sub-flow (local + remote, exclude current) ---- */
  useEffect(() => {
    if (!open || subFlow?.type !== "delete-branch" || !effectiveRepoPath) return;

    let cancelled = false;
    const searchQuery = subFlow.query || undefined;

    const timer = window.setTimeout(async () => {
      try {
        const [localPage, remotePage] = await Promise.all([
          ipc.listGitBranches(effectiveRepoPath, "local", 0, 50, searchQuery),
          ipc.listGitBranches(effectiveRepoPath, "remote", 0, 50, searchQuery),
        ]);
        if (cancelled) return;
        const localNames = new Set(localPage.entries.map((b) => b.name));
        const remotes = remotePage.entries.filter((b) => {
          const shortName = b.name.includes("/") ? b.name.slice(b.name.indexOf("/") + 1) : b.name;
          return !localNames.has(shortName);
        });
        const merged = [...localPage.entries, ...remotes]
          .filter((b) => !b.isCurrent)
          .slice(0, 80);
        setSubFlow((prev) =>
          prev?.type === "delete-branch"
            ? { ...prev, branches: merged, loading: false }
            : prev,
        );
      } catch {
        if (!cancelled) {
          setSubFlow((prev) =>
            prev?.type === "delete-branch" ? { ...prev, loading: false } : prev,
          );
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, subFlow?.type, subFlow?.type === "delete-branch" ? subFlow.query : null, effectiveRepoPath]);

  /* ---- Stash list for apply/pop sub-flow ---- */
  useEffect(() => {
    if (!open || !effectiveRepoPath) return;
    if (subFlow?.type !== "apply-stash" && subFlow?.type !== "pop-stash") return;

    let cancelled = false;
    const flowType = subFlow.type;

    (async () => {
      try {
        const stashes = await ipc.listGitStashes(effectiveRepoPath);
        if (cancelled) return;
        setSubFlow((prev) =>
          prev?.type === flowType
            ? { ...prev, stashes, loading: false }
            : prev,
        );
      } catch {
        if (!cancelled) {
          setSubFlow((prev) =>
            prev?.type === flowType ? { ...prev, loading: false } : prev,
          );
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, subFlow?.type, effectiveRepoPath]);

  useEffect(() => {
    if (!open || subFlow?.type !== "commit" || !effectiveRepoPath) {
      setScopedGitStatus(null);
      return;
    }

    let cancelled = false;

    void resolveRepoStatus(effectiveRepoPath)
      .then((status) => {
        if (!cancelled) {
          setScopedGitStatus(status ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScopedGitStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveRepoPath, open, resolveRepoStatus, subFlow?.type]);

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
          return [{
            label: t("commandPalette.commands.checkoutBranch"),
            items: [{ type: "sub-action", label: t("commandPalette.status.loadingBranches") }],
          }];
        }
        if (items.length === 0) {
          return [{
            label: t("commandPalette.commands.checkoutBranch"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noBranchesFound") }],
          }];
        }
        return [{ label: t("commandPalette.commands.checkoutBranch"), items }];
      }
      if (subFlow.type === "create-branch") {
        const valid = subFlow.value.length > 0 && !/\s/.test(subFlow.value);
        return [{
          label: t("commandPalette.commands.createBranch"),
          items: [{
            type: "sub-action",
            label: valid
              ? t("commandPalette.preview.createBranchReady", { name: subFlow.value })
              : subFlow.value.length === 0
                ? t("commandPalette.preview.createBranchEmpty")
                : t("commandPalette.preview.createBranchInvalid"),
          }],
        }];
      }
      if (subFlow.type === "commit") {
        const commitStatus = scopedRepo ? scopedGitStatus : gitStatus;
        const stagedCount = commitStatus?.files.filter((f) => f.indexStatus).length ?? 0;
        const stagedHint = stagedCount > 0
          ? t("commandPalette.preview.stagedHint", { count: stagedCount })
          : t("commandPalette.preview.noStagedHint");
        return [{
          label: t("commandPalette.subFlow.commit"),
          items: [{
            type: "sub-action",
            label: subFlow.value.length > 0
              ? t("commandPalette.preview.commitWithMessage", {
                  message: subFlow.value,
                  hint: stagedHint,
                })
              : t("commandPalette.preview.commitEmpty", { hint: stagedHint }),
          }],
        }];
      }
      if (subFlow.type === "stash") {
        return [{
          label: t("commandPalette.subFlow.stash"),
          items: [{
            type: "sub-action",
            label: subFlow.value.length > 0
              ? t("commandPalette.preview.stashWithMessage", { message: subFlow.value })
              : t("commandPalette.preview.stashEmpty"),
          }],
        }];
      }
      if (subFlow.type === "codex-rollback") {
        const n = Number.parseInt(subFlow.value, 10);
        const valid = Number.isFinite(n) && n >= 1;
        return [{
          label: t("commandPalette.subFlow.codexRollback"),
          items: [{
            type: "sub-action",
            label: valid
              ? t("commandPalette.preview.codexRollback", { count: n })
              : t("commandPalette.preview.codexRollbackEmpty"),
          }],
        }];
      }
      if (subFlow.type === "delete-branch") {
        const items: ResultItem[] = subFlow.branches.map((b) => ({
          type: "branch" as const,
          entry: b,
        }));
        if (subFlow.loading && items.length === 0) {
          return [{
            label: t("commandPalette.commands.deleteBranch"),
            items: [{ type: "sub-action", label: t("commandPalette.status.loadingBranches") }],
          }];
        }
        if (items.length === 0) {
          return [{
            label: t("commandPalette.commands.deleteBranch"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noBranchesFound") }],
          }];
        }
        return [{ label: t("commandPalette.commands.deleteBranch"), items }];
      }
      if (subFlow.type === "apply-stash" || subFlow.type === "pop-stash") {
        const label = subFlow.type === "apply-stash"
          ? t("commandPalette.commands.applyStash")
          : t("commandPalette.commands.popStash");
        const filtered = subFlow.query
          ? subFlow.stashes.filter((s) => s.name.toLowerCase().includes(subFlow.query.toLowerCase()))
          : subFlow.stashes;
        const items: ResultItem[] = filtered.map((s) => ({
          type: "stash" as const,
          entry: s,
        }));
        if (subFlow.loading && items.length === 0) {
          return [{ label, items: [{ type: "sub-action", label: t("commandPalette.status.loadingStashes") }] }];
        }
        if (items.length === 0) {
          return [{ label, items: [{ type: "sub-action", label: t("commandPalette.status.noStashesFound") }] }];
        }
        return [{ label, items }];
      }
      if (subFlow.type === "switch-repo") {
        const filtered = subFlow.query
          ? activeGitRepos.filter((r) => r.name.toLowerCase().includes(subFlow.query.toLowerCase()))
          : activeGitRepos;
        const items: ResultItem[] = filtered.map((r) => ({
          type: "repo" as const,
          entry: r,
        }));
        if (items.length === 0) {
          return [{
            label: t("commandPalette.group.switchRepo"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noReposFound") }],
          }];
        }
        return [{ label: t("commandPalette.group.switchRepo"), items }];
      }
      if (subFlow.type === "pick-repo") {
        const filtered = subFlow.query
          ? activeGitRepos.filter((r) => r.name.toLowerCase().includes(subFlow.query.toLowerCase()))
          : activeGitRepos;
        const items: ResultItem[] = filtered.map((r) => ({
          type: "repo" as const,
          entry: r,
        }));
        if (items.length === 0) {
          return [{
            label: t("commandPalette.group.pickRepo"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noReposFound") }],
          }];
        }
        return [{ label: t("commandPalette.group.pickRepo"), items }];
      }
    }

    if (mode === "search") {
      if (!activeWorkspaceId) {
        return [{
          label: t("commandPalette.group.search"),
          items: [{ type: "sub-action", label: t("commandPalette.status.noActiveWorkspace") }],
        }];
      }

      if (trimmedTerm.length < 2) {
        return [{
          label: t("commandPalette.group.search"),
          items: [{ type: "sub-action", label: t("commandPalette.status.typeMoreToSearch") }],
        }];
      }

      const result: ResultGroup[] = [];

      if (shouldShowMessageResultsInSearch) {
        if (messageError) {
          result.push({
            label: t("commandPalette.group.messages"),
            items: [{ type: "sub-action", label: messageError }],
          });
        } else if (messageLoading && messageResults.length === 0) {
          result.push({
            label: t("commandPalette.group.messages"),
            items: [{ type: "sub-action", label: t("commandPalette.status.searchingMessages") }],
          });
        } else if (messageResults.length > 0) {
          result.push({
            label: t("commandPalette.group.messages"),
            items: messageResults.map((entry) => ({ type: "message-search", entry })),
          });
        } else if (searchScope === "messages") {
          result.push({
            label: t("commandPalette.group.messages"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noMessagesFound") }],
          });
        }
      }

      if (shouldShowFileResultsInSearch) {
        if (searchScope === "files" && !activeWorkspaceId) {
          result.push({
            label: t("commandPalette.group.files"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noActiveWorkspace") }],
          });
        } else if (activeWorkspaceId) {
          if (fileLoading && fileEntries.length === 0) {
            result.push({
              label: t("commandPalette.group.files"),
              items: [{ type: "sub-action", label: t("commandPalette.status.loadingFiles") }],
            });
          } else {
            const filteredFiles = fuzzyFilter(fileEntries, trimmedTerm, (f) => f.path, searchScope === "files" ? 20 : 8);
            if (filteredFiles.length > 0) {
              result.push({
                label: fileLoading
                  ? t("commandPalette.status.loadingFilesGroup")
                  : t("commandPalette.group.files"),
                items: filteredFiles.map((f) => ({ type: "file", entry: f })),
              });
            } else if (searchScope === "files") {
              result.push({
                label: t("commandPalette.group.files"),
                items: [{ type: "sub-action", label: t("commandPalette.status.noFilesFound") }],
              });
            }
          }
        }
      }

      if (shouldShowThreadResultsInSearch) {
        const filteredThreads = fuzzyFilter(workspaceThreads, trimmedTerm, (thread) => thread.title, searchScope === "threads" ? 15 : 6);
        if (filteredThreads.length > 0) {
          result.push({
            label: t("commandPalette.group.threads"),
            items: filteredThreads.map((entry) => ({ type: "thread", entry })),
          });
        } else if (searchScope === "threads") {
          result.push({
            label: t("commandPalette.group.threads"),
            items: [{ type: "sub-action", label: t("commandPalette.status.noThreadsFound") }],
          });
        }
      }

      return result;
    }

    if (mode === "default") {
      const result: ResultGroup[] = [];

      // Quick actions
      const quickIds = [
        "layout-chat",
        "layout-split",
        "layout-terminal",
        "layout-editor",
        "toggle-sidebar",
        "toggle-git-panel",
        "toggle-focus-mode",
      ];
      const quickItems: ResultItem[] = availableCommands
        .filter((c) => quickIds.includes(c.id))
        .map((c) => ({ type: "command", entry: c }));
      if (quickItems.length > 0) {
        result.push({ label: t("commandPalette.group.quickActions"), items: quickItems });
      }

      // Installed harnesses
      if (installedHarnesses.length > 0) {
        result.push({
          label: t("commandPalette.group.launchAgent"),
          items: installedHarnesses.map((h) => ({ type: "harness", entry: h })),
        });
      }

      // Recent threads
      const recentThreads = workspaceThreads.slice(0, 5);
      if (recentThreads.length > 0) {
        result.push({
          label: t("commandPalette.group.recentThreads"),
          items: recentThreads.map((t) => ({ type: "thread", entry: t })),
        });
      }

      // Git shortcuts
      const gitIds = ["git-fetch", "git-pull", "git-push"];
      const gitItems: ResultItem[] = availableCommands
        .filter((c) => gitIds.includes(c.id))
        .map((c) => ({ type: "command", entry: c }));
      if (gitItems.length > 0) result.push({ label: t("commandPalette.group.git"), items: gitItems });

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
        { key: "codex", label: t("commandPalette.group.codex") },
        { key: "layout", label: t("commandPalette.group.layout") },
        { key: "navigation", label: t("commandPalette.group.navigation") },
        { key: "git", label: t("commandPalette.group.git") },
        { key: "view", label: t("commandPalette.group.views") },
        { key: "harness", label: t("commandPalette.group.agents") },
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
        return [{
          label: t("commandPalette.group.threads"),
          items: [{ type: "sub-action", label: t("commandPalette.status.noThreadsFound") }],
        }];
      }
      return [{
        label: t("commandPalette.group.threads"),
        items: filtered.map((t) => ({ type: "thread", entry: t })),
      }];
    }

    if (mode === "workspace") {
      const filtered = fuzzyFilter(workspaces, term, (w) => w.name, 10);
      if (filtered.length === 0) {
        return [{
          label: t("commandPalette.group.workspaces"),
          items: [{ type: "sub-action", label: t("commandPalette.status.noWorkspacesFound") }],
        }];
      }
      return [{
        label: t("commandPalette.group.workspaces"),
        items: filtered.map((w) => ({ type: "workspace", entry: w })),
      }];
    }

    if (mode === "file") {
      if (!activeWorkspaceId) {
        return [{
          label: t("commandPalette.group.files"),
          items: [{ type: "sub-action", label: t("commandPalette.status.noActiveWorkspace") }],
        }];
      }
      if (fileLoading && fileEntries.length === 0) {
        return [{
          label: t("commandPalette.group.files"),
          items: [{ type: "sub-action", label: t("commandPalette.status.loadingFiles") }],
        }];
      }
      const filteredFiles = term.length > 0
        ? fuzzyFilter(fileEntries, term, (f) => f.path, 20)
        : fileEntries.slice(0, 20);
      if (filteredFiles.length === 0) {
        return [{
          label: t("commandPalette.group.files"),
          items: [{
            type: "sub-action",
            label: fileLoading
              ? t("commandPalette.status.loadingFiles")
              : t("commandPalette.status.noFilesFound"),
          }],
        }];
      }
      return [{
        label: fileLoading
          ? t("commandPalette.status.loadingFilesGroup")
          : t("commandPalette.group.files"),
        items: filteredFiles.map((f) => ({ type: "file", entry: f })),
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
    if (showFilesInAuto && fileEntries.length > 0 && term.length >= 2) {
      const filteredFiles = fuzzyFilter(fileEntries, term, (f) => f.path, 10);
      if (filteredFiles.length > 0) {
        result.push({
          label: fileLoading
            ? t("commandPalette.status.loadingFilesGroup")
            : t("commandPalette.group.files"),
          items: filteredFiles.map((f) => ({ type: "file", entry: f })),
        });
      }
    }

    // Commands
    const filteredCmds = fuzzyFilter(availableCommands, term, getCommandSearchText, 8);
    if (filteredCmds.length > 0) {
      result.push({
        label: t("commandPalette.group.commands"),
        items: filteredCmds.map((c) => ({ type: "command", entry: c })),
      });
    }

    // Threads
    if (showThreadsInAuto) {
      const filteredThreads = fuzzyFilter(workspaceThreads, term, (t) => t.title, 5);
      if (filteredThreads.length > 0) {
        result.push({
          label: t("commandPalette.group.threads"),
          items: filteredThreads.map((t) => ({ type: "thread", entry: t })),
        });
      }
    }

    // Harnesses
    if (installedHarnesses.length > 0) {
      const filteredHarnesses = fuzzyFilter(installedHarnesses, term, (h) => `${h.name} ${h.command}`, 4);
      if (filteredHarnesses.length > 0) {
        result.push({
          label: t("commandPalette.group.agents"),
          items: filteredHarnesses.map((h) => ({ type: "harness", entry: h })),
        });
      }
    }

    return result;
  }, [
    mode, term, subFlow, availableCommands, workspaceThreads, workspaces,
    installedHarnesses, fileEntries, fileLoading, activeThread, gitStatus, repos,
    showFilesInAuto, showThreadsInAuto, activeRepoPath, t, searchScope, scopedRepo, scopedGitStatus,
    trimmedTerm, shouldShowFileResultsInSearch, shouldShowMessageResultsInSearch,
    shouldShowThreadResultsInSearch, messageError, messageLoading, messageResults,
    activeWorkspaceId,
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

  const openMessageResult = useCallback(
    async (result: SearchResult) => {
      if (!activeWorkspaceId) {
        return;
      }

      await useThreadStore.getState().refreshThreads(activeWorkspaceId);
      const targetThread = useThreadStore
        .getState()
        .threads.find((thread) => thread.id === result.threadId);
      if (!targetThread) {
        return;
      }

      await useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "chat");
      setMessageFocusTarget({
        threadId: targetThread.id,
        messageId: result.messageId,
      });
      if (targetThread.repoId) {
        setActiveRepo(targetThread.repoId);
      } else {
        setActiveRepo(null, { remember: false });
      }
      setActiveThread(targetThread.id);
      await bindChatThread(targetThread.id);
      useUiStore.getState().setActiveView("chat");
      onClose();
    },
    [
      activeWorkspaceId,
      bindChatThread,
      onClose,
      setActiveRepo,
      setActiveThread,
      setMessageFocusTarget,
    ],
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
          // Multi-repo: git commands (except switch-repo) go through repo picker first
          if (cmd.group === "git" && activeGitRepos.length > 1 && cmd.id !== "git-switch-repo") {
            setPendingCommandId(cmd.id);
            setScopedRepo(null);
            setSubFlow({ type: "pick-repo", query: "", nextAction: cmd.id });
            setActiveIndex(0);
            return;
          }
          await cmd.action(commandCtx);
          break;
        }
        case "message-search": {
          await openMessageResult(item.entry);
          break;
        }
        case "file": {
          onClose();
          if (activeWorkspaceRootPath) {
            await useFileStore.getState().openFile(activeWorkspaceRootPath, item.entry.path);
            if (activeWorkspaceId) {
              void useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "editor");
            }
          }
          break;
        }
        case "thread": {
          const thread = item.entry;
          if (thread.workspaceId !== activeWorkspaceId) {
            await useWorkspaceStore.getState().setActiveWorkspace(thread.workspaceId);
          }
          await useTerminalStore.getState().setLayoutMode(thread.workspaceId, "chat");
          useThreadStore.getState().setActiveThread(thread.id);
          await useChatStore.getState().setActiveThread(thread.id);
          useUiStore.getState().setActiveView("chat");
          onClose();
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
          if (subFlow?.type === "delete-branch") {
            onClose();
            if (effectiveRepoPath) {
              try {
                await useGitStore.getState().deleteBranch(effectiveRepoPath, item.entry.name, false);
                toast.success(t("commandPalette.toasts.branchDeleted", { name: item.entry.name }));
              } catch {
                toast.error(t("commandPalette.toasts.branchDeleteNotMerged"));
              }
            }
          } else {
            onClose();
            if (effectiveRepoPath) {
              try {
                await useGitStore.getState().checkoutBranch(effectiveRepoPath, item.entry.name, item.entry.isRemote);
                toast.success(t("commandPalette.toasts.branchCheckedOut", { name: item.entry.name }));
              } catch {
                toast.error(t("commandPalette.toasts.checkoutFailed"));
              }
            }
          }
          break;
        }
        case "stash": {
          onClose();
          if (effectiveRepoPath) {
            const action = subFlow?.type === "pop-stash" ? "pop" : "apply";
            try {
              if (action === "pop") {
                await useGitStore.getState().popStash(effectiveRepoPath, item.entry.index);
                toast.success(t("commandPalette.toasts.stashPopped", { name: item.entry.name }));
              } else {
                await useGitStore.getState().applyStash(effectiveRepoPath, item.entry.index);
                toast.success(t("commandPalette.toasts.stashApplied", { name: item.entry.name }));
              }
            } catch {
              toast.error(t("commandPalette.toasts.stashActionFailed", { action }));
            }
          }
          break;
        }
        case "repo": {
          if (subFlow?.type === "pick-repo" && pendingCommandId) {
            // Repo picked for a scoped git command — execute the pending command
            const pickedRepo = { id: item.entry.id, path: item.entry.path, name: item.entry.name };
            setScopedRepo(pickedRepo);
            if (pendingCommandId === "git-commit") {
              try {
                const status = await resolveRepoStatus(pickedRepo.path);
                setScopedGitStatus(status ?? null);
              } catch {
                setScopedGitStatus(null);
              }
            } else {
              setScopedGitStatus(null);
            }
            if (shouldPersistPickedRepoSelection(pendingCommandId)) {
              useWorkspaceStore.getState().setActiveRepo(item.entry.id);
              useGitStore.getState().setActiveRepoPath(item.entry.path);
            }
            const cmd = availableCommands.find((c) => c.id === pendingCommandId);
            if (cmd) {
              const scopedCtx: CommandContext = {
                ...commandCtx,
                activeRepoPath: pickedRepo.path,
              };
              await cmd.action(scopedCtx);
            }
          } else {
            onClose();
            useWorkspaceStore.getState().setActiveRepo(item.entry.id);
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
    [commandCtx, activeWorkspaceRootPath, activeWorkspaceId, activeThreadId, onClose, launchHarness, openMessageResult, subFlow, t, pendingCommandId, availableCommands, activeGitRepos.length, resolveRepoStatus],
  );

  const executeSubFlow = useCallback(async () => {
    if (!subFlow) return;

    // List-picker sub-flows delegate to executeItem
    if (
      subFlow.type === "checkout-branch" ||
      subFlow.type === "delete-branch" ||
      subFlow.type === "apply-stash" ||
      subFlow.type === "pop-stash" ||
      subFlow.type === "switch-repo" ||
      subFlow.type === "pick-repo"
    ) {
      const selected = flatItems[activeIndex];
      if (selected) void executeItem(selected);
      return;
    }

    if (!effectiveRepoPath) return;

    if (subFlow.type === "create-branch") {
      if (subFlow.value.length === 0 || /\s/.test(subFlow.value)) return;
      onClose();
      try {
        await useGitStore.getState().createBranch(effectiveRepoPath, subFlow.value);
        toast.success(t("commandPalette.toasts.branchCreated", { name: subFlow.value }));
      } catch {
        toast.error(t("commandPalette.toasts.createBranchFailed"));
      }
      return;
    }

    if (subFlow.type === "commit") {
      if (subFlow.value.length === 0) return;
      const status = await resolveRepoStatus(effectiveRepoPath);
      const stagedFiles = status?.files.filter((f) => f.indexStatus) ?? [];
      if (stagedFiles.length === 0) {
        toast.warning(t("commandPalette.toasts.noStagedFilesToCommit"));
        return;
      }
      onClose();
      try {
        await useGitStore.getState().commit(effectiveRepoPath, subFlow.value);
        toast.success(t("commandPalette.toasts.committed"));
      } catch {
        toast.error(t("commandPalette.toasts.commitFailed"));
      }
      return;
    }

    if (subFlow.type === "stash") {
      onClose();
      try {
        await useGitStore.getState().pushStash(effectiveRepoPath, subFlow.value || undefined);
        toast.success(t("commandPalette.toasts.changesStashed"));
      } catch {
        toast.error(t("commandPalette.toasts.stashFailed"));
      }
      return;
    }

    if (subFlow.type === "codex-rollback") {
      const numTurns = Number.parseInt(subFlow.value, 10);
      if (!Number.isFinite(numTurns) || numTurns < 1) return;
      onClose();
      const { activeThreadId, rollbackCodexThread } = useThreadStore.getState();
      if (!activeThreadId) return;
      try {
        const rolled = await rollbackCodexThread(activeThreadId, numTurns);
        if (rolled) {
          useThreadStore.getState().setActiveThread(rolled.id);
          toast.success(t("commandPalette.toasts.codexRolledBack", { count: numTurns }));
        }
      } catch (err) {
        toast.error(String(err));
      }
      return;
    }
  }, [subFlow, effectiveRepoPath, onClose, flatItems, activeIndex, executeItem, t, resolveRepoStatus]);

  /* ---- Keyboard handler ---- */

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (subFlow) {
          if (scopedRepo && subFlow.type !== "pick-repo") {
            // Back from scoped sub-flow to repo picker
            setScopedRepo(null);
            setScopedGitStatus(null);
            setSubFlow({ type: "pick-repo", query: "", nextAction: pendingCommandId ?? "" });
            setActiveIndex(0);
          } else {
            // Back from pick-repo or regular sub-flow to main palette
            setSubFlow(null);
            setScopedRepo(null);
            setScopedGitStatus(null);
            setPendingCommandId(null);
            setQuery("");
            setActiveIndex(0);
          }
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
        if (shouldTabCycleCommandPaletteSearchScope(mode, term)) {
          setSearchScope((current) => getNextCommandPaletteSearchScope(current));
          setActiveIndex(0);
          return;
        }
        setQuery(getNextCommandPalettePrefix(query));
        setActiveIndex(0);
        return;
      }
    },
    [flatItems, activeIndex, subFlow, query, onClose, executeItem, executeSubFlow, mode, term, scopedRepo, pendingCommandId],
  );

  /* ---- Input change handler ---- */

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (subFlow) {
        if (subFlow.type === "checkout-branch") {
          setSubFlow({ ...subFlow, query: value, loading: true });
        } else if (subFlow.type === "delete-branch") {
          setSubFlow({ ...subFlow, query: value, loading: true });
        } else if (subFlow.type === "create-branch") {
          setSubFlow({ ...subFlow, value });
        } else if (subFlow.type === "commit") {
          setSubFlow({ ...subFlow, value });
        } else if (subFlow.type === "stash") {
          setSubFlow({ ...subFlow, value });
        } else if (subFlow.type === "codex-rollback") {
          setSubFlow({ ...subFlow, value });
        } else if (subFlow.type === "apply-stash" || subFlow.type === "pop-stash") {
          setSubFlow({ ...subFlow, query: value });
        } else if (subFlow.type === "switch-repo") {
          setSubFlow({ ...subFlow, query: value });
        } else if (subFlow.type === "pick-repo") {
          setSubFlow({ ...subFlow, query: value });
        }
        setActiveIndex(0);
      } else {
        setQuery(normalizeCommandPaletteInput(value, mode));
        setActiveIndex(0);
      }
    },
    [mode, subFlow],
  );

  /* ---- Render helpers ---- */

  const getInputValue = (): string => {
    if (subFlow) {
      if (subFlow.type === "checkout-branch") return subFlow.query;
      if (subFlow.type === "delete-branch") return subFlow.query;
      if (subFlow.type === "create-branch") return subFlow.value;
      if (subFlow.type === "commit") return subFlow.value;
      if (subFlow.type === "stash") return subFlow.value;
      if (subFlow.type === "codex-rollback") return subFlow.value;
      if (subFlow.type === "apply-stash") return subFlow.query;
      if (subFlow.type === "pop-stash") return subFlow.query;
      if (subFlow.type === "switch-repo") return subFlow.query;
      if (subFlow.type === "pick-repo") return subFlow.query;
    }
    if (mode === "search") return term;
    return query;
  };

  const getPlaceholder = (): string => {
    if (subFlow) {
      if (subFlow.type === "checkout-branch") return t("commandPalette.placeholders.checkoutBranch");
      if (subFlow.type === "delete-branch") return t("commandPalette.placeholders.deleteBranch");
      if (subFlow.type === "create-branch") return t("commandPalette.placeholders.createBranch");
      if (subFlow.type === "commit") return t("commandPalette.placeholders.commit");
      if (subFlow.type === "stash") return t("commandPalette.placeholders.stash");
      if (subFlow.type === "codex-rollback") return t("commandPalette.placeholders.codexRollback");
      if (subFlow.type === "apply-stash") return t("commandPalette.placeholders.applyStash");
      if (subFlow.type === "pop-stash") return t("commandPalette.placeholders.popStash");
      if (subFlow.type === "switch-repo") return t("commandPalette.placeholders.switchRepo");
      if (subFlow.type === "pick-repo") return t("commandPalette.placeholders.pickRepo");
    }
    if (mode === "search") {
      return t("commandPalette.placeholders.search");
    }
    if (mode === "file") return t("commandPalette.placeholders.fileMode");
    return t("commandPalette.placeholders.auto");
  };

  const getModeBadge = (): ReactNode => {
    if (subFlow) {
      const labels: Record<string, string> = {
        "checkout-branch": t("commandPalette.subFlow.checkoutBranch"),
        "create-branch": t("commandPalette.subFlow.createBranch"),
        commit: t("commandPalette.subFlow.commit"),
        stash: t("commandPalette.subFlow.stash"),
        "delete-branch": t("commandPalette.subFlow.deleteBranch"),
        "apply-stash": t("commandPalette.subFlow.applyStash"),
        "pop-stash": t("commandPalette.subFlow.popStash"),
        "switch-repo": t("commandPalette.subFlow.switchRepo"),
        "codex-rollback": t("commandPalette.subFlow.codexRollback"),
        "pick-repo": t("commandPalette.subFlow.pickRepo"),
      };
      // Breadcrumb: "Action · repoName" when in a scoped sub-flow
      if (scopedRepo && subFlow.type !== "pick-repo") {
        return (
          <span style={STYLES.modeBadge}>
            {labels[subFlow.type]}
            <span style={{ color: "rgba(255,107,107,0.35)" }}>{"\u00B7"}</span>
            {scopedRepo.name}
          </span>
        );
      }
      // For pick-repo, show the pending command name as the badge
      if (subFlow.type === "pick-repo" && pendingCommandId) {
        const cmdLabel = availableCommands.find((c) => c.id === pendingCommandId);
        if (cmdLabel) {
          return <span style={STYLES.modeBadge}>{cmdLabel.label}</span>;
        }
      }
      return <span style={STYLES.modeBadge}>{labels[subFlow.type]}</span>;
    }
    if (mode === "command") return <span style={STYLES.modeBadge}>&gt;</span>;
    if (mode === "thread") return <span style={STYLES.modeBadge}>@</span>;
    if (mode === "workspace") return <span style={STYLES.modeBadge}>#</span>;
    if (mode === "file") return <span style={STYLES.modeBadge}>%</span>;
    if (mode === "search") return <span style={STYLES.modeBadge}>?</span>;
    return null;
  };

  function renderItem(item: ResultItem, index: number): ReactNode {
    const active = index === activeIndex;
    const key = `${item.type}-${index}`;

    switch (item.type) {
      case "command": {
        const Icon = item.entry.icon;
        const showRepoBadge = item.entry.group === "git" && activeGitRepos.length > 1 && activeRepo;
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><Icon size={16} /></span>
            <span style={{ ...STYLES.itemLabel, display: "flex", alignItems: "center", gap: 6 }}>
              {item.entry.label}
              {showRepoBadge && (
                <span style={STYLES.inlineBadge}>{activeRepo.name}</span>
              )}
            </span>
            {item.entry.shortcut && <span style={STYLES.itemShortcut}>{item.entry.shortcut}</span>}
            {(item.entry.id === "switch-thread" || item.entry.id === "switch-workspace") && (
              <ChevronRight size={14} style={{ color: "var(--text-3)" }} />
            )}
          </button>
        );
      }
      case "message-search": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><Search size={16} /></span>
            <span style={{ overflow: "hidden" }}>
              <span style={{ ...STYLES.itemLabel, display: "block" }}>
                {item.entry.threadTitle || t("commandPalette.status.threadFallback")}
              </span>
              <span style={STYLES.itemDescription}>
                {item.entry.workspaceName} · {item.entry.snippet}
              </span>
            </span>
            <span />
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
        const workspaceName =
          workspaceNameById.get(item.entry.workspaceId) ?? t("commandPalette.status.workspaceFallback");
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
              <span style={{ ...STYLES.itemLabel, display: "block" }}>{item.entry.title}</span>
              <span style={STYLES.itemDescription}>{workspaceName}</span>
            </span>
            <span style={STYLES.itemDescription}>
              {formatRelativeTime(item.entry.lastActivityAt, i18n.language, {
                style: "short-with-suffix",
              })}
            </span>
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
              {item.entry.isCurrent && <span style={{ ...STYLES.inlineBadge, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--border-accent)", marginLeft: 4 }}>{t("commandPalette.status.current")}</span>}
              {item.entry.isRemote && <span style={{ ...STYLES.inlineBadge, marginLeft: 4 }}>{t("commandPalette.status.remote")}</span>}
            </span>
            <span />
          </button>
        );
      }
      case "stash": {
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><Layers size={16} /></span>
            <span style={{ ...STYLES.itemLabel, display: "flex", alignItems: "center", gap: 6 }}>
              {item.entry.name}
              {item.entry.branchHint && (
                <span style={STYLES.inlineBadge}>{item.entry.branchHint}</span>
              )}
            </span>
            <span />
          </button>
        );
      }
      case "repo": {
        const isCurrent = item.entry.id === activeRepo?.id;
        return (
          <button
            key={key}
            ref={active ? activeItemRef : undefined}
            style={STYLES.item(active)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void executeItem(item)}
          >
            <span style={STYLES.itemIcon(active)}><FolderGit2 size={16} /></span>
            <span style={{ overflow: "hidden" }}>
              <span style={{ ...STYLES.itemLabel, display: "flex", alignItems: "center", gap: 6 }}>
                {item.entry.name}
                {isCurrent && (
                  <span style={{ ...STYLES.inlineBadge, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--border-accent)" }}>{t("commandPalette.status.current")}</span>
                )}
              </span>
              <span style={STYLES.itemDescription}>{item.entry.path}</span>
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
              <span style={STYLES.itemLabel}>
                {t("commandPalette.sendMessage.sendTo", {
                  name: activeThread?.title ?? t("commandPalette.status.chatFallback"),
                })}
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
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={STYLES.card}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div style={STYLES.inputRow}>
          {getModeBadge() || (
            <span style={STYLES.inputIcon}><Search size={18} /></span>
          )}
          <input
            ref={inputRef}
            style={STYLES.input}
            value={getInputValue()}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder={getPlaceholder()}
            spellCheck={false}
            autoComplete="off"
            aria-label={getPlaceholder()}
          />
        </div>

        {/* Results */}
        <div ref={resultsRef} style={STYLES.results}>
          {mode === "search" && !subFlow && (
            <div style={STYLES.chipBar}>
              {(["all", "messages", "files", "threads"] as const).map((scope) => (
                <button
                  key={scope}
                  style={STYLES.chip(searchScope === scope)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSearchScope(scope);
                    setActiveIndex(0);
                  }}
                >
                  {t(`commandPalette.searchScopes.${scope}`)}
                </button>
              ))}
            </div>
          )}
          {/* Filter chips — auto mode only */}
          {mode === "auto" && term.length >= 1 && !subFlow && (
            <div style={STYLES.chipBar}>
              <button
                style={STYLES.chip(showFilesInAuto)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setShowFilesInAuto((v) => !v); setActiveIndex(0); }}
              >
                <File size={11} /> {t("commandPalette.chips.files")}
              </button>
              <button
                style={STYLES.chip(showThreadsInAuto)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setShowThreadsInAuto((v) => !v); setActiveIndex(0); }}
              >
                <MessageSquare size={11} /> {t("commandPalette.chips.threads")}
              </button>
            </div>
          )}
          {flatItems.length === 0 && (
            <p style={STYLES.emptyState}>
              {!activeWorkspaceId
                ? t("commandPalette.status.noActiveWorkspace")
                : t("commandPalette.empty.noResults")}
            </p>
          )}
          {groups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && group.label && <div style={STYLES.groupDivider} />}
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
          <span><kbd style={STYLES.footerKbd}>{"\u2191\u2193"}</kbd> {t("commandPalette.footer.navigate")}</span>
          <span><kbd style={STYLES.footerKbd}>{"\u21B5"}</kbd> {t("commandPalette.footer.select")}</span>
          <span><kbd style={STYLES.footerKbd}>esc</kbd> {subFlow ? t("commandPalette.footer.back") : t("commandPalette.footer.close")}</span>
          {!subFlow && (
            <span>
              <kbd style={STYLES.footerKbd}>tab</kbd>
              {shouldTabCycleCommandPaletteSearchScope(mode, term)
                ? t("commandPalette.footer.switchSearchScope")
                : t("commandPalette.footer.switchMode")}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
