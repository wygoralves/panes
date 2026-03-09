import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { KeepAwakeState } from "../types";
import { t } from "../i18n";
import { toast } from "./toastStore";

interface KeepAwakeStoreState {
  state: KeepAwakeState | null;
  loading: boolean;
  loadedOnce: boolean;
  load: () => Promise<KeepAwakeState | null>;
  refresh: () => Promise<KeepAwakeState | null>;
  toggle: () => Promise<KeepAwakeState | null>;
}

function showKeepAwakeToast(nextState: KeepAwakeState, targetEnabled: boolean) {
  if (!nextState.supported) {
    toast.warning(t("app:commandPalette.toasts.keepAwakeUnsupported"));
    return;
  }

  if (targetEnabled && (!nextState.enabled || !nextState.active)) {
    toast.error(t("app:commandPalette.toasts.keepAwakeEnableFailed"));
    return;
  }

  if (!targetEnabled && (nextState.enabled || nextState.active)) {
    toast.error(t("app:commandPalette.toasts.keepAwakeDisableFailed"));
    return;
  }

  toast.success(
    targetEnabled
      ? t("app:commandPalette.toasts.keepAwakeEnabled")
      : t("app:commandPalette.toasts.keepAwakeDisabled"),
  );
}

async function fetchKeepAwakeState() {
  return ipc.getKeepAwakeState();
}

export const useKeepAwakeStore = create<KeepAwakeStoreState>((set, get) => ({
  state: null,
  loading: false,
  loadedOnce: false,

  load: async () => {
    if (get().loading) {
      return get().state;
    }

    set({ loading: true });
    try {
      const state = await fetchKeepAwakeState();
      set({
        state,
        loading: false,
        loadedOnce: true,
      });
      return state;
    } catch (error) {
      console.warn("[keepAwakeStore] Failed to load keep awake state", error);
      set({ loading: false, loadedOnce: true });
      return get().state;
    }
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const state = await fetchKeepAwakeState();
      set({
        state,
        loading: false,
        loadedOnce: true,
      });
      return state;
    } catch (error) {
      console.warn("[keepAwakeStore] Failed to refresh keep awake state", error);
      set({ loading: false, loadedOnce: true });
      return get().state;
    }
  },

  toggle: async () => {
    const current = get().state ?? await get().load();
    if (!current) {
      return null;
    }

    if (!current.supported) {
      toast.warning(t("app:commandPalette.toasts.keepAwakeUnsupported"));
      return current;
    }

    const targetEnabled = !current.enabled || !current.active;
    set({ loading: true });
    try {
      const nextState = await ipc.setKeepAwakeEnabled(targetEnabled);
      set({
        state: nextState,
        loading: false,
        loadedOnce: true,
      });
      showKeepAwakeToast(nextState, targetEnabled);
      return nextState;
    } catch (error) {
      set({ loading: false });
      console.warn("[keepAwakeStore] Failed to toggle keep awake", error);
      toast.error(
        t(
          targetEnabled
            ? "app:commandPalette.toasts.keepAwakeEnableFailed"
            : "app:commandPalette.toasts.keepAwakeDisableFailed",
        ),
      );
      return get().state;
    }
  },
}));
