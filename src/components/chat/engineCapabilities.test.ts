import { describe, expect, it } from "vitest";

import { resolveEngineCapabilities } from "./engineCapabilities";

describe("resolveEngineCapabilities", () => {
  it("falls back to Claude defaults when capabilities are unavailable", () => {
    expect(resolveEngineCapabilities("claude", null)).toEqual({
      permissionModes: ["restricted", "standard", "trusted"],
      sandboxModes: ["read-only", "workspace-write"],
      approvalDecisions: ["accept", "decline", "accept_for_session"],
    });
  });

  it("falls back to Codex defaults when capabilities are unavailable", () => {
    expect(resolveEngineCapabilities("codex", undefined)).toEqual({
      permissionModes: ["untrusted", "on-failure", "on-request", "never"],
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
      approvalDecisions: ["accept", "decline", "cancel", "accept_for_session"],
    });
  });

  it("fills missing capability arrays from the engine fallback", () => {
    expect(
      resolveEngineCapabilities("claude", {
        permissionModes: [],
        sandboxModes: ["read-only"],
        approvalDecisions: [],
      }),
    ).toEqual({
      permissionModes: ["restricted", "standard", "trusted"],
      sandboxModes: ["read-only"],
      approvalDecisions: ["accept", "decline", "accept_for_session"],
    });
  });
});
