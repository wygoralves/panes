import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export const UI_ZOOM_STEPS = [70, 80, 90, 100, 110, 125, 150] as const;
export const DEFAULT_UI_ZOOM_PERCENT = 100;
export const MIN_UI_ZOOM_PERCENT = UI_ZOOM_STEPS[0];
export const MAX_UI_ZOOM_PERCENT = UI_ZOOM_STEPS[UI_ZOOM_STEPS.length - 1];

export function clampUiZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_UI_ZOOM_PERCENT;
  return Math.min(MAX_UI_ZOOM_PERCENT, Math.max(MIN_UI_ZOOM_PERCENT, Math.round(value)));
}

/** The next zoom step above or below `current`, staying within the supported range. */
export function nextUiZoomPercent(current: number, direction: 1 | -1): number {
  const clamped = clampUiZoomPercent(current);
  if (direction === 1) {
    return UI_ZOOM_STEPS.find((step) => step > clamped) ?? MAX_UI_ZOOM_PERCENT;
  }
  return [...UI_ZOOM_STEPS].reverse().find((step) => step < clamped) ?? MIN_UI_ZOOM_PERCENT;
}

/**
 * Scales the page through the webview's own zoom, like browser zoom, so
 * layout, viewport units, and fixed positioning stay consistent.
 */
export async function applyUiZoomPercent(percent: number): Promise<void> {
  if (!isTauri()) return;
  try {
    await getCurrentWebview().setZoom(percent / 100);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[uiZoom] Failed to apply webview zoom", error);
    }
  }
}
