import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  recordPerfMetric,
  getPerfSnapshot,
  clearPerfMetrics,
} from "../src/lib/perfTelemetry";

describe("perfTelemetry", () => {
  beforeEach(() => {
    clearPerfMetrics();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearPerfMetrics();
  });

  describe("recordPerfMetric", () => {
    it("records a metric that appears in snapshot", () => {
      recordPerfMetric("chat.stream.flush.ms", 5);
      const snapshot = getPerfSnapshot(60_000);
      expect(snapshot["chat.stream.flush.ms"].count).toBe(1);
      expect(snapshot["chat.stream.flush.ms"].avg).toBe(5);
    });

    it("ignores non-finite values", () => {
      recordPerfMetric("chat.stream.flush.ms", NaN);
      recordPerfMetric("chat.stream.flush.ms", Infinity);
      recordPerfMetric("chat.stream.flush.ms", -Infinity);
      const snapshot = getPerfSnapshot(60_000);
      expect(snapshot["chat.stream.flush.ms"].count).toBe(0);
    });

    it("logs warning when value exceeds budget", () => {
      // The cooldown compares performance.now() against lastWarnAt (default 0).
      // If the test process started less than WARN_COOLDOWN_MS (8s) ago,
      // the cooldown check would suppress the warning. Mock performance.now()
      // to return a value well past the cooldown window.
      clearPerfMetrics();
      const originalNow = performance.now.bind(performance);
      const mockNow = vi.spyOn(performance, "now").mockImplementation(() => originalNow() + 10_000);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Budget for chat.stream.flush.ms is 12
      recordPerfMetric("chat.stream.flush.ms", 50);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain("[perf][budget]");
      expect(warnSpy.mock.calls[0][0]).toContain("chat.stream.flush.ms=50");
      mockNow.mockRestore();
    });

    it("does not warn when value is within budget", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      recordPerfMetric("chat.stream.flush.ms", 5);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("accumulates multiple metrics", () => {
      recordPerfMetric("chat.stream.flush.ms", 2);
      recordPerfMetric("chat.stream.flush.ms", 4);
      recordPerfMetric("chat.stream.flush.ms", 6);
      const snapshot = getPerfSnapshot(60_000);
      expect(snapshot["chat.stream.flush.ms"].count).toBe(3);
      expect(snapshot["chat.stream.flush.ms"].avg).toBe(4);
      expect(snapshot["chat.stream.flush.ms"].max).toBe(6);
    });
  });

  describe("getPerfSnapshot", () => {
    it("returns zeroed summaries when no metrics recorded", () => {
      const snapshot = getPerfSnapshot(60_000);
      expect(snapshot["chat.stream.flush.ms"]).toEqual({
        count: 0,
        avg: 0,
        p95: 0,
        max: 0,
      });
      expect(snapshot["git.refresh.ms"]).toEqual({
        count: 0,
        avg: 0,
        p95: 0,
        max: 0,
      });
    });

    it("computes p95 correctly", () => {
      // Record 100 values: 1..100
      for (let i = 1; i <= 100; i++) {
        recordPerfMetric("chat.render.commit.ms", i);
      }
      const snapshot = getPerfSnapshot(60_000);
      const summary = snapshot["chat.render.commit.ms"];
      expect(summary.count).toBe(100);
      expect(summary.p95).toBe(95);
      expect(summary.max).toBe(100);
    });

    it("includes all known metric names in result", () => {
      const snapshot = getPerfSnapshot(60_000);
      const expectedNames = [
        "chat.stream.flush.ms",
        "chat.stream.events_per_sec",
        "chat.render.commit.ms",
        "chat.markdown.worker.ms",
        "git.refresh.ms",
        "git.file_diff.ms",
      ];
      for (const name of expectedNames) {
        expect(snapshot).toHaveProperty(name);
      }
    });
  });

  describe("clearPerfMetrics", () => {
    it("clears all recorded metrics", () => {
      recordPerfMetric("chat.stream.flush.ms", 10);
      recordPerfMetric("git.refresh.ms", 100);
      clearPerfMetrics();

      const snapshot = getPerfSnapshot(60_000);
      expect(snapshot["chat.stream.flush.ms"].count).toBe(0);
      expect(snapshot["git.refresh.ms"].count).toBe(0);
    });
  });
});
