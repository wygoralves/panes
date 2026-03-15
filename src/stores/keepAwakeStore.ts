import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { KeepAwakeState, PowerSettings, PowerSettingsInput } from "../types";
import { t } from "../i18n";
import { toast } from "./toastStore";

const KEEP_AWAKE_TOAST_KEYS = {
  enabled: "app:commandPalette.toasts.keepAwakeEnabled",
  enabledLimited: "app:commandPalette.toasts.keepAwakeEnabledLimited",
  disabled: "app:commandPalette.toasts.keepAwakeDisabled",
  unsupported: "app:commandPalette.toasts.keepAwakeUnsupported",
  enableFailed: "app:commandPalette.toasts.keepAwakeEnableFailed",
  disableFailed: "app:commandPalette.toasts.keepAwakeDisableFailed",
  settingsSaved: "app:commandPalette.toasts.powerSettingsSaved",
  settingsSaveFailed: "app:commandPalette.toasts.powerSettingsSaveFailed",
} as const;

interface KeepAwakeStoreState {
  state: KeepAwakeState | null;
  loading: boolean;
  loadedOnce: boolean;
  load: () => Promise<KeepAwakeState | null>;
  refresh: () => Promise<KeepAwakeState | null>;
  toggle: () => Promise<KeepAwakeState | null>;
  powerSettings: PowerSettings | null;
  powerSettingsOpen: boolean;
  loadPowerSettings: () => Promise<PowerSettings | null>;
  savePowerSettings: (input: PowerSettingsInput) => Promise<KeepAwakeState | null>;
  openPowerSettings: () => void;
  closePowerSettings: () => void;
}

export function canToggleKeepAwake(state: KeepAwakeState | null | undefined) {
  return state?.supported !== false || state?.enabled === true;
}

function hasClosedDisplayLimitation(state: KeepAwakeState) {
  return state.supportsClosedDisplay === false && state.closedDisplayActive === false;
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

  if (targetEnabled && hasClosedDisplayLimitation(nextState)) {
    toast.warning(t(KEEP_AWAKE_TOAST_KEYS.enabledLimited));
    return;
  }

  toast.success(t(targetEnabled ? KEEP_AWAKE_TOAST_KEYS.enabled : KEEP_AWAKE_TOAST_KEYS.disabled));
}

async function fetchKeepAwakeState() {
  return ipc.getKeepAwakeState();
}

let pendingKeepAwakeState: Promise<KeepAwakeState | null> | null = null;
let keepAwakeRequestId = 0;
let keepAwakeLastAppliedRequestId = 0;
let keepAwakePendingRequests = 0;

function beginKeepAwakeRequest(set: (partial: Partial<KeepAwakeStoreState>) => void) {
  keepAwakePendingRequests += 1;
  set({ loading: true });
  keepAwakeRequestId += 1;
  return keepAwakeRequestId;
}

function finishKeepAwakeRequest(set: (partial: Partial<KeepAwakeStoreState>) => void) {
  keepAwakePendingRequests = Math.max(0, keepAwakePendingRequests - 1);
  set({ loading: keepAwakePendingRequests > 0 });
}

function applyKeepAwakeState(
  requestId: number,
  set: (partial: Partial<KeepAwakeStoreState>) => void,
  state: KeepAwakeState,
) {
  if (requestId < keepAwakeLastAppliedRequestId) {
    return false;
  }

  keepAwakeLastAppliedRequestId = requestId;
  set({
    state,
    loadedOnce: true,
  });
  return true;
}

function requestKeepAwakeState(
  set: (partial: Partial<KeepAwakeStoreState>) => void,
  get: () => KeepAwakeStoreState,
) {
  if (pendingKeepAwakeState) {
    return pendingKeepAwakeState;
  }

  const requestId = beginKeepAwakeRequest(set);
  const request = (async () => {
    try {
      const state = await fetchKeepAwakeState();
      applyKeepAwakeState(requestId, set, state);
      return state;
    } catch (error) {
      console.warn("[keepAwakeStore] Failed to load keep awake state", error);
      set({ loadedOnce: true });
      return get().state;
    } finally {
      finishKeepAwakeRequest(set);
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
  powerSettings: null,
  powerSettingsOpen: false,

  load: async () => requestKeepAwakeState(set, get),

  refresh: async () => requestKeepAwakeState(set, get),

  toggle: async () => {
    const current = get().state ?? await get().load();
    if (!current) {
      return null;
    }

    if (!canToggleKeepAwake(current)) {
      toast.warning(t(KEEP_AWAKE_TOAST_KEYS.unsupported));
      return current;
    }

    const targetEnabled = !current.enabled;
    const requestId = beginKeepAwakeRequest(set);
    try {
      const nextState = await ipc.setKeepAwakeEnabled(targetEnabled);
      applyKeepAwakeState(requestId, set, nextState);
      showKeepAwakeToast(nextState, targetEnabled);
      return nextState;
    } catch (error) {
      console.warn("[keepAwakeStore] Failed to toggle keep awake", error);
      toast.error(t(targetEnabled ? KEEP_AWAKE_TOAST_KEYS.enableFailed : KEEP_AWAKE_TOAST_KEYS.disableFailed));
      return get().state;
    } finally {
      finishKeepAwakeRequest(set);
    }
  },

  loadPowerSettings: async () => {
    try {
      const settings = await ipc.getPowerSettings();
      set({ powerSettings: settings });
      return settings;
    } catch (error) {
      console.warn("[keepAwakeStore] Failed to load power settings", error);
      return null;
    }
  },

  savePowerSettings: async (input: PowerSettingsInput) => {
    const requestId = beginKeepAwakeRequest(set);
    try {
      const nextState = await ipc.setPowerSettings(input);
      applyKeepAwakeState(requestId, set, nextState);
      set({ powerSettings: { ...input } });
      toast.success(t(KEEP_AWAKE_TOAST_KEYS.settingsSaved));
      return nextState;
    } catch (error) {
      console.warn("[keepAwakeStore] Failed to save power settings", error);
      toast.error(t(KEEP_AWAKE_TOAST_KEYS.settingsSaveFailed));
      return null;
    } finally {
      finishKeepAwakeRequest(set);
    }
  },

  openPowerSettings: () => set({ powerSettingsOpen: true }),
  closePowerSettings: () => set({ powerSettingsOpen: false }),
}));
