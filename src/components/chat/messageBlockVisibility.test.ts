import { describe, expect, it } from "vitest";
import type { ContentBlock, MessageStatus } from "../../types";
import {
  isRenderableMessageRow,
  isVisibleMessageBlock,
} from "./messageBlockVisibility";

describe("isVisibleMessageBlock", () => {
  it.each(["hook_started_123", "hook_completed_123"])(
    "hides persisted %s notices",
    (kind) => {
      const block: ContentBlock = {
        type: "notice",
        kind,
        level: "info",
        title: "Hook",
        message: "Hook details",
      };
      expect(isVisibleMessageBlock(block)).toBe(false);
    },
  );

  it("keeps other notices visible", () => {
    const block: ContentBlock = {
      type: "notice",
      kind: "context_compacted",
      level: "info",
      title: "Context compacted",
      message: "Details",
    };
    expect(isVisibleMessageBlock(block)).toBe(true);
  });
});

describe("isRenderableMessageRow", () => {
  const base = {
    role: "assistant" as const,
    status: "completed" as MessageStatus,
    blocks: [] as ContentBlock[],
  };

  it("always renders user rows", () => {
    expect(isRenderableMessageRow({ ...base, role: "user" })).toBe(true);
  });

  it("drops an assistant row whose only blocks are hook lifecycle notices", () => {
    expect(
      isRenderableMessageRow({
        ...base,
        blocks: [
          {
            type: "notice",
            kind: "hook_started_9",
            level: "info",
            title: "Hook",
            message: "Hook details",
          },
        ],
      }),
    ).toBe(false);
  });

  it("drops an assistant row with no content and no stream in flight", () => {
    expect(isRenderableMessageRow(base)).toBe(false);
    expect(
      isRenderableMessageRow({
        ...base,
        blocks: [{ type: "text", content: "   " }],
      }),
    ).toBe(false);
  });

  it("keeps an empty assistant shell while it is streaming", () => {
    expect(isRenderableMessageRow({ ...base, status: "streaming" })).toBe(true);
  });

  it("keeps an assistant row with visible content", () => {
    expect(
      isRenderableMessageRow({
        ...base,
        blocks: [{ type: "text", content: "Done." }],
      }),
    ).toBe(true);
  });
});
