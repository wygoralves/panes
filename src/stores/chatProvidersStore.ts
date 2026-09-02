import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { ChatProviderInstance } from "../types";
import { useEngineStore } from "./engineStore";

interface ChatProvidersState {
  providers: ChatProviderInstance[];
  loading: boolean;
  loadedOnce: boolean;
  saving: boolean;
  error?: string;
  load: () => Promise<ChatProviderInstance[]>;
  save: (provider: ChatProviderInstance) => Promise<boolean>;
  remove: (providerId: string) => Promise<boolean>;
}

export const useChatProvidersStore = create<ChatProvidersState>((set) => ({
  providers: [],
  loading: false,
  loadedOnce: false,
  saving: false,

  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const providers = await ipc.listChatProviders();
      set({ providers, loading: false, loadedOnce: true });
      return providers;
    } catch (error) {
      set({ loading: false, loadedOnce: true, error: String(error) });
      return [];
    }
  },

  save: async (provider) => {
    set({ saving: true, error: undefined });
    try {
      const providers = await ipc.saveChatProvider(provider);
      set({ providers, saving: false });
      void useEngineStore.getState().load();
      return true;
    } catch (error) {
      set({ saving: false, error: String(error) });
      return false;
    }
  },

  remove: async (providerId) => {
    set({ saving: true, error: undefined });
    try {
      const providers = await ipc.removeChatProvider(providerId);
      set({ providers, saving: false });
      void useEngineStore.getState().load();
      return true;
    } catch (error) {
      set({ saving: false, error: String(error) });
      return false;
    }
  },
}));
