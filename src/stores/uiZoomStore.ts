import { create } from "zustand";
import { ipc } from "../lib/ipc";
import {
  applyUiZoomPercent,
  clampUiZoomPercent,
  DEFAULT_UI_ZOOM_PERCENT,
  nextUiZoomPercent,
} from "../lib/uiZoom";

interface UiZoomState {
  percent: number;
  loaded: boolean;
  load: () => Promise<number>;
  setPercent: (percent: number) => Promise<boolean>;
  step: (direction: 1 | -1) => Promise<boolean>;
  reset: () => Promise<boolean>;
}

export const useUiZoomStore = create<UiZoomState>((set, get) => ({
  percent: DEFAULT_UI_ZOOM_PERCENT,
  loaded: false,

  load: async () => {
    try {
      const saved = clampUiZoomPercent(await ipc.getUiZoomPercent());
      applyUiZoomPercent(saved);
      set({ percent: saved, loaded: true });
      return saved;
    } catch {
      // Frontend-only dev/test contexts have no Tauri bridge.
      set({ loaded: true });
      return DEFAULT_UI_ZOOM_PERCENT;
    }
  },

  setPercent: async (percent) => {
    const previous = get().percent;
    const next = clampUiZoomPercent(percent);
    if (next === previous) return true;
    set({ percent: next });
    applyUiZoomPercent(next);
    try {
      const saved = clampUiZoomPercent(await ipc.setUiZoomPercent(next));
      set({ percent: saved });
      applyUiZoomPercent(saved);
      return true;
    } catch {
      set({ percent: previous });
      applyUiZoomPercent(previous);
      return false;
    }
  },

  step: (direction) => get().setPercent(nextUiZoomPercent(get().percent, direction)),
  reset: () => get().setPercent(DEFAULT_UI_ZOOM_PERCENT),
}));
