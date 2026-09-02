import { describe, expect, it } from "vitest";
import { clampUiZoomPercent, nextUiZoomPercent } from "./uiZoom";

describe("ui zoom", () => {
  it("clamps into the supported range", () => {
    expect(clampUiZoomPercent(100)).toBe(100);
    expect(clampUiZoomPercent(10)).toBe(70);
    expect(clampUiZoomPercent(400)).toBe(150);
    expect(clampUiZoomPercent(Number.NaN)).toBe(100);
  });

  it("steps through the preset levels", () => {
    expect(nextUiZoomPercent(100, 1)).toBe(110);
    expect(nextUiZoomPercent(100, -1)).toBe(90);
    expect(nextUiZoomPercent(150, 1)).toBe(150);
    expect(nextUiZoomPercent(70, -1)).toBe(70);
    expect(nextUiZoomPercent(105, 1)).toBe(110);
    expect(nextUiZoomPercent(105, -1)).toBe(100);
  });
});
