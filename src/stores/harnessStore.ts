import { create } from "zustand";
import { ipc, listenInstallProgress } from "../lib/ipc";
import type { HarnessInfo } from "../types";

const INSTALLED_HARNESSES_KEY = "panes:installedHarnesses";

export type HarnessPhase = "idle" | "scanning" | "installing" | "error";

interface HarnessStore {
  phase: HarnessPhase;
  harnesses: HarnessInfo[];
  npmAvailable: boolean;
  installingId: string | null;
  installLog: { dep: string; line: string; stream: string }[];
  error: string | null;

  scan: () => Promise<void>;
  install: (harnessId: string) => Promise<boolean>;
  launch: (harnessId: string) => Promise<string | null>;
  getInstalledHarnesses: () => HarnessInfo[];
}

function saveInstalledIds(ids: string[]) {
  localStorage.setItem(INSTALLED_HARNESSES_KEY, JSON.stringify(ids));
}

function loadInstalledIds(): string[] {
  try {
    const raw = localStorage.getItem(INSTALLED_HARNESSES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  phase: "idle",
  harnesses: [],
  npmAvailable: false,
  installingId: null,
  installLog: [],
  error: null,

  scan: async () => {
    set({ phase: "scanning", error: null });
    try {
      const report = await ipc.checkHarnesses();
      // Sync localStorage with discovered installations
      const foundIds = report.harnesses
        .filter((h) => h.found)
        .map((h) => h.id);
      const prevIds = loadInstalledIds();
      const merged = [...new Set([...prevIds, ...foundIds])];
      saveInstalledIds(merged);

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

  install: async (harnessId: string) => {
    set({ installingId: harnessId, phase: "installing", installLog: [], error: null });

    const unlisten = await listenInstallProgress((event) => {
      if (event.dependency !== harnessId) return;
      set((state) => ({
        installLog: [
          ...state.installLog,
          { dep: event.dependency, line: event.line, stream: event.stream },
        ],
      }));
    });

    try {
      const result = await ipc.installHarness(harnessId);
      if (result.success) {
        // Update localStorage
        const ids = loadInstalledIds();
        if (!ids.includes(harnessId)) {
          saveInstalledIds([...ids, harnessId]);
        }
        // Re-scan to get updated versions
        await get().scan();
      } else {
        set({ phase: "error", error: result.message });
      }
      return result.success;
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      set({ installingId: null });
      unlisten();
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
