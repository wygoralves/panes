import { create } from "zustand";

interface UiState {
  showSidebar: boolean;
  showGitPanel: boolean;
  searchOpen: boolean;
  engineSetupOpen: boolean;
  toggleSidebar: () => void;
  toggleGitPanel: () => void;
  setSearchOpen: (open: boolean) => void;
  openEngineSetup: () => void;
  closeEngineSetup: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showSidebar: true,
  showGitPanel: true,
  searchOpen: false,
  engineSetupOpen: false,
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  toggleGitPanel: () => set((state) => ({ showGitPanel: !state.showGitPanel })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  openEngineSetup: () => set({ engineSetupOpen: true }),
  closeEngineSetup: () => set({ engineSetupOpen: false }),
}));
