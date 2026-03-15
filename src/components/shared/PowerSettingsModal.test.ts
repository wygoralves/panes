import { describe, expect, it } from "vitest";
import {
  applyCustomTimeInput,
  customTimeToSecs,
  deriveSessionState,
  getPrimaryStatusKey,
  getStatusMessage,
  normalizeFixedSessionState,
  secsToCustomTime,
} from "./PowerSettingsModal";

describe("PowerSettingsModal session state helpers", () => {
  it("resets to the default indefinite state when no duration is saved", () => {
    expect(deriveSessionState(null)).toEqual({
      sessionMode: "indefinite",
      sessionDuration: 3600,
      customHours: "",
      customMinutes: "",
    });
  });

  it("loads preset durations without carrying stale custom time", () => {
    expect(deriveSessionState(1800)).toEqual({
      sessionMode: "fixed",
      sessionDuration: 1800,
      customHours: "",
      customMinutes: "",
    });
  });

  it("loads custom durations decomposed into hours and minutes", () => {
    expect(deriveSessionState(2700)).toEqual({
      sessionMode: "fixed",
      sessionDuration: 2700,
      customHours: "",
      customMinutes: "45",
    });
  });

  it("decomposes durations with both hours and minutes", () => {
    // 1h 15m = 4500s
    expect(deriveSessionState(4500)).toEqual({
      sessionMode: "fixed",
      sessionDuration: 4500,
      customHours: "1",
      customMinutes: "15",
    });
  });

  it("keeps a preset duration selected when returning to fixed mode", () => {
    expect(normalizeFixedSessionState(7200, "", "")).toEqual({
      sessionMode: "fixed",
      sessionDuration: 7200,
      customHours: "",
      customMinutes: "",
    });
  });

  it("drops hidden custom durations when returning to fixed mode without custom text", () => {
    expect(normalizeFixedSessionState(2700, "", "")).toEqual({
      sessionMode: "fixed",
      sessionDuration: 3600,
      customHours: "",
      customMinutes: "",
    });
  });

  it("preserves custom time when switching back to fixed mode", () => {
    expect(normalizeFixedSessionState(5400, "1", "30")).toEqual({
      sessionMode: "fixed",
      sessionDuration: 5400,
      customHours: "1",
      customMinutes: "30",
    });
  });

  it("clearing both custom inputs resets hidden custom duration state", () => {
    expect(applyCustomTimeInput("", "", 2700)).toEqual({
      sessionDuration: 3600,
      customHours: "",
      customMinutes: "",
    });
  });

  it("keeps the active preset when custom inputs are cleared over a preset duration", () => {
    expect(applyCustomTimeInput("", "", 1800)).toEqual({
      sessionDuration: 1800,
      customHours: "",
      customMinutes: "",
    });
  });

  it("applies hours-only custom input", () => {
    expect(applyCustomTimeInput("2", "", 1800)).toEqual({
      sessionDuration: 7200,
      customHours: "2",
      customMinutes: "",
    });
  });

  it("applies minutes-only custom input", () => {
    expect(applyCustomTimeInput("", "25", 1800)).toEqual({
      sessionDuration: 1500,
      customHours: "",
      customMinutes: "25",
    });
  });

  it("applies combined hours and minutes custom input", () => {
    expect(applyCustomTimeInput("1", "30", 1800)).toEqual({
      sessionDuration: 5400,
      customHours: "1",
      customMinutes: "30",
    });
  });
});

describe("customTimeToSecs", () => {
  it("converts hours and minutes to seconds", () => {
    expect(customTimeToSecs("1", "30")).toBe(5400);
  });

  it("returns null for empty inputs", () => {
    expect(customTimeToSecs("", "")).toBeNull();
  });

  it("handles hours only", () => {
    expect(customTimeToSecs("3", "")).toBe(10800);
  });

  it("handles minutes only", () => {
    expect(customTimeToSecs("", "45")).toBe(2700);
  });

  it("returns null for zero total", () => {
    expect(customTimeToSecs("0", "0")).toBeNull();
  });
});

describe("secsToCustomTime", () => {
  it("decomposes seconds into hours and minutes", () => {
    expect(secsToCustomTime(5400)).toEqual({ customHours: "1", customMinutes: "30" });
  });

  it("returns only minutes for sub-hour durations", () => {
    expect(secsToCustomTime(2700)).toEqual({ customHours: "", customMinutes: "45" });
  });

  it("returns only hours for exact hours", () => {
    expect(secsToCustomTime(7200)).toEqual({ customHours: "2", customMinutes: "" });
  });
});

describe("PowerSettingsModal status helpers", () => {
  it("uses the generic paused label after AC power is restored", () => {
    expect(
      getPrimaryStatusKey({
        active: false,
        pausedDueToBattery: true,
        onAcPower: true,
      }),
    ).toBe("powerModal.statusPaused");
  });

  it("keeps the battery pause label only while still on battery power", () => {
    expect(
      getPrimaryStatusKey({
        active: false,
        pausedDueToBattery: true,
        onAcPower: false,
      }),
    ).toBe("powerModal.statusPausedBattery");
  });

  it("surfaces backend status messages only while inactive", () => {
    expect(
      getStatusMessage({
        active: false,
        message: "failed to resume keep awake on AC power: boom",
      }),
    ).toBe("failed to resume keep awake on AC power: boom");
    expect(
      getStatusMessage({
        active: true,
        message: "ignored while active",
      }),
    ).toBeNull();
  });
});
