import { create } from "zustand";
import {
  COMMAND_PALETTE_DEFAULT_LAUNCH,
  type CommandPaletteLaunchState,
} from "../lib/commandPalette";

const SIDEBAR_PINNED_KEY = "panes:sidebarPinned";
const GIT_PANEL_PINNED_KEY = "panes:gitPanelPinned";
const EXPLORER_OPEN_KEY = "panes:explorerOpen";

interface MessageFocusTarget {
  threadId: string;
  messageId: string;
  requestedAt: number;
}

interface FocusModeSnapshot {
  showSidebar: boolean;
  showGitPanel: boolean;
}

export type ActiveView = "chat" | "harnesses" | "settings";
export type SettingsSection =
  | "overview"
  | "appearance"
  | "terminal"
  | "notifications"
  | "power"
  | "about"
  | "workspace-general"
  | "workspace-repos"
  | "workspace-startup";

interface UiState {
  showSidebar: boolean;
  sidebarPinned: boolean;
  showGitPanel: boolean;
  gitPanelPinned: boolean;
  showExplorer: boolean;
  focusMode: boolean;
  focusModeSnapshot: FocusModeSnapshot | null;
  activeView: ActiveView;
  settingsSection: SettingsSection;
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
  toggleGitPanelPin: () => void;
  setGitPanelPinned: (pinned: boolean) => void;
  toggleExplorer: () => void;
  setExplorerOpen: (open: boolean) => void;
  setFocusMode: (enabled: boolean) => void;
  toggleFocusMode: () => void;
  setActiveView: (view: ActiveView) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setSettingsWorkspaceId: (workspaceId: string | null) => void;
  openSettings: (workspaceId?: string | null, section?: SettingsSection) => void;
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

const savedGitPanelPinned = (() => {
  try {
    return localStorage.getItem(GIT_PANEL_PINNED_KEY);
  } catch {
    return null;
  }
})();

const savedExplorerOpen = (() => {
  try {
    return localStorage.getItem(EXPLORER_OPEN_KEY);
  } catch {
    return null;
  }
})();

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  sidebarPinned: savedPinned !== null ? savedPinned === "true" : true,
  showGitPanel: true,
  gitPanelPinned: savedGitPanelPinned !== null ? savedGitPanelPinned === "true" : true,
  showExplorer: savedExplorerOpen !== null ? savedExplorerOpen === "true" : true,
  focusMode: false,
  focusModeSnapshot: null,
  commandPaletteOpen: false,
  commandPaletteLaunch: COMMAND_PALETTE_DEFAULT_LAUNCH,
  activeView: "chat",
  settingsSection: "overview",
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
  toggleGitPanelPin: () =>
    set((state) => {
      const next = !state.gitPanelPinned;
      try {
        localStorage.setItem(GIT_PANEL_PINNED_KEY, String(next));
      } catch {
        // Ignore storage failures in non-browser/test environments.
      }
      return { gitPanelPinned: next, showGitPanel: true };
    }),
  setGitPanelPinned: (pinned) => {
    try {
      localStorage.setItem(GIT_PANEL_PINNED_KEY, String(pinned));
    } catch {
      // Ignore storage failures in non-browser/test environments.
    }
    set({ gitPanelPinned: pinned, showGitPanel: true });
  },
  toggleExplorer: () =>
    set((state) => {
      const next = !state.showExplorer;
      try {
        localStorage.setItem(EXPLORER_OPEN_KEY, String(next));
      } catch {
        // Ignore storage failures in non-browser/test environments.
      }
      return { showExplorer: next };
    }),
  setExplorerOpen: (open) => {
    try {
      localStorage.setItem(EXPLORER_OPEN_KEY, String(open));
    } catch {
      // Ignore storage failures in non-browser/test environments.
    }
    set({ showExplorer: open });
  },
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
  setSettingsSection: (section) => set({ settingsSection: section }),
  setSettingsWorkspaceId: (workspaceId) => set({ settingsWorkspaceId: workspaceId }),
  openSettings: (workspaceId = null, section = "overview") => {
    set((state) => ({
      activeView: "settings",
      settingsSection: section,
      settingsWorkspaceId: workspaceId ?? state.settingsWorkspaceId,
    }));
  },
  openWorkspaceSettings: (workspaceId) => {
    set({
      activeView: "settings",
      settingsSection: "workspace-general",
      settingsWorkspaceId: workspaceId,
    });
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
