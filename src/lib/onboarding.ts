import type {
  DependencyReport,
  EngineHealth,
  OnboardingChatEngineId,
  OnboardingStep,
  OnboardingWorkflowPreference,
} from "../types";

export const CHAT_ENGINE_INSTALL_HARNESS_IDS: Readonly<Record<OnboardingChatEngineId, string>> = {
  codex: "codex",
  claude: "claude-code",
};

const CODEX_AUTH_ERROR_MARKERS = [
  "401",
  "unauthorized",
  "not logged in",
  "login required",
  "authentication required",
  "auth token",
  "invalid token",
  "expired token",
] as const;

interface OnboardingAutoOpenOptions {
  loadedOnce: boolean;
  loadingEngines: boolean;
  completed: boolean;
  legacyCompleted: boolean;
}

export function normalizeOnboardingHarnessInstallId(targetId: string): string {
  if (targetId === "claude") {
    return CHAT_ENGINE_INSTALL_HARNESS_IDS.claude;
  }

  return targetId;
}

export function shouldAutoOpenOnboarding({
  loadedOnce,
  loadingEngines,
  completed,
  legacyCompleted,
}: OnboardingAutoOpenOptions): boolean {
  return loadedOnce && !loadingEngines && !completed && !legacyCompleted;
}

export function nextOnboardingStep(
  step: OnboardingStep,
  workflow: OnboardingWorkflowPreference | null,
): OnboardingStep {
  switch (step) {
    case "greeting":
      return "workflow";
    case "workflow":
      return workflow === "cli" ? "cliProviders" : "chatEngines";
    case "cliProviders":
      return "workspace";
    case "chatEngines":
      return "chatReadiness";
    case "chatReadiness":
      return "workspace";
    case "workspace":
    default:
      return "workspace";
  }
}

export function previousOnboardingStep(
  step: OnboardingStep,
  workflow: OnboardingWorkflowPreference | null,
): OnboardingStep {
  switch (step) {
    case "workflow":
      return "greeting";
    case "cliProviders":
    case "chatEngines":
      return "workflow";
    case "chatReadiness":
      return "chatEngines";
    case "workspace":
      return workflow === "cli" ? "cliProviders" : "chatReadiness";
    case "greeting":
    default:
      return "greeting";
  }
}

export function isChatEngineReady(
  engineId: OnboardingChatEngineId,
  dependencyReport: DependencyReport | null,
  engineHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>>,
): boolean {
  if (engineId === "codex") {
    return Boolean(
      dependencyReport?.node.found &&
        dependencyReport.codex.found &&
        (engineHealth.codex?.available || isCodexAuthDeferred(engineHealth.codex)),
    );
  }

  return engineHealth.claude?.available ?? false;
}

export function isChatWorkflowReady(
  selectedEngines: OnboardingChatEngineId[],
  dependencyReport: DependencyReport | null,
  engineHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>>,
): boolean {
  if (selectedEngines.length === 0) {
    return false;
  }

  return selectedEngines.every((engineId) =>
    isChatEngineReady(engineId, dependencyReport, engineHealth),
  );
}

export function canContinueChatReadiness(
  selectedEngines: OnboardingChatEngineId[],
  dependencyReport: DependencyReport | null,
  engineHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>>,
  loading: boolean,
  error: string | null,
): boolean {
  if (loading || error) {
    return false;
  }

  return isChatWorkflowReady(selectedEngines, dependencyReport, engineHealth);
}

export function onboardingStepIndex(step: OnboardingStep): number {
  switch (step) {
    case "greeting":
      return -1;
    case "workflow":
      return 0;
    case "cliProviders":
    case "chatEngines":
      return 1;
    case "chatReadiness":
      return 2;
    case "workspace":
      return 3;
  }
}

export function isCodexAuthDeferred(health?: EngineHealth): boolean {
  if (!health || health.available || !health.details) {
    return false;
  }

  const value = health.details.toLowerCase();
  return CODEX_AUTH_ERROR_MARKERS.some((marker) => value.includes(marker));
}
