import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { KeepAwakeState } from "../types";
import { t } from "../i18n";
import { toast } from "./toastStore";

const KEEP_AWAKE_TOAST_KEYS = {
  enabled: "app:commandPalette.toasts.keepAwakeEnabled",
  disabled: "app:commandPalette.toasts.keepAwakeDisabled",
  unsupported: "app:commandPalette.toasts.keepAwakeUnsupported",
  enableFailed: "app:commandPalette.toasts.keepAwakeEnableFailed",
  disableFailed: "app:commandPalette.toasts.keepAwakeDisableFailed",
} as const;

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
    toast.warning(t(KEEP_AWAKE_TOAST_KEYS.unsupported));
    return;
  }

  if (targetEnabled && (!nextState.enabled || !nextState.active)) {
    toast.error(t(KEEP_AWAKE_TOAST_KEYS.enableFailed));
    return;
  }

  if (!targetEnabled && (nextState.enabled || nextState.active)) {
    toast.error(t(KEEP_AWAKE_TOAST_KEYS.disableFailed));
    return;
  }

  toast.success(t(targetEnabled ? KEEP_AWAKE_TOAST_KEYS.enabled : KEEP_AWAKE_TOAST_KEYS.disabled));
}

async function fetchKeepAwakeState() {
  return ipc.getKeepAwakeState();
}

let pendingKeepAwakeState: Promise<KeepAwakeState | null> | null = null;

function requestKeepAwakeState(
  set: (partial: Partial<KeepAwakeStoreState>) => void,
  get: () => KeepAwakeStoreState,
) {
  if (pendingKeepAwakeState) {
    return pendingKeepAwakeState;
  }

  set({ loading: true });
  const request = (async () => {
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
  })();

  pendingKeepAwakeState = request;
  request.finally(() => {
    if (pendingKeepAwakeState === request) {
      pendingKeepAwakeState = null;
    }
  });
  return request;
}

export const useKeepAwakeStore = create<KeepAwakeStoreState>((set, get) => ({
  state: null,
  loading: false,
  loadedOnce: false,

  load: async () => requestKeepAwakeState(set, get),

  refresh: async () => requestKeepAwakeState(set, get),

  toggle: async () => {
    const current = get().state ?? await get().load();
    if (!current) {
      return null;
    }

    if (!current.supported && !current.enabled) {
      toast.warning(t(KEEP_AWAKE_TOAST_KEYS.unsupported));
      return current;
    }

    const targetEnabled = !current.enabled;
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
      toast.error(t(targetEnabled ? KEEP_AWAKE_TOAST_KEYS.enableFailed : KEEP_AWAKE_TOAST_KEYS.disableFailed));
      return get().state;
    }
  },
}));
