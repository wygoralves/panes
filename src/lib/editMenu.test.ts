import { describe, expect, it } from "vitest";
import { shouldDispatchTerminalEditAction, type EditMenuAction } from "./editMenu";

function route(action: EditMenuAction, options?: Partial<{
  hasFocusedEditableElement: boolean;
  hasFocusedTerminalSession: boolean;
  isTerminalFocused: boolean;
}>) {
  return shouldDispatchTerminalEditAction({
    action,
    hasFocusedEditableElement: options?.hasFocusedEditableElement ?? false,
    hasFocusedTerminalSession: options?.hasFocusedTerminalSession ?? false,
    isTerminalFocused: options?.isTerminalFocused ?? false,
  });
}

describe("editMenu", () => {
  it("routes terminal clipboard actions when xterm is focused", () => {
    expect(route("edit-copy", { isTerminalFocused: true })).toBe(true);
    expect(route("edit-paste", { isTerminalFocused: true })).toBe(true);
    expect(route("edit-select-all", { isTerminalFocused: true })).toBe(true);
  });

  it("keeps routing to the focused terminal after native menu blur", () => {
    expect(route("edit-paste", { hasFocusedTerminalSession: true })).toBe(true);
  });

  it("does not hijack another editable element", () => {
    expect(route("edit-paste", {
      hasFocusedEditableElement: true,
      hasFocusedTerminalSession: true,
    })).toBe(false);
  });

  it("never routes non-terminal actions to the terminal", () => {
    expect(route("edit-cut", {
      hasFocusedTerminalSession: true,
      isTerminalFocused: true,
    })).toBe(false);
    expect(route("edit-undo", {
      hasFocusedTerminalSession: true,
      isTerminalFocused: true,
    })).toBe(false);
  });
});
