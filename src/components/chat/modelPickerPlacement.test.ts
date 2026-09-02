import { describe, expect, it } from "vitest";
import { placePopover } from "./ModelPicker";

describe("placePopover", () => {
  it("opens above a trigger near the bottom of the viewport", () => {
    const placement = placePopover({ top: 860, bottom: 884 }, 900);
    expect(placement.bottom).toBe(46);
    expect(placement.top).toBeUndefined();
    expect(placement.maxHeight).toBe(560);
  });

  it("caps the height to the room above a mid-screen trigger", () => {
    const placement = placePopover({ top: 420, bottom: 444 }, 800);
    expect(placement.bottom).toBe(386);
    expect(placement.maxHeight).toBe(402);
  });

  it("opens below when the trigger sits in the top half", () => {
    const placement = placePopover({ top: 120, bottom: 144 }, 900);
    expect(placement.top).toBe(150);
    expect(placement.bottom).toBeUndefined();
    expect(placement.maxHeight).toBe(560);
  });
});
