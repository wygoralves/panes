import { describe, expect, it } from "vitest";
import { resolveUsageStatusKey } from "./usageStatus";

describe("resolveUsageStatusKey", () => {
  it("reports loading while the first turn is active", () => {
    expect(resolveUsageStatusKey(true)).toBe("status.usageLoading");
  });

  it("reports unavailable only after a completed attempt without usage", () => {
    expect(resolveUsageStatusKey(false)).toBe("status.usageUnavailable");
  });
});
