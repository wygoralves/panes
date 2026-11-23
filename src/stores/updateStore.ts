import { create } from "zustand";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  confirmDiscardUnsavedWork,
  hasDirtyTabsEditedSince,
  snapshotDirtyTabs,
} from "../lib/unsavedChangesGuard";

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
    let update: Awaited<ReturnType<typeof check>> = null;
    try {
      update = await check();
      if (!update) {
        set({
          status: "idle",
          downloadPhase: "idle",
          downloadedBytes: 0,
          totalBytes: null,
        });
        return;
      }
      await update.download((event) => {
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
      // Ask only now, so edits made during the download count too. On Windows
      // the installer exits the app inside install(), and relaunch() skips the
      // window close guard.
      if (!(await confirmDiscardUnsavedWork())) {
        // The downloaded installer stays in native memory until released.
        await update.close();
        set({ status: "available", downloadPhase: "idle", downloadedBytes: 0, totalBytes: null });
        return;
      }
      // Discard leaves the approved tabs dirty; remember their text so the
      // check below does not ask about them twice.
      const approvedTabs = snapshotDirtyTabs();
      await update.install();
      set({ status: "ready" });
      // The editor stays usable while install() runs; ask again only about
      // edits made meanwhile. On cancel the update applies at the next launch.
      if (hasDirtyTabsEditedSince(approvedTabs) && !(await confirmDiscardUnsavedWork())) {
        return;
      }
      await relaunch();
    } catch (err) {
      // A failed install leaves the downloaded installer in native memory.
      await update?.close().catch(() => undefined);
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
