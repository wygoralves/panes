import { describe, expect, it } from "vitest";
import {
  canCustomWindowResize,
  shouldShowCustomWindowChrome,
  type CustomWindowFrameState,
} from "./customWindowFrame";

describe("customWindowFrame", () => {
  it("allows resize only for non-maximized, non-fullscreen windows", () => {
    const normal: CustomWindowFrameState = { isFullscreen: false, isMaximized: false };
    const fullscreen: CustomWindowFrameState = { isFullscreen: true, isMaximized: false };
    const maximized: CustomWindowFrameState = { isFullscreen: false, isMaximized: true };

    expect(canCustomWindowResize(normal)).toBe(true);
    expect(canCustomWindowResize(fullscreen)).toBe(false);
    expect(canCustomWindowResize(maximized)).toBe(false);
  });

  it("hides chrome only while fullscreen", () => {
    expect(shouldShowCustomWindowChrome({ isFullscreen: false, isMaximized: false })).toBe(true);
    expect(shouldShowCustomWindowChrome({ isFullscreen: false, isMaximized: true })).toBe(true);
    expect(shouldShowCustomWindowChrome({ isFullscreen: true, isMaximized: false })).toBe(false);
  });
});
