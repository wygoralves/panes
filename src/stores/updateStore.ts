import { create } from "zustand";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  dismissed: boolean;

  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  error: null,
  dismissed: false,

  checkForUpdate: async () => {
    if (get().status === "checking") return;
    set({ status: "checking", error: null, dismissed: false });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version });
      } else {
        set({ status: "idle" });
      }
    } catch {
      // Silent on network errors — no degradation if endpoint is unreachable
      set({ status: "idle" });
    }
  },

  downloadAndInstall: async () => {
    set({ status: "downloading", error: null });
    try {
      const update = await check();
      if (!update) {
        set({ status: "idle" });
        return;
      }
      await update.downloadAndInstall();
      set({ status: "ready" });
      await relaunch();
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : "Update failed",
      });
    }
  },

  dismiss: () => {
    set({ dismissed: true });
  },
}));
