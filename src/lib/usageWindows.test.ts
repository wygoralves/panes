import { describe, expect, it } from "vitest";
import { clampRemainingPercent, describeUsageReset, usageLevel } from "./usageWindows";

describe("usage windows", () => {
  it("maps remaining percent to a level", () => {
    expect(usageLevel(80)).toBe("normal");
    expect(usageLevel(25)).toBe("warning");
    expect(usageLevel(10)).toBe("critical");
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
});
