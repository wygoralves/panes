import { describe, expect, it } from "vitest";
import { findSubagent, groupSubagentBlocks, subagentStatusFromTurn } from "./subagentBlocks";
import type { ContentBlock } from "../types";

const action = (actionId: string, agentId?: string): ContentBlock => ({
  type: "action",
  actionId,
  actionType: "command",
  summary: actionId,
  details: {},
  outputChunks: [],
  status: "done",
  ...(agentId ? { agentId } : {}),
});

describe("groupSubagentBlocks", () => {
  it("keeps untagged blocks in the main flow", () => {
    const blocks: ContentBlock[] = [
      { type: "text", content: "hello" },
      action("a1"),
    ];
    const grouped = groupSubagentBlocks(blocks);
    expect(grouped.main).toEqual(blocks);
    expect(grouped.children.size).toBe(0);
  });

  it("nests tagged blocks under their worker in stream order", () => {
    const blocks: ContentBlock[] = [
      action("task", undefined),
      { type: "subagent", agentId: "w1", description: "Explore", status: "running" },
      { type: "text", content: "main continues" },
      { type: "text", content: "worker text", agentId: "w1" },
      action("a2", "w1"),
      { type: "thinking", content: "hmm", agentId: "w1" },
    ];
    const grouped = groupSubagentBlocks(blocks);
    expect(grouped.main.map((block) => block.type)).toEqual(["action", "subagent", "text"]);
    expect(grouped.children.get("w1")?.map((block) => block.type)).toEqual([
      "text",
      "action",
      "thinking",
    ]);
  });

  it("synthesizes a worker shell when a tagged block arrives first", () => {
    const blocks: ContentBlock[] = [
      { type: "text", content: "worker text", agentId: "ghost" },
      { type: "text", content: "main" },
    ];
    const grouped = groupSubagentBlocks(blocks);
    expect(grouped.main[0]).toMatchObject({ type: "subagent", agentId: "ghost", status: "running" });
    expect(grouped.main[1]).toEqual({ type: "text", content: "main" });
    expect(grouped.children.get("ghost")).toHaveLength(1);
  });

  it("nests a child worker under its parent worker", () => {
    const blocks: ContentBlock[] = [
      { type: "subagent", agentId: "p", description: "Parent", status: "running" },
      { type: "subagent", agentId: "c", parentAgentId: "p", description: "Child", status: "running" },
      { type: "text", content: "child text", agentId: "c" },
    ];
    const grouped = groupSubagentBlocks(blocks);
    expect(grouped.main).toHaveLength(1);
    expect(grouped.children.get("p")?.[0]).toMatchObject({ type: "subagent", agentId: "c" });
    expect(grouped.children.get("c")?.[0]).toMatchObject({ type: "text", agentId: "c" });
    expect(findSubagent(blocks, "c")?.children).toHaveLength(1);
  });

  it("keeps a worker's own blocks in the main flow of its transcript", () => {
    const blocks: ContentBlock[] = [
      { type: "text", content: "worker text", agentId: "w1" },
      action("a2", "w1"),
      { type: "subagent", agentId: "c", parentAgentId: "w1", description: "Child", status: "running" },
      { type: "text", content: "child text", agentId: "c" },
    ];
    const grouped = groupSubagentBlocks(blocks, "w1");
    expect(grouped.main.map((block) => block.type)).toEqual(["text", "action", "subagent"]);
    expect(grouped.children.has("w1")).toBe(false);
    expect(grouped.children.get("c")).toHaveLength(1);
    // Regrouping a transcript never manufactures a second copy of the owner.
    const again = groupSubagentBlocks(grouped.main, "w1");
    expect(again.main).toEqual(grouped.main);
  });

  it("maps turn completion statuses onto worker statuses", () => {
    expect(subagentStatusFromTurn("completed")).toBe("done");
    expect(subagentStatusFromTurn("failed")).toBe("error");
    expect(subagentStatusFromTurn("interrupted")).toBe("interrupted");
    expect(subagentStatusFromTurn(undefined)).toBe("done");
  });
});
