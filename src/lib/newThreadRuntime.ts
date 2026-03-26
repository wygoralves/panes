import type { EngineInfo, Thread } from "../types";
import type { OnboardingPreferredChatSelection } from "./onboarding";

export type NewThreadServiceTier = "fast" | "flex";

export interface NewThreadRuntimeSelection {
  engineId: string;
  modelId: string;
  reasoningEffort: string | null;
  serviceTier: NewThreadServiceTier | null;
}

export type ComposerRuntimeSnapshot = NewThreadRuntimeSelection;

export const NEW_THREAD_FALLBACK_RUNTIME: NewThreadRuntimeSelection = {
  engineId: "codex",
  modelId: "gpt-5.4",
  reasoningEffort: "high",
  serviceTier: null,
};

interface ResolveNewThreadRuntimeInput {
  engines: ReadonlyArray<EngineInfo>;
  composerRuntime?: ComposerRuntimeSnapshot | null;
  activeThread?: Thread | null;
  onboardingSelection?: OnboardingPreferredChatSelection | null;
}

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeServiceTier(
  value: string | null | undefined,
): NewThreadServiceTier | null {
  return value === "fast" || value === "flex" ? value : null;
}

function runtimeFromThread(thread: Thread): NewThreadRuntimeSelection {
  const lastModelId = normalizeString(
    typeof thread.engineMetadata?.lastModelId === "string"
      ? thread.engineMetadata.lastModelId
      : null,
  );
  const reasoningEffort = normalizeString(
    typeof thread.engineMetadata?.reasoningEffort === "string"
      ? thread.engineMetadata.reasoningEffort
      : null,
  );
  const serviceTier =
    thread.engineId === "codex"
      ? normalizeServiceTier(
          typeof thread.engineMetadata?.serviceTier === "string"
            ? thread.engineMetadata.serviceTier
            : null,
        )
      : null;

  return {
    engineId: thread.engineId,
    modelId: lastModelId ?? thread.modelId,
    reasoningEffort,
    serviceTier,
  };
}

function resolveRuntimeCandidate(
  engines: ReadonlyArray<EngineInfo>,
  candidate: NewThreadRuntimeSelection | null | undefined,
): NewThreadRuntimeSelection | null {
  if (!candidate) {
    return null;
  }

  const engineId = normalizeString(candidate.engineId);
  const modelId = normalizeString(candidate.modelId);
  if (!engineId || !modelId) {
    return null;
  }

  const engine = engines.find((item) => item.id === engineId);
  if (!engine) {
    return {
      engineId,
      modelId,
      reasoningEffort: normalizeString(candidate.reasoningEffort),
      serviceTier: engineId === "codex" ? normalizeServiceTier(candidate.serviceTier) : null,
    };
  }

  const model = engine.models.find((item) => item.id === modelId);
  if (!model) {
    return null;
  }

  const reasoningEffort = normalizeString(candidate.reasoningEffort);
  const supportedEffort =
    reasoningEffort &&
    model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === reasoningEffort,
    )
      ? reasoningEffort
      : null;

  return {
    engineId: engine.id,
    modelId: model.id,
    reasoningEffort: supportedEffort,
    serviceTier: engine.id === "codex" ? normalizeServiceTier(candidate.serviceTier) : null,
  };
}

export function resolveNewThreadRuntime({
  engines,
  composerRuntime,
  activeThread,
  onboardingSelection,
}: ResolveNewThreadRuntimeInput): NewThreadRuntimeSelection {
  const candidates: Array<NewThreadRuntimeSelection | null> = [
    composerRuntime ?? null,
    activeThread ? runtimeFromThread(activeThread) : null,
    onboardingSelection
      ? {
          engineId: onboardingSelection.engineId,
          modelId: onboardingSelection.modelId,
          reasoningEffort: null,
          serviceTier: null,
        }
      : null,
    NEW_THREAD_FALLBACK_RUNTIME,
  ];

  for (const candidate of candidates) {
    const resolved = resolveRuntimeCandidate(engines, candidate);
    if (resolved) {
      return resolved;
    }
  }

  return { ...NEW_THREAD_FALLBACK_RUNTIME };
}
