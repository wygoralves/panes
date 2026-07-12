import { describe, expect, it } from "vitest";
import { resolveUsageStatusKey } from "./usageStatus";

describe("resolveUsageStatusKey", () => {
  it("prompts for the first message before reporting an unavailable provider", () => {
    expect(resolveUsageStatusKey(false, false)).toBe(
      "status.usageAwaitingFirstMessage",
    );
  });

  it("reports loading while the first turn is active", () => {
    expect(resolveUsageStatusKey(true, true)).toBe("status.usageLoading");
  });

  it("reports unavailable only after a completed attempt without usage", () => {
    expect(resolveUsageStatusKey(true, false)).toBe("status.usageUnavailable");
  });
});
