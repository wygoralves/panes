import { create } from "zustand";
import {
  COMMAND_PALETTE_DEFAULT_LAUNCH,
  type CommandPaletteLaunchState,
} from "../lib/commandPalette";

const SIDEBAR_PINNED_KEY = "panes:sidebarPinned";

interface MessageFocusTarget {
  threadId: string;
  messageId: string;
  requestedAt: number;
}

interface FocusModeSnapshot {
  showSidebar: boolean;
  showGitPanel: boolean;
}

type ActiveView = "chat" | "harnesses" | "workspace-settings";

interface UiState {
  showSidebar: boolean;
  sidebarPinned: boolean;
  showGitPanel: boolean;
  focusMode: boolean;
  focusModeSnapshot: FocusModeSnapshot | null;
  activeView: ActiveView;
  settingsWorkspaceId: string | null;
  commandPaletteOpen: boolean;
  commandPaletteLaunch: CommandPaletteLaunchState;
  messageFocusTarget: MessageFocusTarget | null;
  openCommandPalette: (launch?: Partial<CommandPaletteLaunchState>) => void;
  closeCommandPalette: () => void;
  toggleSidebar: () => void;
  toggleSidebarPin: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  toggleGitPanel: () => void;
  setFocusMode: (enabled: boolean) => void;
  toggleFocusMode: () => void;
  setActiveView: (view: ActiveView) => void;
  openWorkspaceSettings: (workspaceId: string) => void;
  setMessageFocusTarget: (target: { threadId: string; messageId: string }) => void;
  clearMessageFocusTarget: () => void;
}

const savedPinned = (() => {
  try {
    return localStorage.getItem(SIDEBAR_PINNED_KEY);
  } catch {
    return null;
  }
})();

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  sidebarPinned: savedPinned !== null ? savedPinned === "true" : true,
  showGitPanel: true,
  focusMode: false,
  focusModeSnapshot: null,
  commandPaletteOpen: false,
  commandPaletteLaunch: COMMAND_PALETTE_DEFAULT_LAUNCH,
  activeView: "chat",
  settingsWorkspaceId: null,
  messageFocusTarget: null,
  openCommandPalette: (launch) =>
    set({
      commandPaletteOpen: true,
      commandPaletteLaunch: {
        ...COMMAND_PALETTE_DEFAULT_LAUNCH,
        ...launch,
      },
    }),
  closeCommandPalette: () =>
    set({
      commandPaletteOpen: false,
      commandPaletteLaunch: COMMAND_PALETTE_DEFAULT_LAUNCH,
    }),
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  toggleSidebarPin: () =>
    set((state) => {
      const next = !state.sidebarPinned;
      try {
        localStorage.setItem(SIDEBAR_PINNED_KEY, String(next));
      } catch {
        // Ignore storage failures in non-browser/test environments.
      }
      return { sidebarPinned: next, showSidebar: true };
    }),
  setSidebarPinned: (pinned) => {
    try {
      localStorage.setItem(SIDEBAR_PINNED_KEY, String(pinned));
    } catch {
      // Ignore storage failures in non-browser/test environments.
    }
    set({ sidebarPinned: pinned, showSidebar: true });
  },
  toggleGitPanel: () => set((state) => ({ showGitPanel: !state.showGitPanel })),
  setFocusMode: (enabled) =>
    set((state) => {
      if (enabled) {
        if (state.focusMode) {
          return state;
        }
        return {
          focusMode: true,
          focusModeSnapshot: {
            showSidebar: state.showSidebar,
            showGitPanel: state.showGitPanel,
          },
          showSidebar: false,
        };
      }

      if (!state.focusMode) {
        return state;
      }

      const snapshot = state.focusModeSnapshot;
      return {
        focusMode: false,
        focusModeSnapshot: null,
        showSidebar: snapshot?.showSidebar ?? state.showSidebar,
        showGitPanel: snapshot?.showGitPanel ?? state.showGitPanel,
      };
    }),
  toggleFocusMode: () =>
    set((state) => {
      if (!state.focusMode) {
        return {
          focusMode: true,
          focusModeSnapshot: {
            showSidebar: state.showSidebar,
            showGitPanel: state.showGitPanel,
          },
          showSidebar: false,
        };
      }

      const snapshot = state.focusModeSnapshot;
      return {
        focusMode: false,
        focusModeSnapshot: null,
        showSidebar: snapshot?.showSidebar ?? state.showSidebar,
        showGitPanel: snapshot?.showGitPanel ?? state.showGitPanel,
      };
    }),
  setActiveView: (view) => {
    set({ activeView: view });
    if (view === "harnesses") {
      // Lazy import to avoid circular dependency
      void import("./harnessStore").then(({ useHarnessStore }) => {
        void useHarnessStore.getState().scan();
      });
    }
  },
  openWorkspaceSettings: (workspaceId) => {
    set({ activeView: "workspace-settings", settingsWorkspaceId: workspaceId });
  },
  setMessageFocusTarget: (target) =>
    set({
      messageFocusTarget: {
        ...target,
        requestedAt: Date.now(),
      },
    }),
  clearMessageFocusTarget: () => set({ messageFocusTarget: null }),
}));
