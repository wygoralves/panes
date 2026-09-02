import { describe, expect, it } from "vitest";
import { findReusableDraftThread } from "./DraftScopePicker";
import type { Thread } from "../../types";

function thread(overrides: Partial<Thread>): Thread {
  return {
    id: "t",
    workspaceId: "w",
    repoId: null,
    engineId: "codex",
    modelId: "m",
    title: "New Thread",
    status: "idle",
    createdAt: "2026-01-01T00:00:00Z",
    lastActivityAt: "2026-01-01T00:00:00Z",
    messageCount: 0,
    settledAt: null,
    ...overrides,
  } as Thread;
}

describe("findReusableDraftThread", () => {
  it("returns an untouched idle thread", () => {
    const draft = thread({ id: "draft" });
    expect(findReusableDraftThread([thread({ id: "busy", messageCount: 3 }), draft])).toBe(draft);
  });

  it("ignores settled, streaming, or non-empty threads", () => {
    expect(
      findReusableDraftThread([
        thread({ id: "settled", settledAt: "2026-01-02T00:00:00Z" }),
        thread({ id: "streaming", status: "streaming" }),
        thread({ id: "used", messageCount: 1 }),
      ]),
    ).toBeNull();
  });
});
