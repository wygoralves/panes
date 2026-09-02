import { describe, expect, it } from "vitest";
import { placePopover } from "./ModelPicker";

describe("placePopover", () => {
  it("opens above a trigger docked at the bottom of the viewport", () => {
    const placement = placePopover({ top: 860, bottom: 884 }, 900, 400);
    expect(placement.bottom).toBe(46);
    expect(placement.top).toBeUndefined();
    expect(placement.maxHeight).toBe(560);
  });

  it("opens below a mid-screen trigger when the list fits there", () => {
    const placement = placePopover({ top: 420, bottom: 444 }, 800, 300);
    expect(placement.top).toBe(450);
    expect(placement.bottom).toBeUndefined();
    expect(placement.maxHeight).toBe(338);
  });

  it("flips above a mid-screen trigger only when the list does not fit below", () => {
    const placement = placePopover({ top: 420, bottom: 444 }, 800, 560);
    expect(placement.bottom).toBe(386);
    expect(placement.maxHeight).toBe(402);
  });

  it("stays below when neither side fits and below has more room", () => {
    const placement = placePopover({ top: 300, bottom: 324 }, 800, 560);
    expect(placement.top).toBe(330);
    expect(placement.maxHeight).toBe(458);
  });

  it("opens below when the trigger sits in the top half", () => {
    const placement = placePopover({ top: 120, bottom: 144 }, 900);
    expect(placement.top).toBe(150);
    expect(placement.bottom).toBeUndefined();
    expect(placement.maxHeight).toBe(560);
  });
});
