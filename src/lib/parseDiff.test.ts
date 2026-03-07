import { describe, expect, it } from "vitest";

import { parseDiff } from "./parseDiff";

describe("parseDiff", () => {
  it("keeps regular content diffs focused on hunks", () => {
    const raw = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-oldValue",
      "+newValue",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "oldValue", gutter: "-", lineNum: "" },
      { type: "add", content: "newValue", gutter: "+", lineNum: "1" },
    ]);
  });

  it("keeps changed lines whose content starts with ++ or --", () => {
    const raw = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "---oldValue",
      "+++newValue",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "--oldValue", gutter: "-", lineNum: "" },
      { type: "add", content: "++newValue", gutter: "+", lineNum: "1" },
    ]);
  });

  it("keeps changed lines whose content starts with ++ or -- followed by a space", () => {
    const raw = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "--- help",
      "+++ title",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "-- help", gutter: "-", lineNum: "" },
      { type: "add", content: "++ title", gutter: "+", lineNum: "1" },
    ]);
  });

  it("renders metadata-only git changes instead of dropping them", () => {
    const raw = [
      "diff --git a/scripts/setup.sh b/scripts/setup.sh",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      {
        type: "meta",
        content: "diff --git a/scripts/setup.sh b/scripts/setup.sh",
        gutter: "",
        lineNum: "",
      },
      { type: "meta", content: "old mode 100644", gutter: "", lineNum: "" },
      { type: "meta", content: "new mode 100755", gutter: "", lineNum: "" },
    ]);
  });

  it("preserves metadata-only sections inside multi-file diffs", () => {
    const raw = [
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 100%",
      "rename from old-name.ts",
      "rename to new-name.ts",
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-oldValue",
      "+newValue",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      {
        type: "meta",
        content: "diff --git a/old-name.ts b/new-name.ts",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "similarity index 100%",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "rename from old-name.ts",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "rename to new-name.ts",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "diff --git a/src/app.ts b/src/app.ts",
        gutter: "",
        lineNum: "",
      },
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "oldValue", gutter: "-", lineNum: "" },
      { type: "add", content: "newValue", gutter: "+", lineNum: "1" },
    ]);
  });

  it("shows file headers between modified files in multi-file diffs", () => {
    const raw = [
      "diff --git a/src/alpha.ts b/src/alpha.ts",
      "index 1111111..2222222 100644",
      "--- a/src/alpha.ts",
      "+++ b/src/alpha.ts",
      "@@ -1 +1 @@",
      "-oldAlpha",
      "+newAlpha",
      "diff --git a/src/beta.ts b/src/beta.ts",
      "index 3333333..4444444 100644",
      "--- a/src/beta.ts",
      "+++ b/src/beta.ts",
      "@@ -1 +1 @@",
      "-oldBeta",
      "+newBeta",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      {
        type: "meta",
        content: "diff --git a/src/alpha.ts b/src/alpha.ts",
        gutter: "",
        lineNum: "",
      },
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "oldAlpha", gutter: "-", lineNum: "" },
      { type: "add", content: "newAlpha", gutter: "+", lineNum: "1" },
      {
        type: "meta",
        content: "diff --git a/src/beta.ts b/src/beta.ts",
        gutter: "",
        lineNum: "",
      },
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "oldBeta", gutter: "-", lineNum: "" },
      { type: "add", content: "newBeta", gutter: "+", lineNum: "1" },
    ]);
  });

  it("treats copy and dissimilarity records as metadata", () => {
    const raw = [
      "diff --git a/source.ts b/copied.ts",
      "dissimilarity index 12%",
      "copy from source.ts",
      "copy to copied.ts",
      "@@ -1 +1 @@",
      "-oldValue",
      "+newValue",
      "",
    ].join("\n");

    expect(parseDiff(raw)).toEqual([
      {
        type: "meta",
        content: "diff --git a/source.ts b/copied.ts",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "dissimilarity index 12%",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "copy from source.ts",
        gutter: "",
        lineNum: "",
      },
      {
        type: "meta",
        content: "copy to copied.ts",
        gutter: "",
        lineNum: "",
      },
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "del", content: "oldValue", gutter: "-", lineNum: "" },
      { type: "add", content: "newValue", gutter: "+", lineNum: "1" },
    ]);
  });
});
