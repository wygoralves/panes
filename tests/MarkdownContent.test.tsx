import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/fileLinkNavigation", () => ({
  classifyLinkTarget: () => "other",
  navigateLinkTarget: vi.fn(),
}));

import MarkdownContent, {
  shouldRenderMarkdownWorkerPlaceholder,
} from "../src/components/chat/MarkdownContent";

describe("MarkdownContent", () => {
  it("renders markdown while assistant text is still streaming", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={"# Title\n\n**bold** and [link](https://example.com)"}
        streaming
      />,
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("**bold**");
  });
});

describe("shouldRenderMarkdownWorkerPlaceholder", () => {
  it("keeps the worker placeholder for long completed content that never streamed inline", () => {
    expect(
      shouldRenderMarkdownWorkerPlaceholder({
        hasStreamed: false,
        streaming: false,
        workerEligible: true,
        workerError: false,
        workerHtml: null,
      }),
    ).toBe(true);
  });

  it("skips the worker placeholder after a long message has already streamed inline", () => {
    expect(
      shouldRenderMarkdownWorkerPlaceholder({
        hasStreamed: true,
        streaming: false,
        workerEligible: true,
        workerError: false,
        workerHtml: null,
      }),
    ).toBe(false);
  });
});
