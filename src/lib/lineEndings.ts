import type { EditorLineEnding } from "../types";

/**
 * CRLF wins only when it is the majority, so mixed files settle on their dominant ending.
 * Text without a line break keeps the ending already known for the file.
 */
export function detectLineEnding(
  text: string,
  fallback: EditorLineEnding = "\n",
): EditorLineEnding {
  if (!text.includes("\n")) return fallback;
  const crlfCount = text.match(/\r\n/g)?.length ?? 0;
  const lfCount = (text.match(/\n/g)?.length ?? 0) - crlfCount;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

/** Matches how CodeMirror splits lines, so the editor buffer and the tab state agree. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function applyLineEnding(text: string, lineEnding: EditorLineEnding | undefined): string {
  return lineEnding === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * False when saving the normalized text with one ending would change bytes on disk:
 * mixed CRLF and LF, or a CR that is not followed by LF.
 */
export function hasUniformLineEndings(raw: string, lineEnding: EditorLineEnding): boolean {
  return applyLineEnding(normalizeLineEndings(raw), lineEnding) === raw;
}
