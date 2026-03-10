import { t } from "../i18n";
import { toast } from "../stores/toastStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
  runFocusedEditorHistoryAction,
} from "../components/editor/CodeMirrorEditor";
import { readTextFromClipboard } from "./clipboard";
import { type EditMenuAction, shouldDispatchTerminalEditAction } from "./editMenu";
import { isTerminalInputFocused } from "./windowActions";

const TERMINAL_EDIT_EVENT = "panes:terminal-edit-action";

type TerminalEditAction = "copy" | "paste" | "select-all";

function dispatchTerminalEditAction(action: TerminalEditAction) {
  window.dispatchEvent(new CustomEvent<TerminalEditAction>(TERMINAL_EDIT_EVENT, {
    detail: action,
  }));
}

function hasFocusedTerminalSession(): boolean {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  if (!workspaceId) {
    return false;
  }

  const workspace = useTerminalStore.getState().workspaces[workspaceId];
  return Boolean(
    workspace?.focusedSessionId
      && (workspace.layoutMode === "terminal" || workspace.layoutMode === "split"),
  );
}

function getFocusedEditableElement():
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLElement
  | null {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    return activeElement;
  }
  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return activeElement;
  }
  return null;
}

function replaceTextInInput(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
) {
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  element.setRangeText(text, start, end, "end");
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: text,
    inputType: "insertFromPaste",
  }));
}

function insertTextIntoContentEditable(element: HTMLElement, text: string): boolean {
  element.focus();
  if (document.execCommand("insertText", false, text)) {
    return true;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: text,
    inputType: "insertFromPaste",
  }));
  return true;
}

export async function runEditMenuAction(action: EditMenuAction): Promise<void> {
  const activeElement = getFocusedEditableElement();
  if (shouldDispatchTerminalEditAction({
    action,
    hasFocusedEditableElement: activeElement !== null,
    hasFocusedTerminalSession: hasFocusedTerminalSession(),
    isTerminalFocused: isTerminalInputFocused(),
  })) {
    switch (action) {
      case "edit-copy":
        dispatchTerminalEditAction("copy");
        return;
      case "edit-paste":
        dispatchTerminalEditAction("paste");
        return;
      case "edit-select-all":
        dispatchTerminalEditAction("select-all");
        return;
      default:
        return;
    }
  }

  switch (action) {
    case "edit-undo":
      if (!runFocusedEditorHistoryAction("undo")) {
        document.execCommand("undo");
      }
      return;
    case "edit-redo":
      if (!runFocusedEditorHistoryAction("redo")) {
        document.execCommand("redo");
      }
      return;
    case "edit-cut":
      document.execCommand("cut");
      return;
    case "edit-copy":
      document.execCommand("copy");
      return;
    case "edit-select-all":
      document.execCommand("selectAll");
      return;
    case "edit-paste": {
      if (!activeElement) {
        return;
      }
      let text = "";
      try {
        text = await readTextFromClipboard();
      } catch (error) {
        toast.error(t("app:toasts.clipboardReadFailed", {
          error: error instanceof Error ? error.message : String(error),
        }));
        return;
      }
      if (!text) {
        return;
      }
      if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        replaceTextInInput(activeElement, text);
        return;
      }
      insertTextIntoContentEditable(activeElement, text);
      return;
    }
    default:
      return;
  }
}
