import { describe, expect, it } from "vitest";
import { terminalStoreInternals } from "../src/stores/terminalStore";
import type { SplitNode, TerminalGroup } from "../src/types";

const {
  collectSessionIds,
  replaceLeafInTree,
  removeLeafFromTree,
  updateRatioInTree,
  nextFocusedSessionId,
} = terminalStoreInternals;

// ── Helpers ──────────────────────────────────────────────────────────

function makeLeaf(sessionId: string): SplitNode {
  return { type: "leaf", sessionId };
}

function makeSplit(
  left: SplitNode,
  right: SplitNode,
  opts: { id?: string; ratio?: number } = {},
): SplitNode {
  return {
    type: "split",
    id: opts.id ?? "split-1",
    direction: "horizontal",
    ratio: opts.ratio ?? 0.5,
    children: [left, right],
  };
}

function makeGroup(root: SplitNode, overrides: Partial<TerminalGroup> = {}): TerminalGroup {
  return {
    id: overrides.id ?? "group-1",
    root,
    name: overrides.name ?? "Terminal 1",
    ...overrides,
  };
}

// ── collectSessionIds ───────────────────────────────────────────────

describe("collectSessionIds", () => {
  it("returns single id for a leaf node", () => {
    expect(collectSessionIds(makeLeaf("s1"))).toEqual(["s1"]);
  });

  it("collects ids from a simple split", () => {
    const tree = makeSplit(makeLeaf("s1"), makeLeaf("s2"));
    expect(collectSessionIds(tree)).toEqual(["s1", "s2"]);
  });

  it("collects ids from a nested split tree", () => {
    const tree = makeSplit(
      makeSplit(makeLeaf("s1"), makeLeaf("s2"), { id: "inner" }),
      makeLeaf("s3"),
    );
    expect(collectSessionIds(tree)).toEqual(["s1", "s2", "s3"]);
  });

  it("collects ids from deeply nested tree", () => {
    const tree = makeSplit(
      makeSplit(makeLeaf("a"), makeLeaf("b"), { id: "l1" }),
      makeSplit(makeLeaf("c"), makeLeaf("d"), { id: "l2" }),
    );
    expect(collectSessionIds(tree)).toEqual(["a", "b", "c", "d"]);
  });
});

// ── replaceLeafInTree ───────────────────────────────────────────────

describe("replaceLeafInTree", () => {
  it("replaces a matching leaf with a new node", () => {
    const leaf = makeLeaf("s1");
    const replacement = makeSplit(makeLeaf("s1"), makeLeaf("s2"));
    const result = replaceLeafInTree(leaf, "s1", replacement);
    expect(result).toBe(replacement);
  });

  it("does not replace a non-matching leaf", () => {
    const leaf = makeLeaf("s1");
    const replacement = makeLeaf("s2");
    const result = replaceLeafInTree(leaf, "other", replacement);
    expect(result).toBe(leaf);
  });

  it("replaces a leaf deep in a split tree", () => {
    const tree = makeSplit(makeLeaf("s1"), makeLeaf("s2"));
    const replacement = makeLeaf("s3");
    const result = replaceLeafInTree(tree, "s2", replacement);
    expect(collectSessionIds(result)).toEqual(["s1", "s3"]);
  });

  it("preserves split container properties", () => {
    const tree = makeSplit(makeLeaf("s1"), makeLeaf("s2"), { id: "c1", ratio: 0.7 });
    const result = replaceLeafInTree(tree, "s1", makeLeaf("s3"));
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.id).toBe("c1");
      expect(result.ratio).toBe(0.7);
    }
  });
});

// ── removeLeafFromTree ──────────────────────────────────────────────

