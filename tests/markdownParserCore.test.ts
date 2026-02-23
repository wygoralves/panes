import { describe, expect, it } from "vitest";
import {
  markdownParserCoreInternals,
  renderMarkdownToHtml,
} from "../src/workers/markdownParserCore";

// ── parseFenceOpening ───────────────────────────────────────────────

describe("markdownParserCoreInternals.parseFenceOpening", () => {
  it("parses backtick and tilde fences", () => {
    expect(markdownParserCoreInternals.parseFenceOpening("```ts\n")).toEqual({
      markerChar: "`",
      markerLength: 3,
      info: "ts",
    });
    expect(markdownParserCoreInternals.parseFenceOpening("~~~~bash   \n")).toEqual({
      markerChar: "~",
      markerLength: 4,
      info: "bash",
    });
  });

  it("accepts indentation up to 3 columns and rejects 4+", () => {
    expect(markdownParserCoreInternals.parseFenceOpening("   ```js\n")).not.toBeNull();
    expect(markdownParserCoreInternals.parseFenceOpening("    ```js\n")).toBeNull();
    expect(markdownParserCoreInternals.parseFenceOpening("\t```js\n")).toBeNull();
    expect(markdownParserCoreInternals.parseFenceOpening(" \t```js\n")).toBeNull();
  });

  it("returns null for lines with fewer than 3 markers", () => {
    expect(markdownParserCoreInternals.parseFenceOpening("``js\n")).toBeNull();
    expect(markdownParserCoreInternals.parseFenceOpening("~~py\n")).toBeNull();
  });

  it("returns null for non-fence lines", () => {
    expect(markdownParserCoreInternals.parseFenceOpening("plain text\n")).toBeNull();
    expect(markdownParserCoreInternals.parseFenceOpening("\n")).toBeNull();
    expect(markdownParserCoreInternals.parseFenceOpening("")).toBeNull();
  });

  it("rejects backtick fences with backtick in info string", () => {
    expect(markdownParserCoreInternals.parseFenceOpening("```js`extra\n")).toBeNull();
  });

  it("allows tilde fences with backtick in info string", () => {
    const result = markdownParserCoreInternals.parseFenceOpening("~~~js`extra\n");
    expect(result).not.toBeNull();
    expect(result?.info).toBe("js`extra");
  });

  it("parses fence with no language info", () => {
    const result = markdownParserCoreInternals.parseFenceOpening("```\n");
    expect(result).toEqual({ markerChar: "`", markerLength: 3, info: "" });
  });

  it("handles longer marker lengths", () => {
    const result = markdownParserCoreInternals.parseFenceOpening("`````python\n");
    expect(result).toEqual({ markerChar: "`", markerLength: 5, info: "python" });
  });

  it("handles CRLF line endings", () => {
    const result = markdownParserCoreInternals.parseFenceOpening("```ts\r\n");
    expect(result).toEqual({ markerChar: "`", markerLength: 3, info: "ts" });
  });
});

// ── isFenceClosing ──────────────────────────────────────────────────

describe("markdownParserCoreInternals.isFenceClosing", () => {
  it("requires same marker and minimum length", () => {
    expect(markdownParserCoreInternals.isFenceClosing("```   \n", "`", 3)).toBe(true);
    expect(markdownParserCoreInternals.isFenceClosing("``\n", "`", 3)).toBe(false);
    expect(markdownParserCoreInternals.isFenceClosing("~~~~\n", "~", 3)).toBe(true);
    expect(markdownParserCoreInternals.isFenceClosing("~~~x\n", "~", 3)).toBe(false);
  });

  it("accepts closing with more markers than opening", () => {
    expect(markdownParserCoreInternals.isFenceClosing("``````\n", "`", 3)).toBe(true);
  });

  it("rejects closing with different marker type", () => {
    expect(markdownParserCoreInternals.isFenceClosing("~~~\n", "`", 3)).toBe(false);
    expect(markdownParserCoreInternals.isFenceClosing("```\n", "~", 3)).toBe(false);
  });

  it("allows trailing whitespace after closing markers", () => {
    expect(markdownParserCoreInternals.isFenceClosing("```  \t  \n", "`", 3)).toBe(true);
  });

  it("rejects closing with non-whitespace after markers", () => {
    expect(markdownParserCoreInternals.isFenceClosing("```text\n", "`", 3)).toBe(false);
  });

  it("rejects indentation of 4+", () => {
    expect(markdownParserCoreInternals.isFenceClosing("    ```\n", "`", 3)).toBe(false);
  });
});

// ── splitLinesWithEndings ───────────────────────────────────────────

describe("markdownParserCoreInternals.splitLinesWithEndings", () => {
  it("splits lines preserving newline characters", () => {
    const result = markdownParserCoreInternals.splitLinesWithEndings("a\nb\nc\n");
    expect(result).toEqual(["a\n", "b\n", "c\n"]);
  });

  it("handles last line without trailing newline", () => {
    const result = markdownParserCoreInternals.splitLinesWithEndings("a\nb");
    expect(result).toEqual(["a\n", "b"]);
  });

  it("returns empty array for empty string", () => {
    expect(markdownParserCoreInternals.splitLinesWithEndings("")).toEqual([]);
  });

  it("handles single line with newline", () => {
    expect(markdownParserCoreInternals.splitLinesWithEndings("hello\n")).toEqual(["hello\n"]);
  });

  it("handles single line without newline", () => {
    expect(markdownParserCoreInternals.splitLinesWithEndings("hello")).toEqual(["hello"]);
  });
});

