import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { useWorkspaceStore } from "./workspaceStore";
import { useGitStore } from "./gitStore";
import { useThreadStore } from "./threadStore";
import { useChatStore } from "./chatStore";
import { useTerminalStore } from "./terminalStore";
import { useFileStore } from "./fileStore";
import { toast } from "./toastStore";
import type {
  Context,
  ContextEditorState,
  ContextStatus,
  ContextTerminalRecipe,
  ContextUpdate,
  SplitNode,
} from "../types";

// ── Helpers ──────────────────────────────────────────────────────────

const LAST_CONTEXT_KEY_PREFIX = "panes:lastActiveContextId:";

function collectSessionIds(node: SplitNode): string[] {
  if (node.type === "leaf") return [node.sessionId];
  return [...collectSessionIds(node.children[0]), ...collectSessionIds(node.children[1])];
}

function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\]/g, "-");
}

function getRepoPath(repoId: string): string | null {
  const repos = useWorkspaceStore.getState().repos;
  return repos.find((r) => r.id === repoId)?.path ?? null;
}

function findTerminalGroupForContext(
  workspaceId: string,
  contextId: string,
): string | null {
  const ws = useTerminalStore.getState().workspaces[workspaceId];
  if (!ws) return null;
  for (const group of ws.groups) {
    if (!group.sessionMeta) continue;
    for (const meta of Object.values(group.sessionMeta)) {
      if (meta.contextId === contextId) return group.id;
    }
  }
  return null;
}

// ── Types ────────────────────────────────────────────────────────────

export interface CreateContextOpts {
  workspaceId: string;
  repoId: string;
  branchName: string;
  baseBranch?: string;
  displayName?: string;
  prUrl?: string;
  prNumber?: number;
  engineId?: "codex" | "claude";
  modelId?: string;
  harnessId?: string;
}

export interface CloseContextCleanup {
  removeWorktree?: boolean;
  deleteBranch?: boolean;
}

interface ContextState {
  contexts: Context[];
  activeContextId: string | null;
  isCreating: boolean;
  isSwitching: boolean;

  loadContexts: (workspaceId: string) => Promise<void>;
  createContext: (opts: CreateContextOpts) => Promise<Context | null>;
  switchContext: (contextId: string) => Promise<void>;
  closeContext: (contextId: string, cleanup?: CloseContextCleanup) => Promise<void>;
  getActiveContext: () => Context | null;
  getDefaultContext: (workspaceId: string, repoId: string) => Context | null;
}

// ── Store ────────────────────────────────────────────────────────────

