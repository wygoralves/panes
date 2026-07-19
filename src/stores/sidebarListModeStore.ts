import { create } from "zustand";
import { ipc } from "../lib/ipc";
import {
  normalizeSidebarListMode,
  type SidebarListMode,
} from "../lib/sidebarListMode";

interface SidebarListModeState {
  mode: SidebarListMode;
  loaded: boolean;
  load: () => Promise<SidebarListMode>;
  setMode: (mode: SidebarListMode) => Promise<boolean>;
}

export const useSidebarListModeStore = create<SidebarListModeState>((set, get) => ({
  mode: "projects",
  loaded: false,

  load: async () => {
    if (get().loaded) return get().mode;
    try {
      const saved = await ipc.getSidebarListMode();
      const normalized = normalizeSidebarListMode(saved);
      set({ mode: normalized, loaded: true });
      return normalized;
    } catch {
      // Frontend-only dev/test contexts won't have the Tauri invoke bridge.
      set({ loaded: true });
      return "projects";
    }
  },

  setMode: async (mode) => {
    const previous = get().mode;
    set({ mode });

    try {
      const saved = await ipc.setSidebarListMode(mode);
      set({ mode: normalizeSidebarListMode(saved) });
      return true;
    } catch {
      set({ mode: previous });
      return false;
    }
  },
}));
