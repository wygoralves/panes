import type { EngineCapabilities } from "../../types";

const CODEX_CAPABILITIES: EngineCapabilities = {
  permissionModes: ["untrusted", "on-failure", "on-request", "never"],
  sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
  approvalDecisions: ["accept", "decline", "cancel", "accept_for_session"],
};

const CLAUDE_CAPABILITIES: EngineCapabilities = {
  permissionModes: ["restricted", "standard", "trusted"],
  sandboxModes: ["read-only", "workspace-write"],
  approvalDecisions: ["accept", "decline", "accept_for_session"],
};

const OPENCODE_CAPABILITIES: EngineCapabilities = {
  permissionModes: ["ask", "allow", "deny"],
  sandboxModes: [],
  approvalDecisions: ["accept", "decline", "cancel", "accept_for_session"],
};

const EMPTY_CAPABILITIES: EngineCapabilities = {
  permissionModes: [],
  sandboxModes: [],
  approvalDecisions: [],
};

function fallbackEngineCapabilities(engineId?: string | null): EngineCapabilities {
  switch (engineId) {
    case "codex":
      return CODEX_CAPABILITIES;
    case "claude":
      return CLAUDE_CAPABILITIES;
    case "opencode":
      return OPENCODE_CAPABILITIES;
    default:
      return EMPTY_CAPABILITIES;
  }
}

export function resolveEngineCapabilities(
  engineId?: string | null,
  capabilities?: EngineCapabilities | null,
): EngineCapabilities {
  const fallback = fallbackEngineCapabilities(engineId);
  return {
    permissionModes:
      Array.isArray(capabilities?.permissionModes) && capabilities.permissionModes.length > 0
        ? capabilities.permissionModes
        : fallback.permissionModes,
    sandboxModes:
      Array.isArray(capabilities?.sandboxModes) && capabilities.sandboxModes.length > 0
        ? capabilities.sandboxModes
        : fallback.sandboxModes,
    approvalDecisions:
      Array.isArray(capabilities?.approvalDecisions) &&
      capabilities.approvalDecisions.length > 0
        ? capabilities.approvalDecisions
        : fallback.approvalDecisions,
  };
}
