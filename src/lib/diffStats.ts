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

/**
 * Classify each line of a diff as a change, context, or metadata.
 *
 * Inside a hunk (after `@@`) every line beginning with `+`, `-`, or a space is
 * content, so `+++counter;` counts as an addition rather than a file header.
 * A non-empty line with any other prefix ends the hunk; that covers the
 * `diff --git`, `index`, `---`, and `+++` lines that introduce the next file.
 *
 * Some engines send bare `+`/`-` lines with no hunk header at all. In that
 * mode every line is treated as content, except a `--- `/`+++ ` pair, which is
 * the only header shape that can appear there.
 */
function classifyDiffLines(diff: string): DiffPreviewLine[] {
  const lines = diff.split("\n");
  const hasHunks = lines.some((line) => line.startsWith("@@"));
  const out: DiffPreviewLine[] = [];
  let inHunk = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;

    if (hasHunks) {
      if (line.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
    } else if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      i += 1;
      continue;
    }

    const prefix = line[0];
    if (prefix === "+") out.push({ tone: "add", text: line.slice(1) });
    else if (prefix === "-") out.push({ tone: "del", text: line.slice(1) });
    else if (prefix === " ") out.push({ tone: "ctx", text: line.slice(1) });
    else if (prefix !== "\\") inHunk = false;
  }
  return out;
}

export function countDiffStats(diff: string): DiffStats {
  let adds = 0;
  let dels = 0;
  for (const { tone } of classifyDiffLines(diff)) {
    if (tone === "add") adds += 1;
    else if (tone === "del") dels += 1;
  }
  return { adds, dels };
}

/** The first changed lines of a diff with a little context, for a hover preview. */
export function previewDiffLines(diff: string, max = 6): DiffPreviewLine[] {
  return classifyDiffLines(diff).slice(0, max);
}

/** Whether an action summary reads as a file path rather than prose. */
export function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^[\w@~./\\-]+\.[A-Za-z0-9]+$/.test(trimmed) || (trimmed.includes("/") && !trimmed.includes("://"));
}
