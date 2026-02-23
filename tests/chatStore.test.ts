import { describe, expect, it } from "vitest";
import { chatStoreInternals } from "../src/stores/chatStore";
import type {
  ActionBlock,
  ApprovalBlock,
  ContentBlock,
  Message,
  StreamEvent,
} from "../src/types";

const {
  resolveApprovalDecision,
  trimActionOutputChunks,
  patchActionBlock,
  ensureAssistantMessage,
  upsertBlock,
  normalizeBlocks,
  normalizeMessages,
  applyStreamEvent,
} = chatStoreInternals;

// ── Helpers ─────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    threadId: "thread-1",
    role: "assistant",
    status: "streaming",
    schemaVersion: 1,
    blocks: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeActionBlock(overrides: Partial<ActionBlock> = {}): ActionBlock {
  return {
    type: "action",
    actionId: "action-1",
    actionType: "command",
    summary: "test",
    details: {},
    outputChunks: [],
    status: "running",
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("resolveApprovalDecision", () => {
  it("extracts decision string from response", () => {
    expect(resolveApprovalDecision({ decision: "accept" })).toBe("accept");
    expect(resolveApprovalDecision({ decision: "decline" })).toBe("decline");
    expect(resolveApprovalDecision({ decision: "cancel" })).toBe("cancel");
    expect(resolveApprovalDecision({ decision: "accept_for_session" })).toBe("accept_for_session");
  });

  it("returns custom for non-decision responses", () => {
    expect(resolveApprovalDecision({ answers: {} })).toBe("custom");
    expect(resolveApprovalDecision({})).toBe("custom");
  });

  it("returns custom when decision is not a string", () => {
    expect(resolveApprovalDecision({ decision: 42 } as any)).toBe("custom");
  });
});

describe("trimActionOutputChunks", () => {
  it("returns unchanged for empty chunks", () => {
    const result = trimActionOutputChunks([]);
    expect(result.chunks).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns unchanged for small chunks", () => {
    const chunks = [
      { stream: "stdout" as const, content: "hello" },
      { stream: "stderr" as const, content: "world" },
    ];
    const result = trimActionOutputChunks(chunks);
    expect(result.chunks).toEqual(chunks);
    expect(result.truncated).toBe(false);
  });

  it("truncates when chunk count exceeds MAX_CHUNKS (240)", () => {
    const chunks = Array.from({ length: 300 }, (_, i) => ({
      stream: "stdout" as const,
      content: `chunk-${i}`,
    }));
    const result = trimActionOutputChunks(chunks);
    expect(result.chunks.length).toBeLessThanOrEqual(240);
    expect(result.truncated).toBe(true);
  });

  it("truncates when total chars exceed MAX_CHARS", () => {
    // ACTION_OUTPUT_MAX_CHARS = 180,000
    const largeContent = "x".repeat(100_000);
    const chunks = [
      { stream: "stdout" as const, content: largeContent },
      { stream: "stdout" as const, content: largeContent },
    ];
    const result = trimActionOutputChunks(chunks);
    expect(result.truncated).toBe(true);

    let totalChars = 0;
    for (const chunk of result.chunks) {
      totalChars += chunk.content.length;
    }
    // Should be trimmed to ~120,000 (ACTION_OUTPUT_TRIM_TARGET_CHARS)
    expect(totalChars).toBeLessThanOrEqual(130_000);
  });

  it("partially trims a chunk if it contains more content than needed", () => {
    // Create chunks that barely exceed the limit
    const chunks = [
      { stream: "stdout" as const, content: "a".repeat(90_000) },
      { stream: "stdout" as const, content: "b".repeat(90_001) }, // total = 180,001 > max
    ];
    const result = trimActionOutputChunks(chunks);
    expect(result.truncated).toBe(true);
    // The first chunk should be partially trimmed
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe("patchActionBlock", () => {
  it("updates an action block by id", () => {
    const action = makeActionBlock({ actionId: "a1" });
    const blocks: ContentBlock[] = [
      { type: "text", content: "hello" },
      action,
    ];

    const result = patchActionBlock(blocks, "a1", (block) => ({
      ...block,
      status: "done",
    }));

    expect(result).not.toBe(blocks);
    expect((result[1] as ActionBlock).status).toBe("done");
    expect(result[0]).toBe(blocks[0]); // unchanged blocks are preserved
  });

  it("returns same array when action id not found", () => {
    const blocks: ContentBlock[] = [{ type: "text", content: "hi" }];
    const result = patchActionBlock(blocks, "nonexistent", (b) => b);
    expect(result).toBe(blocks);
  });

  it("returns same array when updater returns same block", () => {
    const action = makeActionBlock({ actionId: "a1" });
    const blocks: ContentBlock[] = [action];
    const result = patchActionBlock(blocks, "a1", (b) => b);
    expect(result).toBe(blocks);
  });
});

describe("ensureAssistantMessage", () => {
  it("adds a new assistant message when last message is not assistant streaming", () => {
    const userMsg = makeMessage({ role: "user", status: "completed" });
    const result = ensureAssistantMessage([userMsg], "thread-1");
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("assistant");
    expect(result[1].status).toBe("streaming");
  });

  it("returns same array when last message is already assistant streaming", () => {
    const assistantMsg = makeMessage({ role: "assistant", status: "streaming" });
    const messages = [assistantMsg];
    const result = ensureAssistantMessage(messages, "thread-1");
    expect(result).toBe(messages);
  });

  it("adds new assistant when last assistant is completed", () => {
    const completed = makeMessage({ role: "assistant", status: "completed" });
    const result = ensureAssistantMessage([completed], "thread-1");
    expect(result).toHaveLength(2);
    expect(result[1].status).toBe("streaming");
  });

  it("adds assistant message to empty array", () => {
    const result = ensureAssistantMessage([], "thread-1");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
  });
});

describe("upsertBlock", () => {
  it("appends non-action/approval blocks", () => {
    const blocks: ContentBlock[] = [{ type: "text", content: "a" }];
    const result = upsertBlock(blocks, { type: "text", content: "b" });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ type: "text", content: "b" });
  });

  it("replaces existing action block with same actionId", () => {
    const action1 = makeActionBlock({ actionId: "a1", status: "running" });
    const blocks: ContentBlock[] = [action1];

    const updated = makeActionBlock({ actionId: "a1", status: "done" });
    const result = upsertBlock(blocks, updated);
    expect(result).toHaveLength(1);
    expect((result[0] as ActionBlock).status).toBe("done");
  });

  it("appends new action block with different actionId", () => {
    const action1 = makeActionBlock({ actionId: "a1" });
    const blocks: ContentBlock[] = [action1];

    const action2 = makeActionBlock({ actionId: "a2" });
    const result = upsertBlock(blocks, action2);
    expect(result).toHaveLength(2);
  });

  it("replaces existing approval block with same approvalId", () => {
    const approval: ApprovalBlock = {
      type: "approval",
      approvalId: "ap1",
      actionType: "command",
      summary: "test",
      details: {},
      status: "pending",
    };
    const blocks: ContentBlock[] = [approval];

    const updated: ApprovalBlock = { ...approval, status: "answered", decision: "accept" };
    const result = upsertBlock(blocks, updated);
    expect(result).toHaveLength(1);
    expect((result[0] as ApprovalBlock).status).toBe("answered");
  });
});

describe("normalizeBlocks", () => {
  it("merges adjacent text blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "text", content: "Hello " },
      { type: "text", content: "World" },
    ];
    const result = normalizeBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({ type: "text", content: "Hello World" });
  });

  it("merges adjacent thinking blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", content: "Step 1. " },
      { type: "thinking", content: "Step 2." },
    ];
    const result = normalizeBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({ type: "thinking", content: "Step 1. Step 2." });
  });

  it("does not merge different block types", () => {
    const blocks: ContentBlock[] = [
      { type: "text", content: "a" },
      { type: "thinking", content: "b" },
      { type: "text", content: "c" },
    ];
    const result = normalizeBlocks(blocks);
    expect(result).toHaveLength(3);
  });

  it("returns undefined for non-array input", () => {
    expect(normalizeBlocks(undefined)).toBeUndefined();
  });

  it("handles empty array", () => {
    expect(normalizeBlocks([])).toEqual([]);
  });

  it("handles single block", () => {
    const blocks: ContentBlock[] = [{ type: "text", content: "solo" }];
    const result = normalizeBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({ type: "text", content: "solo" });
  });
});

