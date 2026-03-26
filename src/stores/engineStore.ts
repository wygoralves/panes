import { create } from "zustand";
import type { EngineHealth, EngineInfo, EngineRuntimeUpdatedEvent } from "../types";
import { ipc } from "../lib/ipc";

interface EngineState {
  engines: EngineInfo[];
  health: Record<string, EngineHealth>;
  healthLoading: Record<string, boolean>;
  loading: boolean;
  loadedOnce: boolean;
  error?: string;
  load: () => Promise<void>;
  ensureHealth: (
    engineId: string,
    options?: { force?: boolean },
  ) => Promise<EngineHealth | null>;
  mergeHealth: (reports: EngineHealth[]) => void;
  applyRuntimeUpdate: (event: EngineRuntimeUpdatedEvent) => void;
}

let pendingHealthRequests: Partial<Record<string, Promise<EngineHealth | null>>> = {};

export const useEngineStore = create<EngineState>((set, get) => ({
  engines: [],
  health: {},
  healthLoading: {},
  loading: false,
  loadedOnce: false,
  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const engines = await ipc.listEngines();
      set({
        engines,
        loading: false,
        loadedOnce: true,
        error: undefined,
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
  },
  ensureHealth: async (engineId, options) => {
    const existing = get().health[engineId];
    if (existing && !options?.force) {
      return existing;
    }

    if (pendingHealthRequests[engineId]) {
      return pendingHealthRequests[engineId];
    }

    set((state) => {
      if (
        state.healthLoading[engineId] ||
        (!options?.force && state.health[engineId])
      ) {
        return state;
      }

      return {
        healthLoading: {
          ...state.healthLoading,
          [engineId]: true,
        },
      };
    });

    const request = (async () => {
      try {
        const health = await ipc.engineHealth(engineId);
        set((state) => {
          const { [engineId]: _ignored, ...rest } = state.healthLoading;
          return {
            health: {
              ...state.health,
              [health.id]: health,
            },
            healthLoading: rest,
          };
        });
        return health;
      } catch (error) {
        const message = String(error);
        set((state) => {
          const { [engineId]: _ignored, ...rest } = state.healthLoading;
          return {
            healthLoading: rest,
            error: `${engineId}: ${message}`,
          };
        });
        return null;
      } finally {
        delete pendingHealthRequests[engineId];
      }
    })();

    pendingHealthRequests[engineId] = request;
    return request;
  },
  mergeHealth: (reports) =>
    set((state) => {
      if (reports.length === 0) {
        return state;
      }

      const nextHealth = { ...state.health };
      const nextHealthLoading = { ...state.healthLoading };
      for (const report of reports) {
        nextHealth[report.id] = report;
        delete nextHealthLoading[report.id];
      }

      return {
        health: nextHealth,
        healthLoading: nextHealthLoading,
      };
    }),
  applyRuntimeUpdate: ({ engineId, protocolDiagnostics }) =>
    set((state) => {
      const current = state.health[engineId];
      const nextHealth: EngineHealth = current
        ? {
            ...current,
            available: true,
            details: current.available ? current.details : undefined,
            protocolDiagnostics: protocolDiagnostics ?? current.protocolDiagnostics,
          }
        : {
            id: engineId,
            available: true,
            warnings: [],
            checks: [],
            fixes: [],
            protocolDiagnostics,
          };

      const { [engineId]: _ignored, ...rest } = state.healthLoading;

      return {
        health: {
          ...state.health,
          [engineId]: nextHealth,
        },
        healthLoading: rest,
      };
    }),
}));
