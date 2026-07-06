import { describe, expect, it } from "vitest";
import { getLanguageExtension } from "./CodeMirrorEditor";

describe("getLanguageExtension", () => {
  it("returns a language extension for .java files", () => {
    expect(getLanguageExtension("src/Main.java")).not.toBeNull();
  });

  it("returns a language extension for .cs files", () => {
    expect(getLanguageExtension("src/Program.cs")).not.toBeNull();
  });

  it("is case-insensitive on the extension", () => {
    expect(getLanguageExtension("src/Main.JAVA")).not.toBeNull();
    expect(getLanguageExtension("src/Program.CS")).not.toBeNull();
  });

  it("returns null for unknown extensions", () => {
    expect(getLanguageExtension("src/binary.bin")).toBeNull();
  });
});