export const useContextStore = create<ContextState>((set, get) => ({
  contexts: [],
  activeContextId: null,
  isCreating: false,
  isSwitching: false,

  loadContexts: async (workspaceId) => {
    try {
      const contexts = await ipc.listContexts(workspaceId);
      const lastId = localStorage.getItem(LAST_CONTEXT_KEY_PREFIX + workspaceId);
      const activeContextId = contexts.find((c) => c.id === lastId)?.id ?? null;
      set({ contexts, activeContextId });
    } catch {
      // DB may not have the table yet on first run — degrade gracefully
    }
  },

  createContext: async (opts) => {
    set({ isCreating: true });

    const gitStore = useGitStore.getState();
    const threadStore = useThreadStore.getState();
    const repo = useWorkspaceStore.getState().repos.find((r) => r.id === opts.repoId);
    if (!repo) {
      set({ isCreating: false });
      toast.error("Repo not found");
      return null;
    }

    const worktreePath = `${repo.path}/.panes/worktrees/${sanitizeBranchName(opts.branchName)}`;
    const baseBranch = opts.baseBranch ?? repo.defaultBranch;

    let createdWorktree = false;
    let createdThreadId: string | null = null;

    try {
      // 1. Create worktree
      await gitStore.addWorktree(repo.path, worktreePath, opts.branchName, baseBranch);
      createdWorktree = true;

      // 2. Create chat thread
      createdThreadId = await threadStore.createThread({
        workspaceId: opts.workspaceId,
        repoId: opts.repoId,
        engineId: opts.engineId,
        modelId: opts.modelId,
        title: opts.displayName ?? opts.branchName,
      });

      // 3. Build terminal recipe
      const terminalRecipe: ContextTerminalRecipe = {
        sessions: [{
          harnessId: opts.harnessId ?? null,
          launchHarnessOnCreate: !!opts.harnessId,
        }],
      };

      // 4. Persist context to DB (before terminal, so we have the context ID)
      const now = new Date().toISOString();
      const contextId = crypto.randomUUID();
      const contextData: Context = {
        id: contextId,
        workspaceId: opts.workspaceId,
        repoId: opts.repoId,
        worktreePath,
        branchName: opts.branchName,
        threadId: createdThreadId,
        displayName: opts.displayName ?? opts.branchName,
        prUrl: opts.prUrl ?? null,
        prNumber: opts.prNumber ?? null,
        status: "active",
        terminalRecipe: JSON.stringify(terminalRecipe),
        editorState: null,
        layoutMode: null,
        createdAt: now,
        lastActiveAt: now,
      };

      const created = await ipc.createContext(contextData);

      // 5. Create terminal session via the store (proper state management + contextId tagging)
      try {
        await useTerminalStore.getState().createSessionForContext(
          opts.workspaceId,
          worktreePath,
          created.id,
          opts.harnessId,
        );
      } catch {
        // Terminal creation is non-fatal — context still works without it
      }

      set((state) => ({
        contexts: [...state.contexts, created],
        isCreating: false,
      }));

      // 6. Switch to the new context
      await get().switchContext(created.id);

      return created;
    } catch (error) {
      // Compensating rollback
      if (createdThreadId) {
        try { await ipc.archiveThread(createdThreadId); } catch { /* best effort */ }
      }
      if (createdWorktree) {
        try { await gitStore.removeWorktree(repo.path, worktreePath, true); } catch { /* best effort */ }
      }
      set({ isCreating: false });
      toast.error(`Failed to create context: ${error}`);
      return null;
    }
  },

  switchContext: async (targetId) => {
    const target = get().contexts.find((c) => c.id === targetId);
    if (!target || target.id === get().activeContextId) return;

    set({ isSwitching: true });

    try {
      const current = get().getActiveContext();
      const repo = useWorkspaceStore.getState().repos.find((r) => r.id === target.repoId);
      if (!repo) {
        throw new Error(`Repo ${target.repoId} not found`);
      }

      const fileStore = useFileStore.getState();
      const gitStore = useGitStore.getState();
      const terminalStore = useTerminalStore.getState();

      // ── Phase 1: Save current context state ──
      if (current) {
        const currentRepoPath = current.worktreePath ?? getRepoPath(current.repoId) ?? "";
        const editorState = fileStore.snapshotTabs(currentRepoPath);
        const layoutWs = terminalStore.workspaces[current.workspaceId];
        const layoutMode = layoutWs?.layoutMode ?? null;

        const update: ContextUpdate = {
          editorState: JSON.stringify(editorState),
          layoutMode: layoutMode ?? undefined,
          status: "paused",
          lastActiveAt: new Date().toISOString(),
        };
        await ipc.updateContext(current.id, update);

        set((state) => ({
          contexts: state.contexts.map((c) =>
            c.id === current.id
              ? {
                  ...c,
                  editorState: JSON.stringify(editorState),
                  layoutMode,
                  status: "paused" as ContextStatus,
                }
              : c,
          ),
        }));
      }

      // ── Phase 2: Activate target context ──
      const effectivePath = target.worktreePath ?? repo.path;
      const isWorktree = target.worktreePath != null;

      // 2a. Repo activation (must come first)
      useWorkspaceStore.getState().setActiveRepo(target.repoId, { remember: false });

      // 2b. Git panel switch (order matters: setActiveRepoPath clears mainRepoPath)
      gitStore.setActiveRepoPath(effectivePath);
      gitStore.setMainRepoPath(isWorktree ? repo.path : null);

      // 2c. Thread activation (sync then async)
      if (target.threadId) {
        useThreadStore.getState().setActiveThread(target.threadId);
        await useChatStore.getState().setActiveThread(target.threadId);
      }

      // 2d. Terminal group activation
      const existingGroupId = findTerminalGroupForContext(target.workspaceId, target.id);
      if (existingGroupId) {
        useTerminalStore.getState().setActiveGroup(target.workspaceId, existingGroupId);
      }

      // 2e. Editor tab restore
      if (target.editorState) {
        try {
          const parsedState: ContextEditorState = JSON.parse(target.editorState);
          await useFileStore.getState().restoreTabs(effectivePath, parsedState);
        } catch {
          useFileStore.getState().closeAllTabs();
        }
      } else {
        useFileStore.getState().closeAllTabs();
      }

      // 2f. Layout mode restore
      if (target.layoutMode) {
        const validModes = ["chat", "split", "terminal", "editor"] as const;
        type LayoutMode = (typeof validModes)[number];
        if (validModes.includes(target.layoutMode as LayoutMode)) {
          useTerminalStore.getState().setLayoutMode(
            target.workspaceId,
            target.layoutMode as LayoutMode,
          );
        }
      }

      // ── Phase 3: Finalize ──
      const now = new Date().toISOString();
      await ipc.updateContext(target.id, {
        status: "active",
        lastActiveAt: now,
      });

      set((state) => ({
        activeContextId: target.id,
        isSwitching: false,
        contexts: state.contexts.map((c) =>
          c.id === target.id
            ? { ...c, status: "active" as ContextStatus, lastActiveAt: now }
            : c,
        ),
      }));

      localStorage.setItem(LAST_CONTEXT_KEY_PREFIX + target.workspaceId, target.id);

      // Refresh git panel for the new path
      gitStore.refresh(effectivePath).catch(() => {});
    } catch (error) {
      set({ isSwitching: false });
      toast.error(`Failed to switch context: ${error}`);
    }
  },

  closeContext: async (contextId, cleanup) => {
    const context = get().contexts.find((c) => c.id === contextId);
    if (!context) return;

    // Can't close the default context
    if (!context.worktreePath) return;

    // If closing the active context, switch to default first
    if (contextId === get().activeContextId) {
      const defaultCtx = get().getDefaultContext(context.workspaceId, context.repoId);
      if (defaultCtx && defaultCtx.id !== contextId) {
        await get().switchContext(defaultCtx.id);
      }
    }

    // Close terminal sessions for this context's group
    const groupId = findTerminalGroupForContext(context.workspaceId, contextId);
    if (groupId) {
      const ws = useTerminalStore.getState().workspaces[context.workspaceId];
      const group = ws?.groups.find((g) => g.id === groupId);
      if (group) {
        const sessionIds = collectSessionIds(group.root);
        for (const sid of sessionIds) {
          try {
            await useTerminalStore.getState().closeSession(context.workspaceId, sid);
          } catch { /* session may already be gone */ }
        }
      }
    }

    // Remove worktree if requested
    if (cleanup?.removeWorktree !== false && context.worktreePath) {
      const repo = useWorkspaceStore.getState().repos.find((r) => r.id === context.repoId);
      if (repo) {
        try {
          await useGitStore.getState().removeWorktree(
            repo.path,
            context.worktreePath,
            true,
            context.branchName,
            cleanup?.deleteBranch ?? false,
          );
        } catch {
          // Worktree might already be gone
        }
      }
    }

    // Archive the thread
    if (context.threadId) {
      try { await ipc.archiveThread(context.threadId); } catch { /* best effort */ }
    }

    // Archive the context
    await ipc.archiveContext(contextId);

    set((state) => ({
      contexts: state.contexts.filter((c) => c.id !== contextId),
    }));
  },

  getActiveContext: () => {
    const { contexts, activeContextId } = get();
    return contexts.find((c) => c.id === activeContextId) ?? null;
  },

  getDefaultContext: (workspaceId, repoId) => {
    return (
      get().contexts.find(
        (c) =>
          c.workspaceId === workspaceId &&
          c.repoId === repoId &&
          c.worktreePath === null,
      ) ?? null
    );
  },
}));
