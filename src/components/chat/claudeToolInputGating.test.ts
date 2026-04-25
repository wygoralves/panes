import { describe, expect, it } from "vitest";
import type { ApprovalBlock } from "../../types";
import {
  buildPermissionApprovalResponseForEngine,
  canUseApprovalDecisionActions,
  filterPendingApprovalBannerRows,
  isOpenCodeQuestionApproval,
  resolvePendingToolInputApproval,
} from "./ChatPanel";
import { shouldShowClaudeUnsupportedApproval } from "./MessageBlocks";
import {
  buildToolInputResponseFromSelections,
  defaultToolInputSelections,
  parseToolInputQuestions,
} from "./toolInputApproval";

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

    expect(resolvePendingToolInputApproval(pendingApprovals, "claude")).toEqual(
      toolInputApproval,
    );
    expect(
      filterPendingApprovalBannerRows(
        pendingApprovals,
        "claude",
        toolInputApproval.approvalId,
      ),
    ).toEqual([standardApproval]);
    expect(
      shouldShowClaudeUnsupportedApproval(toolInputApproval.details, true, true),
    ).toBe(false);
  });

  it("keeps older supported Claude questionnaires switchable in the banner", () => {
    const olderApproval = makeApprovalBlock("tool-input-older", {
      _serverMethod: "item/tool/requestuserinput",
      questions: [
        {
          id: "question-1",
          question: "Use the safer migration path?",
          header: "Path",
          options: [
            { label: "Yes", description: "Keep compatibility first" },
            { label: "No", description: "Prefer the shorter path" },
          ],
        },
      ],
    });
    const newerApproval = makeApprovalBlock("tool-input-newer", {
      _serverMethod: "item/tool/requestuserinput",
      questions: [
        {
          id: "question-2",
          question: "Should Claude update snapshots too?",
          header: "Tests",
          options: [
            { label: "Update", description: "Refresh snapshots now" },
            { label: "Skip", description: "Leave snapshots unchanged" },
          ],
        },
      ],
    });

    expect(
      resolvePendingToolInputApproval([olderApproval, newerApproval], "claude"),
    ).toEqual(newerApproval);
    expect(
      filterPendingApprovalBannerRows(
        [olderApproval, newerApproval],
        "claude",
        newerApproval.approvalId,
      ),
    ).toEqual([olderApproval]);
    expect(
      resolvePendingToolInputApproval(
        [olderApproval, newerApproval],
        "claude",
        olderApproval.approvalId,
      ),
    ).toEqual(olderApproval);
    expect(
      filterPendingApprovalBannerRows(
        [olderApproval, newerApproval],
        "claude",
        olderApproval.approvalId,
      ),
    ).toEqual([newerApproval]);
  });

  it("keeps malformed Claude tool-input approvals out of the composer path", () => {
    const malformedApproval = makeApprovalBlock("tool-input-invalid", {
      _serverMethod: "item/tool/requestuserinput",
      questions: [],
    });

    expect(resolvePendingToolInputApproval([malformedApproval], "claude")).toBeNull();
    expect(filterPendingApprovalBannerRows([malformedApproval], "claude")).toEqual([
      malformedApproval,
    ]);
    expect(
      shouldShowClaudeUnsupportedApproval(malformedApproval.details, true, true),
    ).toBe(true);
  });

  it("uses the same unsupported check for Claude mixed questionnaire payloads", () => {
    const mixedApproval = makeApprovalBlock("tool-input-mixed", {
      _serverMethod: "item/tool/requestuserinput",
      questions: [
        {
          id: "question-1",
          question: "Should Claude also relax the exec policy?",
          header: "Policy",
          options: [
            { label: "No", description: "Keep the current policy" },
            { label: "Yes", description: "Relax the policy now" },
          ],
        },
      ],
      proposedExecpolicyAmendment: ["allow npm test"],
    });

    expect(resolvePendingToolInputApproval([mixedApproval], "claude")).toBeNull();
    expect(filterPendingApprovalBannerRows([mixedApproval], "claude")).toEqual([
      mixedApproval,
    ]);
    expect(
      shouldShowClaudeUnsupportedApproval(mixedApproval.details, true, true),
    ).toBe(true);
  });

  it("does not expose decision actions for OpenCode question approvals", () => {
    const openCodeQuestion = makeApprovalBlock("opencode-question", {
      _serverMethod: "item/tool/requestUserInput",
      _opencodeRequestKind: "question",
      questions: [
        {
          id: "question-1",
          question: "Which package manager should OpenCode use?",
          options: [{ label: "pnpm", description: "Use pnpm" }],
        },
      ],
    });
    const openCodePermission = makeApprovalBlock("opencode-permission", {
      _serverMethod: "item/permissions/requestApproval",
      _opencodeRequestKind: "permission",
    });

    expect(isOpenCodeQuestionApproval(openCodeQuestion.details)).toBe(true);
    expect(canUseApprovalDecisionActions("opencode", openCodeQuestion.details)).toBe(false);
    expect(canUseApprovalDecisionActions("opencode", openCodePermission.details)).toBe(true);
    expect(canUseApprovalDecisionActions("claude", openCodeQuestion.details)).toBe(true);
  });

  it("uses OpenCode-native decision payloads for permission approvals", () => {
    const details = {
      _serverMethod: "item/permissions/requestApproval",
      _opencodeRequestKind: "permission",
      permission: "bash",
    };

    expect(
      buildPermissionApprovalResponseForEngine("opencode", details, "accept"),
    ).toEqual({ decision: "accept" });
    expect(
      buildPermissionApprovalResponseForEngine("opencode", details, "accept_for_session"),
    ).toEqual({ decision: "accept_for_session" });
    expect(
      buildPermissionApprovalResponseForEngine("opencode", details, "decline"),
    ).toEqual({ decision: "decline" });
    expect(
      buildPermissionApprovalResponseForEngine("codex", details, "accept"),
    ).toEqual({ permissions: {}, scope: "turn" });
  });

  it("preserves OpenCode multiple-choice and custom-answer question metadata", () => {
    const questions = parseToolInputQuestions({
      questions: [
        {
          id: "question-1-tools",
          question: "Which checks should OpenCode run?",
          header: "Checks",
          multiple: true,
          custom: false,
          options: [
            { label: "typecheck", description: "Run TypeScript", recommended: true },
            { label: "test", description: "Run tests", recommended: false },
          ],
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "question-1-tools",
        question: "Which checks should OpenCode run?",
        header: "Checks",
        multiple: true,
        custom: false,
        options: [
          { label: "typecheck", description: "Run TypeScript", recommended: true },
          { label: "test", description: "Run tests", recommended: false },
        ],
      },
    ]);
    expect(defaultToolInputSelections(questions)).toEqual({
      "question-1-tools": ["typecheck"],
    });
  });

  it("builds ordered OpenCode-style answer arrays for multi-select questions", () => {
    const questions = parseToolInputQuestions({
      questions: [
        {
          id: "checks",
          question: "Which checks?",
          multiple: true,
          custom: true,
          options: [
            { label: "typecheck", description: "Run TypeScript" },
            { label: "test", description: "Run tests" },
          ],
        },
        {
          id: "manager",
          question: "Which package manager?",
          custom: false,
          options: [
            { label: "pnpm", description: "Use pnpm" },
            { label: "npm", description: "Use npm" },
          ],
        },
      ],
    });

    expect(
      buildToolInputResponseFromSelections(
        questions,
        {
          checks: ["typecheck", "test"],
          manager: ["npm"],
        },
        {
          checks: "lint",
          manager: "yarn",
        },
      ),
    ).toEqual({
      answers: {
        checks: { answers: ["typecheck", "test", "lint"] },
        manager: { answers: ["npm"] },
      },
    });
  });
});
