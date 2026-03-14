import { describe, expect, it } from "vitest";
import type { ApprovalBlock } from "../../types";
import {
  filterPendingApprovalBannerRows,
  resolvePendingToolInputApproval,
} from "./ChatPanel";
import { shouldShowClaudeUnsupportedApproval } from "./MessageBlocks";

function makeApprovalBlock(
  approvalId: string,
  details: Record<string, unknown>,
): ApprovalBlock {
  return {
    type: "approval",
    approvalId,
    actionType: "other",
    summary: approvalId,
    details,
    status: "pending",
  };
}

describe("Claude tool-input gating", () => {
  it("routes valid Claude AskUserQuestion approvals to the composer path", () => {
    const toolInputApproval = makeApprovalBlock("tool-input", {
      _serverMethod: "item/tool/requestuserinput",
      questions: [
        {
          id: "question-1",
          question: "Which option should Claude use?",
          header: "Approach",
          options: [
            { label: "Option A", description: "First path" },
            { label: "Option B", description: "Second path" },
          ],
        },
      ],
    });
    const standardApproval = makeApprovalBlock("standard", {});
    const pendingApprovals = [standardApproval, toolInputApproval];

    expect(resolvePendingToolInputApproval(pendingApprovals)).toEqual(toolInputApproval);
    expect(filterPendingApprovalBannerRows(pendingApprovals)).toEqual([standardApproval]);
    expect(
      shouldShowClaudeUnsupportedApproval(toolInputApproval.details, true, true),
    ).toBe(false);
  });

  it("keeps malformed Claude tool-input approvals out of the composer path", () => {
    const malformedApproval = makeApprovalBlock("tool-input-invalid", {
      _serverMethod: "item/tool/requestuserinput",
      questions: [],
    });

    expect(resolvePendingToolInputApproval([malformedApproval])).toBeNull();
    expect(filterPendingApprovalBannerRows([malformedApproval])).toEqual([malformedApproval]);
    expect(
      shouldShowClaudeUnsupportedApproval(malformedApproval.details, true, true),
    ).toBe(true);
  });
});
