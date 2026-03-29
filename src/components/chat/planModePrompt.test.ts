import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
  getPlanImplementationCodingMessage,
  latestAssistantMessage,
  messageHasStructuredPlan,
  shouldPromptToImplementPlan,
} from "./planModePrompt";

function buildAssistantMessage(content: string): Message {
  return {
    id: "assistant-1",
    threadId: "thread-1",
    role: "assistant",
    status: "completed",
    schemaVersion: 1,
    blocks: [
      {
        type: "thinking",
        content,
      },
    ],
    createdAt: new Date().toISOString(),
    hydration: "full",
    hasDeferredContent: false,
  };
}

describe("planModePrompt", () => {
  it("uses the explicit exit-plan handoff only for Claude", () => {
    expect(getPlanImplementationCodingMessage("claude")).toBe(
      "Exit plan mode and implement the plan.",
    );
    expect(getPlanImplementationCodingMessage("codex")).toBe("Implement the plan.");
  });

  it("detects structured plan output from assistant messages", () => {
    const message = buildAssistantMessage(
      [
        "Implementation outline",
        "- [completed] Inspect the current behavior",
        "- [pending] Apply the fix",
      ].join("\n"),
    );

    expect(messageHasStructuredPlan(message)).toBe(true);
  });

  it("ignores assistant messages without structured plan items", () => {
    const message = buildAssistantMessage("I need one clarification before I continue.");

    expect(messageHasStructuredPlan(message)).toBe(false);
  });

  it("detects prompt-guided plans that use generic markdown lists", () => {
    const message = buildAssistantMessage(
      [
        "Plan:",
        "1. Inspect the current flow",
        "2. Reuse the same inline questionnaire",
      ].join("\n"),
    );

    expect(messageHasStructuredPlan(message)).toBe(true);
  });

  it("detects Codex native plan updates that use camelCase inProgress statuses", () => {
    const message = buildAssistantMessage(
      [
        "Plan update",
        "- [inProgress] Inspect the current flow",
        "- [pending] Apply the fix",
      ].join("\n"),
    );

    expect(messageHasStructuredPlan(message)).toBe(true);
  });

  it("returns the latest assistant message in the transcript", () => {
    const assistant = buildAssistantMessage("- [pending] Implement the fix");

    const messages: Message[] = [
      {
        id: "user-1",
        threadId: "thread-1",
        role: "user",
        status: "completed",
        schemaVersion: 1,
        blocks: [
          {
            type: "text",
            content: "Plan this change",
            planMode: true,
          },
        ],
        createdAt: new Date().toISOString(),
        hydration: "full",
        hasDeferredContent: false,
      },
      assistant,
    ];

    expect(latestAssistantMessage(messages)).toEqual(assistant);
  });

  it("detects ExitPlanMode tool attempts as a plan completion signal", () => {
    const message: Message = {
      id: "assistant-1",
      threadId: "thread-1",
      role: "assistant",
      status: "completed",
      schemaVersion: 1,
      blocks: [
        { type: "text", content: "The plan is ready." },
        {
          type: "action",
          actionId: "a1",
          actionType: "other",
          summary: "ExitPlanMode",
          details: {},
          outputChunks: [],
          status: "error",
        },
      ],
      createdAt: new Date().toISOString(),
      hydration: "full",
      hasDeferredContent: false,
    };

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "completed",
        activeThreadId: "thread-1",
        armedThreadId: "thread-1",
        engineId: "claude",
        messages: [message],
      }),
    ).toBe(true);
  });

  it("ignores ExitPlanMode tool attempts for non-Claude engines", () => {
    const message: Message = {
      id: "assistant-1",
      threadId: "thread-1",
      role: "assistant",
      status: "completed",
      schemaVersion: 1,
      blocks: [
        { type: "text", content: "The plan is ready." },
        {
          type: "action",
          actionId: "a1",
          actionType: "other",
          summary: "ExitPlanMode",
          details: {},
          outputChunks: [],
          status: "error",
        },
      ],
      createdAt: new Date().toISOString(),
      hydration: "full",
      hasDeferredContent: false,
    };

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "completed",
        activeThreadId: "thread-1",
        armedThreadId: "thread-1",
        engineId: "codex",
        messages: [message],
      }),
    ).toBe(false);
  });

  it("prompts to implement only after a live plan turn completes", () => {
    const latestAssistant = buildAssistantMessage(
      "- [completed] Investigate\n- [pending] Implement",
    );

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "completed",
        activeThreadId: "thread-1",
        armedThreadId: "thread-1",
        engineId: "codex",
        messages: [latestAssistant],
      }),
    ).toBe(true);

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "completed",
        activeThreadId: "thread-1",
        armedThreadId: "thread-2",
        engineId: "codex",
        messages: [latestAssistant],
      }),
    ).toBe(false);

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "error",
        activeThreadId: "thread-1",
        armedThreadId: "thread-1",
        engineId: "codex",
        messages: [latestAssistant],
      }),
    ).toBe(false);
  });

  it("prompts when the last turn contains a plan followed by another assistant message", () => {
    const planAssistant = buildAssistantMessage(
      "- [completed] Inspect\n- [pending] Implement",
    );
    const trailingAssistant: Message = {
      id: "assistant-2",
      threadId: "thread-1",
      role: "assistant",
      status: "completed",
      schemaVersion: 1,
      blocks: [
        {
          type: "approval",
          approvalId: "approval-1",
          actionType: "other",
          summary: "What should Panes do next?",
          details: {},
          status: "pending",
        },
      ],
      createdAt: new Date().toISOString(),
      hydration: "full",
      hasDeferredContent: false,
    };

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "completed",
        activeThreadId: "thread-1",
        armedThreadId: "thread-1",
        engineId: "codex",
        messages: [
          {
            id: "user-1",
            threadId: "thread-1",
            role: "user",
            status: "completed",
            schemaVersion: 1,
            blocks: [{ type: "text", content: "Plan this", planMode: true }],
            createdAt: new Date().toISOString(),
            hydration: "full",
            hasDeferredContent: false,
          },
          planAssistant,
          trailingAssistant,
        ],
      }),
    ).toBe(true);
  });
});
