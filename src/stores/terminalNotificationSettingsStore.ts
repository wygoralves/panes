import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { t } from "../i18n";
import { toast } from "./toastStore";
import type {
  TerminalNotificationIntegrationId,
  TerminalNotificationSettings,
} from "../types";

const NOTIFICATION_TOAST_KEYS = {
  chatEnabled: "app:notificationSettings.toasts.chatEnabled",
  chatDisabled: "app:notificationSettings.toasts.chatDisabled",
  chatEnableFailed: "app:notificationSettings.toasts.chatEnableFailed",
  chatDisableFailed: "app:notificationSettings.toasts.chatDisableFailed",
  terminalEnabled: "app:notificationSettings.toasts.terminalEnabled",
  terminalDisabled: "app:notificationSettings.toasts.terminalDisabled",
  terminalEnableFailed: "app:notificationSettings.toasts.terminalEnableFailed",
  terminalDisableFailed: "app:notificationSettings.toasts.terminalDisableFailed",
  allDisabled: "app:notificationSettings.toasts.allDisabled",
  disableAllFailed: "app:notificationSettings.toasts.disableAllFailed",
  installFailed: "app:notificationSettings.toasts.installFailed",
  installSuccess: "app:notificationSettings.toasts.installSuccess",
} as const;

interface TerminalNotificationSettingsStoreState {
  settings: TerminalNotificationSettings | null;
  loading: boolean;
  loadedOnce: boolean;
  modalOpen: boolean;
  updatingChatEnabled: boolean;
  updatingTerminalEnabled: boolean;
  installingIntegration: TerminalNotificationIntegrationId | null;
  load: () => Promise<TerminalNotificationSettings | null>;
  refresh: () => Promise<TerminalNotificationSettings | null>;
  openModal: () => void;
  closeModal: () => void;
  toggle: () => Promise<TerminalNotificationSettings | null>;
  setChatEnabled: (enabled: boolean) => Promise<TerminalNotificationSettings | null>;
  setTerminalEnabled: (enabled: boolean) => Promise<TerminalNotificationSettings | null>;
  disableAll: () => Promise<TerminalNotificationSettings | null>;
  setNotificationSound: (sound: string) => Promise<void>;
  previewSound: (sound: string) => Promise<void>;
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

function patchSettingsState(
  current: TerminalNotificationSettings | null,
  patch: Partial<TerminalNotificationSettings>,
): TerminalNotificationSettings | null {
  if (!current) {
    return null;
  }
  return {
    ...current,
    ...patch,
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
      const settings = await ipc.getAgentNotificationSettings();
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
    updatingChatEnabled: false,
    updatingTerminalEnabled: false,
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

      if (!current.chatEnabled && !current.terminalEnabled) {
        get().openModal();
        return current;
      }

      return get().disableAll();
    },

    setChatEnabled: async (enabled) => {
      const current = get().settings ?? await get().load();
      if (!current) {
        return null;
      }

      set({ updatingChatEnabled: true });
      try {
        await ipc.setChatNotificationsEnabled(enabled);
        const nextSettings = patchSettingsState(current, { chatEnabled: enabled });
        set({
          settings: nextSettings,
          updatingChatEnabled: false,
        });
        toast.success(
          t(
            enabled
              ? NOTIFICATION_TOAST_KEYS.chatEnabled
              : NOTIFICATION_TOAST_KEYS.chatDisabled,
          ),
        );
        return nextSettings;
      } catch (error) {
        console.warn("[terminalNotificationSettingsStore] Failed to update chat notification toggle", error);
        toast.error(
          t(
            enabled
              ? NOTIFICATION_TOAST_KEYS.chatEnableFailed
              : NOTIFICATION_TOAST_KEYS.chatDisableFailed,
          ),
        );
        set({ updatingChatEnabled: false });
        return current;
      }
    },

    setTerminalEnabled: async (enabled) => {
      const current = get().settings ?? await get().load();
      if (!current) {
        return null;
      }

      set({ updatingTerminalEnabled: true });
      try {
        await ipc.setTerminalNotificationsEnabled(enabled);
        const nextSettings = patchSettingsState(current, { terminalEnabled: enabled });
        set({
          settings: nextSettings,
          updatingTerminalEnabled: false,
        });
        toast.success(
          t(
            enabled
              ? NOTIFICATION_TOAST_KEYS.terminalEnabled
              : NOTIFICATION_TOAST_KEYS.terminalDisabled,
          ),
        );
        return nextSettings;
      } catch (error) {
        console.warn("[terminalNotificationSettingsStore] Failed to update terminal notification toggle", error);
        toast.error(
          t(
            enabled
              ? NOTIFICATION_TOAST_KEYS.terminalEnableFailed
              : NOTIFICATION_TOAST_KEYS.terminalDisableFailed,
          ),
        );
        set({ updatingTerminalEnabled: false });
        return current;
      }
    },

    disableAll: async () => {
      const current = get().settings ?? await get().load();
      if (!current) {
        return null;
      }

      if (!current.chatEnabled && !current.terminalEnabled) {
        return current;
      }

      set({
        updatingChatEnabled: current.chatEnabled,
        updatingTerminalEnabled: current.terminalEnabled,
      });

      try {
        if (current.chatEnabled) {
          await ipc.setChatNotificationsEnabled(false);
        }
        if (current.terminalEnabled) {
          await ipc.setTerminalNotificationsEnabled(false);
        }

        const nextSettings = patchSettingsState(current, {
          chatEnabled: false,
          terminalEnabled: false,
        });
        set({
          settings: nextSettings,
          updatingChatEnabled: false,
          updatingTerminalEnabled: false,
        });
        toast.success(t(NOTIFICATION_TOAST_KEYS.allDisabled));
        return nextSettings;
      } catch (error) {
        console.warn("[terminalNotificationSettingsStore] Failed to disable agent notifications", error);
        toast.error(t(NOTIFICATION_TOAST_KEYS.disableAllFailed));
        set({
          updatingChatEnabled: false,
          updatingTerminalEnabled: false,
        });
        void get().refresh();
        return current;
      }
    },

    setNotificationSound: async (sound) => {
      try {
        await ipc.setNotificationSound(sound);
        const current = get().settings;
        if (current) {
          set({
            settings: { ...current, notificationSound: sound === "none" ? null : sound },
          });
        }
      } catch (error) {
        console.warn("[terminalNotificationSettingsStore] Failed to set notification sound", error);
      }
    },

    previewSound: async (sound) => {
      try {
        await ipc.previewNotificationSound(sound);
      } catch (error) {
        console.warn("[terminalNotificationSettingsStore] Failed to preview sound", error);
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
          t(NOTIFICATION_TOAST_KEYS.installSuccess, {
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
          t(NOTIFICATION_TOAST_KEYS.installFailed, {
            integration: integrationLabel(integration),
          }),
        );
        set({ installingIntegration: null });
        return get().settings;
      }
    },
  }));
