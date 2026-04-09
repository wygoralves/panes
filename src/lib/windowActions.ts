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

export function isWindowsDesktop(): boolean {
  return typeof navigator !== "undefined"
    && navigator.platform.toLowerCase().startsWith("win")
    && isTauri();
}

export function isMacDesktop(): boolean {
  return typeof navigator !== "undefined"
    && navigator.platform.startsWith("Mac")
    && isTauri();
}

export function usesCustomWindowFrame(): boolean {
  return isLinuxDesktop() || isWindowsDesktop();
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

  if (normalizedKey === "n" && shiftKey) {
    return true;
  }

  return APP_SHORTCUTS_ALLOWED_WHILE_TERMINAL_FOCUSED.has(normalizedKey);
}

export async function closeCurrentWindow(): Promise<void> {
  const currentWindow = getCurrentWindow();
  try {
    await currentWindow.close();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[windowActions] Failed to close current window, forcing destroy", error);
    }
    await currentWindow.destroy();
  }
}

export async function minimizeCurrentWindow(): Promise<void> {
  const currentWindow = getCurrentWindow();
  try {
    await currentWindow.minimize();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[windowActions] Failed to minimize current window, falling back to hide", error);
    }
    await currentWindow.hide();
  }
}

export async function toggleCurrentWindowMaximize(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

export async function toggleWindowFullscreen(): Promise<void> {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  await currentWindow.setFullscreen(!isFullscreen);
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
