import { describe, expect, it } from "vitest";
import { nextTerminalNumber } from "./terminalStore";
import type { TerminalGroup } from "../types";

function makeGroup(name: string): TerminalGroup {
  return {
    id: crypto.randomUUID(),
    root: { type: "leaf", sessionId: "s1" },
    name,
  };
}

describe("nextTerminalNumber", () => {
  it("returns 1 for empty groups", () => {
    expect(nextTerminalNumber([])).toBe(1);
  });

  it("returns 2 when Terminal 1 exists", () => {
    expect(nextTerminalNumber([makeGroup("Terminal 1")])).toBe(2);
  });

  it("fills gap when Terminal 2 is missing", () => {
    const groups = [makeGroup("Terminal 1"), makeGroup("Terminal 3")];
    expect(nextTerminalNumber(groups)).toBe(2);
  });

  it("fills the first gap in a larger sequence", () => {
    const groups = [
      makeGroup("Terminal 1"),
      makeGroup("Terminal 3"),
      makeGroup("Terminal 4"),
      makeGroup("Terminal 6"),
    ];
    expect(nextTerminalNumber(groups)).toBe(2);
  });

  it("ignores non-terminal names", () => {
    const groups = [makeGroup("Claude Code"), makeGroup("Terminal 1")];
    expect(nextTerminalNumber(groups)).toBe(2);
  });

  it("ignores partial matches", () => {
    const groups = [makeGroup("Terminal 1 (copy)"), makeGroup("My Terminal 2")];
    expect(nextTerminalNumber(groups)).toBe(1);
  });

  it("reuses number after close-and-reopen scenario", () => {
    // Simulate: had 3 tabs, closed Terminal 2
    const groups = [makeGroup("Terminal 1"), makeGroup("Terminal 3")];
    // Open new tab → should get Terminal 2
    expect(nextTerminalNumber(groups)).toBe(2);
    // After adding Terminal 2, next should be 4
    groups.push(makeGroup("Terminal 2"));
    expect(nextTerminalNumber(groups)).toBe(4);
  });

  it("handles harness groups mixed with terminal groups", () => {
    const groups = [
      makeGroup("Terminal 1"),
      { ...makeGroup("Codex CLI"), harnessId: "codex" },
      makeGroup("Terminal 3"),
    ];
    expect(nextTerminalNumber(groups)).toBe(2);
  });
});
