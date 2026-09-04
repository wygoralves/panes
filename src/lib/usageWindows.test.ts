import { describe, expect, it } from "vitest";
import {
  bindingUsage,
  clampRemainingPercent,
  describeUsageReset,
  shouldShowUsageTrigger,
  tightestUsage,
  usageLevel,
  usageWindowCandidates,
} from "./usageWindows";
import type { ContextUsage } from "../types";

const emptyUsage: ContextUsage = {
  currentTokens: null,
  maxContextTokens: null,
  contextPercent: null,
  windowFiveHourPercent: null,
  windowWeeklyPercent: null,
  windowFableWeeklyPercent: null,
  windowOpusWeeklyPercent: null,
  windowSonnetWeeklyPercent: null,
  windowFiveHourResetsAt: null,
  windowWeeklyResetsAt: null,
  windowFableWeeklyResetsAt: null,
  windowOpusWeeklyResetsAt: null,
  windowSonnetWeeklyResetsAt: null,
};

const bindingLabels = {
  context: "Context window",
  fiveHour: "5-hour limit",
  weekly: "Weekly · all models",
};

describe("usage windows", () => {
  it("maps the percent left to a level", () => {
    expect(usageLevel(80)).toBe("normal");
    expect(usageLevel(50)).toBe("normal");
    expect(usageLevel(49)).toBe("warning");
    expect(usageLevel(25)).toBe("warning");
    expect(usageLevel(24)).toBe("critical");
    expect(usageLevel(0)).toBe("critical");
    expect(clampRemainingPercent(37.6)).toBe(62);
    expect(clampRemainingPercent(140)).toBe(0);
  });

  it("describes resets relative to now", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(describeUsageReset(null, now)).toBeNull();
    expect(describeUsageReset(now + 10 * 60_000, now)).toEqual({ kind: "minutes", minutes: 10 });
    expect(describeUsageReset(now - 60_000, now)).toEqual({ kind: "minutes", minutes: 1 });
    expect(describeUsageReset(now + (2 * 60 + 14) * 60_000, now)).toEqual({ kind: "hours", hours: 2, minutes: 14 });
    expect(describeUsageReset(Math.floor(now / 1000) + 3 * 86_400, now)).toMatchObject({ kind: "absolute" });
  });

  it("shows the usage trigger whenever any percent is known", () => {
    expect(shouldShowUsageTrigger(null)).toBe(false);
    expect(shouldShowUsageTrigger(emptyUsage)).toBe(false);
    expect(shouldShowUsageTrigger({ ...emptyUsage, contextPercent: 23 })).toBe(true);
    // A restored thread knows its plan windows on bind but not its context usage.
    expect(
      shouldShowUsageTrigger({
        ...emptyUsage,
        windowFiveHourPercent: 52,
        windowWeeklyPercent: 49,
      }),
    ).toBe(true);
    expect(shouldShowUsageTrigger({ ...emptyUsage, windowFableWeeklyPercent: 5 })).toBe(true);
  });

  it("lists every known window as the budget left, in draw order", () => {
    const usage = {
      ...emptyUsage,
      contextPercent: 23,
      windowFiveHourPercent: 52.4,
      windowWeeklyPercent: 49,
    };

    expect(
      usageWindowCandidates(usage, { label: "Weekly · Fable", percent: 5 }, bindingLabels),
    ).toEqual([
      { percentLeft: 23, label: "Context window", source: "context" },
      { percentLeft: 52, label: "5-hour limit", source: "fiveHour" },
      { percentLeft: 49, label: "Weekly · all models", source: "weekly" },
      { percentLeft: 5, label: "Weekly · Fable", source: "family" },
    ]);
    expect(usageWindowCandidates(emptyUsage, null, bindingLabels)).toEqual([]);
    expect(usageWindowCandidates(null, null, bindingLabels)).toEqual([]);
  });

  it("binds the ring to the window with the least left", () => {
    const usage = {
      ...emptyUsage,
      contextPercent: 23,
      windowFiveHourPercent: 52,
      windowWeeklyPercent: 49,
    };

    expect(bindingUsage(usage, null, bindingLabels)).toEqual({
      percentLeft: 23,
      label: "Context window",
      source: "context",
    });
    expect(
      bindingUsage(usage, { label: "Weekly · Fable", percent: 5 }, bindingLabels),
    ).toEqual({ percentLeft: 5, label: "Weekly · Fable", source: "family" });
    expect(bindingUsage(emptyUsage, null, bindingLabels)).toBeNull();
    expect(bindingUsage(null, null, bindingLabels)).toBeNull();
  });

  it("resolves ring ties toward the earlier window", () => {
    const usage = { ...emptyUsage, contextPercent: 23, windowWeeklyPercent: 23 };
    expect(bindingUsage(usage, { label: "Weekly · Fable", percent: 23 }, bindingLabels)).toEqual({
      percentLeft: 23,
      label: "Context window",
      source: "context",
    });
    expect(
      bindingUsage({ ...emptyUsage, windowFiveHourPercent: 23 }, { label: "Weekly · Fable", percent: 23 }, bindingLabels),
    ).toEqual({ percentLeft: 23, label: "5-hour limit", source: "fiveHour" });
  });

  it("clamps the percent left into 0-100", () => {
    expect(tightestUsage(usageWindowCandidates({ ...emptyUsage, contextPercent: 140 }, null, bindingLabels))).toEqual({
      percentLeft: 100,
      label: "Context window",
      source: "context",
    });
    expect(tightestUsage(usageWindowCandidates({ ...emptyUsage, contextPercent: -4 }, null, bindingLabels))).toEqual({
      percentLeft: 0,
      label: "Context window",
      source: "context",
    });
    expect(tightestUsage([])).toBeNull();
  });
});
