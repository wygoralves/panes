export type UsageStatusKey =
  | "status.usageAwaitingFirstMessage"
  | "status.usageLoading"
  | "status.usageUnavailable";

export function resolveUsageStatusKey(
  hasUserMessage: boolean,
  loading: boolean,
): UsageStatusKey {
  if (!hasUserMessage) return "status.usageAwaitingFirstMessage";
  if (loading) return "status.usageLoading";
  return "status.usageUnavailable";
}
