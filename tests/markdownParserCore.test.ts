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
});
