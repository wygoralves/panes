import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPrompt,
  draftPreview,
  hasDraftContent,
  trimPromptMap,
  useComposerDraftStore,
} from "./composerDraftStore";

describe("hasDraftContent", () => {
  it("ignores whitespace-only text", () => {
    expect(hasDraftContent("   \n\t")).toBe(false);
    expect(hasDraftContent("fix the login bug")).toBe(true);
    expect(hasDraftContent(undefined)).toBe(false);
  });
});

describe("draftPreview", () => {
  it("returns the first non-empty line", () => {
    expect(draftPreview("\n\n  Rename the store  \nthen add tests")).toBe("Rename the store");
    expect(draftPreview("  ")).toBeNull();
  });
});

describe("applyPrompt", () => {
  it("stores text and removes the entry when it empties", () => {
    const withText = applyPrompt({}, "t1", "hello");
    expect(withText).toEqual({ t1: "hello" });
    expect(applyPrompt(withText, "t1", "  ")).toEqual({});
  });

  it("returns the same map when nothing changes", () => {
    const prompts = { t1: "hello" };
    expect(applyPrompt(prompts, "t1", "hello")).toBe(prompts);
    expect(applyPrompt(prompts, "t2", "")).toBe(prompts);
  });

  it("moves an updated draft to the most recent position", () => {
    const prompts = applyPrompt(applyPrompt({}, "a", "one"), "b", "two");
    expect(Object.keys(applyPrompt(prompts, "a", "one more"))).toEqual(["b", "a"]);
  });
});

describe("trimPromptMap", () => {
  it("keeps the most recent entries", () => {
    expect(trimPromptMap({ a: "1", b: "2", c: "3" }, 2)).toEqual({ b: "2", c: "3" });
  });
});

describe("useComposerDraftStore", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({ promptByThread: {} });
  });

  it("clears a prompt", () => {
    useComposerDraftStore.getState().setPrompt("t1", "draft");
    expect(useComposerDraftStore.getState().promptByThread).toEqual({ t1: "draft" });
    useComposerDraftStore.getState().clearPrompt("t1");
    expect(useComposerDraftStore.getState().promptByThread).toEqual({});
  });
});
