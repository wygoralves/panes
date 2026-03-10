export type EditMenuAction =
  | "edit-undo"
  | "edit-redo"
  | "edit-cut"
  | "edit-copy"
  | "edit-paste"
  | "edit-select-all";

interface TerminalEditRoutingOptions {
  action: EditMenuAction;
  hasFocusedEditableElement: boolean;
  hasFocusedTerminalSession: boolean;
  isTerminalFocused: boolean;
}

const TERMINAL_EDIT_ACTIONS = new Set<EditMenuAction>([
  "edit-copy",
  "edit-paste",
  "edit-select-all",
]);

export function shouldDispatchTerminalEditAction({
  action,
  hasFocusedEditableElement,
  hasFocusedTerminalSession,
  isTerminalFocused,
}: TerminalEditRoutingOptions): boolean {
  if (!TERMINAL_EDIT_ACTIONS.has(action)) {
    return false;
  }

  if (isTerminalFocused) {
    return true;
  }

  return hasFocusedTerminalSession && !hasFocusedEditableElement;
}
