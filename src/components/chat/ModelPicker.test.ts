import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { EngineModel } from "../../types";
import {
  filterOpenCodeModelsForQuery,
  formatCompactTokenLimit,
  formatOpenCodeProviderName,
  getOpenCodeProviderId,
  groupOpenCodeModels,
  modelMetadataChips,
} from "./ModelPicker";

function makeModel(id: string, hidden = false): EngineModel {
  return {
    id,
    displayName: id,
    description: id,
    hidden,
    isDefault: false,
    inputModalities: ["text"],
    attachmentModalities: ["text"],
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

  it("builds compact metadata chips for OpenCode model capabilities", () => {
    const t = ((key: string, options?: Record<string, string>) => {
      const labels: Record<string, string> = {
        "modelPicker.metadata.vision": "Vision",
        "modelPicker.metadata.pdf": "PDF",
        "modelPicker.metadata.files": "Files",
        "modelPicker.metadata.noFiles": "No files",
        "modelPicker.metadata.contextLimit": `${options?.tokens} ctx`,
        "modelPicker.metadata.outputLimit": `${options?.tokens} out`,
      };
      return labels[key] ?? key;
    }) as unknown as TFunction<"chat">;

    expect(formatCompactTokenLimit(400000)).toBe("400K");
    expect(formatCompactTokenLimit(1200000)).toBe("1.2M");
    expect(
      modelMetadataChips(t, {
        ...makeModel("openrouter/openai/gpt-5"),
        attachmentModalities: ["text", "image", "pdf"],
        limits: {
          contextTokens: 400000,
          outputTokens: 128000,
        },
      }).map((chip) => chip.label),
    ).toEqual(["Vision", "PDF", "Files", "400K ctx", "128K out"]);
  });
});
