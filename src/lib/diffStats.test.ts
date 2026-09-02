import { describe, expect, it } from "vitest";
import { countDiffStats, looksLikeFilePath, previewDiffLines } from "./diffStats";

const DIFF = [
  "diff --git a/src/terminal/pty.rs b/src/terminal/pty.rs",
  "--- a/src/terminal/pty.rs",
  "+++ b/src/terminal/pty.rs",
  "@@ -10,4 +10,5 @@ fn write(&self, bytes: &[u8]) {",
  " fn write(&self, bytes: &[u8]) {",
  "-    let mut guard = self.process.lock();",
  "+    let writer = self.writer.clone();",
  "+    drop(guard);",
  "     writer.write_all(bytes)",
].join("\n");

describe("diffStats", () => {
  it("counts added and removed lines inside hunks only", () => {
    expect(countDiffStats(DIFF)).toEqual({ adds: 2, dels: 1 });
  });

  it("falls back to bare +/- lines when there is no hunk header", () => {
    expect(countDiffStats("+one\n+two\n-three\n")).toEqual({ adds: 2, dels: 1 });
  });

  it("previews the first changed lines with context and without file headers", () => {
    expect(previewDiffLines(DIFF, 3)).toEqual([
      { tone: "ctx", text: "fn write(&self, bytes: &[u8]) {" },
      { tone: "del", text: "    let mut guard = self.process.lock();" },
      { tone: "add", text: "    let writer = self.writer.clone();" },
    ]);
  });

  it("keeps hunk lines that merely start with +++ or ---", () => {
    const diff = [
      "--- a/counter.c",
      "+++ b/counter.c",
      "@@ -1,2 +1,2 @@",
      "-- SELECT 1",
      "+++counter;",
    ].join("\n");
    expect(countDiffStats(diff)).toEqual({ adds: 1, dels: 1 });
    expect(previewDiffLines(diff)).toEqual([
      { tone: "del", text: "- SELECT 1" },
      { tone: "add", text: "++counter;" },
    ]);
  });

  it("skips the headers of a second file in a multi-file diff", () => {
    const diff = [
      "diff --git a/one.txt b/one.txt",
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/two.txt b/two.txt",
      "--- a/two.txt",
      "+++ b/two.txt",
      "@@ -1 +1 @@",
      "-two",
      "+deux",
      "\\ No newline at end of file",
    ].join("\n");
    expect(countDiffStats(diff)).toEqual({ adds: 2, dels: 2 });
  });

  it("previews bare +/- payloads that have no hunk header", () => {
    expect(previewDiffLines("+one\n+two\n-three\n", 2)).toEqual([
      { tone: "add", text: "one" },
      { tone: "add", text: "two" },
    ]);
  });

  it("ignores a bare header pair but not a lone --- deletion", () => {
    expect(countDiffStats("--- a/x\n+++ b/x\n+one\n")).toEqual({ adds: 1, dels: 0 });
    expect(countDiffStats("--- comment\n+one\n")).toEqual({ adds: 1, dels: 1 });
  });

  it("tells file paths from prose summaries", () => {
    expect(looksLikeFilePath("src-tauri/src/terminal/pty.rs")).toBe(true);
    expect(looksLikeFilePath("README.md")).toBe(true);
    expect(looksLikeFilePath("Edit the terminal writer")).toBe(false);
    expect(looksLikeFilePath("https://docs.rs/portable-pty")).toBe(false);
  });
});
