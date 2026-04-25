import { describe, expect, it } from "vitest";
import {
  NEW_THREAD_FALLBACK_RUNTIME,
  resolveNewThreadRuntime,
} from "./newThreadRuntime";
import type { EngineInfo, Thread } from "../types";

const engines: EngineInfo[] = [
  {
    id: "codex",
    name: "Codex",
    models: [
      {
        id: "gpt-5.4",
        displayName: "gpt-5.4",
        description: "Latest",
        hidden: false,
        isDefault: true,
        inputModalities: ["text"],
        attachmentModalities: ["text"],
        supportsPersonality: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Fast" },
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "high", description: "Deep" },
          { reasoningEffort: "xhigh", description: "Max" },
        ],
      },
      {
        id: "gpt-5.3-codex",
        displayName: "gpt-5.3-codex",
        description: "Previous",
        hidden: false,
        isDefault: false,
        inputModalities: ["text"],
        attachmentModalities: ["text"],
        supportsPersonality: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Fast" },
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "high", description: "Deep" },
          { reasoningEffort: "xhigh", description: "Max" },
        ],
      },
    ],
    capabilities: {
      permissionModes: [],
      sandboxModes: [],
      approvalDecisions: [],
    },
  },
  {
    id: "claude",
    name: "Claude",
    models: [
      {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        description: "Claude",
        hidden: false,
        isDefault: true,
        inputModalities: ["text"],
        attachmentModalities: ["text"],
        supportsPersonality: false,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "high", description: "Deep" },
        ],
      },
    ],
    capabilities: {
      permissionModes: [],
      sandboxModes: [],
      approvalDecisions: [],
    },
  },
];

function buildThread(overrides?: Partial<Thread>): Thread {
  return {
    id: "thread-1",
    workspaceId: "ws-1",
    repoId: null,
    engineId: "codex",
    modelId: "gpt-5.3-codex",
    engineThreadId: null,
    engineMetadata: undefined,
    title: "Thread",
    status: "idle",
    messageCount: 0,
    totalTokens: 0,
    createdAt: "2026-03-26T00:00:00Z",
    lastActivityAt: "2026-03-26T00:00:00Z",
    ...overrides,
  };
}

describe("resolveNewThreadRuntime", () => {
  it("prefers the visible composer runtime over saved thread metadata", () => {
    const runtime = resolveNewThreadRuntime({
      engines,
      composerRuntime: {
        engineId: "codex",
        modelId: "gpt-5.4",
        reasoningEffort: "low",
        serviceTier: "fast",
      },
      activeThread: buildThread({
        engineMetadata: {
          lastModelId: "gpt-5.3-codex",
          reasoningEffort: "xhigh",
          serviceTier: "flex",
        },
      }),
      onboardingSelection: {
        engineId: "claude",
        modelId: "claude-sonnet-4-6",
      },
    });

    expect(runtime).toEqual({
      engineId: "codex",
      modelId: "gpt-5.4",
      reasoningEffort: "low",
      serviceTier: "fast",
    });
  });

  it("prefers saved active-thread runtime over onboarding", () => {
    const runtime = resolveNewThreadRuntime({
      engines,
      activeThread: buildThread({
        engineMetadata: {
          lastModelId: "gpt-5.4",
          reasoningEffort: "xhigh",
          serviceTier: "fast",
        },
      }),
      onboardingSelection: {
        engineId: "claude",
        modelId: "claude-sonnet-4-6",
      },
    });

    expect(runtime).toEqual({
      engineId: "codex",
      modelId: "gpt-5.4",
      reasoningEffort: "xhigh",
      serviceTier: "fast",
    });
  });

  it("uses the onboarding selection when there is no composer or active thread", () => {
    const runtime = resolveNewThreadRuntime({
      engines,
      onboardingSelection: {
        engineId: "claude",
        modelId: "claude-sonnet-4-6",
      },
    });

    expect(runtime).toEqual({
      engineId: "claude",
      modelId: "claude-sonnet-4-6",
      reasoningEffort: null,
      serviceTier: null,
    });
  });

  it("falls back to codex gpt-5.4 high when no other preference exists", () => {
    expect(
      resolveNewThreadRuntime({
        engines,
        onboardingSelection: null,
      }),
    ).toEqual(NEW_THREAD_FALLBACK_RUNTIME);
  });
});
