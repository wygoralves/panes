import { describe, expect, it } from "vitest";
import type { EngineModel } from "../../types";
import {
  filterOpenCodeModelsForQuery,
  formatOpenCodeProviderName,
  getOpenCodeProviderId,
  groupOpenCodeModels,
} from "./ModelPicker";

function makeModel(id: string, hidden = false): EngineModel {
  return {
    id,
    displayName: id,
    description: id,
    hidden,
    isDefault: false,
    inputModalities: ["text"],
    supportsPersonality: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [],
  };
}

describe("OpenCode model provider grouping", () => {
  it("reads the provider from the slug and unwraps OpenRouter broker models", () => {
    expect(getOpenCodeProviderId("openai/gpt-5")).toBe("openai");
    expect(getOpenCodeProviderId("openrouter/anthropic/claude-sonnet-4.5")).toBe(
      "anthropic",
    );
    expect(getOpenCodeProviderId("openrouter/arcee-ai/trinity-large-preview")).toBe(
      "arcee-ai",
    );
    expect(getOpenCodeProviderId("local-model")).toBe("local");
  });

  it("formats common provider labels", () => {
    expect(formatOpenCodeProviderName("openai")).toBe("OpenAI");
    expect(formatOpenCodeProviderName("openrouter")).toBe("OpenRouter");
    expect(formatOpenCodeProviderName("custom-provider")).toBe("Custom Provider");
  });

  it("groups active and legacy models by provider in source order", () => {
    const groups = groupOpenCodeModels([
      makeModel("opencode/big-pickle"),
      makeModel("openrouter/anthropic/claude-sonnet-4.5"),
      makeModel("opencode/legacy-model", true),
      makeModel("openai/gpt-5"),
    ]);

    expect(groups.map((group) => group.providerId)).toEqual([
      "opencode",
      "anthropic",
      "openai",
    ]);
    expect(groups[0]).toMatchObject({
      providerLabel: "OpenCode",
      totalModelCount: 2,
    });
    expect(groups[0].activeModels.map((model) => model.id)).toEqual([
      "opencode/big-pickle",
    ]);
    expect(groups[0].legacyModels.map((model) => model.id)).toEqual([
      "opencode/legacy-model",
    ]);
    expect(groups[1]).toMatchObject({
      providerLabel: "Anthropic",
      totalModelCount: 1,
    });
  });

  it("filters models by slug, display name, and description", () => {
    const models = [
      makeModel("openrouter/anthropic/claude-sonnet-4.5"),
      {
        ...makeModel("openai/gpt-5"),
        displayName: "GPT 5",
        description: "OpenAI coding model",
      },
    ];

    expect(filterOpenCodeModelsForQuery(models, "claude").map((model) => model.id)).toEqual([
      "openrouter/anthropic/claude-sonnet-4.5",
    ]);
    expect(filterOpenCodeModelsForQuery(models, "coding").map((model) => model.id)).toEqual([
      "openai/gpt-5",
    ]);
    expect(filterOpenCodeModelsForQuery(models, "   ")).toEqual(models);
  });
});
