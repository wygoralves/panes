import { describe, expect, it } from "vitest";
import {
  applyCustomMinutesInput,
  deriveSessionState,
  getPrimaryStatusKey,
  getStatusMessage,
  normalizeFixedSessionState,
} from "./PowerSettingsModal";

describe("PowerSettingsModal session state helpers", () => {
  it("resets to the default indefinite state when no duration is saved", () => {
    expect(deriveSessionState(null)).toEqual({
      sessionMode: "indefinite",
      sessionDuration: 3600,
      customMinutes: "",
    });
  });

  it("loads preset durations without carrying stale custom minutes", () => {
    expect(deriveSessionState(1800)).toEqual({
      sessionMode: "fixed",
      sessionDuration: 1800,
      customMinutes: "",
    });
  });

  it("loads custom durations with the matching custom minute value", () => {
    expect(deriveSessionState(2700)).toEqual({
      sessionMode: "fixed",
      sessionDuration: 2700,
      customMinutes: "45",
    });
  });

  it("keeps a preset duration selected when returning to fixed mode", () => {
    expect(normalizeFixedSessionState(7200, "")).toEqual({
      sessionMode: "fixed",
      sessionDuration: 7200,
      customMinutes: "",
    });
  });

  it("drops hidden custom durations when returning to fixed mode without custom text", () => {
    expect(normalizeFixedSessionState(2700, "")).toEqual({
      sessionMode: "fixed",
      sessionDuration: 3600,
      customMinutes: "",
    });
  });

  it("clearing the custom input resets hidden custom duration state", () => {
    expect(applyCustomMinutesInput("", 2700)).toEqual({
      sessionDuration: 3600,
      customMinutes: "",
    });
  });

  it("keeps the active preset when the custom input is cleared over a preset duration", () => {
    expect(applyCustomMinutesInput("", 1800)).toEqual({
      sessionDuration: 1800,
      customMinutes: "",
    });
  });

  it("applies valid custom minute input to the saved duration", () => {
    expect(applyCustomMinutesInput("25", 1800)).toEqual({
      sessionDuration: 1500,
      customMinutes: "25",
    });
  });

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
