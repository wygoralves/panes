import { renderToStaticMarkup } from "react-dom/server";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/fileLinkNavigation", () => ({
  classifyLinkTarget: () => "other",
  navigateLinkTarget: vi.fn(),
}));

import MarkdownContent, {
  handleMarkdownLinkAuxClick,
  handleMarkdownLinkClick,
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

describe("markdown link clicks", () => {
  // The tests run without a DOM, so stand in the classes the handlers check.
  class FakeNode {}
  class FakeElement extends FakeNode {
    closest(): FakeElement | null {
      return null;
    }
  }
  class FakeAnchor extends FakeElement {
    constructor(private readonly href: string) {
      super();
    }
    closest(): FakeAnchor {
      return this;
    }
    getAttribute(): string {
      return this.href;
    }
  }

  function stubDom() {
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLAnchorElement", FakeAnchor);
  }

  function linkEvent(href: string, button = 0) {
    return {
      button,
      defaultPrevented: false,
      target: new FakeAnchor(href),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ReactMouseEvent<HTMLDivElement> & { preventDefault: ReturnType<typeof vi.fn> };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a link that is neither local nor external from navigating the app window", () => {
    stubDom();
    const event = linkEvent("./notes");
    handleMarkdownLinkClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("lets in-page fragment links such as footnotes scroll", () => {
    stubDom();
    const event = linkEvent("#user-content-fn-1");
    handleMarkdownLinkClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("blocks middle clicks on links", () => {
    stubDom();
    const event = linkEvent("https://example.com", 1);
    handleMarkdownLinkAuxClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
