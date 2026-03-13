import type { ContentBlock } from "../../types";

function getBlockTypeOrdinal(
  blocks: ContentBlock[],
  index: number,
  type: ContentBlock["type"],
): number {
  let ordinal = 0;
  for (let current = 0; current <= index; current += 1) {
    if (blocks[current]?.type === type) {
      ordinal += 1;
    }
  }
  return Math.max(0, ordinal - 1);
}

export function getMessageBlockKey(
  block: ContentBlock,
  index: number,
  blocks: ContentBlock[],
): string {
  switch (block.type) {
    case "action":
      return `action:${block.actionId}`;
    case "approval":
      return `approval:${block.approvalId}`;
    case "notice":
      return `notice:${block.kind}`;
    case "steer":
      return `steer:${block.steerId}`;
    case "diff":
      return `diff:${block.scope}:${getBlockTypeOrdinal(blocks, index, "diff")}`;
    default:
      return `${block.type}:${index}`;
  }
}
