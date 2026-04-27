const SPECIAL_FILE_NAMES = new Set([
  ".env",
  ".env.example",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  ".prettierignore",
  ".eslintrc",
  ".editorconfig",
  "AGENTS.md",
  "Cargo.toml",
  "Cargo.lock",
  "Dockerfile",
  "Makefile",
  "README",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vite.config.ts",
]);

const CHUNK_REGEX = /\S+/g;
const TRIM_LEADING_CHARS = new Set(["(", "[", "{", "<", "\"", "'", "`", "*"]);
const TRIM_TRAILING_CHARS = new Set([")", "]", "}", ">", "\"", "'", "`", "*", ",", ";", "!", "?"]);
const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface ParsedFileReference {
  path: string;
  line?: number;
  column?: number;
}

export interface FileReferenceMatch {
  start: number;
  end: number;
  rawReference: string;
  path: string;
  line?: number;
  column?: number;
}

export function isLikelyFileReferencePath(rawValue: string): boolean {
  const parsed = parseFileReference(rawValue);
  if (!parsed) {
    return false;
  }

  const normalizedPath = parsed.path.trim();
  if (!normalizedPath || normalizedPath.includes("://")) {
    return false;
  }

  const basename = normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath;
  if (!basename || basename === "." || basename === "..") {
    return false;
  }

  if (SPECIAL_FILE_NAMES.has(basename)) {
    return true;
  }

  if (basename.startsWith(".") && basename.length > 1) {
    return true;
  }

  const lastDot = basename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return false;
  }

  const extension = basename.slice(lastDot + 1);
  return /[A-Za-z]/.test(extension);
}

export function parseFileReference(rawValue: string): ParsedFileReference | null {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.includes("://")) {
    return null;
  }

  const hashParsed = parseHashLocation(trimmed);
  const colonParsed = hashParsed ?? parseColonLocation(trimmed);
  const parsed = colonParsed ?? { path: trimmed };

  if (!parsed.path.trim()) {
    return null;
  }

  if (!looksLikeFilePath(parsed.path)) {
    return null;
  }

  return parsed;
}

export function isEditorFileReferenceHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return false;
  }

  return isLikelyFileReferencePath(trimmed);
}

export function findFileReferenceMatches(text: string): FileReferenceMatch[] {
  const matches: FileReferenceMatch[] = [];
  for (const chunk of text.matchAll(CHUNK_REGEX)) {
    const rawChunk = chunk[0];
    const chunkStart = chunk.index ?? 0;
    const trimmed = trimChunk(rawChunk);
    if (!trimmed) {
      continue;
    }

    const parsed = parseFileReference(trimmed.value);
    if (!parsed) {
      continue;
    }

    matches.push({
      start: chunkStart + trimmed.startOffset,
      end: chunkStart + trimmed.endOffset,
      rawReference: trimmed.value,
      path: parsed.path,
      line: parsed.line,
      column: parsed.column,
    });
  }

  return matches;
}

export function linkifyMarkdownFileReferences(markdown: string): string {
  const lines = markdown.split(/(\r?\n)/);
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let result = "";

  for (const line of lines) {
    if (line === "\n" || line === "\r\n") {
      result += line;
      continue;
    }

    const fenceInfo = readFenceInfo(line);
    if (fence) {
      result += line;
      if (
        fenceInfo &&
        fenceInfo.marker === fence.marker &&
        fenceInfo.length >= fence.length &&
        isFenceClosingLine(line, fence.marker)
      ) {
        fence = null;
      }
      continue;
    }

    if (fenceInfo) {
      fence = fenceInfo;
      result += line;
      continue;
    }

    result += linkifyMarkdownLine(line);
  }

  return result;
}

function trimChunk(value: string): { value: string; startOffset: number; endOffset: number } | null {
  let startOffset = 0;
  let endOffset = value.length;

  while (startOffset < endOffset && TRIM_LEADING_CHARS.has(value[startOffset])) {
    startOffset += 1;
  }

  while (endOffset > startOffset) {
    const char = value[endOffset - 1];
    if (TRIM_TRAILING_CHARS.has(char)) {
      endOffset -= 1;
      continue;
    }

    if (char === ".") {
      const slice = value.slice(startOffset, endOffset);
      if (!slice.endsWith("..") && !slice.startsWith(".")) {
        endOffset -= 1;
        continue;
      }
    }

    break;
  }

  if (startOffset >= endOffset) {
    return null;
  }

  return {
    value: value.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  };
}

function looksLikeFilePath(path: string): boolean {
  if (!path || path === "." || path === ".." || path.endsWith("/")) {
    return false;
  }

  const basename = path.split("/").filter(Boolean).pop() ?? path;
  if (!basename) {
    return false;
  }

  if (SPECIAL_FILE_NAMES.has(basename)) {
    return true;
  }

  if (basename.startsWith(".") && basename.length > 1) {
    return true;
  }

  const lastDot = basename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return false;
  }

  const extension = basename.slice(lastDot + 1);
  return /[A-Za-z]/.test(extension);
}

function parseHashLocation(input: string): ParsedFileReference | null {
  const hashIndex = input.lastIndexOf("#");
  if (hashIndex < 0) {
    return null;
  }

  const suffix = input.slice(hashIndex + 1);
  const hashMatch = /^([Ll])(\d+)(?:([Cc])(\d+))?$/.exec(suffix);
  if (!hashMatch) {
    return null;
  }

  const line = Number(hashMatch[2]);
  const column = hashMatch[4] ? Number(hashMatch[4]) : undefined;
  if (!Number.isInteger(line) || line <= 0) {
    return null;
  }
  if (column !== undefined && (!Number.isInteger(column) || column <= 0)) {
    return null;
  }

  return {
    path: input.slice(0, hashIndex),
    line,
    column,
  };
}

