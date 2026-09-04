import type { ContextUsage } from "../types";

export type UsageLevel = "normal" | "warning" | "critical";

export function usageLevel(remainingPercent: number): UsageLevel {
  if (remainingPercent < 25) return "critical";
  if (remainingPercent < 50) return "warning";
  return "normal";
}

export function clampRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

export type UsageReset =
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "absolute"; date: Date };

/** Normalizes second or millisecond timestamps into a Date. */
export function usageResetDate(timestamp: number | null): Date | null {
  if (timestamp == null) return null;
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Describes when a window resets relative to `now`, falling back to a date past 24h. */
export function describeUsageReset(timestamp: number | null, now = Date.now()): UsageReset | null {
  const date = usageResetDate(timestamp);
  if (!date) return null;
  const totalMinutes = Math.max(0, Math.round((date.getTime() - now) / 60_000));
  if (totalMinutes < 60) return { kind: "minutes", minutes: Math.max(1, totalMinutes) };
  if (totalMinutes < 24 * 60) {
    return { kind: "hours", hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
  }
  return { kind: "absolute", date };
}

/**
 * Whether the composer should offer the usage trigger. Restored threads know their
 * plan windows on bind but only learn context usage once a turn runs this session,
 * so any known percent is enough to show it.
 */
export function shouldShowUsageTrigger(usage: ContextUsage | null): boolean {
  if (!usage) return false;
  return [
    usage.contextPercent,
    usage.windowFiveHourPercent,
    usage.windowWeeklyPercent,
    usage.windowFableWeeklyPercent,
    usage.windowOpusWeeklyPercent,
    usage.windowSonnetWeeklyPercent,
  ].some((percent) => typeof percent === "number" && Number.isFinite(percent));
}

/** Which window the ring is bound to, so callers can pick their own short label. */
export type UsageBindingSource = "context" | "fiveHour" | "weekly" | "family";

export interface UsageBinding {
  /** Share of the window still available, 0-100. */
  percentLeft: number;
  /** Display label of the window the ring is bound to. */
  label: string;
  source: UsageBindingSource;
}

export interface UsageBindingLabels {
  context: string;
  fiveHour: string;
  weekly: string;
}

/**
 * Every window whose budget is known, in the order the composer draws them:
 * context, 5-hour, weekly, then the selected family window. Labels come from the
 * caller so this stays free of i18n.
 */
export function usageWindowCandidates(
  usage: ContextUsage | null,
  familyWindow: { label: string; percent: number | null } | null,
  labels: UsageBindingLabels,
): UsageBinding[] {
  if (!usage) return [];

  const candidates: UsageBinding[] = [];
  const consider = (
    source: UsageBindingSource,
    label: string,
    remainingPercent: number | null,
  ) => {
    if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent)) return;
    candidates.push({
      label,
      source,
      percentLeft: Math.max(0, Math.min(100, Math.round(remainingPercent))),
    });
  };

  consider("context", labels.context, usage.contextPercent);
  consider("fiveHour", labels.fiveHour, usage.windowFiveHourPercent);
  consider("weekly", labels.weekly, usage.windowWeeklyPercent);
  if (familyWindow) consider("family", familyWindow.label, familyWindow.percent);

  return candidates;
}

/** The candidate with the least budget left; an earlier candidate wins a tie. */
export function tightestUsage(candidates: UsageBinding[]): UsageBinding | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((tightest, candidate) =>
    candidate.percentLeft < tightest.percentLeft ? candidate : tightest,
  );
}

/**
 * The window with the least budget left; the first of context, 5-hour, weekly,
 * family wins a tie. Null when nothing is known.
 */
export function bindingUsage(
  usage: ContextUsage | null,
  familyWindow: { label: string; percent: number | null } | null,
  labels: UsageBindingLabels,
): UsageBinding | null {
  return tightestUsage(usageWindowCandidates(usage, familyWindow, labels));
}
