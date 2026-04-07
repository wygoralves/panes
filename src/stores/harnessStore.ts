import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { HarnessInfo } from "../types";

export type HarnessPhase = "idle" | "scanning" | "error";

interface HarnessStore {
  phase: HarnessPhase;
  harnesses: HarnessInfo[];
  npmAvailable: boolean;
  error: string | null;
  loadedOnce: boolean;

  scan: () => Promise<void>;
  ensureScanned: () => Promise<void>;
  launch: (harnessId: string) => Promise<string | null>;
  getInstalledHarnesses: () => HarnessInfo[];
}

let pendingHarnessScan: Promise<void> | null = null;

function requestHarnessScan(
  set: (partial: Partial<HarnessStore>) => void,
  get: () => HarnessStore,
) {
  if (pendingHarnessScan) {
    return pendingHarnessScan;
  }

  if (get().phase === "scanning") {
    return Promise.resolve();
  }

  set({ phase: "scanning", error: null });
  const request = (async () => {
    try {
      const report = await ipc.checkHarnesses();
      set({
        harnesses: report.harnesses,
        npmAvailable: report.npmAvailable,
        phase: "idle",
        error: null,
        loadedOnce: true,
      });
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        loadedOnce: true,
      });
    } finally {
      pendingHarnessScan = null;
    }
  })();

  pendingHarnessScan = request;
  return request;
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  phase: "idle",
  harnesses: [],
  npmAvailable: false,
  error: null,
  loadedOnce: false,

  scan: async () => requestHarnessScan(set, get),

  ensureScanned: async () => {
    if (get().loadedOnce) {
      return;
    }
    await requestHarnessScan(set, get);
  },

  launch: async (harnessId: string) => {
    try {
      return await ipc.launchHarness(harnessId);
    } catch {
      return null;
    }
  },

  getInstalledHarnesses: () => {
    const { harnesses } = get();
    return harnesses.filter((h) => h.found);
  },
}));
