/** Line-level stats and a short preview for a unified diff, without a full parse. */

export interface DiffStats {
  adds: number;
  dels: number;
}

export type DiffPreviewTone = "add" | "del" | "ctx";

export interface DiffPreviewLine {
  tone: DiffPreviewTone;
  text: string;
}

function isFileHeader(line: string): boolean {
  return line.startsWith("+++") || line.startsWith("---");
}

export function countDiffStats(diff: string): DiffStats {
  let adds = 0;
  let dels = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || isFileHeader(line)) continue;
    if (line.startsWith("+")) adds += 1;
    else if (line.startsWith("-")) dels += 1;
  }
  if (!inHunk) {
    // Some engines send bare +/- lines without hunk headers.
    for (const line of diff.split("\n")) {
      if (isFileHeader(line)) continue;
      if (line.startsWith("+")) adds += 1;
      else if (line.startsWith("-")) dels += 1;
    }
  }
  return { adds, dels };
}

/** The first changed lines of a diff with a little context, for a hover preview. */
export function previewDiffLines(diff: string, max = 6): DiffPreviewLine[] {
  const out: DiffPreviewLine[] = [];
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (out.length >= max) break;
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || isFileHeader(line)) continue;
    if (line.startsWith("+")) out.push({ tone: "add", text: line.slice(1) });
    else if (line.startsWith("-")) out.push({ tone: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) out.push({ tone: "ctx", text: line.slice(1) });
  }
  return out;
}

/** Whether an action summary reads as a file path rather than prose. */
export function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^[\w@~./\\-]+\.[A-Za-z0-9]+$/.test(trimmed) || (trimmed.includes("/") && !trimmed.includes("://"));
}
