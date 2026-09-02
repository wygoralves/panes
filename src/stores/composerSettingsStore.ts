import { create } from "zustand";
import { ipc } from "../lib/ipc";

interface ComposerSettingsState {
  planModeVisible: boolean;
  loaded: boolean;
  load: () => Promise<boolean>;
  setPlanModeVisible: (visible: boolean) => Promise<boolean>;
}

export const useComposerSettingsStore = create<ComposerSettingsState>((set, get) => ({
  planModeVisible: true,
  loaded: false,

  load: async () => {
    if (get().loaded) return get().planModeVisible;
    try {
      const saved = await ipc.getComposerPlanModeVisible();
      set({ planModeVisible: saved, loaded: true });
      return saved;
    } catch {
      // Frontend-only dev/test contexts won't have the Tauri invoke bridge.
      set({ loaded: true });
      return true;
    }
  },

  setPlanModeVisible: async (visible) => {
    const previous = get().planModeVisible;
    set({ planModeVisible: visible });

    try {
      const saved = await ipc.setComposerPlanModeVisible(visible);
      set({ planModeVisible: saved });
      return true;
    } catch {
      set({ planModeVisible: previous });
      return false;
    }
  },
}));
