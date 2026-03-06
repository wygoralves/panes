import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIpc = vi.hoisted(() => ({
  listEngines: vi.fn(),
  engineHealth: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

import { useEngineStore } from "./engineStore";

describe("engineStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEngineStore.setState({
      engines: [],
      health: {},
      loading: false,
      loadedOnce: false,
      error: undefined,
    });
  });

  it("marks Codex available when a runtime update arrives", () => {
    useEngineStore.setState({
      health: {
        codex: {
          id: "codex",
          available: false,
          details: "Engine discovery failed: codex missing",
          warnings: [],
          checks: ["codex --version"],
          fixes: [],
        },
      },
    });

    useEngineStore.getState().applyRuntimeUpdate({
      engineId: "codex",
      protocolDiagnostics: {
        methodAvailability: [
          {
            method: "app/list",
            status: "available",
          },
        ],
        experimentalFeatures: [],
        collaborationModes: [],
        apps: [],
        fetchedAt: "2026-03-06T00:00:00Z",
        stale: false,
      },
    });

    const codex = useEngineStore.getState().health.codex;
    expect(codex?.available).toBe(true);
    expect(codex?.details).toBeUndefined();
    expect(codex?.protocolDiagnostics?.fetchedAt).toBe("2026-03-06T00:00:00Z");
  });
});
