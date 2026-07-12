import { create } from "zustand";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";
type DownloadPhase = "idle" | "downloading" | "installing";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  lastCheckedAt: number | null;
  downloadPhase: DownloadPhase;
  downloadedBytes: number;
  totalBytes: number | null;
  /** True after user clicks "Not now" — hides dot until next app launch */
  snoozed: boolean;

  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  resetToIdle: () => void;
  snooze: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  error: null,
  lastCheckedAt: null,
  downloadPhase: "idle",
  downloadedBytes: 0,
  totalBytes: null,
  snoozed: false,

  checkForUpdate: async () => {
    if (get().status === "checking") return;
    set({
      status: "checking",
      error: null,
      downloadPhase: "idle",
      downloadedBytes: 0,
      totalBytes: null,
    });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version, lastCheckedAt: Date.now() });
      } else {
        set({ status: "idle", version: null, lastCheckedAt: Date.now() });
      }
    } catch {
      // Silent on network errors — no degradation if endpoint is unreachable
      set({ status: "idle" });
    }
  },

  downloadAndInstall: async () => {
    set({
      status: "downloading",
      error: null,
      downloadPhase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
    });
    try {
      const update = await check();
      if (!update) {
        set({
          status: "idle",
          downloadPhase: "idle",
          downloadedBytes: 0,
          totalBytes: null,
        });
        return;
      }
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          set({
            downloadPhase: "downloading",
            downloadedBytes: 0,
            totalBytes: event.data.contentLength ?? null,
          });
          return;
        }
        if (event.event === "Progress") {
          set((state) => ({
            downloadedBytes: state.downloadedBytes + event.data.chunkLength,
          }));
          return;
        }
        set((state) => ({
          downloadPhase: "installing",
          downloadedBytes: state.totalBytes ?? state.downloadedBytes,
        }));
      });
      set({ status: "ready" });
      await relaunch();
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : "Update failed",
        downloadPhase: "idle",
      });
    }
  },

  resetToIdle: () => {
    set({
      status: "idle",
      error: null,
      downloadPhase: "idle",
      downloadedBytes: 0,
      totalBytes: null,
    });
  },

  snooze: () => {
    set({ snoozed: true });
  },
}));
