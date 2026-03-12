import { describe, expect, it } from "vitest";
import {
  canContinueChatReadiness,
  isOnboardingEnterTargetInteractive,
  isChatWorkflowReady,
  isCodexAuthDeferred,
  nextOnboardingStep,
  normalizeOnboardingHarnessInstallId,
  previousOnboardingStep,
  shouldAutoOpenOnboarding,
} from "./onboarding";
import type { DependencyReport } from "../types";

const readyDependencies: DependencyReport = {
  node: {
    found: true,
    version: "20.18.0",
    path: "/usr/local/bin/node",
    canAutoInstall: true,
    installMethod: "brew",
  },
  codex: {
    found: true,
    version: "0.1.0",
    path: "/usr/local/bin/codex",
    canAutoInstall: true,
    installMethod: "npm",
  },
  git: {
    found: true,
    version: "2.48.0",
    path: "/usr/bin/git",
    canAutoInstall: false,
    installMethod: null,
  },
  platform: "macos",
  packageManagers: ["homebrew"],
};

describe("onboarding helpers", () => {
  it("maps the Claude engine id to the installable harness id", () => {
    expect(normalizeOnboardingHarnessInstallId("claude")).toBe("claude-code");
    expect(normalizeOnboardingHarnessInstallId("codex")).toBe("codex");
    expect(normalizeOnboardingHarnessInstallId("kiro")).toBe("kiro");
  });

  it("auto-opens only for users who have not completed any onboarding", () => {
    expect(
      shouldAutoOpenOnboarding({
        loadedOnce: true,
        loadingEngines: false,
        completed: false,
        legacyCompleted: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoOpenOnboarding({
        loadedOnce: true,
        loadingEngines: false,
        completed: true,
        legacyCompleted: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoOpenOnboarding({
        loadedOnce: true,
        loadingEngines: false,
        completed: false,
        legacyCompleted: true,
      }),
    ).toBe(false);
  });

  it("resolves forward and backward steps for each workflow", () => {
    expect(nextOnboardingStep("workflow", "cli")).toBe("cliProviders");
    expect(nextOnboardingStep("workflow", "chat")).toBe("chatEngines");
    expect(nextOnboardingStep("chatReadiness", "chat")).toBe("workspace");
    expect(previousOnboardingStep("workspace", "cli")).toBe("cliProviders");
    expect(previousOnboardingStep("workspace", "chat")).toBe("chatReadiness");
  });

  it("treats Codex as ready only when both dependency and engine health pass", () => {
    expect(
      isChatWorkflowReady(["codex"], readyDependencies, {
        codex: {
          id: "codex",
          available: true,
          warnings: [],
          checks: [],
          fixes: [],
        },
      }),
    ).toBe(true);

    expect(
      isChatWorkflowReady(["codex"], readyDependencies, {
        codex: {
          id: "codex",
          available: false,
          warnings: [],
          checks: [],
          fixes: [],
        },
      }),
    ).toBe(false);
  });

  it("lets Claude readiness depend on engine health without requiring the Claude CLI", () => {
    expect(
      isChatWorkflowReady(["claude"], readyDependencies, {
        claude: {
          id: "claude",
          available: true,
          warnings: ["ANTHROPIC_API_KEY is not set"],
          checks: [],
          fixes: [],
        },
      }),
    ).toBe(true);
  });

  it("treats Codex auth failures as non-blocking for onboarding when the CLI is installed", () => {
    const authBlockedHealth = {
      id: "codex",
      available: false,
      details: "Authentication required: not logged in",
      warnings: [],
      checks: [],
      fixes: [],
    };

    expect(isCodexAuthDeferred(authBlockedHealth)).toBe(true);
    expect(isChatWorkflowReady(["codex"], readyDependencies, { codex: authBlockedHealth })).toBe(
      true,
    );
  });

  it("keeps non-auth Codex runtime failures blocking", () => {
    const runtimeFailure = {
      id: "codex",
      available: false,
      details: "Failed to connect to the Codex transport",
      warnings: [],
      checks: [],
      fixes: [],
    };

    expect(isCodexAuthDeferred(runtimeFailure)).toBe(false);
    expect(isChatWorkflowReady(["codex"], readyDependencies, { codex: runtimeFailure })).toBe(
      false,
    );
  });

  it("blocks advancing chat readiness while a refresh is pending or has failed", () => {
    const readyHealth = {
      claude: {
        id: "claude",
        available: true,
        warnings: [],
        checks: [],
        fixes: [],
      },
    };

    expect(
      canContinueChatReadiness(["claude"], readyDependencies, readyHealth, true, null),
    ).toBe(false);
    expect(
      canContinueChatReadiness(["claude"], readyDependencies, readyHealth, false, "request failed"),
    ).toBe(false);
    expect(
      canContinueChatReadiness(["claude"], readyDependencies, readyHealth, false, null),
    ).toBe(true);
  });

  it("ignores the global Enter shortcut when focus is inside another interactive control", () => {
    expect(
      isOnboardingEnterTargetInteractive([
        { tagName: "span", role: null, isContentEditable: false },
        { tagName: "button", role: null, isContentEditable: false },
      ]),
    ).toBe(true);

    expect(
      isOnboardingEnterTargetInteractive([
        { tagName: "div", role: "button", isContentEditable: false },
      ]),
    ).toBe(true);

    expect(
      isOnboardingEnterTargetInteractive([
        { tagName: "div", role: null, isContentEditable: false },
      ]),
    ).toBe(false);
  });
});
