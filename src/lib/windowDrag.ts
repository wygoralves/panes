import { getCurrentWindow } from "@tauri-apps/api/window";

const INTERACTIVE = "button, input, textarea, select, a, .dropdown-menu";

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(INTERACTIVE) !== null;
}

function reportWindowActionError(action: string, error: unknown) {
  if (import.meta.env.DEV) {
    console.warn(`[windowDrag] Failed to ${action}`, error);
  }
}

export function handleDragMouseDown(e: React.MouseEvent) {
  if (e.button !== 0) return;
  if (isInteractive(e.target)) return;
  getCurrentWindow().startDragging().catch((error) => {
    reportWindowActionError("start dragging window", error);
  });
}

export function handleDragDoubleClick(e: React.MouseEvent) {
  if (isInteractive(e.target)) return;
  getCurrentWindow().toggleMaximize().catch((error) => {
    reportWindowActionError("toggle maximize window", error);
  });
}
