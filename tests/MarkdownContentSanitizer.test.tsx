import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const sanitize = vi.hoisted(() => vi.fn((_html: string, _config: unknown) => "<p>clean</p>"));

vi.mock("dompurify", () => ({
  default: { isSupported: true, sanitize },
}));

import MarkdownContent, { MARKDOWN_ALLOWED_URI_RE } from "../src/components/chat/MarkdownContent";

describe("MarkdownContent sanitizer", () => {
  it("passes rendered markdown through DOMPurify before it reaches the DOM", () => {
    const html = renderToStaticMarkup(<MarkdownContent content={"**bold**"} streaming />);

    expect(sanitize).toHaveBeenCalledWith(
      expect.stringContaining("<strong>bold</strong>"),
      expect.objectContaining({ ALLOWED_URI_REGEXP: MARKDOWN_ALLOWED_URI_RE }),
    );
    expect(html).toContain("<p>clean</p>");
    expect(html).not.toContain("<strong>");
  });
});

describe("MARKDOWN_ALLOWED_URI_RE", () => {
  it("keeps web, relative and local file links", () => {
    for (const href of [
      "https://example.com",
      "mailto:a@example.com",
      "#user-content-fn-1",
      "./notes",
      "/repo/README.md",
      "src/a.ts:12",
      "README.md:4",
      "Makefile:12",
      "README:5:2",
      "C:\\repo\\a.ts:3",
      "\\\\server\\share\\f.txt",
    ]) {
      expect(MARKDOWN_ALLOWED_URI_RE.test(href), href).toBe(true);
    }
  });

  it("drops script schemes and protocol-relative links", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "javascript:1,alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example/x",
      "/\\evil.example/x",
      "\\/evil.example/x",
    ]) {
      expect(MARKDOWN_ALLOWED_URI_RE.test(href), href).toBe(false);
    }
  });
});
