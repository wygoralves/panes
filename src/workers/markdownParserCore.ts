import hljs from "highlight.js/lib/common";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

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

function escapeNonFenceHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
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
      const safe = sanitizeUrl(rawValue);
      return ` ${attrName}="${safe}"`;
    },
  );

  return withSafeLinks.replace(
    /<a\b(?![^>]*\brel=)([^>]*)>/gi,
    "<a$1 rel=\"noreferrer noopener\">",
  );
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
  });

  let finalHtml = html;
  for (const fence of fences) {
    finalHtml = finalHtml.replace(fence.placeholder, fence.html);
  }

  return sanitizeRenderedHtml(finalHtml);
}

export const markdownParserCoreInternals = {
  parseFenceOpening,
  isFenceClosing,
  splitLinesWithEndings,
  tokenizeFences,
};

