import { describe, expect, it } from "vitest";
import type { ContentBlock } from "../../types";
import { getMessageBlockKey } from "./messageBlockKeys";

describe("getMessageBlockKey", () => {
  it("keeps approval keys stable when a reroute notice is prepended", () => {
    const approvalBlock: ContentBlock = {
      type: "approval",
      approvalId: "approval-1",
      actionType: "command",
      summary: "Run tests",
      details: {},
      status: "pending",
    };
    const baseBlocks: ContentBlock[] = [approvalBlock];
    const reroutedBlocks: ContentBlock[] = [
      {
        type: "notice",
        kind: "model_rerouted",
        level: "info",
        title: "Model rerouted",
        message: "Switched models.",
      },
      approvalBlock,
    ];

    expect(getMessageBlockKey(baseBlocks[0], 0, baseBlocks)).toBe(
      getMessageBlockKey(reroutedBlocks[1], 1, reroutedBlocks),
    );
  });

  it("keeps diff keys stable when a reroute notice is prepended", () => {
    const diffBlock: ContentBlock = {
      type: "diff",
      scope: "turn",
      diff: "diff --git a/file b/file",
    };
    const secondDiffBlock: ContentBlock = {
      type: "diff",
      scope: "file",
      diff: "diff --git a/other b/other",
    };
    const baseBlocks: ContentBlock[] = [diffBlock, secondDiffBlock];
    const reroutedBlocks: ContentBlock[] = [
      {
        type: "notice",
        kind: "model_rerouted",
        level: "info",
        title: "Model rerouted",
        message: "Switched models.",
      },
      diffBlock,
      secondDiffBlock,
    ];

    expect(getMessageBlockKey(baseBlocks[0], 0, baseBlocks)).toBe(
      getMessageBlockKey(reroutedBlocks[1], 1, reroutedBlocks),
    );
    expect(getMessageBlockKey(baseBlocks[1], 1, baseBlocks)).toBe(
      getMessageBlockKey(reroutedBlocks[2], 2, reroutedBlocks),
    );
  });
});
