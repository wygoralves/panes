import { create } from "zustand";
import { ipc } from "../lib/ipc";
import {
  applyThemePreference,
  normalizeThemePreference,
  type ThemePreference,
} from "../lib/theme";

interface ThemeStoreState {
  preference: ThemePreference;
  loaded: boolean;
  load: () => Promise<ThemePreference>;
  setPreference: (preference: ThemePreference) => Promise<boolean>;
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  preference: "dark",
  loaded: false,

  load: async () => {
    try {
      const saved = await ipc.getAppTheme();
      const normalized = normalizeThemePreference(saved);
      applyThemePreference(normalized);
      set({ preference: normalized, loaded: true });
      return normalized;
    } catch {
      // Frontend-only dev/test contexts won't have the Tauri invoke bridge.
      applyThemePreference("dark");
      set({ loaded: true });
      return "dark";
    }
  },

  setPreference: async (preference) => {
    const previous = get().preference;
    set({ preference });
    applyThemePreference(preference);

    try {
      const saved = await ipc.setAppTheme(preference);
      const normalized = normalizeThemePreference(saved);
      set({ preference: normalized });
      applyThemePreference(normalized);
      return true;
    } catch {
      set({ preference: previous });
      applyThemePreference(previous);
      return false;
    }
  },
}));
