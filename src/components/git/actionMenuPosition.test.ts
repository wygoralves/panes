import { describe, expect, it } from "vitest";
import { getActionMenuPosition } from "./actionMenuPosition";

describe("getActionMenuPosition", () => {
  it("opens below when there is enough room", () => {
    expect(
      getActionMenuPosition({
        triggerRect: { top: 100, bottom: 124, right: 260 },
        menuWidth: 140,
        menuHeight: 72,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ top: 128, left: 120 });
  });

  it("flips above when the menu would overflow below", () => {
    expect(
      getActionMenuPosition({
        triggerRect: { top: 560, bottom: 584, right: 300 },
        menuWidth: 140,
        menuHeight: 104,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ top: 452, left: 160 });
  });

  it("clamps inside the viewport when space is tight", () => {
    expect(
      getActionMenuPosition({
        triggerRect: { top: 24, bottom: 48, right: 90 },
        menuWidth: 140,
        menuHeight: 400,
        viewportWidth: 200,
        viewportHeight: 320,
      }),
    ).toEqual({ top: 8, left: 8 });
  });
});
