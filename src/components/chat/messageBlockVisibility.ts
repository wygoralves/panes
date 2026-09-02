import type { ContentBlock, Message } from "../../types";

function isHookLifecycleNotice(block: ContentBlock): boolean {
  return (
    block.type === "notice" &&
    (block.kind.startsWith("hook_started_") || block.kind.startsWith("hook_completed_"))
  );
}

export function isVisibleMessageBlock(block: ContentBlock): boolean {
  return !isHookLifecycleNotice(block);
}

export function hasVisibleMessageContent(blocks?: ContentBlock[]): boolean {
  if (!blocks || blocks.length === 0) {
    return false;
  }
  return blocks.filter(isVisibleMessageBlock).some((block) => {
    if (block.type === "text" || block.type === "thinking") {
      return Boolean(block.content?.trim());
    }
    return true;
  });
}

/**
 * Whether a message paints a row at all. The virtualized list measures and
 * offsets rows before they render, so it has to agree with the row component
 * about which messages disappear; otherwise an assistant shell with nothing
 * to show still reserves vertical space in the transcript.
 */
export function isRenderableMessageRow(
  message: Pick<Message, "role" | "status" | "blocks">,
): boolean {
  if (message.role === "user") {
    return true;
  }
  return hasVisibleMessageContent(message.blocks) || message.status === "streaming";
}
