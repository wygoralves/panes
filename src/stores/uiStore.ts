import { create } from "zustand";

const SIDEBAR_PINNED_KEY = "panes:sidebarPinned";

interface MessageFocusTarget {
  threadId: string;
  messageId: string;
  requestedAt: number;
}

interface UiState {
  showSidebar: boolean;
  sidebarPinned: boolean;
  showGitPanel: boolean;
  searchOpen: boolean;
  engineSetupOpen: boolean;
  messageFocusTarget: MessageFocusTarget | null;
  toggleSidebar: () => void;
  toggleSidebarPin: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  toggleGitPanel: () => void;
  setSearchOpen: (open: boolean) => void;
  openEngineSetup: () => void;
  closeEngineSetup: () => void;
  setMessageFocusTarget: (target: { threadId: string; messageId: string }) => void;
  clearMessageFocusTarget: () => void;
}

const savedPinned = localStorage.getItem(SIDEBAR_PINNED_KEY);

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  sidebarPinned: savedPinned !== null ? savedPinned === "true" : true,
  showGitPanel: true,
  searchOpen: false,
  engineSetupOpen: false,
  messageFocusTarget: null,
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  toggleSidebarPin: () =>
    set((state) => {
      const next = !state.sidebarPinned;
      localStorage.setItem(SIDEBAR_PINNED_KEY, String(next));
      return { sidebarPinned: next, showSidebar: true };
    }),
  setSidebarPinned: (pinned) => {
    localStorage.setItem(SIDEBAR_PINNED_KEY, String(pinned));
    set({ sidebarPinned: pinned, showSidebar: true });
  },
  toggleGitPanel: () => set((state) => ({ showGitPanel: !state.showGitPanel })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  openEngineSetup: () => set({ engineSetupOpen: true }),
  closeEngineSetup: () => set({ engineSetupOpen: false }),
  setMessageFocusTarget: (target) =>
    set({
      messageFocusTarget: {
        ...target,
        requestedAt: Date.now(),
      },
    }),
  clearMessageFocusTarget: () => set({ messageFocusTarget: null }),
}));
