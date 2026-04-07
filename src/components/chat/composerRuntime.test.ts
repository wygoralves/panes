import { describe, expect, it } from "vitest";
import { buildComposerRuntimeSnapshot } from "./composerRuntime";
import type { EngineModel } from "../../types";

const codexModel: EngineModel = {
  id: "gpt-5.4",
  displayName: "gpt-5.4",
  description: "Latest",
  hidden: false,
  isDefault: true,
  inputModalities: ["text"],
  supportsPersonality: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "Fast" },
    { reasoningEffort: "medium", description: "Balanced" },
    { reasoningEffort: "high", description: "Deep" },
  ],
};

describe("buildComposerRuntimeSnapshot", () => {
  it("ignores a blank composer until a thread or explicit override exists", () => {
    expect(
      buildComposerRuntimeSnapshot({
        hasActiveThread: false,
        hasExplicitOverride: false,
        selectedEngineId: "codex",
        selectedModel: codexModel,
        selectedEffort: "medium",
        selectedServiceTier: "inherit",
      }),
    ).toBeNull();
  });

  it("captures an explicit codex override for new-thread inheritance", () => {
    expect(
      buildComposerRuntimeSnapshot({
        hasActiveThread: false,
        hasExplicitOverride: true,
        selectedEngineId: "codex",
        selectedModel: codexModel,
        selectedEffort: "high",
        selectedServiceTier: "fast",
      }),
    ).toEqual({
      engineId: "codex",
      modelId: "gpt-5.4",
      reasoningEffort: "high",
      serviceTier: "fast",
    });
  });

  it("drops codex-only service tiers for non-codex engines", () => {
    expect(
      buildComposerRuntimeSnapshot({
        hasActiveThread: true,
        hasExplicitOverride: false,
        selectedEngineId: "claude",
        selectedModel: {
          id: "claude-sonnet-4-6",
          defaultReasoningEffort: codexModel.defaultReasoningEffort,
          supportedReasoningEfforts: codexModel.supportedReasoningEfforts,
        },
        selectedEffort: "high",
        selectedServiceTier: "flex",
      }),
    ).toEqual({
      engineId: "claude",
      modelId: "claude-sonnet-4-6",
      reasoningEffort: "high",
      serviceTier: null,
    });
  });
});
