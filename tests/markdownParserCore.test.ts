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

// Event handler attributes on real tags. Quoted attribute values are
// skipped so a link whose href mentions "onerror=" does not count.
function findEventHandlerAttributes(html: string): string[] {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).filter((tag) =>
    /[\s/]on[a-z]+\s*=/i.test(tag.replace(/"[^"]*"|'[^']*'/g, '""')),
  );
}

describe("renderMarkdownToHtml", () => {
  it("highlights closed and unclosed fences the same way so a streaming block does not restyle when it closes", () => {
    const highlighted = renderMarkdownToHtml("```js\nconst value = 1;\n```\n");
    expect(highlighted).toContain("class=\"hljs language-js\"");
    expect(highlighted).toContain("const");

    const unclosed = renderMarkdownToHtml("```js\nconst value = 1;\n");
    expect(unclosed).toContain("class=\"hljs language-js\"");
    expect(unclosed).toContain("value");
    expect(unclosed).not.toContain("panes-code-block");
    expect(unclosed).not.toContain("```");
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

    expect(html).toContain('<img alt="local" />');
    expect(html).not.toContain("src=");
  });

  it("sanitizes dangerous tags, handlers and javascript links", () => {
    const html = renderMarkdownToHtml(
      [
        "[xss](javascript:alert(1))",
        "<script>alert('x')</script>",
        "<img src=\"javascript:alert(1)\" onerror=\"alert(1)\">",
      ].join("\n"),
    );

    expect(html).toContain('<a rel="noreferrer noopener">xss</a>');
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=&quot;javascript:alert(1)&quot;");
    expect(html).not.toContain("<img");
    expect(findEventHandlerAttributes(html)).toEqual([]);
  });

  it("leaves link-shaped text inside inline code unchanged", () => {
    const html = renderMarkdownToHtml("Use `<a href='about:blank'>` here");

    expect(html).toContain("<code>&lt;a href='about:blank'&gt;</code>");
  });

  it("leaves link-shaped text inside code blocks unchanged", () => {
    const fenced = renderMarkdownToHtml("```text\n<a href='about:blank'>\n```");
    expect(fenced).toContain("&lt;a href=&#x27;about:blank&#x27;&gt;");

    const indented = renderMarkdownToHtml("    <img src='javascript:x'>");
    expect(indented).toContain("<pre><code>&lt;img src='javascript:x'&gt;\n</code></pre>");
  });

  it("encodes raw HTML that the old regex filter let through", () => {
    const payloads = [
      "<div <>\n<img src=x a/onerror=alert(1) <>",
      "hello\n\n<div <><img src=x a/onerror=alert(1) <>",
      "<details <>\n<img src=x a/onerror=alert(1) <>",
      "<div <>\n<svg/onload=alert(1) <>",
      "<div <>\n<a href=javascript:alert(1) <>x</a>",
      "<img src='x'/onerror=alert(1)>",
      "# Title\n\nSome text\n\n<div <>\n<a href=x a/onmouseover=alert(1) <>hover</a>",
    ];

    for (const payload of payloads) {
      const html = renderMarkdownToHtml(payload);
      expect(html, payload).not.toMatch(/<(?:img|svg|div|details)\b/i);
      expect(findEventHandlerAttributes(html), payload).toEqual([]);
      expect(html, payload).not.toContain('href="javascript:');
    }
  });

  it("renders inline code with angle brackets escaped once", () => {
    const html = renderMarkdownToHtml("Use `<div>` and `Vec<String>`, not `<br>`");

    expect(html).toContain("<code>&lt;div&gt;</code>");
    expect(html).toContain("<code>Vec&lt;String&gt;</code>");
    expect(html).toContain("<code>&lt;br&gt;</code>");
  });

  it("drops protocol-relative links and keeps relative and local ones", () => {
    const html = renderMarkdownToHtml(
      "[a](//evil.example/x) [b](./notes) [c](../x) [d](/repo/README.md)",
    );

    expect(html).not.toContain("evil.example");
    expect(html).toContain('<a rel="noreferrer noopener">a</a>');
    expect(renderMarkdownToHtml("note[^1]\n\n[^1]: text")).toContain('href="#user-content-fn-1"');
    expect(html).toContain('href="./notes"');
    expect(html).toContain('href="../x"');
    expect(html).toContain('href="/repo/README.md"');

    const unc = renderMarkdownToHtml("See `\\\\server\\share\\f.txt`");
    expect(unc).toContain('href="\\\\server\\share\\f.txt"');
  });

  it("places fenced code between the paragraphs around it", () => {
    const html = renderMarkdownToHtml("before\n```js\nconst a = '$&';\n```\nafter");

    expect(html).toMatch(/^<p>before<\/p>\n<pre><code class="hljs language-js">/);
    expect(html).toContain("$&amp;");
    expect(html).toMatch(/<\/pre>\n<p>after<\/p>$/);
    expect(html).not.toContain("\uE000");
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

  it("keeps a br or hr that starts an HTML block when text follows it", () => {
    expect(renderMarkdownToHtml("<br>\nnext line")).toBe("<br>\nnext line");
    expect(renderMarkdownToHtml("<hr>\n<img src=x onerror=alert(1)>")).toBe(
      "<hr>\n&lt;img src=x onerror=alert(1)&gt;",
    );
  });

  it("does not let text spelled like a fence sentinel take the fence's place", () => {
    const html = renderMarkdownToHtml(
      "&#xE000;PANES_FENCE_0&#xE000;\n\n```js\nconst a = 42;\n```\n",
    );

    expect(html).toMatch(/^<p>\uE000PANES_FENCE_0\uE000<\/p>\n<pre><code class="hljs language-js">/);
  });
});
