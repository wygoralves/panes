import hljs from "highlight.js/lib/common";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import {
  DISALLOWED_LOCAL_PREFIX_CHAR_RE,
  TEXT_LINK_PATTERN,
  isLocalFileLinkSyntax,
  trimLinkText,
} from "../lib/localFileLinkPatterns";

interface FenceToken {
  placeholder: string;
  html: string;
}

interface FenceOpening {
  markerChar: "`" | "~";
  markerLength: number;
  info: string;
}

interface IndentInfo {
  width: number;
  nextIndex: number;
}

const SAFE_HTML_TAG_RE = /<(br|hr)\s*\/?>/gi;
const RAW_HTML_FRAGMENT_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![a-z][^>]*>|<\?[\s\S]*?\?>|<\/[a-z][a-z0-9-]*\s*>|<[a-z][a-z0-9-]*(?:\s+(?:"[^"]*"|'[^']*'|[^"'<>])*)?\s*\/?>/gi;

function escapeHtmlFragment(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeNonFenceHtml(input: string): string {
  // Preserve known safe self-closing HTML tags (<br>, <hr>) by replacing them
  // with placeholders before escaping, then restoring after.
  const placeholders: { placeholder: string; tag: string }[] = [];
  let idx = 0;
  const withPlaceholders = input.replace(SAFE_HTML_TAG_RE, (match) => {
    const placeholder = `\x00SAFE_TAG_${idx++}\x00`;
    placeholders.push({ placeholder, tag: match });
    return placeholder;
  });

  let escaped = withPlaceholders.replace(
    RAW_HTML_FRAGMENT_RE,
    (match) => escapeHtmlFragment(match),
  );

  for (const { placeholder, tag } of placeholders) {
    escaped = escaped.replace(placeholder, tag);
  }

  return escaped;
}

function sanitizeUrl(url: string, attrName: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "#";
  }

  if (attrName.toLowerCase() === "href" && isLocalFileLinkSyntax(trimmed)) {
    return trimmed;
  }

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return trimmed;
  }

  return "#";
}

function sanitizeRenderedHtml(html: string): string {
  const withoutDangerousTags = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>[\s\S]*?<\/embed>/gi, "");

  const withoutEventHandlers = withoutDangerousTags.replace(
    /\s+on[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi,
    "",
  );

  const withSafeLinks = withoutEventHandlers.replace(
    /\s(href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_full, attrName: string, _quoted: string, doubleValue: string, singleValue: string) => {
      const rawValue = typeof doubleValue === "string" ? doubleValue : singleValue;
      const safe = sanitizeUrl(rawValue, attrName);
      return ` ${attrName}="${safe}"`;
    },
  );

  return withSafeLinks.replace(
    /<a\b(?![^>]*\brel=)([^>]*)>/gi,
    "<a$1 rel=\"noreferrer noopener\">",
  );
}

function escapeHtmlAttribute(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function linkifyLocalFileReferencesInText(text: string): string {
  return text.replace(TEXT_LINK_PATTERN, (raw, offset: number) => {
    const trimmed = trimLinkText(raw);
    if (
      !trimmed ||
      !isLocalFileLinkSyntax(trimmed) ||
      text.slice(Math.max(0, offset - 4), offset) === "&lt;" ||
      (offset > 0 && DISALLOWED_LOCAL_PREFIX_CHAR_RE.test(text[offset - 1] ?? ""))
    ) {
      return raw;
    }

    const trailing = raw.slice(trimmed.length);
    const safeHref = escapeHtmlAttribute(trimmed);
    return `<a href="${safeHref}" rel="noreferrer noopener">${trimmed}</a>${trailing}`;
  });
}

function linkifyLocalFileReferencesInHtml(html: string): string {
  const tagPattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
  const skipTags = new Set(["a", "pre"]);
  let result = "";
  let lastIndex = 0;
  let skipDepth = 0;

  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const tagName = (match[1] ?? "").toLowerCase();
    const index = match.index ?? 0;
    const text = html.slice(lastIndex, index);
    result += skipDepth > 0 ? text : linkifyLocalFileReferencesInText(text);
    result += tag;

    if (skipTags.has(tagName)) {
      const isClosing = tag.startsWith("</");
      const isSelfClosing = tag.endsWith("/>");
      if (isClosing) {
        skipDepth = Math.max(0, skipDepth - 1);
      } else if (!isSelfClosing) {
        skipDepth += 1;
      }
    }

    lastIndex = index + tag.length;
  }

  const remaining = html.slice(lastIndex);
  result += skipDepth > 0 ? remaining : linkifyLocalFileReferencesInText(remaining);
  return result;
}

