const TERMINAL_ACCELERATED_RENDERING_EVENT =
  "panes:terminal-accelerated-rendering-changed";

let terminalAcceleratedRenderingPreferenceVersion = 0;

export interface TerminalAcceleratedRenderingEventDetail {
  enabled: boolean;
}

export function getTerminalAcceleratedRenderingPreferenceVersion(): number {
  return terminalAcceleratedRenderingPreferenceVersion;
}

export function emitTerminalAcceleratedRenderingChanged(enabled: boolean) {
  terminalAcceleratedRenderingPreferenceVersion += 1;
  window.dispatchEvent(
    new CustomEvent<TerminalAcceleratedRenderingEventDetail>(
      TERMINAL_ACCELERATED_RENDERING_EVENT,
      {
        detail: { enabled },
      },
    ),
  );
}

export function listenTerminalAcceleratedRenderingChanged(
  handler: (enabled: boolean) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TerminalAcceleratedRenderingEventDetail>).detail;
    handler(detail.enabled);
  };
  window.addEventListener(TERMINAL_ACCELERATED_RENDERING_EVENT, listener);
  return () =>
    window.removeEventListener(TERMINAL_ACCELERATED_RENDERING_EVENT, listener);
}
