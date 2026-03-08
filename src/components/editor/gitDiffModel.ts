import { diffLines } from "diff";

export type LineHighlightKind = "added" | "removed";

export interface LineHighlightRange {
  fromLine: number;
  toLine: number;
  kind: LineHighlightKind;
}

export interface DiffHighlightResult {
  base: LineHighlightRange[];
  modified: LineHighlightRange[];
}

export type DiffHunkKind = "added" | "removed" | "modified";

export interface DiffHunkRange {
  fromLine: number;
  toLine: number;
}

export interface DiffHunk {
  id: string;
  kind: DiffHunkKind;
  baseRange: DiffHunkRange | null;
  modifiedRange: DiffHunkRange | null;
  baseAnchorLine: number;
  modifiedAnchorLine: number;
  primarySide: "base" | "modified";
  primaryLine: number;
}

export interface DiffHunkAnchor {
  primarySide: "base" | "modified";
  primaryLine: number;
  secondaryLine: number | null;
}

export interface GitDiffModel {
  highlights: DiffHighlightResult;
  hunks: DiffHunk[];
}

interface PendingHunk {
  baseRange: DiffHunkRange | null;
  modifiedRange: DiffHunkRange | null;
  baseAnchorLine: number;
  modifiedAnchorLine: number;
  sawAdded: boolean;
  sawRemoved: boolean;
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function pushRange(
  target: LineHighlightRange[],
  fromLine: number,
  toLine: number,
  kind: LineHighlightKind,
) {
  if (toLine < fromLine) {
    return;
  }

  const previous = target[target.length - 1];
  if (previous && previous.kind === kind && previous.toLine + 1 >= fromLine) {
    previous.toLine = Math.max(previous.toLine, toLine);
    return;
  }

  target.push({ fromLine, toLine, kind });
}

function countChunkLines(value: string, fallbackCount?: number): number {
  if (fallbackCount !== undefined) {
    return fallbackCount;
  }
  return splitLines(value).length;
}

function cloneRange(range: DiffHunkRange | null): DiffHunkRange | null {
  if (!range) {
    return null;
  }
  return { fromLine: range.fromLine, toLine: range.toLine };
}

function finalizePendingHunk(
  target: DiffHunk[],
  pending: PendingHunk | null,
  nextId: number,
): number {
  if (!pending) {
    return nextId;
  }

  const kind =
    pending.sawAdded && pending.sawRemoved
      ? "modified"
      : pending.sawAdded
        ? "added"
        : "removed";
  const baseRange = cloneRange(pending.baseRange);
  const modifiedRange = cloneRange(pending.modifiedRange);
  const primarySide = modifiedRange ? "modified" : "base";
  const primaryLine = modifiedRange?.fromLine ?? baseRange?.fromLine ?? 1;

  target.push({
    id: `hunk-${nextId}`,
    kind,
    baseRange,
    modifiedRange,
    baseAnchorLine: pending.baseAnchorLine,
    modifiedAnchorLine: pending.modifiedAnchorLine,
    primarySide,
    primaryLine,
  });

  return nextId + 1;
}

export function buildGitDiffModel(
  baseContent: string,
  modifiedContent: string,
): GitDiffModel {
  const base: LineHighlightRange[] = [];
  const modified: LineHighlightRange[] = [];
  const hunks: DiffHunk[] = [];
  let baseLine = 1;
  let modifiedLine = 1;
  let nextHunkId = 0;
  let pending: PendingHunk | null = null;

  for (const chunk of diffLines(baseContent, modifiedContent)) {
    const lineCount = countChunkLines(chunk.value, chunk.count);
    if (lineCount === 0) {
      continue;
    }

    if (!chunk.added && !chunk.removed) {
      nextHunkId = finalizePendingHunk(hunks, pending, nextHunkId);
      pending = null;
      baseLine += lineCount;
      modifiedLine += lineCount;
      continue;
    }

    if (!pending) {
      pending = {
        baseRange: null,
        modifiedRange: null,
        baseAnchorLine: baseLine,
        modifiedAnchorLine: modifiedLine,
        sawAdded: false,
        sawRemoved: false,
      };
    }

    if (chunk.removed) {
      const fromLine = baseLine;
      const toLine = baseLine + lineCount - 1;
      pushRange(base, fromLine, toLine, "removed");
      pending.baseRange = pending.baseRange
        ? { fromLine: pending.baseRange.fromLine, toLine }
        : { fromLine, toLine };
      pending.sawRemoved = true;
      baseLine += lineCount;
      continue;
    }

    const fromLine = modifiedLine;
    const toLine = modifiedLine + lineCount - 1;
    pushRange(modified, fromLine, toLine, "added");
    pending.modifiedRange = pending.modifiedRange
      ? { fromLine: pending.modifiedRange.fromLine, toLine }
      : { fromLine, toLine };
    pending.sawAdded = true;
    modifiedLine += lineCount;
  }

  finalizePendingHunk(hunks, pending, nextHunkId);

  return {
    highlights: { base, modified },
    hunks,
  };
}

export function getDiffHunkAnchor(hunk: DiffHunk): DiffHunkAnchor {
  return {
    primarySide: hunk.primarySide,
    primaryLine: hunk.primaryLine,
    secondaryLine:
      hunk.primarySide === "modified"
        ? hunk.baseRange?.fromLine ?? hunk.baseAnchorLine
        : hunk.modifiedRange?.fromLine ?? hunk.modifiedAnchorLine,
  };
}

export function getDiffHunkLine(
  hunk: DiffHunk,
  pane: "base" | "modified",
): number {
  if (pane === "base") {
    return hunk.baseRange?.fromLine ?? hunk.baseAnchorLine;
  }

  return hunk.modifiedRange?.fromLine ?? hunk.modifiedAnchorLine;
}

function getAnchorDistance(hunk: DiffHunk, anchor: DiffHunkAnchor): number {
  const preferredLine =
    anchor.primarySide === "modified"
      ? hunk.modifiedRange?.fromLine ?? null
      : hunk.baseRange?.fromLine ?? null;
  if (preferredLine !== null) {
    return Math.abs(preferredLine - anchor.primaryLine);
  }

  const fallbackLine =
    anchor.primarySide === "modified"
      ? hunk.baseRange?.fromLine ?? null
      : hunk.modifiedRange?.fromLine ?? null;
  if (fallbackLine !== null) {
    const fallbackTarget = anchor.secondaryLine ?? anchor.primaryLine;
    return 10_000 + Math.abs(fallbackLine - fallbackTarget);
  }

  return Number.POSITIVE_INFINITY;
}

export function pickClosestHunkIndex(
  hunks: DiffHunk[],
  anchor: DiffHunkAnchor | null,
): number | null {
  if (hunks.length === 0) {
    return null;
  }

  if (!anchor) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [index, hunk] of hunks.entries()) {
    const distance = getAnchorDistance(hunk, anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function hunkContainsAnchor(
  hunk: DiffHunk,
  anchor: DiffHunkAnchor | null,
): boolean {
  if (!anchor) {
    return false;
  }

  const preferredRange =
    anchor.primarySide === "modified" ? hunk.modifiedRange : hunk.baseRange;
  if (preferredRange) {
    return (
      anchor.primaryLine >= preferredRange.fromLine
      && anchor.primaryLine <= preferredRange.toLine
    );
  }

  const fallbackRange =
    anchor.primarySide === "modified" ? hunk.baseRange : hunk.modifiedRange;
  if (!fallbackRange || anchor.secondaryLine === null) {
    return false;
  }

  return (
    anchor.secondaryLine >= fallbackRange.fromLine
    && anchor.secondaryLine <= fallbackRange.toLine
  );
}
