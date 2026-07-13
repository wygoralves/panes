import { describe, expect, it } from "vitest";
import {
  availableAutonomyPresets,
  autonomyPresetDescriptionKey,
  autonomyPresetExecutionPolicyRequest,
  autonomyPresetPatch,
  detectAutonomyPreset,
  isDefaultAutonomyPreset,
  resolveDefaultAutonomyPreset,
} from "./autonomyPresets";
import type { AutonomyPresetId } from "./autonomyPresets";
import type { ChatEngineId } from "../types";

describe("autonomyPresetPatch", () => {
  it("maps full autonomy per engine", () => {
    expect(autonomyPresetPatch("full", "codex")).toEqual({
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      networkPolicy: "enabled",
    });
    expect(autonomyPresetPatch("full", "claude")).toEqual({
      approvalPolicy: "trusted",
      sandboxMode: "workspace-write",
      networkPolicy: "enabled",
    });
    expect(autonomyPresetPatch("full", "opencode")).toEqual({
      approvalPolicy: "allow",
    });
  });

  it("never emits sandbox or network keys for opencode", () => {
    for (const preset of availableAutonomyPresets("opencode")) {
      const patch = autonomyPresetPatch(preset, "opencode");
      expect("sandboxMode" in patch).toBe(false);
      expect("networkPolicy" in patch).toBe(false);
    }
  });

  it("never requests a full-access sandbox for claude", () => {
    for (const preset of availableAutonomyPresets("claude")) {
      expect(autonomyPresetPatch(preset, "claude").sandboxMode).not.toBe(
        "danger-full-access",
      );
    }
  });
});

describe("detectAutonomyPreset", () => {
  it("round-trips every available preset for every engine", () => {
    const engines: ChatEngineId[] = ["codex", "claude", "opencode"];
    for (const engineId of engines) {
      for (const preset of availableAutonomyPresets(engineId)) {
        const patch = autonomyPresetPatch(preset, engineId);
        const snapshot = {
          approvalPolicy: patch.approvalPolicy,
          sandboxMode: patch.sandboxMode ?? "inherit",
          networkPolicy: patch.networkPolicy ?? "inherit",
        };
        const detected = detectAutonomyPreset(engineId, snapshot);
        if (engineId === "opencode" && preset === "auto") {
          expect(detected).toBe("full");
        } else {
          expect(detected).toBe(preset);
        }
      }
    }
  });

  it("detects codex full autonomy regardless of the stored network value", () => {
    expect(
      detectAutonomyPreset("codex", {
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
        networkPolicy: "inherit",
      }),
    ).toBe("full");
  });

  it("distinguishes claude auto from full by the network override", () => {
    expect(
      detectAutonomyPreset("claude", {
        approvalPolicy: "trusted",
        sandboxMode: "workspace-write",
        networkPolicy: "inherit",
      }),
    ).toBe("auto");
    expect(
      detectAutonomyPreset("claude", {
        approvalPolicy: "trusted",
        sandboxMode: "workspace-write",
        networkPolicy: "enabled",
      }),
    ).toBe("full");
  });

  it("returns null for combinations off the ladder", () => {
    expect(
      detectAutonomyPreset("codex", {
        approvalPolicy: "never",
        sandboxMode: "read-only",
        networkPolicy: "inherit",
      }),
    ).toBeNull();
    expect(
      detectAutonomyPreset("claude", {
        approvalPolicy: "standard",
        sandboxMode: "inherit",
        networkPolicy: "inherit",
      }),
    ).toBeNull();
  });
});

