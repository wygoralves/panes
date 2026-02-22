import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { TerminalSession, SplitNode, SplitDirection, TerminalGroup } from "../types";

export type LayoutMode = "chat" | "terminal" | "split";

const DEFAULT_PANEL_SIZE = 32;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;

const LAYOUT_MODE_STORAGE_KEY = (wsId: string) => `panes:layoutMode:${wsId}`;

function readStoredLayoutMode(workspaceId: string): LayoutMode {
  const v = localStorage.getItem(LAYOUT_MODE_STORAGE_KEY(workspaceId));
  if (v === "terminal" || v === "split") return v;
  return "chat";
}

// ── Split tree helpers ──────────────────────────────────────────────

export function collectSessionIds(node: SplitNode): string[] {
  if (node.type === "leaf") return [node.sessionId];
  return [...collectSessionIds(node.children[0]), ...collectSessionIds(node.children[1])];
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

function makeLeafGroup(sessionId: string): TerminalGroup {
  return { id: crypto.randomUUID(), root: { type: "leaf", sessionId } };
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
  panelSize: number;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  groups: TerminalGroup[];
  activeGroupId: string | null;
  focusedSessionId: string | null;
  loading: boolean;
  error?: string;
}

interface TerminalState {
  workspaces: Record<string, WorkspaceTerminalState>;
  openTerminal: (workspaceId: string) => Promise<void>;
  closeTerminal: (workspaceId: string) => Promise<void>;
  toggleTerminal: (workspaceId: string) => Promise<void>;
  setLayoutMode: (workspaceId: string, mode: LayoutMode) => Promise<void>;
  cycleLayoutMode: (workspaceId: string) => Promise<void>;
  runCommandInTerminal: (workspaceId: string, command: string) => Promise<boolean>;
  createSession: (workspaceId: string, cols?: number, rows?: number) => Promise<string | null>;
  closeSession: (workspaceId: string, sessionId: string) => Promise<void>;
  setActiveSession: (workspaceId: string, sessionId: string) => void;
  setPanelSize: (workspaceId: string, size: number) => void;
  syncSessions: (workspaceId: string) => Promise<void>;
  handleSessionExit: (workspaceId: string, sessionId: string) => void;
  splitSession: (workspaceId: string, sessionId: string, direction: SplitDirection, cols?: number, rows?: number) => Promise<void>;
  setFocusedSession: (workspaceId: string, sessionId: string) => void;
  setActiveGroup: (workspaceId: string, groupId: string) => void;
  updateGroupRatio: (workspaceId: string, groupId: string, containerId: string, ratio: number) => void;
}

function defaultWorkspaceState(): WorkspaceTerminalState {
  return {
    isOpen: false,
    layoutMode: "chat",
    panelSize: DEFAULT_PANEL_SIZE,
    sessions: [],
    activeSessionId: null,
    groups: [],
    activeGroupId: null,
    focusedSessionId: null,
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

export const useTerminalStore = create<TerminalState>((set, get) => ({
  workspaces: {},

  openTerminal: async (workspaceId) => {
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        isOpen: true,
        loading: true,
        error: undefined,
      }),
    }));

    try {
      let sessions = await ipc.terminalListSessions(workspaceId);
      if (sessions.length === 0) {
        const created = await ipc.terminalCreateSession(workspaceId, DEFAULT_COLS, DEFAULT_ROWS);
        sessions = [created];
      }
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
        const groups =
          current.groups.length > 0
            ? current.groups
            : sessions.map((s) => makeLeafGroup(s.id));
        const activeGroupId = current.activeGroupId ?? groups[groups.length - 1]?.id ?? null;
        const focusedId = nextFocusedSessionId(groups, activeGroupId, current.focusedSessionId);
        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            isOpen: true,
            sessions,
            activeSessionId: focusedId,
            groups,
            activeGroupId,
            focusedSessionId: focusedId,
            loading: false,
            error: undefined,
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

    if (mode !== "chat") {
      const workspace = get().workspaces[workspaceId] ?? defaultWorkspaceState();
      if (workspace.sessions.length === 0) {
        await get().openTerminal(workspaceId);
      }
    }

    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        layoutMode: mode,
        isOpen: mode !== "chat" ? true : (state.workspaces[workspaceId]?.isOpen ?? false),
      }),
    }));
  },

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

  createSession: async (workspaceId, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) => {
    set((state) => ({
      workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
        isOpen: true,
        loading: true,
        error: undefined,
      }),
    }));

    try {
      const created = await ipc.terminalCreateSession(workspaceId, cols, rows);
      const newGroup = makeLeafGroup(created.id);
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
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
          groups = sessions.map((s) => makeLeafGroup(s.id));
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
            ...(hasSessions ? { isOpen: true, layoutMode: restoredMode } : {}),
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
      if (noSessionsLeft) {
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

      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          sessions,
          activeSessionId: focusedId,
          groups,
          activeGroupId,
          focusedSessionId: focusedId,
          ...(noSessionsLeft ? { layoutMode: "chat" as LayoutMode } : {}),
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
}));