// ── tokenizeFences ──────────────────────────────────────────────────

describe("markdownParserCoreInternals.tokenizeFences", () => {
  it("tokenizes a single closed fence", () => {
    const md = "```js\nconst x = 1;\n```\n";
    const result = markdownParserCoreInternals.tokenizeFences(md);
    expect(result.fences).toHaveLength(1);
    expect(result.fences[0].html).toContain("hljs");
    expect(result.source).toContain("panes-code-block");
  });

  it("leaves unclosed fence as plain text", () => {
    const md = "```js\nconst x = 1;\n";
    const result = markdownParserCoreInternals.tokenizeFences(md);
    expect(result.fences).toHaveLength(0);
    expect(result.source).not.toContain("panes-code-block");
  });

  it("handles multiple fences", () => {
    const md = "```js\na\n```\ntext\n```py\nb\n```\n";
    const result = markdownParserCoreInternals.tokenizeFences(md);
    expect(result.fences).toHaveLength(2);
  });

  it("handles plain text with no fences", () => {
    const md = "Just some text\nwith multiple lines\n";
    const result = markdownParserCoreInternals.tokenizeFences(md);
    expect(result.fences).toHaveLength(0);
    expect(result.source).toContain("Just some text");
  });

  it("escapes HTML in non-fence content", () => {
    const md = "<div>test</div>\n```js\ncode\n```\n";
    const result = markdownParserCoreInternals.tokenizeFences(md);
    expect(result.source).toContain("&lt;div&gt;");
  });
});

// ── renderMarkdownToHtml ────────────────────────────────────────────

describe("renderMarkdownToHtml", () => {
  it("highlights closed fences and keeps unclosed fences as plain markdown input", () => {
    const highlighted = renderMarkdownToHtml("```js\nconst value = 1;\n```\n");
    expect(highlighted).toContain("class=\"hljs language-js\"");
    expect(highlighted).toContain("const");

    const unclosed = renderMarkdownToHtml("```js\nconst value = 1;\n");
    expect(unclosed).toContain("const value = 1");
    expect(unclosed).not.toContain("panes-code-block");
  });

  it("sanitizes dangerous tags, handlers and javascript links", () => {
    const html = renderMarkdownToHtml(
      [
        "[xss](javascript:alert(1))",
        "<script>alert('x')</script>",
        "<img src=\"javascript:alert(1)\" onerror=\"alert(1)\">",
      ].join("\n"),
    );

    expect(html).toContain("href=\"#\"");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=&quot;javascript:alert(1)&quot;>");
    expect(html).not.toContain("onerror=");
  });

  it("renders basic markdown (headings, bold, italic)", () => {
    const html = renderMarkdownToHtml("# Hello\n\n**bold** and *italic*");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders links with safe URLs", () => {
    const html = renderMarkdownToHtml("[link](https://example.com)");
    expect(html).toContain("href=\"https://example.com\"");
  });

  it("adds rel=noreferrer noopener to links", () => {
    const html = renderMarkdownToHtml("[link](https://example.com)");
    expect(html).toContain("rel=\"noreferrer noopener\"");
  });

  it("sanitizes style and iframe tags", () => {
    const md = "<style>body{color:red}</style><iframe src='evil'></iframe>";
    const html = renderMarkdownToHtml(md);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<iframe");
  });

  it("renders GFM tables", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders GFM strikethrough", () => {
    const html = renderMarkdownToHtml("~~deleted~~");
    expect(html).toContain("<del>deleted</del>");
  });

  it("renders GFM task lists", () => {
    const md = "- [x] Done\n- [ ] Not done";
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("checked");
  });

  it("handles empty input", () => {
    const html = renderMarkdownToHtml("");
    expect(html).toBe("");
  });

  it("handles fence with unknown language using autodetect", () => {
    const html = renderMarkdownToHtml("```unknownlang\nconst x = 1;\n```\n");
    expect(html).toContain("hljs");
  });

  it("handles fence with no language (autodetect)", () => {
    const html = renderMarkdownToHtml("```\nplain code\n```\n");
    // Autodetect may wrap tokens in spans, but the text is present
    expect(html).toContain("plain");
    expect(html).toContain("hljs");
  });

  it("preserves safe relative links", () => {
    const html = renderMarkdownToHtml("[link](./page.html)");
    expect(html).toContain("href=\"./page.html\"");
  });

  it("preserves anchor links", () => {
    const html = renderMarkdownToHtml("[section](#section)");
    expect(html).toContain("href=\"#section\"");
  });

  it("preserves mailto links", () => {
    const html = renderMarkdownToHtml("[email](mailto:a@b.com)");
    expect(html).toContain("href=\"mailto:a@b.com\"");
  });

  it("sanitizes data: URLs to #", () => {
    const html = renderMarkdownToHtml("[evil](data:text/html,<script>alert(1)</script>)");
    expect(html).toContain("href=\"#\"");
  });
});
