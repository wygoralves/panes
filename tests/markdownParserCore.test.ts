import { describe, expect, it } from "vitest";
import {
  markdownParserCoreInternals,
  renderMarkdownToHtml,
} from "../src/workers/markdownParserCore";

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
});

describe("markdownParserCoreInternals.isFenceClosing", () => {
  it("requires same marker and minimum length", () => {
    expect(markdownParserCoreInternals.isFenceClosing("```   \n", "`", 3)).toBe(true);
    expect(markdownParserCoreInternals.isFenceClosing("``\n", "`", 3)).toBe(false);
    expect(markdownParserCoreInternals.isFenceClosing("~~~~\n", "~", 3)).toBe(true);
    expect(markdownParserCoreInternals.isFenceClosing("~~~x\n", "~", 3)).toBe(false);
  });
});

describe("renderMarkdownToHtml", () => {
  it("highlights closed fences and keeps unclosed fences as plain markdown input", () => {
    const highlighted = renderMarkdownToHtml("```js\nconst value = 1;\n```\n");
    expect(highlighted).toContain("class=\"hljs language-js\"");
    expect(highlighted).toContain("const");

    const unclosed = renderMarkdownToHtml("```js\nconst value = 1;\n");
    expect(unclosed).toContain("const value = 1");
    expect(unclosed).not.toContain("panes-code-block");
  });

  it("renders blockquotes and angle-bracket autolinks", () => {
    const blockquote = renderMarkdownToHtml("> quoted\n> line");
    expect(blockquote).toContain("<blockquote>");
    expect(blockquote).toContain("<p>quoted\nline</p>");

    const autolink = renderMarkdownToHtml("<https://example.com>");
    expect(autolink).toContain('href="https://example.com"');
    expect(autolink).toContain(">https://example.com</a>");
  });

  it("linkifies bare local file references outside fenced code blocks", () => {
    const html = renderMarkdownToHtml(
      "See src/lib/fileLinkNavigation.ts:12 and README.md.\n\n`src/inline.ts:3`\n\n```ts\nsrc/ignored.ts\n```",
    );

    expect(html).toContain('href="src/lib/fileLinkNavigation.ts:12"');
    expect(html).toContain(">src/lib/fileLinkNavigation.ts:12</a>");
    expect(html).toContain('href="README.md"');
    expect(html).toContain(">README.md</a>.");
    expect(html).toContain('<code><a href="src/inline.ts:3"');
    expect(html).toContain("<code");
    expect(html).toContain("hljs language-ts");
    expect(html).not.toContain('href="src/ignored.ts"');
  });

  it("preserves explicit markdown links to local files", () => {
    const html = renderMarkdownToHtml("[readme](README.md) [file](file:///repo/README.md#L4)");

    expect(html).toContain('href="README.md"');
    expect(html).toContain('href="file:///repo/README.md#L4"');
  });

  it("does not allow local file URLs in image sources", () => {
    const html = renderMarkdownToHtml("![local](file:///repo/secret.png)");

    expect(html).toContain('src="#"');
    expect(html).not.toContain('src="file:///repo/secret.png"');
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

  it("keeps safe br/hr tags while escaping other inline html", () => {
    const html = renderMarkdownToHtml(
      [
        "line 1<br>line 2",
        "<hr>",
        "<kbd>Cmd</kbd>",
      ].join("\n\n"),
    );

    expect(html).toContain("<br>");
    expect(html).toContain("<hr>");
    expect(html).toContain("&lt;kbd&gt;Cmd&lt;/kbd&gt;");
  });
});
