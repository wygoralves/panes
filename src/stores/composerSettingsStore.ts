import { create } from "zustand";
import { ipc } from "../lib/ipc";

interface ComposerSettingsState {
  planModeVisible: boolean;
  legacyModelsVisible: boolean;
  loaded: boolean;
  load: () => Promise<boolean>;
  setPlanModeVisible: (visible: boolean) => Promise<boolean>;
  setLegacyModelsVisible: (visible: boolean) => Promise<boolean>;
}

export const useComposerSettingsStore = create<ComposerSettingsState>((set, get) => ({
  planModeVisible: true,
  legacyModelsVisible: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return get().planModeVisible;
    try {
      const [planModeVisible, legacyModelsVisible] = await Promise.all([
        ipc.getComposerPlanModeVisible(),
        ipc.getComposerLegacyModelsVisible(),
      ]);
      set({ planModeVisible, legacyModelsVisible, loaded: true });
      return planModeVisible;
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

  setLegacyModelsVisible: async (visible) => {
    const previous = get().legacyModelsVisible;
    set({ legacyModelsVisible: visible });

    try {
      const saved = await ipc.setComposerLegacyModelsVisible(visible);
      set({ legacyModelsVisible: saved });
      return true;
    } catch {
      set({ legacyModelsVisible: previous });
      return false;
    }
  },
}));
