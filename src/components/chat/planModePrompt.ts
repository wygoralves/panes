import type { Message, ThreadStatus } from "../../types";

export function getPlanImplementationCodingMessage(engineId?: string | null): string {
  return engineId === "claude"
    ? "Exit plan mode and implement the plan."
    : "Implement the plan.";
}

const STRUCTURED_PLAN_LINE_PATTERN =
  /(^|\n)- \[(?:pending|in_progress|inProgress|completed)\] /;
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

function trailingAssistantMessages(messages: Message[]): Message[] {
  const trailing: Message[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      trailing.unshift(message);
      continue;
    }
    break;
  }

  return trailing;
}

function messageHasExitPlanModeAttempt(message: Message | null | undefined): boolean {
  if (!message || message.role !== "assistant") {
    return false;
  }
  return (message.blocks ?? []).some(
    (block) =>
      block.type === "action" &&
      typeof block.summary === "string" &&
      block.summary.includes("ExitPlanMode"),
  );
}

export function shouldPromptToImplementPlan({
  wasStreaming,
  streaming,
  status,
  activeThreadId,
  armedThreadId,
  engineId,
  messages,
}: {
  wasStreaming: boolean;
  streaming: boolean;
  status: ThreadStatus;
  activeThreadId: string | null;
  armedThreadId: string | null;
  engineId?: string | null;
  messages: Message[];
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

  const assistantMessages = trailingAssistantMessages(messages);
  if (assistantMessages.length === 0) {
    return false;
  }

  // Show the prompt if the assistant produced a structured plan, or if it
  // attempted to call ExitPlanMode in Claude plan mode (which may fail at
  // the SDK level but still signals the agent considers planning complete).
  return (
    assistantMessages.some(messageHasStructuredPlan) ||
    (engineId === "claude" && assistantMessages.some(messageHasExitPlanModeAttempt))
  );
}
