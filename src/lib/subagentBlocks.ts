import type { ContentBlock, Message, SubagentBlock, SubagentStatus, TurnCompletionStatus } from "../types";

/** Blocks a subagent produced, keyed by its agent id. */
export type SubagentChildren = Map<string, ContentBlock[]>;

export interface GroupedSubagentBlocks {
  /** The main agent's blocks plus one `subagent` block per worker. */
  main: ContentBlock[];
  children: SubagentChildren;
}

function blockAgentId(block: ContentBlock): string | null {
  if (block.type === "subagent") {
    return block.parentAgentId ?? null;
  }
  if (block.type === "text" || block.type === "thinking" || block.type === "action") {
    return block.agentId ?? null;
  }
  return null;
}

/**
 * Subagent work is stored flat next to the main agent's blocks, tagged with
 * an `agentId`. Rendering nests it: every tagged block moves under the
 * `subagent` block that owns it, in stream order, and a nested worker moves
 * under its parent worker. A tagged block whose worker never announced
 * itself gets a synthesized `subagent` block so nothing disappears. When the
 * blocks are one worker's transcript, pass its id as `ownerAgentId` so its
 * own output is not regrouped under a second copy of the worker.
 */
export function groupSubagentBlocks(
  blocks: ContentBlock[],
  ownerAgentId?: string | null,
): GroupedSubagentBlocks {
  const main: ContentBlock[] = [];
  const children: SubagentChildren = new Map();
  const known = new Set<string>();

  for (const block of blocks) {
    if (block.type === "subagent") {
      known.add(block.agentId);
    }
  }

  function placeholderFor(agentId: string): SubagentBlock {
    return { type: "subagent", agentId, description: agentId, status: "running" };
  }

  for (const block of blocks) {
    const owner = blockAgentId(block);
    // Inside a worker's own transcript its blocks are the main flow.
    if (!owner || owner === ownerAgentId) {
      main.push(block);
      continue;
    }
    if (!known.has(owner)) {
      // Worker announced nothing; give it a shell at the point it first spoke.
      known.add(owner);
      main.push(placeholderFor(owner));
    }
    const list = children.get(owner);
    if (list) {
      list.push(block);
    } else {
      children.set(owner, [block]);
    }
  }

  return { main, children };
}

export function subagentStatusFromTurn(status: TurnCompletionStatus | string | undefined): SubagentStatus {
  if (status === "failed") return "error";
  if (status === "interrupted") return "interrupted";
  return "done";
}

/** Whether the block can still receive streamed content. */
export function isSubagentActive(block: SubagentBlock): boolean {
  return block.status === "running";
}

/** Finds a worker and everything it produced inside one message's blocks. */
export function findSubagent(
  blocks: ContentBlock[] | undefined,
  agentId: string,
): { block: SubagentBlock; children: ContentBlock[] } | null {
  if (!blocks) return null;
  const grouped = groupSubagentBlocks(blocks);
  const stack: ContentBlock[][] = [grouped.main];
  while (stack.length > 0) {
    const list = stack.pop()!;
    for (const block of list) {
      if (block.type !== "subagent") continue;
      if (block.agentId === agentId) {
        return { block, children: grouped.children.get(agentId) ?? [] };
      }
      const nested = grouped.children.get(block.agentId);
      if (nested) stack.push(nested);
    }
  }
  return null;
}

export interface SubagentEntry {
  block: SubagentBlock;
  children: ContentBlock[];
  messageId: string;
}

/**
 * Every subagent a thread has run, in the order they appeared, nested ones
 * included. Feeds the Subagents pane.
 */
export function collectSubagents(messages: Message[]): SubagentEntry[] {
  const entries: SubagentEntry[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || !message.blocks) continue;
    const grouped = groupSubagentBlocks(message.blocks);
    const walk = (list: ContentBlock[]) => {
      for (const block of list) {
        if (block.type !== "subagent") continue;
        const children = grouped.children.get(block.agentId) ?? [];
        entries.push({ block, children, messageId: message.id });
        walk(children);
      }
    };
    walk(grouped.main);
  }
  return entries;
}

export type SubagentTone = "accent" | "violet" | "info" | "amber";

const SUBAGENT_TONES: readonly SubagentTone[] = ["accent", "violet", "info", "amber"];

/** A stable colour per subagent so the same worker reads the same everywhere. */
export function subagentTone(agentId: string): SubagentTone {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0;
  }
  return SUBAGENT_TONES[hash % SUBAGENT_TONES.length];
}

/**
 * Codex names its workers with short slugs (`reviewer/packaging_ci`), Claude
 * with the task description. Slugs are humanised; sentences are kept.
 */
export function subagentDisplayName(block: SubagentBlock, fallback: string): string {
  const raw =
    (block.description && block.description !== block.agentId ? block.description : block.agentType) ??
    fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const slugLike = !/\s/.test(trimmed) && trimmed.length <= 40;
  if (!slugLike) return trimmed;
  const leaf = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  const spaced = leaf.replace(/[_-]+/g, " ").trim();
  if (!spaced) return trimmed;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
