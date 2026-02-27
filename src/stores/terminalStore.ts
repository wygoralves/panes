import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { TerminalSession, SplitNode, SplitDirection, TerminalGroup, WorktreeSessionInfo } from "../types";

export type LayoutMode = "chat" | "terminal" | "split" | "editor";

const DEFAULT_PANEL_SIZE = 32;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;

const LAYOUT_MODE_STORAGE_KEY = (wsId: string) => `panes:layoutMode:${wsId}`;

function readStoredLayoutMode(workspaceId: string): LayoutMode {
  const v = localStorage.getItem(LAYOUT_MODE_STORAGE_KEY(workspaceId));
  if (v === "terminal" || v === "split" || v === "editor") return v;
  return "chat";
}

// ── Split tree helpers ──────────────────────────────────────────────

export function collectSessionIds(node: SplitNode): string[] {
  if (node.type === "leaf") return [node.sessionId];
  return [...collectSessionIds(node.children[0]), ...collectSessionIds(node.children[1])];
}

// Build a balanced binary SplitNode tree for N sessions.
// 1 → leaf, 2–3 → vertical columns, 4+ → horizontal rows of vertical columns (2×2 grid for 4).
// Direction semantics: "vertical" → side-by-side (row), "horizontal" → stacked (column).
export function buildGridSplitTree(sessionIds: string[]): SplitNode {
  if (sessionIds.length === 0) throw new Error("buildGridSplitTree requires at least 1 session");
  if (sessionIds.length === 1) return { type: "leaf", sessionId: sessionIds[0] };
  if (sessionIds.length <= 3) return buildVerticalColumn(sessionIds);

  // 4+ sessions: split into two rows (horizontal), each row is a vertical column
  const topCount = Math.ceil(sessionIds.length / 2);
  const top = sessionIds.slice(0, topCount);
  const bottom = sessionIds.slice(topCount);
  return {
    type: "split",
    id: crypto.randomUUID(),
    direction: "horizontal",
    ratio: top.length / sessionIds.length,
    children: [buildVerticalColumn(top), buildVerticalColumn(bottom)],
  };
}

function buildVerticalColumn(sessionIds: string[]): SplitNode {
  if (sessionIds.length === 1) return { type: "leaf", sessionId: sessionIds[0] };
  return {
    type: "split",
    id: crypto.randomUUID(),
    direction: "vertical",
    ratio: 1 / sessionIds.length,
    children: [
      { type: "leaf", sessionId: sessionIds[0] },
      buildVerticalColumn(sessionIds.slice(1)),
    ],
  };
}

function replaceLeafInTree(node: SplitNode, targetId: string, replacement: SplitNode): SplitNode {
  if (node.type === "leaf") return node.sessionId === targetId ? replacement : node;
  return {
    ...node,
    children: [
      replaceLeafInTree(node.children[0], targetId, replacement),
      replaceLeafInTree(node.children[1], targetId, replacement),
    ],
  };
}

function removeLeafFromTree(node: SplitNode, targetId: string): SplitNode | null {
  if (node.type === "leaf") return node.sessionId === targetId ? null : node;
  const [left, right] = node.children;
  if (left.type === "leaf" && left.sessionId === targetId) return right;
  if (right.type === "leaf" && right.sessionId === targetId) return left;
  const newLeft = removeLeafFromTree(left, targetId);
  const newRight = removeLeafFromTree(right, targetId);
  if (newLeft === null) return newRight;
  if (newRight === null) return newLeft;
  return { ...node, children: [newLeft, newRight] };
}

function updateRatioInTree(node: SplitNode, containerId: string, ratio: number): SplitNode {
  if (node.type === "leaf") return node;
  if (node.id === containerId) return { ...node, ratio };
  return {
    ...node,
    children: [
      updateRatioInTree(node.children[0], containerId, ratio),
      updateRatioInTree(node.children[1], containerId, ratio),
    ],
  };
}

function findGroupForSession(groups: TerminalGroup[], sessionId: string): TerminalGroup | null {
  for (const group of groups) {
    if (collectSessionIds(group.root).includes(sessionId)) return group;
  }
  return null;
}

function makeLeafGroup(sessionId: string, name: string, harnessId?: string, autoDetectedHarness?: boolean): TerminalGroup {
  return {
    id: crypto.randomUUID(),
    root: { type: "leaf", sessionId },
    name,
    ...(harnessId ? { harnessId } : {}),
    ...(autoDetectedHarness !== undefined ? { autoDetectedHarness } : {}),
  };
}

