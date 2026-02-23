import { describe, expect, it } from "vitest";
import { threadStoreInternals } from "../src/stores/threadStore";
import type { Thread } from "../src/types";

const {
  mergeWorkspaceThreads,
  flattenThreadsByWorkspace,
  applyThreadReasoningEffort,
  applyThreadLastModel,
  readThreadLastModelId,
  threadMatchesRequestedModel,
} = threadStoreInternals;

// ── Helpers ─────────────────────────────────────────────────────────

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t-1",
    workspaceId: "ws-1",
    repoId: null,
    engineId: "codex",
    modelId: "gpt-5.3-codex",
    engineThreadId: null,
    title: "Test Thread",
    status: "idle",
    messageCount: 0,
    totalTokens: 0,
    createdAt: "2025-01-01T00:00:00Z",
    lastActivityAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("mergeWorkspaceThreads", () => {
  it("adds threads for a new workspace", () => {
    const current: Record<string, Thread[]> = {};
    const threads = [makeThread({ id: "t-1" })];
    const result = mergeWorkspaceThreads(current, "ws-1", threads);
    expect(result["ws-1"]).toHaveLength(1);
    expect(result["ws-1"][0].id).toBe("t-1");
  });

  it("replaces threads for an existing workspace", () => {
    const current: Record<string, Thread[]> = {
      "ws-1": [makeThread({ id: "t-old" })],
    };
    const threads = [makeThread({ id: "t-new" })];
    const result = mergeWorkspaceThreads(current, "ws-1", threads);
    expect(result["ws-1"]).toHaveLength(1);
    expect(result["ws-1"][0].id).toBe("t-new");
  });

  it("preserves other workspaces", () => {
    const current: Record<string, Thread[]> = {
      "ws-1": [makeThread({ id: "t-1" })],
      "ws-2": [makeThread({ id: "t-2", workspaceId: "ws-2" })],
    };
    const result = mergeWorkspaceThreads(current, "ws-1", []);
    expect(result["ws-1"]).toHaveLength(0);
    expect(result["ws-2"]).toHaveLength(1);
  });
});

describe("flattenThreadsByWorkspace", () => {
  it("returns empty array for empty object", () => {
    expect(flattenThreadsByWorkspace({})).toEqual([]);
  });

  it("flattens and sorts by lastActivityAt descending", () => {
    const threadsByWorkspace: Record<string, Thread[]> = {
      "ws-1": [
        makeThread({ id: "t-1", lastActivityAt: "2025-01-01T00:00:00Z" }),
        makeThread({ id: "t-2", lastActivityAt: "2025-01-03T00:00:00Z" }),
      ],
      "ws-2": [
        makeThread({ id: "t-3", lastActivityAt: "2025-01-02T00:00:00Z", workspaceId: "ws-2" }),
      ],
    };

    const result = flattenThreadsByWorkspace(threadsByWorkspace);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("t-2"); // Jan 3
    expect(result[1].id).toBe("t-3"); // Jan 2
    expect(result[2].id).toBe("t-1"); // Jan 1
  });

  it("handles single workspace with single thread", () => {
    const threadsByWorkspace = {
      "ws-1": [makeThread({ id: "t-1" })],
    };
    const result = flattenThreadsByWorkspace(threadsByWorkspace);
    expect(result).toHaveLength(1);
  });
});

describe("applyThreadReasoningEffort", () => {
  it("sets reasoningEffort in engineMetadata", () => {
    const thread = makeThread();
    const result = applyThreadReasoningEffort(thread, "high");
    expect(result.engineMetadata).toEqual({ reasoningEffort: "high" });
  });

  it("removes reasoningEffort when set to null", () => {
    const thread = makeThread({
      engineMetadata: { reasoningEffort: "high", other: "keep" },
    });
    const result = applyThreadReasoningEffort(thread, null);
    expect(result.engineMetadata).toEqual({ other: "keep" });
  });

  it("sets engineMetadata to undefined when empty after removal", () => {
    const thread = makeThread({
      engineMetadata: { reasoningEffort: "high" },
    });
    const result = applyThreadReasoningEffort(thread, null);
    expect(result.engineMetadata).toBeUndefined();
  });

  it("preserves other metadata keys", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: "model-x" },
    });
    const result = applyThreadReasoningEffort(thread, "low");
    expect(result.engineMetadata).toEqual({
      lastModelId: "model-x",
      reasoningEffort: "low",
    });
  });

  it("handles thread with no engineMetadata", () => {
    const thread = makeThread({ engineMetadata: undefined });
    const result = applyThreadReasoningEffort(thread, "medium");
    expect(result.engineMetadata).toEqual({ reasoningEffort: "medium" });
  });
});

describe("applyThreadLastModel", () => {
  it("sets lastModelId in engineMetadata", () => {
    const thread = makeThread();
    const result = applyThreadLastModel(thread, "gpt-4o");
    expect(result.engineMetadata).toEqual({ lastModelId: "gpt-4o" });
  });

  it("removes lastModelId when set to null", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: "gpt-4o", reasoningEffort: "high" },
    });
    const result = applyThreadLastModel(thread, null);
    expect(result.engineMetadata).toEqual({ reasoningEffort: "high" });
  });

  it("sets engineMetadata to undefined when empty after removal", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: "gpt-4o" },
    });
    const result = applyThreadLastModel(thread, null);
    expect(result.engineMetadata).toBeUndefined();
  });
});

describe("readThreadLastModelId", () => {
  it("returns model id from engineMetadata", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: "gpt-4o" },
    });
    expect(readThreadLastModelId(thread)).toBe("gpt-4o");
  });

  it("returns null when lastModelId is not set", () => {
    const thread = makeThread({ engineMetadata: undefined });
    expect(readThreadLastModelId(thread)).toBeNull();
  });

  it("returns null when lastModelId is empty string", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: "" },
    });
    expect(readThreadLastModelId(thread)).toBeNull();
  });

  it("returns null when lastModelId is whitespace-only", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: "   " },
    });
    expect(readThreadLastModelId(thread)).toBeNull();
  });

  it("returns null when lastModelId is not a string", () => {
    const thread = makeThread({
      engineMetadata: { lastModelId: 42 as any },
    });
    expect(readThreadLastModelId(thread)).toBeNull();
  });
});

describe("threadMatchesRequestedModel", () => {
  it("matches on thread.modelId", () => {
    const thread = makeThread({ modelId: "gpt-5.3-codex" });
    expect(threadMatchesRequestedModel(thread, "gpt-5.3-codex")).toBe(true);
  });

  it("matches on lastModelId in metadata", () => {
    const thread = makeThread({
      modelId: "gpt-5.3-codex",
      engineMetadata: { lastModelId: "gpt-4o" },
    });
    expect(threadMatchesRequestedModel(thread, "gpt-4o")).toBe(true);
  });

  it("returns false when neither matches", () => {
    const thread = makeThread({
      modelId: "gpt-5.3-codex",
      engineMetadata: { lastModelId: "gpt-4o" },
    });
    expect(threadMatchesRequestedModel(thread, "claude-3.5")).toBe(false);
  });

  it("returns false when metadata has no lastModelId", () => {
    const thread = makeThread({ modelId: "gpt-5.3-codex" });
    expect(threadMatchesRequestedModel(thread, "gpt-4o")).toBe(false);
  });
});
