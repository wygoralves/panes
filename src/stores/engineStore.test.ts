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
      healthLoading: {},
      loading: false,
      loadedOnce: false,
      error: undefined,
    });
  });

  it("loads engines without eagerly probing health", async () => {
    mockIpc.listEngines.mockResolvedValue([
      {
        id: "codex",
        name: "Codex",
        models: [],
        capabilities: {
          permissionModes: [],
          sandboxModes: [],
          approvalDecisions: [],
        },
      },
    ]);

    await useEngineStore.getState().load();

    expect(mockIpc.listEngines).toHaveBeenCalledTimes(1);
    expect(mockIpc.engineHealth).not.toHaveBeenCalled();
    expect(useEngineStore.getState().engines).toHaveLength(1);
  });

  it("loads engine health on demand", async () => {
    mockIpc.engineHealth.mockResolvedValue({
      id: "codex",
      available: true,
      details: "ready",
      warnings: [],
      checks: [],
      fixes: [],
    });

    const health = await useEngineStore.getState().ensureHealth("codex");

    expect(mockIpc.engineHealth).toHaveBeenCalledWith("codex");
    expect(health?.available).toBe(true);
    expect(useEngineStore.getState().health.codex?.details).toBe("ready");
  });

  it("does not cache thrown health errors and allows retries", async () => {
    mockIpc.engineHealth
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        id: "codex",
        available: true,
        details: "ready",
        warnings: [],
        checks: [],
        fixes: [],
      });

    const first = await useEngineStore.getState().ensureHealth("codex");
    const second = await useEngineStore.getState().ensureHealth("codex");

    expect(first).toBeNull();
    expect(second?.available).toBe(true);
    expect(mockIpc.engineHealth).toHaveBeenCalledTimes(2);
    expect(useEngineStore.getState().health.codex?.details).toBe("ready");
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
        skills: [],
        pluginMarketplaces: [],
        mcpServers: [],
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
