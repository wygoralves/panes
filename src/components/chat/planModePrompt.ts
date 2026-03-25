import type { Message, ThreadStatus } from "../../types";

export const PLAN_IMPLEMENTATION_CODING_MESSAGE = "Implement the plan.";

const STRUCTURED_PLAN_LINE_PATTERN = /(^|\n)- \[(?:pending|in_progress|completed)\] /;
const GENERIC_PLAN_LIST_PATTERN = /(^|\n)(?:[-*]|\d+\.)\s+\S+/g;

export function messageHasStructuredPlan(message: Message | null | undefined): boolean {
  if (!message || message.role !== "assistant") {
    return false;
  }

  const content = (message.blocks ?? []).reduce((combined, block) => {
    if (block.type !== "text" && block.type !== "thinking") {
      return combined;
    }

    return combined ? `${combined}\n${block.content}` : block.content;
  }, "");

  if (!content) {
    return false;
  }

  if (STRUCTURED_PLAN_LINE_PATTERN.test(content)) {
    return true;
  }

  const genericListMatches = content.match(GENERIC_PLAN_LIST_PATTERN) ?? [];
  return genericListMatches.length >= 2;
}

export function latestAssistantMessage(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message;
    }
  }

  return undefined;
}

export function shouldPromptToImplementPlan({
  wasStreaming,
  streaming,
  status,
  activeThreadId,
  armedThreadId,
  latestAssistant,
}: {
  wasStreaming: boolean;
  streaming: boolean;
  status: ThreadStatus;
  activeThreadId: string | null;
  armedThreadId: string | null;
  latestAssistant: Message | null | undefined;
}): boolean {
  if (!wasStreaming || streaming) {
    return false;
  }

  if (status !== "completed") {
    return false;
  }

  if (!activeThreadId || armedThreadId !== activeThreadId) {
    return false;
  }

  return messageHasStructuredPlan(latestAssistant);
}
