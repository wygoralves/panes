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

/** Scales the whole document. WebKit and Chromium both honor CSS zoom on the root. */
export function applyUiZoomPercent(percent: number) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.zoom = percent === DEFAULT_UI_ZOOM_PERCENT ? "" : `${percent}%`;
}