describe("normalizeMessages", () => {
  it("normalizes blocks within each message", () => {
    const messages: Message[] = [
      makeMessage({
        blocks: [
          { type: "text", content: "a" },
          { type: "text", content: "b" },
        ],
      }),
    ];

    const result = normalizeMessages(messages);
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks![0]).toEqual({ type: "text", content: "ab" });
  });
});

describe("applyStreamEvent", () => {
  it("appends text content from TextDelta", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = { type: "TextDelta", content: "Hello" };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks).toHaveLength(1);
    expect(assistant.blocks![0]).toEqual({ type: "text", content: "Hello" });
  });

  it("appends to existing text block for consecutive TextDelta", () => {
    const msg = makeMessage({
      blocks: [{ type: "text", content: "Hello " }],
    });
    const event: StreamEvent = { type: "TextDelta", content: "World" };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks![0]).toEqual({ type: "text", content: "Hello World" });
  });

  it("creates new text block after non-text block", () => {
    const msg = makeMessage({
      blocks: [{ type: "thinking", content: "..." }],
    });
    const event: StreamEvent = { type: "TextDelta", content: "result" };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks).toHaveLength(2);
    expect(assistant.blocks![1]).toEqual({ type: "text", content: "result" });
  });

  it("handles ThinkingDelta events", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = { type: "ThinkingDelta", content: "thinking..." };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks![0]).toEqual({ type: "thinking", content: "thinking..." });
  });

  it("appends to existing thinking block for consecutive ThinkingDelta", () => {
    const msg = makeMessage({
      blocks: [{ type: "thinking", content: "step1 " }],
    });
    const event: StreamEvent = { type: "ThinkingDelta", content: "step2" };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks![0]).toEqual({ type: "thinking", content: "step1 step2" });
  });

  it("handles ActionStarted event", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "ActionStarted",
      action_id: "act-1",
      action_type: "command",
      summary: "Running ls",
      details: { cmd: "ls" },
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    const action = assistant.blocks![0] as ActionBlock;
    expect(action.type).toBe("action");
    expect(action.actionId).toBe("act-1");
    expect(action.actionType).toBe("command");
    expect(action.status).toBe("running");
  });

  it("handles ActionCompleted event (success)", () => {
    const action = makeActionBlock({ actionId: "act-1" });
    const msg = makeMessage({ blocks: [action] });
    const event: StreamEvent = {
      type: "ActionCompleted",
      action_id: "act-1",
      result: { success: true, durationMs: 100 },
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    const updatedAction = assistant.blocks![0] as ActionBlock;
    expect(updatedAction.status).toBe("done");
    expect(updatedAction.result?.success).toBe(true);
    expect(updatedAction.result?.durationMs).toBe(100);
  });

  it("handles ActionCompleted event (failure)", () => {
    const action = makeActionBlock({ actionId: "act-1" });
    const msg = makeMessage({ blocks: [action] });
    const event: StreamEvent = {
      type: "ActionCompleted",
      action_id: "act-1",
      result: { success: false, error: "failed", durationMs: 50 },
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    const updatedAction = assistant.blocks![0] as ActionBlock;
    expect(updatedAction.status).toBe("error");
    expect(updatedAction.result?.error).toBe("failed");
  });

  it("handles ApprovalRequested event", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "ApprovalRequested",
      approval_id: "ap-1",
      action_type: "file_write",
      summary: "Write to file",
      details: {},
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    const approval = assistant.blocks![0] as ApprovalBlock;
    expect(approval.type).toBe("approval");
    expect(approval.approvalId).toBe("ap-1");
    expect(approval.status).toBe("pending");
  });

  it("handles DiffUpdated event - new diff", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "DiffUpdated",
      diff: "--- a\n+++ b\n",
      scope: "turn",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks![0]).toEqual({
      type: "diff",
      diff: "--- a\n+++ b\n",
      scope: "turn",
    });
  });

  it("handles DiffUpdated event - updates existing diff with same scope", () => {
    const msg = makeMessage({
      blocks: [{ type: "diff", diff: "old-diff", scope: "turn" }],
    });
    const event: StreamEvent = {
      type: "DiffUpdated",
      diff: "new-diff",
      scope: "turn",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks).toHaveLength(1);
    expect(assistant.blocks![0]).toMatchObject({ type: "diff", diff: "new-diff" });
  });

  it("handles Error event (recoverable)", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "Error",
      message: "Something went wrong",
      recoverable: true,
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.blocks![0]).toEqual({
      type: "error",
      message: "Something went wrong",
    });
    expect(assistant.status).toBe("streaming"); // not changed for recoverable
  });

  it("handles Error event (non-recoverable) sets error status", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "Error",
      message: "Fatal error",
      recoverable: false,
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.status).toBe("error");
  });

  it("handles TurnCompleted (completed)", () => {
    const msg = makeMessage({ blocks: [{ type: "text", content: "done" }] });
    const event: StreamEvent = {
      type: "TurnCompleted",
      status: "completed",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    expect(assistant.status).toBe("completed");
  });

  it("handles TurnCompleted (failed)", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "TurnCompleted",
      status: "failed",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    expect(result[result.length - 1].status).toBe("error");
  });

  it("handles TurnCompleted (interrupted)", () => {
    const msg = makeMessage({ blocks: [] });
    const event: StreamEvent = {
      type: "TurnCompleted",
      status: "interrupted",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    expect(result[result.length - 1].status).toBe("interrupted");
  });

  it("skips empty TextDelta", () => {
    const msg = makeMessage({ blocks: [{ type: "text", content: "hello" }] });
    const messages = [msg];
    const event: StreamEvent = { type: "TextDelta", content: "" };
    const result = applyStreamEvent(messages, event, "thread-1");
    expect(result).toBe(messages);
  });

  it("creates assistant message when none exists (TurnStarted)", () => {
    const event: StreamEvent = { type: "TurnStarted" };
    const result = applyStreamEvent([], event, "thread-1");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
  });

  it("handles ActionOutputDelta merges same-stream chunks", () => {
    const action = makeActionBlock({
      actionId: "a1",
      outputChunks: [{ stream: "stdout", content: "part1" }],
    });
    const msg = makeMessage({ blocks: [action] });
    const event: StreamEvent = {
      type: "ActionOutputDelta",
      action_id: "a1",
      stream: "stdout",
      content: "part2",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    const updatedAction = assistant.blocks![0] as ActionBlock;
    expect(updatedAction.outputChunks).toHaveLength(1);
    expect(updatedAction.outputChunks[0].content).toBe("part1part2");
  });

  it("handles ActionOutputDelta creates new chunk for different stream", () => {
    const action = makeActionBlock({
      actionId: "a1",
      outputChunks: [{ stream: "stdout", content: "out" }],
    });
    const msg = makeMessage({ blocks: [action] });
    const event: StreamEvent = {
      type: "ActionOutputDelta",
      action_id: "a1",
      stream: "stderr",
      content: "err",
    };
    const result = applyStreamEvent([msg], event, "thread-1");
    const assistant = result[result.length - 1];
    const updatedAction = assistant.blocks![0] as ActionBlock;
    expect(updatedAction.outputChunks).toHaveLength(2);
    expect(updatedAction.outputChunks[1]).toEqual({ stream: "stderr", content: "err" });
  });
});
