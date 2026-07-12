import type { ChatEngineId } from "../types";

export type AutonomyPresetId = "inherit" | "read-only" | "ask" | "auto" | "full";

export interface AutonomyPolicySnapshot {
  approvalPolicy: string;
  sandboxMode: string;
  networkPolicy: string;
}

export interface AutonomyPresetPatch {
  approvalPolicy: string;
  sandboxMode?: "inherit" | "read-only" | "workspace-write" | "danger-full-access";
  networkPolicy?: "inherit" | "enabled" | "restricted";
}

export interface AutonomyPresetOptions {
  /**
   * Codex rejects read-only and workspace-write sandbox overrides while Panes
   * runs in external sandbox mode; presets then leave the sandbox on inherit
   * and steer through the approval policy alone.
   */
  codexExternalSandbox?: boolean;
}

export const AUTONOMY_PRESET_IDS: readonly AutonomyPresetId[] = [
  "inherit",
  "read-only",
  "ask",
  "auto",
  "full",
];

export function isAutonomyPresetId(value: unknown): value is AutonomyPresetId {
  return (
    value === "inherit" ||
    value === "read-only" ||
    value === "ask" ||
    value === "auto" ||
    value === "full"
  );
}

/**
 * OpenCode exposes approvals only, and its `allow` mode never asks, so a
 * separate "auto in workspace" rung would be indistinguishable from full
 * autonomy there.
 */
export function availableAutonomyPresets(engineId: ChatEngineId): AutonomyPresetId[] {
  if (engineId === "opencode") {
    return ["inherit", "read-only", "ask", "full"];
  }
  return [...AUTONOMY_PRESET_IDS];
}

export function autonomyPresetPatch(
  preset: AutonomyPresetId,
  engineId: ChatEngineId,
  options?: AutonomyPresetOptions,
): AutonomyPresetPatch {
  if (engineId === "opencode") {
    switch (preset) {
      case "read-only":
        return { approvalPolicy: "deny" };
      case "ask":
        return { approvalPolicy: "ask" };
      case "auto":
      case "full":
        return { approvalPolicy: "allow" };
      default:
        return { approvalPolicy: "inherit" };
    }
  }

  if (engineId === "claude") {
    switch (preset) {
      case "read-only":
        return { approvalPolicy: "restricted", sandboxMode: "read-only", networkPolicy: "restricted" };
      case "ask":
        return { approvalPolicy: "standard", sandboxMode: "workspace-write", networkPolicy: "restricted" };
      case "auto":
        // Network stays on inherit so this rung remains distinguishable from
        // full autonomy, which pins the network on.
        return { approvalPolicy: "trusted", sandboxMode: "workspace-write", networkPolicy: "inherit" };
      case "full":
        // Claude has no full-access sandbox in Panes; full autonomy keeps
        // workspace-write.
        return { approvalPolicy: "trusted", sandboxMode: "workspace-write", networkPolicy: "enabled" };
      default:
        return { approvalPolicy: "inherit", sandboxMode: "inherit", networkPolicy: "inherit" };
    }
  }

  const externalSandbox = options?.codexExternalSandbox === true;
  switch (preset) {
    case "read-only":
      return {
        approvalPolicy: "untrusted",
        sandboxMode: externalSandbox ? "inherit" : "read-only",
        networkPolicy: "restricted",
      };
    case "ask":
      return {
        approvalPolicy: "on-request",
        sandboxMode: externalSandbox ? "inherit" : "workspace-write",
        networkPolicy: "restricted",
      };
    case "auto":
      return {
        approvalPolicy: "on-failure",
        sandboxMode: externalSandbox ? "inherit" : "workspace-write",
        networkPolicy: "enabled",
      };
    case "full":
      return { approvalPolicy: "never", sandboxMode: "danger-full-access", networkPolicy: "enabled" };
    default:
      return { approvalPolicy: "inherit", sandboxMode: "inherit", networkPolicy: "inherit" };
  }
}

/**
 * Map the thread's current execution policy back onto a preset, or `null`
 * when the combination does not match any rung (a custom setup).
 */
export function detectAutonomyPreset(
  engineId: ChatEngineId,
  snapshot: AutonomyPolicySnapshot,
  options?: AutonomyPresetOptions,
): AutonomyPresetId | null {
  if (engineId === "opencode") {
    switch (snapshot.approvalPolicy) {
      case "inherit":
        return "inherit";
      case "deny":
        return "read-only";
      case "ask":
        return "ask";
      case "allow":
        return "full";
      default:
        return null;
    }
  }

  // Full access forces the network on for Codex, so the stored network value
  // is irrelevant on that rung.
  if (
    engineId === "codex" &&
    snapshot.approvalPolicy === "never" &&
    snapshot.sandboxMode === "danger-full-access"
  ) {
    return "full";
  }

  for (const preset of availableAutonomyPresets(engineId)) {
    if (engineId === "codex" && preset === "full") {
      continue;
    }
    const patch = autonomyPresetPatch(preset, engineId, options);
    if (
      patch.approvalPolicy === snapshot.approvalPolicy &&
      patch.sandboxMode === snapshot.sandboxMode &&
      patch.networkPolicy === snapshot.networkPolicy
    ) {
      return preset;
    }
  }

  return null;
}

/**
 * The `set_thread_execution_policy` request for a preset, or `null` for
 * `inherit`, which means "leave the thread on trust defaults".
 */
export function autonomyPresetExecutionPolicyRequest(
  preset: AutonomyPresetId,
  engineId: ChatEngineId,
  options?: AutonomyPresetOptions,
): {
  approvalPolicy?: unknown;
  sandboxMode?: string | null;
  allowNetwork?: boolean | null;
} | null {
  if (preset === "inherit") {
    return null;
  }

  const patch = autonomyPresetPatch(preset, engineId, options);
  if (engineId === "opencode") {
    return { approvalPolicy: patch.approvalPolicy };
  }

  return {
    approvalPolicy: patch.approvalPolicy,
    sandboxMode: patch.sandboxMode === "inherit" ? null : patch.sandboxMode ?? null,
    allowNetwork:
      patch.networkPolicy === "inherit" ? null : patch.networkPolicy === "enabled",
  };
}
