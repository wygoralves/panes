import { create } from "zustand";
import { ipc, listenInstallProgress } from "../lib/ipc";
import type { DependencyReport } from "../types";

const SETUP_COMPLETED_KEY = "panes.setup.completed.v2";

export type SetupPhase = "scanning" | "plan" | "installing" | "complete" | "error";

interface SetupStore {
  open: boolean;
  phase: SetupPhase;
  report: DependencyReport | null;
  installLog: { dep: string; line: string; stream: string }[];
  installing: string | null;
  error: string | null;

  openSetup: () => void;
  closeSetup: () => void;
  scan: () => Promise<void>;
  install: (dep: string, method: string) => Promise<boolean>;
  installAll: () => Promise<void>;
  verify: () => Promise<void>;
  isCompleted: () => boolean;
}

export const useSetupStore = create<SetupStore>((set, get) => ({
  open: false,
  phase: "scanning",
  report: null,
  installLog: [],
  installing: null,
  error: null,

  openSetup: () => set({ open: true, phase: "scanning", error: null }),
  closeSetup: () => {
    set({ open: false });
  },

  isCompleted: () => {
    return localStorage.getItem(SETUP_COMPLETED_KEY) === "1";
  },

  scan: async () => {
    set({ phase: "scanning", error: null });
    try {
      const report = await ipc.checkDependencies();
      // node + codex are required; git is informational (some features degrade gracefully)
      const allGood = report.node.found && report.codex.found;

      set({
        report,
        phase: allGood ? "complete" : "plan",
      });

      if (allGood) {
        localStorage.setItem(SETUP_COMPLETED_KEY, "1");
      }
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  install: async (dep: string, method: string) => {
    set({ installing: dep, error: null });

    const unlisten = await listenInstallProgress((event) => {
      set((state) => ({
        installLog: [
          ...state.installLog,
          { dep: event.dependency, line: event.line, stream: event.stream },
        ],
      }));
    });

    try {
      const result = await ipc.installDependency(dep, method);
      return result.success;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ installing: null });
      unlisten();
    }
  },

  installAll: async () => {
    const { report, install } = get();
    if (!report) return;

    set({ phase: "installing", installLog: [], error: null });

    // Install node first if needed (codex depends on npm)
    if (!report.node.found && report.node.canAutoInstall && report.node.installMethod) {
      const ok = await install("node", report.node.installMethod);
      if (!ok) {
        set({ phase: "error", error: "Node.js installation failed" });
        return;
      }
    }

    // Then codex
    if (!report.codex.found && report.codex.canAutoInstall && report.codex.installMethod) {
      const ok = await install("codex", report.codex.installMethod);
      if (!ok) {
        set({ phase: "error", error: "Codex CLI installation failed" });
        return;
      }
    }

    // Re-scan to verify
    await get().verify();
  },

  verify: async () => {
    set({ phase: "scanning", error: null });
    try {
      const report = await ipc.checkDependencies();
      const allGood = report.node.found && report.codex.found;

      set({
        report,
        phase: allGood ? "complete" : "plan",
      });

      if (allGood) {
        localStorage.setItem(SETUP_COMPLETED_KEY, "1");
      }
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
