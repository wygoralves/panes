export type UsageStatusKey = "status.usageLoading" | "status.usageUnavailable";

/** The usage row only exists once a turn has run; before that the draft page
 * has nothing to report, so callers skip it entirely. */
export function resolveUsageStatusKey(loading: boolean): UsageStatusKey {
  return loading ? "status.usageLoading" : "status.usageUnavailable";
}