export function nextTerminalNumber(groups: TerminalGroup[]): number {
  const used = new Set<number>();
  for (const g of groups) {
    const match = /^Terminal (\d+)$/.exec(g.name);
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function nextHarnessName(baseName: string, harnessId: string, excludeGroupId: string, groups: TerminalGroup[]): string {
  const used = new Set<number>();
  for (const g of groups) {
    if (g.id === excludeGroupId || g.harnessId !== harnessId) continue;
    if (g.name === baseName) { used.add(1); continue; }
    const match = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`).exec(g.name);
    if (match) used.add(Number(match[1]));
  }
  if (used.size === 0) return baseName;
  let n = 1;
  while (used.has(n)) n++;
  return n === 1 ? baseName : `${baseName} ${n}`;
}

function nextFocusedSessionId(
  groups: TerminalGroup[],
  preferGroupId: string | null,
  previousId: string | null,
): string | null {
  if (groups.length === 0) return null;
  const target =
    (preferGroupId ? groups.find((g) => g.id === preferGroupId) : null) ??
    groups[groups.length - 1];
  const ids = collectSessionIds(target.root);
  if (previousId && ids.includes(previousId)) return previousId;
  return ids[ids.length - 1] ?? null;
}

// ── State shape ─────────────────────────────────────────────────────

interface WorkspaceTerminalState {
  isOpen: boolean;
  layoutMode: LayoutMode;
  preEditorLayoutMode: LayoutMode;
  panelSize: number;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  groups: TerminalGroup[];
  activeGroupId: string | null;
  focusedSessionId: string | null;
  broadcastGroupId: string | null;
  loading: boolean;
  error?: string;
}

interface TerminalState {
  workspaces: Record<string, WorkspaceTerminalState>;
  setWorkspaceStatus: (workspaceId: string, loading: boolean, error?: string) => void;
  openTerminal: (workspaceId: string) => Promise<void>;
  closeTerminal: (workspaceId: string) => Promise<void>;
  toggleTerminal: (workspaceId: string) => Promise<void>;
  setLayoutMode: (workspaceId: string, mode: LayoutMode) => Promise<void>;
  cycleLayoutMode: (workspaceId: string) => Promise<void>;
  runCommandInTerminal: (workspaceId: string, command: string) => Promise<boolean>;
  createSession: (workspaceId: string, cols?: number, rows?: number, harnessId?: string, harnessName?: string) => Promise<string | null>;
  closeSession: (workspaceId: string, sessionId: string) => Promise<void>;
  setActiveSession: (workspaceId: string, sessionId: string) => void;
  setPanelSize: (workspaceId: string, size: number) => void;
  syncSessions: (workspaceId: string) => Promise<void>;
  handleSessionExit: (workspaceId: string, sessionId: string) => void;
  splitSession: (workspaceId: string, sessionId: string, direction: SplitDirection, cols?: number, rows?: number) => Promise<void>;
  setFocusedSession: (workspaceId: string, sessionId: string) => void;
  setActiveGroup: (workspaceId: string, groupId: string) => void;
  updateGroupRatio: (workspaceId: string, groupId: string, containerId: string, ratio: number) => void;
  renameGroup: (workspaceId: string, groupId: string, name: string) => void;
  reorderGroups: (workspaceId: string, fromIndex: number, toIndex: number) => void;
  updateGroupHarness: (workspaceId: string, groupId: string, harnessId: string | null, harnessName: string | null, autoDetected: boolean) => void;
  toggleBroadcast: (workspaceId: string, groupId: string) => void;
  createMultiSessionGroup: (
    workspaceId: string,
    harnesses: Array<{ harnessId: string; name: string }>,
    worktreeConfig?: {
      repoPath: string;
      baseBranch: string;
      baseDir: string;
    } | null,
    cols?: number,
    rows?: number,
  ) => Promise<{ groupId: string; sessionIds: string[] } | null>;
  getGroupWorktrees: (workspaceId: string, groupId: string) => WorktreeSessionInfo[];
  removeGroupWorktrees: (workspaceId: string, worktrees: WorktreeSessionInfo[]) => Promise<void>;
}

function defaultWorkspaceState(): WorkspaceTerminalState {
  return {
    isOpen: false,
    layoutMode: "chat",
    preEditorLayoutMode: "chat",
    panelSize: DEFAULT_PANEL_SIZE,
    sessions: [],
    activeSessionId: null,
    groups: [],
    activeGroupId: null,
    focusedSessionId: null,
    broadcastGroupId: null,
    loading: false,
    error: undefined,
  };
}

function mergeWorkspaceState(
  state: TerminalState["workspaces"],
  workspaceId: string,
  next: Partial<WorkspaceTerminalState>,
): TerminalState["workspaces"] {
  const current = state[workspaceId] ?? defaultWorkspaceState();
  return {
    ...state,
    [workspaceId]: {
      ...current,
      ...next,
    },
  };
}

async function removeWorktreesSequential(worktrees: WorktreeSessionInfo[]): Promise<string[]> {
  const failures: string[] = [];
  for (const worktree of worktrees) {
    try {
      await ipc.removeGitWorktree(
        worktree.repoPath,
        worktree.worktreePath,
        true,
        worktree.branch,
        true,
      );
    } catch (error) {
      failures.push(`${worktree.branch || worktree.worktreePath}: ${String(error)}`);
    }
  }
  return failures;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  workspaces: {},

  setWorkspaceStatus: (workspaceId, loading, error) => {
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        loading,
        error,
      }),
    }));
  },

  openTerminal: async (workspaceId) => {
    // Only mark the terminal as open. Session creation is deferred to
    // syncSessions which runs after the TerminalPanel mounts and registers
    // its output event listeners, so the initial shell prompt is never lost.
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        isOpen: true,
        loading: true,
        error: undefined,
      }),
    }));
  },

  closeTerminal: async (workspaceId) => {
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        loading: true,
        error: undefined,
      }),
    }));
    try {
      await ipc.terminalCloseWorkspaceSessions(workspaceId);
      localStorage.setItem(LAYOUT_MODE_STORAGE_KEY(workspaceId), "chat");
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          isOpen: false,
          layoutMode: "chat",
          sessions: [],
          activeSessionId: null,
          groups: [],
          activeGroupId: null,
          focusedSessionId: null,
          loading: false,
          error: undefined,
        }),
      }));
    } catch (error) {
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          loading: false,
          error: String(error),
        }),
      }));
    }
  },

  toggleTerminal: async (workspaceId) => {
    const workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
    if (workspace.isOpen) {
      await get().closeTerminal(workspaceId);
      return;
    }
    await get().openTerminal(workspaceId);
  },

  setLayoutMode: async (workspaceId, mode) => {
    localStorage.setItem(LAYOUT_MODE_STORAGE_KEY(workspaceId), mode);

    if (mode === "split" || mode === "terminal") {
      const workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
      if (workspace.sessions.length === 0) {
        await get().openTerminal(workspaceId);
      }
    }

    set((state) => {
      const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const preEditorLayoutMode =
        mode === "editor" && current.layoutMode !== "editor"
          ? current.layoutMode
          : current.preEditorLayoutMode;
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          layoutMode: mode,
          preEditorLayoutMode,
          isOpen: (mode === "split" || mode === "terminal") ? true : current.isOpen,
        }),
      };
    });
  },

  // Editor mode is excluded from the cycle — it has its own toggle (Cmd+E)
  cycleLayoutMode: async (workspaceId) => {
    const workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
    const order: LayoutMode[] = ["chat", "split", "terminal"];
    const currentIndex = order.indexOf(workspace.layoutMode);
    const nextMode = order[(currentIndex + 1) % order.length];
    await get().setLayoutMode(workspaceId, nextMode);
  },

  runCommandInTerminal: async (workspaceId, command) => {
    const normalized = command.trim();
    if (!workspaceId || !normalized) {
      return false;
    }

    try {
      let workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();

      if (!workspace.isOpen || workspace.sessions.length === 0) {
        await get().openTerminal(workspaceId);
        workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
      }

      let sessionId = workspace.activeSessionId;
      if (!sessionId) {
        sessionId = workspace.sessions[workspace.sessions.length - 1]?.id ?? null;
      }

      if (!sessionId) {
        sessionId = await get().createSession(workspaceId, DEFAULT_COLS, DEFAULT_ROWS);
      }

      if (!sessionId) {
        return false;
      }

      await ipc.terminalWrite(workspaceId, sessionId, `${normalized}\r`);
      return true;
    } catch (error) {
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          error: String(error),
        }),
      }));
      return false;
    }
  },

  createSession: async (workspaceId, cols = DEFAULT_COLS, rows = DEFAULT_ROWS, harnessId, harnessName) => {
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        isOpen: true,
        loading: true,
        error: undefined,
      }),
    }));

    try {
      const created = await ipc.terminalCreateSession(workspaceId, cols, rows);
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();

        let groupName: string;
        // Use a temporary id for exclusion since the group doesn't exist yet
        const tempId = "__new__";
        if (harnessId && harnessName) {
          groupName = nextHarnessName(harnessName, harnessId, tempId, current.groups);
        } else {
          groupName = `Terminal ${nextTerminalNumber(current.groups)}`;
        }

        const newGroup = makeLeafGroup(created.id, groupName, harnessId, harnessId ? false : undefined);
        const sessions = [
          ...current.sessions.filter((session) => session.id !== created.id),
          created,
        ];
        const groups = [...current.groups, newGroup];
        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            isOpen: true,
            sessions,
            activeSessionId: created.id,
            groups,
            activeGroupId: newGroup.id,
            focusedSessionId: created.id,
            loading: false,
            error: undefined,
          }),
        };
      });
      return created.id;
    } catch (error) {
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          loading: false,
          error: String(error),
        }),
      }));
      return null;
    }
  },

  closeSession: async (workspaceId, sessionId) => {
    try {
      await ipc.terminalCloseSession(workspaceId, sessionId);
      get().handleSessionExit(workspaceId, sessionId);
    } catch (error) {
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          error: String(error),
        }),
      }));
    }
  },

  setActiveSession: (workspaceId, sessionId) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      if (!workspace.sessions.some((session) => session.id === sessionId)) {
        return state;
      }
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          activeSessionId: sessionId,
          focusedSessionId: sessionId,
        }),
      };
    });
  },

  setPanelSize: (workspaceId, size) => {
    const clamped = Math.max(15, Math.min(65, size));
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        panelSize: clamped,
      }),
    }));
  },

  syncSessions: async (workspaceId) => {
    try {
      const sessions = await ipc.terminalListSessions(workspaceId);
      const storedMode = readStoredLayoutMode(workspaceId);
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
        const hasSessions = sessions.length > 0;
        const restoredMode = hasSessions && (storedMode === "split" || storedMode === "terminal")
          ? storedMode
          : current.layoutMode;

        const liveIds = new Set(sessions.map((s) => s.id));
        let groups: TerminalGroup[];
        if (current.groups.length === 0 && hasSessions) {
          groups = [];
          for (const s of sessions) {
            const n = nextTerminalNumber(groups);
            groups.push(makeLeafGroup(s.id, `Terminal ${n}`));
          }
        } else {
          groups = current.groups
            .map((group) => {
              let root: SplitNode | null = group.root;
              for (const id of collectSessionIds(group.root)) {
                if (!liveIds.has(id)) {
                  root = root ? removeLeafFromTree(root, id) : null;
                }
              }
              return root ? { ...group, root } : null;
            })
            .filter((g): g is TerminalGroup => g !== null);
        }

        const activeGroupId =
          (current.activeGroupId && groups.some((g) => g.id === current.activeGroupId)
            ? current.activeGroupId
            : groups[groups.length - 1]?.id) ?? null;
        const focusedId = nextFocusedSessionId(groups, activeGroupId, current.focusedSessionId);

        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            sessions,
            activeSessionId: focusedId,
            groups,
            activeGroupId,
            focusedSessionId: focusedId,
            loading: false,
            error: undefined,
            ...(hasSessions ? { isOpen: true, layoutMode: restoredMode } : {}),
          }),
        };
      });
    } catch (error) {
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          loading: false,
          error: String(error),
        }),
      }));
    }
  },

  handleSessionExit: (workspaceId, sessionId) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const sessions = workspace.sessions.filter((session) => session.id !== sessionId);

      const groups = workspace.groups
        .map((group) => {
          const newRoot = removeLeafFromTree(group.root, sessionId);
          return newRoot ? { ...group, root: newRoot } : null;
        })
        .filter((g): g is TerminalGroup => g !== null);

      const noSessionsLeft = sessions.length === 0;
      const isTerminalMode = workspace.layoutMode === "terminal" || workspace.layoutMode === "split";
      if (noSessionsLeft && isTerminalMode) {
        localStorage.setItem(LAYOUT_MODE_STORAGE_KEY(workspaceId), "chat");
      }

      const activeGroupId =
        (workspace.activeGroupId && groups.some((g) => g.id === workspace.activeGroupId)
          ? workspace.activeGroupId
          : groups[groups.length - 1]?.id) ?? null;
      const focusedId = nextFocusedSessionId(
        groups,
        activeGroupId,
        workspace.focusedSessionId === sessionId ? null : workspace.focusedSessionId,
      );

      const broadcastGroupId =
        workspace.broadcastGroupId && groups.some((g) => g.id === workspace.broadcastGroupId)
          ? workspace.broadcastGroupId
          : null;

      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          sessions,
          activeSessionId: focusedId,
          groups,
          activeGroupId,
          focusedSessionId: focusedId,
          broadcastGroupId,
          ...(noSessionsLeft && isTerminalMode ? { layoutMode: "chat" as LayoutMode } : {}),
        }),
      };
    });
  },

  splitSession: async (workspaceId, sessionId, direction, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) => {
    const workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
    const group = findGroupForSession(workspace.groups, sessionId);
    if (!group) return;

    try {
      const created = await ipc.terminalCreateSession(workspaceId, cols, rows);
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
        const sessions = [
          ...current.sessions.filter((s) => s.id !== created.id),
          created,
        ];

        const splitContainer: SplitNode = {
          type: "split",
          id: crypto.randomUUID(),
          direction,
          ratio: 0.5,
          children: [
            { type: "leaf", sessionId },
            { type: "leaf", sessionId: created.id },
          ],
        };

        const groups = current.groups.map((g) => {
          if (g.id !== group.id) return g;
          return { ...g, root: replaceLeafInTree(g.root, sessionId, splitContainer) };
        });

        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            sessions,
            activeSessionId: created.id,
            groups,
            activeGroupId: group.id,
            focusedSessionId: created.id,
          }),
        };
      });
    } catch (error) {
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          error: String(error),
        }),
      }));
    }
  },

  setFocusedSession: (workspaceId, sessionId) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      if (!workspace.sessions.some((s) => s.id === sessionId)) return state;
      const group = findGroupForSession(workspace.groups, sessionId);
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          activeSessionId: sessionId,
          focusedSessionId: sessionId,
          ...(group ? { activeGroupId: group.id } : {}),
        }),
      };
    });
  },

  setActiveGroup: (workspaceId, groupId) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const group = workspace.groups.find((g) => g.id === groupId);
      if (!group) return state;
      const focusedId = nextFocusedSessionId([group], groupId, workspace.focusedSessionId);
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          activeGroupId: groupId,
          focusedSessionId: focusedId,
          activeSessionId: focusedId,
        }),
      };
    });
  },

  updateGroupRatio: (workspaceId, groupId, containerId, ratio) => {
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const groups = workspace.groups.map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, root: updateRatioInTree(g.root, containerId, clamped) };
      });
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, { groups }),
      };
    });
  },

  renameGroup: (workspaceId, groupId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const groups = workspace.groups.map((g) =>
        g.id === groupId ? { ...g, name: trimmed } : g,
      );
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, { groups }),
      };
    });
  },

  reorderGroups: (workspaceId, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const groups = [...workspace.groups];
      const [moved] = groups.splice(fromIndex, 1);
      groups.splice(toIndex, 0, moved);
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, { groups }),
      };
    });
  },

  updateGroupHarness: (workspaceId, groupId, harnessId, harnessName, autoDetected) => {
    set((state) => {
      const workspace = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const groups = workspace.groups.map((g) => {
        if (g.id !== groupId) return g;
        if (harnessId && harnessName) {
          const name = nextHarnessName(harnessName, harnessId, g.id, workspace.groups);
          return { ...g, harnessId, name, autoDetectedHarness: autoDetected };
        }
        // Revert only if it was auto-detected
        if (g.autoDetectedHarness) {
          const n = nextTerminalNumber(workspace.groups.filter((other) => other.id !== g.id));
          const { harnessId: _h, autoDetectedHarness: _a, ...rest } = g;
          return { ...rest, name: `Terminal ${n}` };
        }
        return g;
      });
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, { groups }),
      };
    });
  },

  toggleBroadcast: (workspaceId, groupId) => {
    set((state) => {
      const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
      const next = current.broadcastGroupId === groupId ? null : groupId;
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          broadcastGroupId: next,
        }),
      };
    });
  },

  createMultiSessionGroup: async (workspaceId, harnesses, worktreeConfig, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) => {
    if (harnesses.length === 0) return null;

    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        isOpen: true,
        loading: true,
        error: undefined,
      }),
    }));

    // Track created worktrees for cleanup on failure
    const createdWorktrees: WorktreeSessionInfo[] = [];

    try {
      // Phase 1: Create worktrees sequentially if configured (git locks prevent parallelism)
      const worktreeRunId = worktreeConfig ? crypto.randomUUID().slice(0, 8) : null;
      if (worktreeConfig && worktreeRunId) {
        for (let i = 0; i < harnesses.length; i++) {
          const branch = `panes/${worktreeRunId}/agent-${i + 1}`;
          const worktreePath = `${worktreeConfig.baseDir}/${worktreeRunId}/agent-${i + 1}`;
          await ipc.addGitWorktree(
            worktreeConfig.repoPath,
            worktreePath,
            branch,
            worktreeConfig.baseBranch,
          );
          createdWorktrees.push({ repoPath: worktreeConfig.repoPath, worktreePath, branch });
        }
      }

      // Phase 2: Create terminal sessions (with CWD override if worktrees are active)
      const creationResults = await Promise.allSettled(
        harnesses.map((_h, i) => {
          const cwd = createdWorktrees[i]?.worktreePath ?? undefined;
          return ipc.terminalCreateSession(workspaceId, cols, rows, cwd);
        }),
      );
      const created = creationResults
        .filter((result): result is PromiseFulfilledResult<TerminalSession> => result.status === "fulfilled")
        .map((result) => result.value);
      const firstFailure = creationResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (firstFailure) {
        await Promise.allSettled(
          created.map((session) => ipc.terminalCloseSession(workspaceId, session.id)),
        );
        throw firstFailure.reason;
      }

      const sessionIds = created.map((s) => s.id);
      const root = buildGridSplitTree(sessionIds);

      const groupId = crypto.randomUUID();

      // Build worktree map keyed by session ID
      let worktreeMap: Record<string, WorktreeSessionInfo> | undefined;
      if (createdWorktrees.length > 0) {
        worktreeMap = {};
        sessionIds.forEach((sid, i) => {
          const wt = createdWorktrees[i];
          if (wt) worktreeMap![sid] = wt;
        });
      }

      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
        const groupName = harnesses.length === 1
          ? nextHarnessName(harnesses[0].name, harnesses[0].harnessId, groupId, current.groups)
          : `${harnesses.length} agents`;
        const newGroup: TerminalGroup = {
          id: groupId,
          root,
          name: groupName,
          harnessId: harnesses[0].harnessId,
          autoDetectedHarness: false,
          ...(worktreeMap ? { worktrees: worktreeMap } : {}),
        };
        const sessions = [
          ...current.sessions.filter((s) => !sessionIds.includes(s.id)),
          ...created,
        ];
        const groups = [...current.groups, newGroup];
        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            isOpen: true,
            sessions,
            groups,
            activeGroupId: groupId,
            activeSessionId: sessionIds[0],
            focusedSessionId: sessionIds[0],
            loading: false,
            error: undefined,
          }),
        };
      });

      return { groupId, sessionIds };
    } catch (error) {
      let message = String(error);

      // Clean up any worktrees created before the failure
      if (createdWorktrees.length > 0) {
        const cleanupFailures = await removeWorktreesSequential(createdWorktrees);
        if (cleanupFailures.length > 0) {
          message = `${message}. Cleanup failed for ${cleanupFailures.length} worktree(s): ${cleanupFailures.join("; ")}`;
        }
      }
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          loading: false,
          error: message,
        }),
      }));
      return null;
    }
  },

  getGroupWorktrees: (workspaceId, groupId) => {
    const workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
    const group = workspace.groups.find((item) => item.id === groupId);
    return Object.values(group?.worktrees ?? {});
  },

  removeGroupWorktrees: async (workspaceId, worktrees) => {
    if (worktrees.length === 0) return;

    const failures = await removeWorktreesSequential(worktrees);
    if (failures.length === 0) return;

    const message = `Failed to remove ${failures.length} worktree(s): ${failures.join("; ")}`;
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        error: message,
      }),
    }));
    throw new Error(message);
  },
}));
