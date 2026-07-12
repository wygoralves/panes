import { describe, expect, it } from "vitest";
import {
  availableAutonomyPresets,
  autonomyPresetExecutionPolicyRequest,
  autonomyPresetPatch,
  detectAutonomyPreset,
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
