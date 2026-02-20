import { create } from "zustand";
import type { EngineHealth, EngineInfo } from "../types";
import { ipc } from "../lib/ipc";

interface EngineState {
  engines: EngineInfo[];
  health: Record<string, EngineHealth>;
  loading: boolean;
  loadedOnce: boolean;
  error?: string;
  load: () => Promise<void>;
}

export const useEngineStore = create<EngineState>((set) => ({
  engines: [],
  health: {},
  loading: false,
  loadedOnce: false,
  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const engines = await ipc.listEngines();
      const checkResults = await Promise.allSettled(
        engines.map((engine) => ipc.engineHealth(engine.id))
      );
      const health: Record<string, EngineHealth> = {};
      const healthErrors: string[] = [];

      checkResults.forEach((result, index) => {
        const engineId = engines[index]?.id ?? "unknown";
        if (result.status === "fulfilled") {
          health[result.value.id] = result.value;
          return;
        }

        const message = String(result.reason);
        health[engineId] = {
          id: engineId,
          available: false,
          details: `Failed to check ${engineId} health: ${message}`,
          warnings: [],
          checks: [],
          fixes: [],
        };
        healthErrors.push(`${engineId}: ${message}`);
      });

      set({
        engines,
        health,
        loading: false,
        loadedOnce: true,
        error: healthErrors.length > 0 ? healthErrors.join(" | ") : undefined,
      });
    } catch (error) {
      const message = String(error);
      set({
        loading: false,
        loadedOnce: true,
        error: message,
        health: {
          codex: {
            id: "codex",
            available: false,
            details: `Engine discovery failed: ${message}`,
            warnings: [],
            checks: ["codex --version", "command -v codex"],
            fixes: [],
          },
        },
      });
    }
  }
}));
