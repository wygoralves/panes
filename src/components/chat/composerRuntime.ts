import type { ComposerRuntimeSnapshot } from "../../lib/newThreadRuntime";
import type { EngineModel } from "../../types";
import { resolveReasoningEffortForModel } from "./reasoningEffort";

export type ComposerServiceTierValue = "inherit" | "fast" | "flex";

interface BuildComposerRuntimeSnapshotInput {
  hasActiveThread: boolean;
  hasExplicitOverride: boolean;
  selectedEngineId: string;
  selectedModel: Pick<EngineModel, "id" | "defaultReasoningEffort" | "supportedReasoningEfforts"> | null;
  selectedEffort: string | null | undefined;
  selectedServiceTier: ComposerServiceTierValue;
}

function normalizeComposerServiceTier(
  value: ComposerServiceTierValue,
): ComposerRuntimeSnapshot["serviceTier"] {
  return value === "fast" || value === "flex" ? value : null;
}

export function buildComposerRuntimeSnapshot({
  hasActiveThread,
  hasExplicitOverride,
  selectedEngineId,
  selectedModel,
  selectedEffort,
  selectedServiceTier,
}: BuildComposerRuntimeSnapshotInput): ComposerRuntimeSnapshot | null {
  if (!selectedModel || (!hasActiveThread && !hasExplicitOverride)) {
    return null;
  }

  return {
    engineId: selectedEngineId,
    modelId: selectedModel.id,
    reasoningEffort: resolveReasoningEffortForModel(selectedModel, selectedEffort),
    serviceTier:
      selectedEngineId === "codex"
        ? normalizeComposerServiceTier(selectedServiceTier)
        : null,
  };
}
