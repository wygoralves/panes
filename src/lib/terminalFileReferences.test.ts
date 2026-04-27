import { describe, expect, it } from "vitest";
import { terminalMatchOffsetsToRange } from "./terminalFileReferences";

describe("terminalFileReferences", () => {
  it("maps end offsets as inclusive xterm ranges", () => {
    const range = terminalMatchOffsetsToRange(4, [10], 4, 8);

    expect(range).toEqual({
      start: { x: 5, y: 5 },
      end: { x: 8, y: 5 },
    });
  });

  it("maps wrapped terminal matches without including the next character", () => {
    const range = terminalMatchOffsetsToRange(10, [5, 5], 3, 7);

    expect(range).toEqual({
      start: { x: 4, y: 11 },
      end: { x: 2, y: 12 },
    });
  });
});
