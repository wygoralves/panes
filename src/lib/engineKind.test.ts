import { describe, expect, it } from "vitest";
import {
  chatProviderSlugFromLabel,
  engineKind,
  isBuiltinEngineId,
  isValidChatProviderSlug,
} from "./engineKind";

describe("engineKind", () => {
  it("maps built-in ids and instance ids to their kind", () => {
    expect(engineKind("codex")).toBe("codex");
    expect(engineKind("claude_work")).toBe("claude");
    expect(engineKind("codex_personal-2")).toBe("codex");
    expect(engineKind("claude_")).toBe("claude_");
    expect(engineKind("claudex")).toBe("claudex");
    expect(engineKind(null)).toBe("");
  });

  it("recognizes built-in ids", () => {
    expect(isBuiltinEngineId("claude")).toBe(true);
    expect(isBuiltinEngineId("claude_work")).toBe(false);
  });

  it("derives slugs from labels", () => {
    expect(chatProviderSlugFromLabel("Work laptop")).toBe("work-laptop");
    expect(chatProviderSlugFromLabel("  2nd Account! ")).toBe("nd-account");
    expect(chatProviderSlugFromLabel("Ação")).toBe("acao");
    expect(isValidChatProviderSlug("work-2")).toBe(true);
    expect(isValidChatProviderSlug("Work")).toBe(false);
    expect(isValidChatProviderSlug("")).toBe(false);
  });
});
