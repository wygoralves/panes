export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

export function clampTerminalFontSize(fontSize: number): number {
  if (Number.isNaN(fontSize)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(fontSize)));
}

const TERMINAL_FONT_SIZE_EVENT = "panes:terminal-font-size-changed";

let terminalFontSizePreferenceVersion = 0;

export interface TerminalFontSizeEventDetail {
  fontSize: number;
}

export function getTerminalFontSizePreferenceVersion(): number {
  return terminalFontSizePreferenceVersion;
}

export function emitTerminalFontSizeChanged(fontSize: number) {
  terminalFontSizePreferenceVersion += 1;
  window.dispatchEvent(
    new CustomEvent<TerminalFontSizeEventDetail>(TERMINAL_FONT_SIZE_EVENT, {
      detail: { fontSize },
    }),
  );
}

export function listenTerminalFontSizeChanged(
  handler: (fontSize: number) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TerminalFontSizeEventDetail>).detail;
    handler(detail.fontSize);
  };
  window.addEventListener(TERMINAL_FONT_SIZE_EVENT, listener);
  return () => window.removeEventListener(TERMINAL_FONT_SIZE_EVENT, listener);
}
