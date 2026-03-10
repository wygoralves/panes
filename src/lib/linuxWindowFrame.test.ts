import { describe, expect, it } from "vitest";
import {
  canLinuxWindowResize,
  shouldShowLinuxWindowChrome,
  type LinuxWindowFrameState,
} from "./linuxWindowFrame";

describe("linuxWindowFrame", () => {
  it("allows resize only for non-maximized, non-fullscreen windows", () => {
    const normal: LinuxWindowFrameState = { isFullscreen: false, isMaximized: false };
    const fullscreen: LinuxWindowFrameState = { isFullscreen: true, isMaximized: false };
    const maximized: LinuxWindowFrameState = { isFullscreen: false, isMaximized: true };

    expect(canLinuxWindowResize(normal)).toBe(true);
    expect(canLinuxWindowResize(fullscreen)).toBe(false);
    expect(canLinuxWindowResize(maximized)).toBe(false);
  });

  it("hides chrome only while fullscreen", () => {
    expect(shouldShowLinuxWindowChrome({ isFullscreen: false, isMaximized: false })).toBe(true);
    expect(shouldShowLinuxWindowChrome({ isFullscreen: false, isMaximized: true })).toBe(true);
    expect(shouldShowLinuxWindowChrome({ isFullscreen: true, isMaximized: false })).toBe(false);
  });
});
