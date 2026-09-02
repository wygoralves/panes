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

  it("tells file paths from prose summaries", () => {
    expect(looksLikeFilePath("src-tauri/src/terminal/pty.rs")).toBe(true);
    expect(looksLikeFilePath("README.md")).toBe(true);
    expect(looksLikeFilePath("Edit the terminal writer")).toBe(false);
    expect(looksLikeFilePath("https://docs.rs/portable-pty")).toBe(false);
  });
});
