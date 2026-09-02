export type UsageLevel = "normal" | "warning" | "critical";

export function usageLevel(remainingPercent: number): UsageLevel {
  if (remainingPercent <= 10) return "critical";
  if (remainingPercent <= 25) return "warning";
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
