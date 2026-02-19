import { create } from "zustand";

interface UiState {
  showSidebar: boolean;
  showGitPanel: boolean;
  searchOpen: boolean;
  toggleSidebar: () => void;
  toggleGitPanel: () => void;
  setSearchOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  showGitPanel: true,
  searchOpen: false,
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  toggleGitPanel: () => set((state) => ({ showGitPanel: !state.showGitPanel })),
  setSearchOpen: (open) => set({ searchOpen: open })
}));

