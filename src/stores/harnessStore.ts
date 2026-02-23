import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { HarnessInfo } from "../types";

export type HarnessPhase = "idle" | "scanning" | "error";

interface HarnessStore {
  phase: HarnessPhase;
  harnesses: HarnessInfo[];
  npmAvailable: boolean;
  error: string | null;

  scan: () => Promise<void>;
  launch: (harnessId: string) => Promise<string | null>;
  getInstalledHarnesses: () => HarnessInfo[];
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  phase: "idle",
  harnesses: [],
  npmAvailable: false,
  error: null,

  scan: async () => {
    // Skip if already scanning
    if (get().phase === "scanning") return;
    set({ phase: "scanning", error: null });
    try {
      const report = await ipc.checkHarnesses();
      set({
        harnesses: report.harnesses,
        npmAvailable: report.npmAvailable,
        phase: "idle",
      });
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