function parseColonLocation(input: string): ParsedFileReference | null {
  const lastColon = input.lastIndexOf(":");
  if (lastColon < 0) {
    return null;
  }

  const lastSegment = input.slice(lastColon + 1);
  if (!/^\d+$/.test(lastSegment)) {
    return null;
  }

  let base = input.slice(0, lastColon);
  let line = Number(lastSegment);
  let column: number | undefined;
  if (!Number.isInteger(line) || line <= 0) {
    return null;
  }

  const secondColon = base.lastIndexOf(":");
  if (secondColon >= 0) {
    const secondSegment = base.slice(secondColon + 1);
    if (/^\d+$/.test(secondSegment)) {
      const parsedLine = Number(secondSegment);
      if (!Number.isInteger(parsedLine) || parsedLine <= 0) {
        return null;
      }
      column = line;
      line = parsedLine;
      base = base.slice(0, secondColon);
    }
  }

  return {
    path: base,
    line,
    column,
  };
}

function linkifyMarkdownLine(line: string): string {
  let result = "";
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    if (char === "`") {
      const backtickMatch = /^`+/.exec(line.slice(index));
      const fence = backtickMatch?.[0] ?? "`";
      const closingIndex = line.indexOf(fence, index + fence.length);
      if (closingIndex >= 0) {
        result += line.slice(index, closingIndex + fence.length);
        index = closingIndex + fence.length;
        continue;
      }
    }

    if (char === "[") {
      const closingBracket = line.indexOf("](", index);
      if (closingBracket >= 0) {
        const closingParen = findClosingParen(line, closingBracket + 2);
        if (closingParen >= 0) {
          result += line.slice(index, closingParen + 1);
          index = closingParen + 1;
          continue;
        }
      }
    }

    if (char === "<") {
      const protectedSpanEnd = readProtectedAngleSpan(line, index);
      if (protectedSpanEnd !== null) {
        result += line.slice(index, protectedSpanEnd);
        index = protectedSpanEnd;
        continue;
      }
    }

    let nextSpecial = line.length;
    for (const special of ["`", "[", "<"]) {
      const specialIndex = line.indexOf(special, index + 1);
      if (specialIndex >= 0) {
        nextSpecial = Math.min(nextSpecial, specialIndex);
      }
    }

    result += linkifyPlainTextSegment(line.slice(index, nextSpecial));
    index = nextSpecial;
  }

  return result;
}

function linkifyPlainTextSegment(segment: string): string {
  const matches = findFileReferenceMatches(segment);
  if (matches.length === 0) {
    return segment;
  }

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += segment.slice(cursor, match.start);
    const label = escapeMarkdownLinkText(match.rawReference);
    const destination = escapeMarkdownLinkDestination(match.rawReference);
    result += `[${label}](<${destination}>)`;
    cursor = match.end;
  }
  result += segment.slice(cursor);
  return result;
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\\[\]])/g, "\\$1");
}

function escapeMarkdownLinkDestination(value: string): string {
  return value.replace(/[<>]/g, "");
}

function readFenceInfo(line: string): { marker: "`" | "~"; length: number } | null {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  if (!match) {
    return null;
  }

  return {
    marker: match[2][0] as "`" | "~",
    length: match[2].length,
  };
}

function isFenceClosingLine(line: string, marker: "`" | "~"): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})([ \t]*)$/.exec(line);
  return Boolean(match && match[2][0] === marker);
}

function findClosingParen(line: string, start: number): number {
  let depth = 1;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function readProtectedAngleSpan(line: string, start: number): number | null {
  const closingAngle = findInlineHtmlTagEnd(line, start + 1);
  if (closingAngle < 0) {
    return null;
  }

  const contents = line.slice(start + 1, closingAngle);
  if (contents.includes("://") || contents.startsWith("mailto:") || contents.startsWith("tel:")) {
    return closingAngle + 1;
  }

  if (contents.startsWith("!--")) {
    const commentEnd = line.indexOf("-->", start + 4);
    return commentEnd >= 0 ? commentEnd + 3 : closingAngle + 1;
  }

  const tagMatch = /^\/?\s*([A-Za-z][A-Za-z0-9:-]*)\b/.exec(contents);
  if (!tagMatch) {
    return null;
  }

  const tagName = tagMatch[1].toLowerCase();
  const isClosingTag = /^\//.test(contents.trimStart());
  const isSelfClosing = /\/\s*$/.test(contents);
  if (isClosingTag || isSelfClosing || VOID_HTML_TAGS.has(tagName)) {
    return closingAngle + 1;
  }

  const closingTag = new RegExp(`</\\s*${escapeRegExp(tagName)}\\s*>`, "i");
  const remainder = line.slice(closingAngle + 1);
  const closingMatch = closingTag.exec(remainder);
  if (!closingMatch || closingMatch.index === undefined) {
    return closingAngle + 1;
  }

  return closingAngle + 1 + closingMatch.index + closingMatch[0].length;
}

function findInlineHtmlTagEnd(line: string, start: number): number {
  let quote: "\"" | "'" | null = null;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") {
      return index;
    }
  }

  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
