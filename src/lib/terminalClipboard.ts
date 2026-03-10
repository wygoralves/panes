interface TerminalClipboardKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isTerminalCopyShortcut(event: TerminalClipboardKeyEvent): boolean {
  return (
    !event.altKey &&
    event.ctrlKey &&
    !event.metaKey &&
    event.shiftKey &&
    event.key.toLowerCase() === "c"
  );
}

export function isTerminalPasteShortcut(event: TerminalClipboardKeyEvent): boolean {
  const key = event.key.toLowerCase();

  if (
    !event.altKey &&
    event.ctrlKey &&
    !event.metaKey &&
    event.shiftKey &&
    key === "v"
  ) {
    return true;
  }

  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.shiftKey &&
    key === "insert"
  );
}
