import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFileStore } from "../stores/fileStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

const APP_SHORTCUTS_ALLOWED_WHILE_TERMINAL_FOCUSED = new Set(["d", "e", "k", "p", "t"]);

export function isLinuxDesktop(): boolean {
  return typeof navigator !== "undefined"
    && navigator.platform.toLowerCase().includes("linux")
    && isTauri();
}

export function isTerminalInputFocused(doc: Document | undefined = globalThis.document): boolean {
  const activeElement = doc?.activeElement;
  return typeof activeElement === "object"
    && activeElement !== null
    && "classList" in activeElement
    && typeof activeElement.classList.contains === "function"
    && activeElement.classList.contains("xterm-helper-textarea");
}

export function shouldHandleAppShortcutWhileTerminalFocused(key: string, shiftKey: boolean): boolean {
  const normalizedKey = key.toLowerCase();

  // Keep browser/WebView save-page suppression active in every focus state.
  if (normalizedKey === "s" && !shiftKey) {
    return true;
  }

  // These shortcuts are owned by the app and do not have a native-menu fallback.
  if (normalizedKey === "i" && shiftKey) {
    return true;
  }

  return APP_SHORTCUTS_ALLOWED_WHILE_TERMINAL_FOCUSED.has(normalizedKey);
}

export async function closeCurrentWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function requestWindowClose(): Promise<void> {
  const wsId = useWorkspaceStore.getState().activeWorkspaceId;
  const wsState = wsId ? useTerminalStore.getState().workspaces[wsId] : undefined;
  const fileState = useFileStore.getState();

  if (wsState?.layoutMode === "editor" && fileState.activeTabId) {
    fileState.requestCloseTab(fileState.activeTabId);
    return;
  }

  await closeCurrentWindow();
}
