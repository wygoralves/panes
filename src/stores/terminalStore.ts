import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { TerminalSession } from "../types";

const DEFAULT_PANEL_SIZE = 32;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;

interface WorkspaceTerminalState {
  isOpen: boolean;
  panelSize: number;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  loading: boolean;
  error?: string;
}

interface TerminalState {
  workspaces: Record<string, WorkspaceTerminalState>;
  openTerminal: (workspaceId: string) => Promise<void>;
  closeTerminal: (workspaceId: string) => Promise<void>;
  toggleTerminal: (workspaceId: string) => Promise<void>;
  runCommandInTerminal: (workspaceId: string, command: string) => Promise<boolean>;
  createSession: (workspaceId: string, cols?: number, rows?: number) => Promise<string | null>;
  closeSession: (workspaceId: string, sessionId: string) => Promise<void>;
  setActiveSession: (workspaceId: string, sessionId: string) => void;
  setPanelSize: (workspaceId: string, size: number) => void;
  syncSessions: (workspaceId: string) => Promise<void>;
  handleSessionExit: (workspaceId: string, sessionId: string) => void;
}

function defaultWorkspaceState(): WorkspaceTerminalState {
  return {
    isOpen: false,
    panelSize: DEFAULT_PANEL_SIZE,
    sessions: [],
    activeSessionId: null,
    loading: false,
    error: undefined,
  };
}

function mergeWorkspaceState(
  state: TerminalState["workspaces"],
  workspaceId: string,
  next: Partial<WorkspaceTerminalState>
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

function nextActiveSessionId(
  sessions: TerminalSession[],
  previousActiveId: string | null,
): string | null {
  if (previousActiveId && sessions.some((session) => session.id === previousActiveId)) {
    return previousActiveId;
  }
  return sessions[sessions.length - 1]?.id ?? null;
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
        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            isOpen: true,
            sessions,
            activeSessionId: nextActiveSessionId(sessions, current.activeSessionId),
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
      set((state) => ({
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          isOpen: false,
          sessions: [],
          activeSessionId: null,
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
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
        const sessions = [
          ...current.sessions.filter((session) => session.id !== created.id),
          created,
        ];
        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            isOpen: true,
            sessions,
            activeSessionId: created.id,
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
      set((state) => {
        const current = state.workspaces[workspaceId] ?? defaultWorkspaceState();
        return {
          workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
            sessions,
            activeSessionId: nextActiveSessionId(sessions, current.activeSessionId),
            ...(sessions.length > 0 ? { isOpen: true } : {}),
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
      return {
        workspaces: mergeWorkspaceState(state.workspaces, workspaceId, {
          sessions,
          activeSessionId: nextActiveSessionId(sessions, workspace.activeSessionId === sessionId ? null : workspace.activeSessionId),
        }),
      };
    });
  },
}));
