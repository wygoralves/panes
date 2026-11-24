import { describe, expect, it } from "vitest";
import { isExplorerTextFieldTarget } from "./FileExplorer";

function fakeElement(matchesTextField: boolean): Element {
  const element = {
    closest: (selector: string) =>
      matchesTextField && selector.includes("input") ? element : null,
  };
  return element as unknown as Element;
}

describe("isExplorerTextFieldTarget", () => {
  it("treats Backspace on the filter input as typing, not a delete shortcut", () => {
    const container = fakeElement(false);
    const filterInput = fakeElement(true);

    expect(isExplorerTextFieldTarget(filterInput, container)).toBe(true);
  });

  it("keeps shortcuts for the explorer container and its rows", () => {
    const container = fakeElement(false);
    const row = fakeElement(false);

    expect(isExplorerTextFieldTarget(container, container)).toBe(false);
    expect(isExplorerTextFieldTarget(row, container)).toBe(false);
  });
});
