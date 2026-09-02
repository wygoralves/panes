import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, normalizeTimestamp } from "./formatters";

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeTimestamp", () => {
  it("tags a bare SQLite stamp as UTC", () => {
    expect(normalizeTimestamp("2026-09-01 12:00:00")).toBe("2026-09-01T12:00:00Z");
  });

  it("leaves ISO stamps untouched", () => {
    expect(normalizeTimestamp("2026-09-01T12:00:00Z")).toBe("2026-09-01T12:00:00Z");
    expect(normalizeTimestamp("2026-09-01T12:00:00.000Z")).toBe(
      "2026-09-01T12:00:00.000Z",
    );
  });

  it("leaves values that are not SQLite stamps untouched", () => {
    expect(normalizeTimestamp("not a date")).toBe("not a date");
    expect(normalizeTimestamp("2026-09-01 12:00")).toBe("2026-09-01 12:00");
  });
});

describe("formatRelativeTime", () => {
  it("reads a bare SQLite stamp as UTC instead of local time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:10:00.000Z"));

    expect(formatRelativeTime("2026-09-01 12:00:00", "en")).toBe("10m");
    expect(formatRelativeTime("2026-09-01T12:00:00Z", "en")).toBe("10m");
  });
});
