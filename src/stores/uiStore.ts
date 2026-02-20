import { create } from "zustand";

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

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  sidebarPinned: true,
  showGitPanel: true,
  searchOpen: false,
  engineSetupOpen: false,
  messageFocusTarget: null,
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  toggleSidebarPin: () =>
    set((state) => ({
      sidebarPinned: !state.sidebarPinned,
      showSidebar: true,
    })),
  setSidebarPinned: (pinned) => set({ sidebarPinned: pinned, showSidebar: true }),
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
