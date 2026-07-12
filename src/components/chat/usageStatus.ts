export type UsageStatusKey =
  | "status.usageAwaitingFirstMessage"
  | "status.usageLoading"
  | "status.usageUnavailable";

export function resolveUsageStatusKey(
  hasUserMessage: boolean,
  streaming: boolean,
): UsageStatusKey {
  if (!hasUserMessage) return "status.usageAwaitingFirstMessage";
  if (streaming) return "status.usageLoading";
  return "status.usageUnavailable";
}
