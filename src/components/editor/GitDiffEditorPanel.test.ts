import { describe, expect, it } from "vitest";
import { getFocusPaneForHunk, getRevealLine } from "./GitDiffEditorPanel";
import {
  buildGitDiffModel,
  getDiffHunkAnchor,
  pickClosestHunkIndex,
} from "./gitDiffModel";

describe("buildGitDiffModel", () => {
  it("keeps separated edits in distinct highlight ranges and hunks", () => {
    const base = ["one", "two", "three", "four", "five", ""].join("\n");
    const modified = ["one", "TWO", "three", "four", "FIVE", ""].join("\n");

    expect(buildGitDiffModel(base, modified)).toEqual({
      highlights: {
        base: [
          { fromLine: 2, toLine: 2, kind: "removed" },
          { fromLine: 5, toLine: 5, kind: "removed" },
        ],
        modified: [
          { fromLine: 2, toLine: 2, kind: "added" },
          { fromLine: 5, toLine: 5, kind: "added" },
        ],
      },
      hunks: [
        {
          id: "hunk-0",
          kind: "modified",
          baseRange: { fromLine: 2, toLine: 2 },
          modifiedRange: { fromLine: 2, toLine: 2 },
          baseAnchorLine: 2,
          modifiedAnchorLine: 2,
          primarySide: "modified",
          primaryLine: 2,
        },
        {
          id: "hunk-1",
          kind: "modified",
          baseRange: { fromLine: 5, toLine: 5 },
          modifiedRange: { fromLine: 5, toLine: 5 },
          baseAnchorLine: 5,
          modifiedAnchorLine: 5,
          primarySide: "modified",
          primaryLine: 5,
        },
      ],
    });
  });

  it("merges adjacent removed and added chunks into one modified hunk", () => {
    const base = ["one", "two", "three", ""].join("\n");
    const modified = ["one", "two updated", "three updated", "three extra", ""].join("\n");

    expect(buildGitDiffModel(base, modified).hunks).toEqual([
      {
        id: "hunk-0",
        kind: "modified",
        baseRange: { fromLine: 2, toLine: 3 },
        modifiedRange: { fromLine: 2, toLine: 4 },
        baseAnchorLine: 2,
        modifiedAnchorLine: 2,
        primarySide: "modified",
        primaryLine: 2,
      },
    ]);
  });

  it("supports add-only hunks for untracked content", () => {
    const model = buildGitDiffModel("", ["one", "two", ""].join("\n"));

    expect(model.highlights).toEqual({
      base: [],
      modified: [{ fromLine: 1, toLine: 2, kind: "added" }],
    });
    expect(model.hunks).toEqual([
      {
        id: "hunk-0",
        kind: "added",
        baseRange: null,
        modifiedRange: { fromLine: 1, toLine: 2 },
        baseAnchorLine: 1,
        modifiedAnchorLine: 1,
        primarySide: "modified",
        primaryLine: 1,
      },
    ]);
  });

  it("supports delete-only hunks", () => {
    const model = buildGitDiffModel(["one", "two", ""].join("\n"), "");

    expect(model.highlights).toEqual({
      base: [{ fromLine: 1, toLine: 2, kind: "removed" }],
      modified: [],
    });
    expect(model.hunks).toEqual([
      {
        id: "hunk-0",
        kind: "removed",
        baseRange: { fromLine: 1, toLine: 2 },
        modifiedRange: null,
        baseAnchorLine: 1,
        modifiedAnchorLine: 1,
        primarySide: "base",
        primaryLine: 1,
      },
    ]);
  });

  it("returns no hunks when contents match", () => {
    expect(buildGitDiffModel("same\n", "same\n")).toEqual({
      highlights: {
        base: [],
        modified: [],
      },
      hunks: [],
    });
  });

  it("keeps missing-side reveal anchors aligned after earlier shifts", () => {
    const model = buildGitDiffModel(
      ["one", "two", "three", "four", "five", ""].join("\n"),
      ["one", "two", "three", "four", "added", "five", ""].join("\n"),
    );

    expect(model.hunks).toEqual([
      {
        id: "hunk-0",
        kind: "added",
        baseRange: null,
        modifiedRange: { fromLine: 5, toLine: 5 },
        baseAnchorLine: 5,
        modifiedAnchorLine: 5,
        primarySide: "modified",
        primaryLine: 5,
      },
    ]);
    expect(getRevealLine(model.hunks[0]!, "base")).toBe(5);
    expect(getRevealLine(model.hunks[0]!, "modified")).toBe(5);
  });
});

describe("pickClosestHunkIndex", () => {
  it("preserves the closest hunk after recomputation", () => {
    const original = buildGitDiffModel(
      ["one", "two", "three", "four", ""].join("\n"),
      ["one", "TWO", "three", "FOUR", ""].join("\n"),
    );
    const anchor = getDiffHunkAnchor(original.hunks[1]!);

    const updated = buildGitDiffModel(
      ["one", "two", "three", "four", ""].join("\n"),
      ["one", "TWO", "inserted", "three", "FOUR", ""].join("\n"),
    );

    expect(pickClosestHunkIndex(updated.hunks, anchor)).toBe(1);
  });
});

describe("git diff navigation helpers", () => {
  it("keeps focus on the modified pane when it remains editable", () => {
    const hunk = buildGitDiffModel(
      ["one", "two", "three", ""].join("\n"),
      ["one", "three", ""].join("\n"),
    ).hunks[0]!;

    expect(hunk.kind).toBe("removed");
    expect(getFocusPaneForHunk(hunk, false)).toBe("modified");
  });

  it("falls back to the hunk side when the modified pane is read-only", () => {
    const hunk = buildGitDiffModel(
      ["one", "two", "three", ""].join("\n"),
      ["one", "three", ""].join("\n"),
    ).hunks[0]!;

    expect(getFocusPaneForHunk(hunk, true)).toBe("base");
  });
});
