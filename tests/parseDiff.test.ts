import { describe, expect, it } from "vitest";
import { parseDiff, extractDiffFilename, LINE_CLASS } from "../src/lib/parseDiff";

describe("parseDiff", () => {
  it("returns single empty context line for empty input", () => {
    // split("") produces [""], which yields one empty context entry
    const result = parseDiff("");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "context", content: "", gutter: "", lineNum: "" });
  });

  it("parses a simple diff with additions and deletions", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index abc123..def456 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-removed",
      "+added",
      "+added2",
      " line3",
    ].join("\n");

    const result = parseDiff(diff);

    expect(result).toEqual([
      { type: "hunk", content: "", gutter: "", lineNum: "" },
      { type: "context", content: "line1", gutter: "", lineNum: "1" },
      { type: "del", content: "removed", gutter: "-", lineNum: "" },
      { type: "add", content: "added", gutter: "+", lineNum: "2" },
      { type: "add", content: "added2", gutter: "+", lineNum: "3" },
      { type: "context", content: "line3", gutter: "", lineNum: "4" },
    ]);
  });

  it("extracts hunk label after @@...@@", () => {
    const diff = "@@ -10,5 +10,6 @@ function hello() {";
    const result = parseDiff(diff);

    expect(result).toEqual([
      { type: "hunk", content: "function hello() {", gutter: "", lineNum: "" },
    ]);
  });

  it("handles hunk header with no label", () => {
    const result = parseDiff("@@ -1,3 +1,4 @@");
    expect(result[0]).toMatchObject({ type: "hunk", content: "" });
  });

  it("increments line numbers for additions and context", () => {
    const diff = [
      "@@ -1,2 +5,4 @@",
      " context",
      "+add1",
      "+add2",
      " context2",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result[1].lineNum).toBe("5"); // context starts at 5
    expect(result[2].lineNum).toBe("6"); // +add1
    expect(result[3].lineNum).toBe("7"); // +add2
    expect(result[4].lineNum).toBe("8"); // context2
  });

  it("does not increment line numbers for deletions", () => {
    const diff = [
      "@@ -1,3 +1,1 @@",
      "-removed1",
      "-removed2",
      " kept",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result[1]).toMatchObject({ type: "del", lineNum: "" });
    expect(result[2]).toMatchObject({ type: "del", lineNum: "" });
    expect(result[3]).toMatchObject({ type: "context", lineNum: "1" });
  });

  it("skips metadata lines (diff, index, ---, +++, new file, etc.)", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/foo.ts",
      "@@ -0,0 +1,2 @@",
      "+line1",
      "+line2",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result).toHaveLength(3); // hunk + 2 additions
    expect(result[0].type).toBe("hunk");
    expect(result[1].type).toBe("add");
    expect(result[2].type).toBe("add");
  });

  it("skips deleted file, similarity, rename, old mode, new mode headers", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 95%",
      "rename from old.ts",
      "rename to new.ts",
      "old mode 100644",
      "new mode 100755",
      "deleted file mode 100644",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result).toHaveLength(3); // hunk + del + add
  });

  it("handles multiple hunks", () => {
    const diff = [
      "@@ -1,2 +1,2 @@",
      "-a",
      "+b",
      "@@ -10,2 +10,2 @@ someFunction",
      "-c",
      "+d",
    ].join("\n");

    const result = parseDiff(diff);
    const hunks = result.filter((l) => l.type === "hunk");
    expect(hunks).toHaveLength(2);
    expect(hunks[1].content).toBe("someFunction");
  });

  it("strips leading space from context lines", () => {
    const diff = [
      "@@ -1,1 +1,1 @@",
      " context with leading space",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result[1].content).toBe("context with leading space");
  });

  it("treats lines without prefix as context", () => {
    const diff = [
      "@@ -1,1 +1,1 @@",
      "no-prefix line",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result[1]).toMatchObject({ type: "context", content: "no-prefix line" });
  });
});

describe("extractDiffFilename", () => {
  it("extracts filename from single-file diff", () => {
    const diff = [
      "diff --git a/src/lib/ipc.ts b/src/lib/ipc.ts",
      "index abc..def 100644",
      "--- a/src/lib/ipc.ts",
      "+++ b/src/lib/ipc.ts",
      "@@ -1,1 +1,1 @@",
      "+changed",
    ].join("\n");

    expect(extractDiffFilename(diff)).toBe("src/lib/ipc.ts");
  });

  it("returns null for multi-file diff", () => {
    const diff = [
      "diff --git a/file1.ts b/file1.ts",
      "@@ -1,1 +1,1 @@",
      "+a",
      "diff --git a/file2.ts b/file2.ts",
      "@@ -1,1 +1,1 @@",
      "+b",
    ].join("\n");

    expect(extractDiffFilename(diff)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractDiffFilename("")).toBeNull();
  });

  it("returns null for diff with no git header", () => {
    expect(extractDiffFilename("@@ -1,1 +1,1 @@\n+line")).toBeNull();
  });

  it("extracts renamed file (b/ path)", () => {
    const diff = "diff --git a/old-name.ts b/new-name.ts\n@@ -1 +1 @@\n+x";
    expect(extractDiffFilename(diff)).toBe("new-name.ts");
  });
});

describe("LINE_CLASS", () => {
  it("maps add to git-diff-add", () => {
    expect(LINE_CLASS.add).toBe("git-diff-add");
  });

  it("maps del to git-diff-del", () => {
    expect(LINE_CLASS.del).toBe("git-diff-del");
  });

  it("maps hunk to git-diff-hunk", () => {
    expect(LINE_CLASS.hunk).toBe("git-diff-hunk");
  });

  it("maps context to empty string", () => {
    expect(LINE_CLASS.context).toBe("");
  });
});