describe("codex external sandbox mode", () => {
  const options = { codexExternalSandbox: true };

  it("leaves the sandbox on inherit for the constrained rungs", () => {
    expect(autonomyPresetPatch("read-only", "codex", options).sandboxMode).toBe("inherit");
    expect(autonomyPresetPatch("ask", "codex", options).sandboxMode).toBe("inherit");
    expect(autonomyPresetPatch("auto", "codex", options).sandboxMode).toBe("inherit");
    expect(autonomyPresetPatch("full", "codex", options).sandboxMode).toBe(
      "danger-full-access",
    );
  });

  it("round-trips detection with the same flag", () => {
    for (const preset of availableAutonomyPresets("codex")) {
      const patch = autonomyPresetPatch(preset, "codex", options);
      expect(
        detectAutonomyPreset(
          "codex",
          {
            approvalPolicy: patch.approvalPolicy,
            sandboxMode: patch.sandboxMode ?? "inherit",
            networkPolicy: patch.networkPolicy ?? "inherit",
          },
          options,
        ),
      ).toBe(preset);
    }
  });

  it("never issues a request with a blocked sandbox override", () => {
    for (const preset of availableAutonomyPresets("codex")) {
      const request = autonomyPresetExecutionPolicyRequest(preset, "codex", options);
      if (request) {
        expect(request.sandboxMode).not.toBe("read-only");
        expect(request.sandboxMode).not.toBe("workspace-write");
      }
    }
  });

  it("does not change claude or opencode mappings", () => {
    expect(autonomyPresetPatch("ask", "claude", options)).toEqual(
      autonomyPresetPatch("ask", "claude"),
    );
    expect(autonomyPresetPatch("full", "opencode", options)).toEqual(
      autonomyPresetPatch("full", "opencode"),
    );
  });
});

describe("autonomyPresetExecutionPolicyRequest", () => {
  it("returns null for inherit", () => {
    expect(autonomyPresetExecutionPolicyRequest("inherit", "codex")).toBeNull();
  });

  it("builds engine-appropriate requests", () => {
    expect(autonomyPresetExecutionPolicyRequest("full", "codex")).toEqual({
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      allowNetwork: true,
    });
    expect(autonomyPresetExecutionPolicyRequest("auto", "claude")).toEqual({
      approvalPolicy: "trusted",
      sandboxMode: "workspace-write",
      allowNetwork: null,
    });
    expect(autonomyPresetExecutionPolicyRequest("read-only", "opencode")).toEqual({
      approvalPolicy: "deny",
    });
  });

  it("covers every non-inherit preset", () => {
    const engines: ChatEngineId[] = ["codex", "claude", "opencode"];
    for (const engineId of engines) {
      const presets = availableAutonomyPresets(engineId).filter(
        (preset): preset is Exclude<AutonomyPresetId, "inherit"> => preset !== "inherit",
      );
      for (const preset of presets) {
        expect(autonomyPresetExecutionPolicyRequest(preset, engineId)).not.toBeNull();
      }
    }
  });
});

describe("autonomy preset presentation", () => {
  it("uses engine-specific descriptions where the permission model differs", () => {
    expect(autonomyPresetDescriptionKey("read-only", "opencode")).toBe(
      "autonomy.engineDescriptions.opencode.read-only",
    );
    expect(autonomyPresetDescriptionKey("full", "claude")).toBe(
      "autonomy.engineDescriptions.claude.full",
    );
    expect(
      autonomyPresetDescriptionKey("auto", "codex", { codexExternalSandbox: true }),
    ).toBe("autonomy.engineDescriptions.codexExternal.auto");
  });

  it("keeps the standard Codex descriptions outside external sandbox mode", () => {
    expect(autonomyPresetDescriptionKey("ask", "codex")).toBe(
      "autonomy.presets.ask.description",
    );
  });

  it("treats an unset stored default as inherit", () => {
    expect(resolveDefaultAutonomyPreset(null)).toBe("inherit");
    expect(resolveDefaultAutonomyPreset(undefined)).toBe("inherit");
    expect(resolveDefaultAutonomyPreset("auto")).toBe("auto");
    expect(isDefaultAutonomyPreset("inherit", null)).toBe(true);
    expect(isDefaultAutonomyPreset("auto", null)).toBe(false);
    expect(isDefaultAutonomyPreset("auto", "auto")).toBe(true);
  });
});
