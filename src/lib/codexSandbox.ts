import type { EngineHealth } from "../types";

export function isCodexExternalSandboxWarning(message?: string): boolean {
  if (typeof message !== "string") {
    return false;
  }

  const normalized = message.toLowerCase();
  return normalized.includes("external sandbox mode");
}

export function codexUsesExternalSandbox(health: Record<string, EngineHealth>): boolean {
  const codexHealth = health.codex;
  if (!codexHealth?.available) {
    return false;
  }

  return (codexHealth.warnings ?? []).some((warning) =>
    isCodexExternalSandboxWarning(warning),
  );
}
