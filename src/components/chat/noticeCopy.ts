import type { TFunction } from "i18next";
import type { NoticeBlock } from "../../types";

/**
 * Engines write notice copy in English, and it is persisted with the message.
 * Notices Panes knows by kind are shown in the user's language instead.
 */
export function noticeCopy(
  t: TFunction<"chat">,
  block: Pick<NoticeBlock, "kind" | "title" | "message">,
): { title: string; message: string } {
  switch (block.kind) {
    case "claude_sandbox_unavailable":
      return {
        title: t("messageBlocks.notices.claudeSandboxUnavailable.title"),
        message: t("messageBlocks.notices.claudeSandboxUnavailable.message"),
      };
    default:
      return { title: block.title, message: block.message };
  }
}
