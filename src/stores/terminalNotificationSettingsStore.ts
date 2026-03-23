import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { t } from "../i18n";
import { toast } from "./toastStore";
import type {
  TerminalNotificationIntegrationId,
  TerminalNotificationSettings,
} from "../types";

const TERMINAL_NOTIFICATION_TOAST_KEYS = {
  enabled: "app:notificationSettings.toasts.enabled",
  disabled: "app:notificationSettings.toasts.disabled",
  enableFailed: "app:notificationSettings.toasts.enableFailed",
  disableFailed: "app:notificationSettings.toasts.disableFailed",
  installFailed: "app:notificationSettings.toasts.installFailed",
  installSuccess: "app:notificationSettings.toasts.installSuccess",
} as const;

interface TerminalNotificationSettingsStoreState {
  settings: TerminalNotificationSettings | null;
  loading: boolean;
  loadedOnce: boolean;
  modalOpen: boolean;
  updatingEnabled: boolean;
  installingIntegration: TerminalNotificationIntegrationId | null;
  load: () => Promise<TerminalNotificationSettings | null>;
  refresh: () => Promise<TerminalNotificationSettings | null>;
  openModal: () => void;
  closeModal: () => void;
  toggle: () => Promise<TerminalNotificationSettings | null>;
  setEnabled: (enabled: boolean) => Promise<TerminalNotificationSettings | null>;
  installIntegration: (
    integration: TerminalNotificationIntegrationId,
  ) => Promise<TerminalNotificationSettings | null>;
}

let pendingTerminalNotificationSettings:
  | Promise<TerminalNotificationSettings | null>
  | null = null;

function integrationLabel(integration: TerminalNotificationIntegrationId) {
  return t(`app:notificationSettings.integrations.${integration}.title`);
}

function updateSettingsState(
  current: TerminalNotificationSettings | null,
  enabled: boolean,
): TerminalNotificationSettings | null {
  if (!current) {
    return null;
  }
  return {
    ...current,
    enabled,
  };
}

function requestTerminalNotificationSettings(
  set: (partial: Partial<TerminalNotificationSettingsStoreState>) => void,
) {
  if (pendingTerminalNotificationSettings) {
    return pendingTerminalNotificationSettings;
  }

  set({ loading: true });
  const request = (async () => {
    try {
      const settings = await ipc.getTerminalNotificationSettings();
      set({
        settings,
        loading: false,
        loadedOnce: true,
      });
      return settings;
    } catch (error) {
      console.warn("[terminalNotificationSettingsStore] Failed to load notification settings", error);
      set({
        loading: false,
        loadedOnce: true,
      });
      return null;
    }
  })();

  pendingTerminalNotificationSettings = request;
  request.finally(() => {
    if (pendingTerminalNotificationSettings === request) {
      pendingTerminalNotificationSettings = null;
    }
  });
  return request;
}

export const useTerminalNotificationSettingsStore =
  create<TerminalNotificationSettingsStoreState>((set, get) => ({
    settings: null,
    loading: false,
    loadedOnce: false,
    modalOpen: false,
    updatingEnabled: false,
    installingIntegration: null,

    load: async () => requestTerminalNotificationSettings(set),

    refresh: async () => requestTerminalNotificationSettings(set),

    openModal: () => {
      if (!get().loadedOnce && !get().loading) {
        void get().load();
      }
      set({ modalOpen: true });
    },

    closeModal: () => set({ modalOpen: false }),

    toggle: async () => {
      const current = get().settings ?? await get().load();
      if (!current) {
        return null;
      }

      if (!current.enabled && !current.setupComplete) {
        get().openModal();
        return current;
      }

      return get().setEnabled(!current.enabled);
    },

    setEnabled: async (enabled: boolean) => {
      const current = get().settings ?? await get().load();
      if (!current) {
        return null;
      }

      set({ updatingEnabled: true });
      try {
        await ipc.setTerminalNotificationsEnabled(enabled);
        const nextSettings = updateSettingsState(current, enabled);
        set({
          settings: nextSettings,
          updatingEnabled: false,
        });
        toast.success(
          t(
            enabled
              ? TERMINAL_NOTIFICATION_TOAST_KEYS.enabled
              : TERMINAL_NOTIFICATION_TOAST_KEYS.disabled,
          ),
        );
        return nextSettings;
      } catch (error) {
        console.warn("[terminalNotificationSettingsStore] Failed to update notification toggle", error);
        toast.error(
          t(
            enabled
              ? TERMINAL_NOTIFICATION_TOAST_KEYS.enableFailed
              : TERMINAL_NOTIFICATION_TOAST_KEYS.disableFailed,
          ),
        );
        set({ updatingEnabled: false });
        return current;
      }
    },

    installIntegration: async (integration) => {
      set({ installingIntegration: integration });
      try {
        const nextSettings = await ipc.installTerminalNotificationIntegration(integration);
        set({
          settings: nextSettings,
          loadedOnce: true,
          installingIntegration: null,
        });
        toast.success(
          t(TERMINAL_NOTIFICATION_TOAST_KEYS.installSuccess, {
            integration: integrationLabel(integration),
          }),
        );
        return nextSettings;
      } catch (error) {
        console.warn(
          `[terminalNotificationSettingsStore] Failed to install ${integration} notification integration`,
          error,
        );
        toast.error(
          t(TERMINAL_NOTIFICATION_TOAST_KEYS.installFailed, {
            integration: integrationLabel(integration),
          }),
        );
        set({ installingIntegration: null });
        return get().settings;
      }
    },
  }));