function normalizeFenceLanguage(raw: string): string {
  const firstToken = raw.trim().split(/\s+/)[0] ?? "";
  return firstToken.toLowerCase();
}

function renderHighlightedFence(code: string, language: string): string {
  const normalizedLanguage = normalizeFenceLanguage(language);
  let highlighted: string;
  let languageClass = "";

  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    highlighted = hljs.highlight(code, { language: normalizedLanguage }).value;
    languageClass = ` language-${normalizedLanguage}`;
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }

  return `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`;
}

function removeLineBreak(line: string): string {
  if (line.endsWith("\r\n")) {
    return line.slice(0, -2);
  }
  if (line.endsWith("\n")) {
    return line.slice(0, -1);
  }
  return line;
}

function readIndentInfo(line: string): IndentInfo {
  let width = 0;
  let index = 0;
  while (index < line.length) {
    const current = line[index];
    if (current === " ") {
      width += 1;
      index += 1;
      continue;
    }
    if (current === "\t") {
      width += 4 - (width % 4);
      index += 1;
      continue;
    }
    break;
  }

  return {
    width,
    nextIndex: index,
  };
}

function parseFenceOpening(line: string): FenceOpening | null {
  const content = removeLineBreak(line);
  const indent = readIndentInfo(content);
  if (indent.width > 3) {
    return null;
  }

  const markerChar = content[indent.nextIndex];
  if (markerChar !== "`" && markerChar !== "~") {
    return null;
  }

  let markerEnd = indent.nextIndex;
  while (content[markerEnd] === markerChar) {
    markerEnd += 1;
  }

  const markerLength = markerEnd - indent.nextIndex;
  if (markerLength < 3) {
    return null;
  }

  const info = content.slice(markerEnd).trim();
  if (markerChar === "`" && info.includes("`")) {
    return null;
  }

  return {
    markerChar,
    markerLength,
    info,
  };
}

function isFenceClosing(
  line: string,
  markerChar: FenceOpening["markerChar"],
  minMarkerLength: number,
): boolean {
  const content = removeLineBreak(line);
  const indent = readIndentInfo(content);
  if (indent.width > 3) {
    return false;
  }

  let markerEnd = indent.nextIndex;
  while (content[markerEnd] === markerChar) {
    markerEnd += 1;
  }

  const markerLength = markerEnd - indent.nextIndex;
  if (markerLength < minMarkerLength) {
    return false;
  }

  const suffix = content.slice(markerEnd);
  return /^[ \t]*$/.test(suffix);
}

function splitLinesWithEndings(markdown: string): string[] {
  return markdown.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function tokenizeFences(markdown: string): { source: string; fences: FenceToken[] } {
  const lines = splitLinesWithEndings(markdown);
  const fences: FenceToken[] = [];
  let source = "";
  let plainBuffer = "";
  let fenceIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const opening = parseFenceOpening(lines[lineIndex]);
    if (!opening) {
      plainBuffer += lines[lineIndex];
      continue;
    }

    let closingIndex = -1;
    let code = "";
    for (let scanIndex = lineIndex + 1; scanIndex < lines.length; scanIndex += 1) {
      if (isFenceClosing(lines[scanIndex], opening.markerChar, opening.markerLength)) {
        closingIndex = scanIndex;
        break;
      }
      code += lines[scanIndex];
    }

    if (closingIndex < 0) {
      plainBuffer += lines.slice(lineIndex).join("");
      break;
    }

    if (plainBuffer) {
      source += escapeNonFenceHtml(plainBuffer);
      plainBuffer = "";
    }

    const placeholder = `<panes-code-block data-panes-id="${fenceIndex}"></panes-code-block>`;
    source += placeholder;

    fences.push({
      placeholder,
      html: renderHighlightedFence(code, opening.info),
    });

    fenceIndex += 1;
    lineIndex = closingIndex;
  }

  if (plainBuffer) {
    source += escapeNonFenceHtml(plainBuffer);
  }

  return { source, fences };
}

export function renderMarkdownToHtml(markdown: string): string {
  const { source, fences } = tokenizeFences(markdown);
  const html = micromark(source, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
    allowDangerousProtocol: true,
  });

  let finalHtml = html;
  for (const fence of fences) {
    finalHtml = finalHtml.replace(fence.placeholder, fence.html);
  }

  return linkifyLocalFileReferencesInHtml(sanitizeRenderedHtml(finalHtml));
}

export const markdownParserCoreInternals = {
  parseFenceOpening,
  isFenceClosing,
  splitLinesWithEndings,
  tokenizeFences,
};
