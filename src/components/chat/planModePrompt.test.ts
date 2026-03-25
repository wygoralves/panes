import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
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
        latestAssistant,
      }),
    ).toBe(true);

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "completed",
        activeThreadId: "thread-1",
        armedThreadId: "thread-2",
        latestAssistant,
      }),
    ).toBe(false);

    expect(
      shouldPromptToImplementPlan({
        wasStreaming: true,
        streaming: false,
        status: "error",
        activeThreadId: "thread-1",
        armedThreadId: "thread-1",
        latestAssistant,
      }),
    ).toBe(false);
  });
});
