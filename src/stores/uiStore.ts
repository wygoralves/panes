import { create } from "zustand";

const SIDEBAR_PINNED_KEY = "panes:sidebarPinned";

interface MessageFocusTarget {
  threadId: string;
  messageId: string;
  requestedAt: number;
}

type ActiveView = "chat" | "harnesses";

interface UiState {
  showSidebar: boolean;
  sidebarPinned: boolean;
  showGitPanel: boolean;
  searchOpen: boolean;
  activeView: ActiveView;
  messageFocusTarget: MessageFocusTarget | null;
  toggleSidebar: () => void;
  toggleSidebarPin: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  toggleGitPanel: () => void;
  setSearchOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  setMessageFocusTarget: (target: { threadId: string; messageId: string }) => void;
  clearMessageFocusTarget: () => void;
}

const savedPinned = localStorage.getItem(SIDEBAR_PINNED_KEY);

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  sidebarPinned: savedPinned !== null ? savedPinned === "true" : true,
  showGitPanel: true,
  searchOpen: false,
  activeView: "chat",
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
  setActiveView: (view) => {
    set({ activeView: view });
    if (view === "harnesses") {
      // Lazy import to avoid circular dependency
      void import("./harnessStore").then(({ useHarnessStore }) => {
        void useHarnessStore.getState().scan();
      });
    }
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
