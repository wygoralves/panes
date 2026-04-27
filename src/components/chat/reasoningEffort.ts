import type { EngineModel } from "../../types";

function normalizeReasoningEffort(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolveReasoningEffortForModel(
  model: Pick<EngineModel, "defaultReasoningEffort" | "supportedReasoningEfforts"> | null | undefined,
  preferredEffort: string | null | undefined,
): string | null {
  const normalizedPreferred = normalizeReasoningEffort(preferredEffort);
  if (!model) {
    return normalizedPreferred;
  }

  if (model.supportedReasoningEfforts.length === 0) {
    return null;
  }

  if (
    normalizedPreferred &&
    model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === normalizedPreferred,
    )
  ) {
    return normalizedPreferred;
  }

  const normalizedDefault = normalizeReasoningEffort(model.defaultReasoningEffort);
  if (
    normalizedDefault &&
    model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === normalizedDefault,
    )
  ) {
    return normalizedDefault;
  }

  const firstSupported = model.supportedReasoningEfforts.find((option) =>
    normalizeReasoningEffort(option.reasoningEffort),
  );
  if (firstSupported) {
    return firstSupported.reasoningEffort;
  }

  return normalizedDefault;
}
