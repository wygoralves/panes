import { describe, expect, it } from "vitest";
import { buildLineHighlights } from "./GitDiffEditorPanel";

describe("buildLineHighlights", () => {
  it("keeps separated edits in distinct highlight ranges", () => {
    const base = ["one", "two", "three", "four", "five", ""].join("\n");
    const modified = ["one", "TWO", "three", "four", "FIVE", ""].join("\n");

    expect(buildLineHighlights(base, modified)).toEqual({
      base: [
        { fromLine: 2, toLine: 2, kind: "removed" },
        { fromLine: 5, toLine: 5, kind: "removed" },
      ],
      modified: [
        { fromLine: 2, toLine: 2, kind: "added" },
        { fromLine: 5, toLine: 5, kind: "added" },
      ],
    });
  });
});
