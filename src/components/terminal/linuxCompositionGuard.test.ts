import { describe, expect, it } from "vitest";
import {
  createLinuxTerminalCompositionState,
  filterLinuxTerminalCompositionData,
  noteLinuxTerminalCompositionEnd,
  noteLinuxTerminalCompositionStart,
  noteLinuxTerminalCompositionText,
} from "./linuxCompositionGuard";

describe("linuxCompositionGuard", () => {
  it("ignores regular input outside composition", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionText(state, "a", "insertText", 10);

    expect(filterLinuxTerminalCompositionData(state, "a", 15)).toBe("a");
    expect(filterLinuxTerminalCompositionData(state, "a", 25)).toBe("a");
  });

  it("suppresses dead-key artifacts and keeps the composed character", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 100);
    noteLinuxTerminalCompositionText(state, "e", "insertCompositionText", 110);
    noteLinuxTerminalCompositionText(state, "é", "insertText", 120);

    expect(filterLinuxTerminalCompositionData(state, "´", 125)).toBeNull();
    expect(filterLinuxTerminalCompositionData(state, " é", 130)).toBe("é");
  });

  it("preserves trailing space typed with the composed character", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 140);
    noteLinuxTerminalCompositionText(state, "é", "insertText", 150);

    expect(filterLinuxTerminalCompositionData(state, "é ", 160)).toBe("é ");
  });

  it("preserves standalone accent characters committed via dead key plus space", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 170);
    noteLinuxTerminalCompositionText(state, "´", "insertText", 180);

    expect(filterLinuxTerminalCompositionData(state, "´", 190)).toBe("´");
  });

  it("preserves standalone space right after the composition commits", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 180);
    noteLinuxTerminalCompositionText(state, "é", "insertText", 190);

    expect(filterLinuxTerminalCompositionData(state, "é", 200)).toBe("é");
    expect(filterLinuxTerminalCompositionData(state, " ", 210)).toBe(" ");
  });

  it("collapses repeated composed output into one character", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 200);
    noteLinuxTerminalCompositionText(state, "é", "insertText", 210);

    expect(filterLinuxTerminalCompositionData(state, "ééé", 220)).toBe("é");
  });

  it("collapses repeated composed output and preserves trailing punctuation", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 240);
    noteLinuxTerminalCompositionText(state, "é", "insertText", 250);

    expect(filterLinuxTerminalCompositionData(state, "éé ", 260)).toBe("é ");
  });

  it("suppresses the immediate duplicate after committing composed text", () => {
    const state = createLinuxTerminalCompositionState();

    noteLinuxTerminalCompositionStart(state);
    noteLinuxTerminalCompositionEnd(state, 300);
    noteLinuxTerminalCompositionText(state, "é", "insertText", 310);

    expect(filterLinuxTerminalCompositionData(state, "é", 320)).toBe("é");
    expect(filterLinuxTerminalCompositionData(state, "é", 340)).toBeNull();
    expect(filterLinuxTerminalCompositionData(state, "é", 450)).toBe("é");
  });
});
