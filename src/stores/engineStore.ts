import { create } from "zustand";
import type { EngineHealth, EngineInfo } from "../types";
import { ipc } from "../lib/ipc";

interface EngineState {
  engines: EngineInfo[];
  health: Record<string, EngineHealth>;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
}

export const useEngineStore = create<EngineState>((set) => ({
  engines: [],
  health: {},
  loading: false,
  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const engines = await ipc.listEngines();
      const checks = await Promise.all(engines.map((engine) => ipc.engineHealth(engine.id)));
      const health = checks.reduce<Record<string, EngineHealth>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {});
      set({ engines, health, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  }
}));
