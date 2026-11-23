import hljs from "highlight.js/lib/common";
import { micromark, type Options } from "micromark";
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

type HtmlExtension = NonNullable<Options["htmlExtensions"]>[number];

const SAFE_HTML_TAG_RE = /^<(?:br|hr)\s*\/?>$/i;
// Fenced code is swapped for a plain-text sentinel before micromark runs, so
// the highlighted HTML never passes through the markdown parser.
const FENCE_SENTINEL_CHAR = "\uE000";

// micromark encodes every raw HTML fragment as text. The one exception is a
// lone <br> or <hr>, which is passed through as markup.
const safeHtmlTagExtension: HtmlExtension = {
  enter: {
    htmlFlow(token) {
      this.lineEndingIfNeeded();
      if (SAFE_HTML_TAG_RE.test(this.sliceSerialize(token).trim())) {
        this.setData("ignoreEncode", true);
      }
    },
    htmlText(token) {
      if (SAFE_HTML_TAG_RE.test(this.sliceSerialize(token))) {
        this.setData("ignoreEncode", true);
      }
    },
  },
};

function sanitizeUrl(url: string, attrName: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "#";
  }

  if (attrName.toLowerCase() === "href" && isLocalFileLinkSyntax(trimmed)) {
    return trimmed;
  }

  // Protocol-relative ("//host") and backslash-prefixed links resolve to a
  // remote host against the app origin, so they never pass as relative paths.
  if (/^[\\/]{2}/.test(trimmed)) {
    return "#";
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
  const withSafeLinks = html.replace(
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

    // An unclosed fence (a code block still streaming in) renders the same way
    // a closed one does, so finishing the block does not restyle it.
    if (plainBuffer) {
      source += plainBuffer;
      plainBuffer = "";
    }

    // The sentinel sits in its own paragraph so micromark renders it as
    // `<p>sentinel</p>`, which is then swapped for the highlighted block.
    const placeholder = `${FENCE_SENTINEL_CHAR}PANES_FENCE_${fenceIndex}${FENCE_SENTINEL_CHAR}`;
    source += `\n${placeholder}\n\n`;

    fences.push({
      placeholder,
      html: renderHighlightedFence(code, opening.info),
    });

    fenceIndex += 1;
    if (closingIndex < 0) {
      break;
    }
    lineIndex = closingIndex;
  }

  if (plainBuffer) {
    source += plainBuffer;
  }

  return { source, fences };
}

export function renderMarkdownToHtml(markdown: string): string {
  const { source, fences } = tokenizeFences(markdown);
  const html = micromark(source, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml(), safeHtmlTagExtension],
    allowDangerousHtml: false,
    // Link protocols are checked by sanitizeUrl, which also admits local
    // file links that micromark's own allowlist would drop.
    allowDangerousProtocol: true,
  });

  let finalHtml = html;
  for (const fence of fences) {
    const paragraph = `<p>${fence.placeholder}</p>`;
    finalHtml = finalHtml.includes(paragraph)
      ? finalHtml.replace(paragraph, () => fence.html)
      : finalHtml.replace(fence.placeholder, () => fence.html);
  }

  return linkifyLocalFileReferencesInHtml(sanitizeRenderedHtml(finalHtml));
}

export const markdownParserCoreInternals = {
  parseFenceOpening,
  isFenceClosing,
  splitLinesWithEndings,
  tokenizeFences,
};
