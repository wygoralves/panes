import { describe, expect, it } from "vitest";
import { isTerminalCopyShortcut, isTerminalPasteShortcut } from "./terminalClipboard";

describe("terminalClipboard", () => {
  it("matches the Linux copy shortcut", () => {
    expect(
      isTerminalCopyShortcut({
        altKey: false,
        ctrlKey: true,
        key: "C",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
  });

  it("does not treat plain Ctrl+C as copy", () => {
    expect(
      isTerminalCopyShortcut({
        altKey: false,
        ctrlKey: true,
        key: "c",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("matches Ctrl+Shift+V paste", () => {
    expect(
      isTerminalPasteShortcut({
        altKey: false,
        ctrlKey: true,
        key: "v",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
  });

  it("matches Shift+Insert paste", () => {
    expect(
      isTerminalPasteShortcut({
        altKey: false,
        ctrlKey: false,
        key: "Insert",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
  });

  it("does not hijack other shifted keys", () => {
    expect(
      isTerminalPasteShortcut({
        altKey: false,
        ctrlKey: false,
        key: "v",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
  });
});
