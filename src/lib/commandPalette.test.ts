import { describe, expect, it } from "vitest";
import {
  detectCommandPaletteMode,
  getNextCommandPalettePrefix,
  getNextCommandPaletteSearchScope,
  normalizeCommandPaletteInput,
  shouldTabCycleCommandPaletteSearchScope,
} from "./commandPalette";

describe("commandPalette helpers", () => {
  it("detects search mode via ? prefix", () => {
    expect(detectCommandPaletteMode("?find this")).toEqual({
      mode: "search",
      term: "find this",
    });
  });

  it("cycles general prefixes including search mode", () => {
    expect(getNextCommandPalettePrefix("")).toBe(">");
    expect(getNextCommandPalettePrefix(">")).toBe("@");
    expect(getNextCommandPalettePrefix("@")).toBe("#");
    expect(getNextCommandPalettePrefix("#")).toBe("%");
    expect(getNextCommandPalettePrefix("%")).toBe("?");
    expect(getNextCommandPalettePrefix("?")).toBe("");
  });

  it("cycles search scopes in the expected order", () => {
    expect(getNextCommandPaletteSearchScope("all")).toBe("messages");
    expect(getNextCommandPaletteSearchScope("messages")).toBe("files");
    expect(getNextCommandPaletteSearchScope("files")).toBe("threads");
    expect(getNextCommandPaletteSearchScope("threads")).toBe("all");
  });

  it("lets prefixed input escape search mode while preserving plain search text", () => {
    expect(normalizeCommandPaletteInput("find this", "search")).toBe("?find this");
    expect(normalizeCommandPaletteInput("", "search")).toBe("?");
    expect(normalizeCommandPaletteInput(">layout", "search")).toBe(">layout");
    expect(normalizeCommandPaletteInput("@thread", "search")).toBe("@thread");
    expect(normalizeCommandPaletteInput("%src", "search")).toBe("%src");
  });

  it("only cycles search scope with tab when search mode has a real term", () => {
    expect(shouldTabCycleCommandPaletteSearchScope("search", "find")).toBe(true);
    expect(shouldTabCycleCommandPaletteSearchScope("search", "")).toBe(false);
    expect(shouldTabCycleCommandPaletteSearchScope("search", "   ")).toBe(false);
    expect(shouldTabCycleCommandPaletteSearchScope("command", "find")).toBe(false);
  });
});