describe("removeLeafFromTree", () => {
  it("returns null when removing the only leaf", () => {
    const result = removeLeafFromTree(makeLeaf("s1"), "s1");
    expect(result).toBeNull();
  });

  it("returns the leaf unchanged when target does not match", () => {
    const leaf = makeLeaf("s1");
    const result = removeLeafFromTree(leaf, "other");
    expect(result).toBe(leaf);
  });

  it("returns sibling when removing left child of a split", () => {
    const right = makeLeaf("s2");
    const tree = makeSplit(makeLeaf("s1"), right);
    const result = removeLeafFromTree(tree, "s1");
    expect(result).toBe(right);
  });

  it("returns sibling when removing right child of a split", () => {
    const left = makeLeaf("s1");
    const tree = makeSplit(left, makeLeaf("s2"));
    const result = removeLeafFromTree(tree, "s2");
    expect(result).toBe(left);
  });

  it("removes leaf from nested tree correctly", () => {
    const innerSplit = makeSplit(makeLeaf("s2"), makeLeaf("s3"), { id: "inner" });
    const tree = makeSplit(makeLeaf("s1"), innerSplit);
    const result = removeLeafFromTree(tree, "s2");
    // s2 removed, inner split collapses to s3, so tree becomes split(s1, s3)
    expect(result).not.toBeNull();
    expect(collectSessionIds(result!)).toEqual(["s1", "s3"]);
  });
});

// ── updateRatioInTree ───────────────────────────────────────────────

describe("updateRatioInTree", () => {
  it("returns leaf unchanged", () => {
    const leaf = makeLeaf("s1");
    const result = updateRatioInTree(leaf, "any-id", 0.6);
    expect(result).toBe(leaf);
  });

  it("updates ratio on matching container", () => {
    const tree = makeSplit(makeLeaf("s1"), makeLeaf("s2"), { id: "c1", ratio: 0.5 });
    const result = updateRatioInTree(tree, "c1", 0.7);
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.ratio).toBe(0.7);
    }
  });

  it("does not modify non-matching containers", () => {
    const tree = makeSplit(makeLeaf("s1"), makeLeaf("s2"), { id: "c1", ratio: 0.5 });
    const result = updateRatioInTree(tree, "other", 0.7);
    if (result.type === "split") {
      expect(result.ratio).toBe(0.5);
    }
  });

  it("updates ratio in nested container", () => {
    const inner = makeSplit(makeLeaf("s2"), makeLeaf("s3"), { id: "inner", ratio: 0.4 });
    const tree = makeSplit(makeLeaf("s1"), inner, { id: "outer", ratio: 0.5 });
    const result = updateRatioInTree(tree, "inner", 0.8);
    if (result.type === "split") {
      expect(result.ratio).toBe(0.5); // outer unchanged
      const innerResult = result.children[1];
      if (innerResult.type === "split") {
        expect(innerResult.ratio).toBe(0.8); // inner updated
      }
    }
  });
});

// ── nextFocusedSessionId ────────────────────────────────────────────

describe("nextFocusedSessionId", () => {
  it("returns null for empty groups", () => {
    expect(nextFocusedSessionId([], null, null)).toBeNull();
  });

  it("returns last session id from last group when no preference", () => {
    const groups = [
      makeGroup(makeLeaf("s1"), { id: "g1" }),
      makeGroup(makeLeaf("s2"), { id: "g2" }),
    ];
    expect(nextFocusedSessionId(groups, null, null)).toBe("s2");
  });

  it("returns session from preferred group", () => {
    const groups = [
      makeGroup(makeLeaf("s1"), { id: "g1" }),
      makeGroup(makeLeaf("s2"), { id: "g2" }),
    ];
    expect(nextFocusedSessionId(groups, "g1", null)).toBe("s1");
  });

  it("preserves previous session id if it exists in target group", () => {
    const groups = [
      makeGroup(makeSplit(makeLeaf("s1"), makeLeaf("s2")), { id: "g1" }),
    ];
    expect(nextFocusedSessionId(groups, "g1", "s1")).toBe("s1");
  });

  it("falls back to last session when previous id not in group", () => {
    const groups = [
      makeGroup(makeSplit(makeLeaf("s1"), makeLeaf("s2")), { id: "g1" }),
    ];
    expect(nextFocusedSessionId(groups, "g1", "s99")).toBe("s2");
  });

  it("falls back to last group when preferred group not found", () => {
    const groups = [
      makeGroup(makeLeaf("s1"), { id: "g1" }),
      makeGroup(makeLeaf("s2"), { id: "g2" }),
    ];
    expect(nextFocusedSessionId(groups, "nonexistent", null)).toBe("s2");
  });
});
