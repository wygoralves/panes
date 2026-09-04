import { engineKind } from "./engineKind";
import type { ChatEngineId } from "../types";

export type AutonomyPresetId = "inherit" | "read-only" | "ask" | "auto" | "full";

interface AutonomyPolicySnapshot {
  approvalPolicy: string;
  sandboxMode: string;
  networkPolicy: string;
}

interface AutonomyPresetPatch {
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
  return AUTONOMY_PRESET_IDS.includes(value as AutonomyPresetId);
}

export function resolveDefaultAutonomyPreset(
  preset: AutonomyPresetId | null | undefined,
): AutonomyPresetId {
  return preset ?? "inherit";
}

export function isDefaultAutonomyPreset(
  preset: AutonomyPresetId | null | undefined,
  storedDefault: AutonomyPresetId | null | undefined,
): boolean {
  return preset != null && resolveDefaultAutonomyPreset(storedDefault) === preset;
}

export function autonomyPresetDescriptionKey(
  preset: AutonomyPresetId,
  engineId: ChatEngineId,
  options?: AutonomyPresetOptions,
): string {
  if (engineKind(engineId) === "opencode") {
    return `autonomy.engineDescriptions.opencode.${preset}`;
  }
  if (engineKind(engineId) === "claude") {
    return `autonomy.engineDescriptions.claude.${preset}`;
  }
  if (
    options?.codexExternalSandbox === true &&
    (preset === "read-only" || preset === "ask" || preset === "auto")
  ) {
    return `autonomy.engineDescriptions.codexExternal.${preset}`;
  }
  return `autonomy.presets.${preset}.description`;
}

/**
 * OpenCode exposes approvals only, and its `allow` mode never asks, so a
 * separate "auto in workspace" rung would be indistinguishable from full
 * autonomy there.
 */
export function availableAutonomyPresets(engineId: ChatEngineId): AutonomyPresetId[] {
  if (engineKind(engineId) === "opencode") {
    return ["inherit", "read-only", "ask", "full"];
  }
  return [...AUTONOMY_PRESET_IDS];
}

/**
 * The rungs the picker offers: ask, approve for me, full access. OpenCode has
 * no sandboxed middle rung. A thread already sitting on a rung outside this
 * list (repo default, read only) keeps it visible at the top so the current
 * state is never hidden.
 */
export function visibleAutonomyPresets(
  engineId: ChatEngineId,
  current?: AutonomyPresetId | null,
): AutonomyPresetId[] {
  const rungs: AutonomyPresetId[] =
    engineKind(engineId) === "opencode" ? ["ask", "full"] : ["ask", "auto", "full"];
  if (current && !rungs.includes(current) && availableAutonomyPresets(engineId).includes(current)) {
    return [current, ...rungs];
  }
  return rungs;
}

/**
 * Clamp a preset onto the ladder the engine actually exposes. A rung an
 * engine does not implement must step *down* to the closest rung it does,
 * never sideways onto a more permissive one: OpenCode has no sandboxed
 * "auto" rung, so mapping "auto" to its `allow` mode would hand an
 * unsandboxed thread full autonomy it was never asked for.
 */
export function resolveAutonomyPresetForEngine(
  preset: AutonomyPresetId,
  engineId: ChatEngineId,
): AutonomyPresetId {
  const available = availableAutonomyPresets(engineId);
  if (available.includes(preset)) {
    return preset;
  }

  for (let index = AUTONOMY_PRESET_IDS.indexOf(preset) - 1; index > 0; index -= 1) {
    const candidate = AUTONOMY_PRESET_IDS[index];
    if (available.includes(candidate)) {
      return candidate;
    }
  }

  return "inherit";
}

/**
 * The rung "allow all and stop asking" switches a thread to. It grants
 * autonomy inside the workspace sandbox and never escalates to full disk
 * and network access, so engines without that rung step down instead.
 */
export function stopAskingAutonomyPreset(engineId: ChatEngineId): AutonomyPresetId {
  return resolveAutonomyPresetForEngine("auto", engineId);
}

export function autonomyPresetPatch(
  requestedPreset: AutonomyPresetId,
  engineId: ChatEngineId,
  options?: AutonomyPresetOptions,
): AutonomyPresetPatch {
  const preset = resolveAutonomyPresetForEngine(requestedPreset, engineId);

  if (engineKind(engineId) === "opencode") {
    switch (preset) {
      case "read-only":
        return { approvalPolicy: "deny" };
      case "ask":
        return { approvalPolicy: "ask" };
      case "full":
        return { approvalPolicy: "allow" };
      default:
        return { approvalPolicy: "inherit" };
    }
  }

  if (engineKind(engineId) === "claude") {
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
        return { approvalPolicy: "trusted", sandboxMode: "danger-full-access", networkPolicy: "enabled" };
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
  if (engineKind(engineId) === "opencode") {
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
    engineKind(engineId) === "codex" &&
    snapshot.approvalPolicy === "never" &&
    snapshot.sandboxMode === "danger-full-access"
  ) {
    return "full";
  }

  for (const preset of availableAutonomyPresets(engineId)) {
    if (engineKind(engineId) === "codex" && preset === "full") {
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
  requestedPreset: AutonomyPresetId,
  engineId: ChatEngineId,
  options?: AutonomyPresetOptions,
): {
  approvalPolicy?: unknown;
  sandboxMode?: string | null;
  allowNetwork?: boolean | null;
} | null {
  const preset = resolveAutonomyPresetForEngine(requestedPreset, engineId);
  if (preset === "inherit") {
    return null;
  }

  const patch = autonomyPresetPatch(preset, engineId, options);
  if (engineKind(engineId) === "opencode") {
    return { approvalPolicy: patch.approvalPolicy };
  }

  return {
    approvalPolicy: patch.approvalPolicy,
    sandboxMode: patch.sandboxMode === "inherit" ? null : patch.sandboxMode ?? null,
    allowNetwork:
      patch.networkPolicy === "inherit" ? null : patch.networkPolicy === "enabled",
  };
}
