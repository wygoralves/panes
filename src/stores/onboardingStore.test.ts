import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIpc = vi.hoisted(() => ({
  installDependency: vi.fn(),
  installHarness: vi.fn(),
}));

const mockListenInstallProgress = vi.hoisted(() => vi.fn());

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
  listenInstallProgress: mockListenInstallProgress,
}));

type OnboardingStoreModule = typeof import("./onboardingStore");

function createStorageStub() {
  const storage = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

describe("onboardingStore", () => {
  let useOnboardingStore: OnboardingStoreModule["useOnboardingStore"];
  let readStoredOnboardingState: OnboardingStoreModule["readStoredOnboardingState"];
  let LEGACY_SETUP_COMPLETED_KEY: OnboardingStoreModule["LEGACY_SETUP_COMPLETED_KEY"];
  let ONBOARDING_CHAT_ENGINES_KEY: OnboardingStoreModule["ONBOARDING_CHAT_ENGINES_KEY"];
  let ONBOARDING_COMPLETED_KEY: OnboardingStoreModule["ONBOARDING_COMPLETED_KEY"];
  let ONBOARDING_WORKFLOW_KEY: OnboardingStoreModule["ONBOARDING_WORKFLOW_KEY"];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageStub());
    mockListenInstallProgress.mockResolvedValue(() => undefined);

    ({
      LEGACY_SETUP_COMPLETED_KEY,
      ONBOARDING_CHAT_ENGINES_KEY,
      ONBOARDING_COMPLETED_KEY,
      ONBOARDING_WORKFLOW_KEY,
      readStoredOnboardingState,
      useOnboardingStore,
    } = await import("./onboardingStore"));

    useOnboardingStore.setState({
      open: false,
      completed: false,
      legacyCompleted: false,
      step: "workflow",
      preferredWorkflow: null,
      selectedChatEngines: [],
      selectedWorkspaceId: null,
      installLog: [],
      installing: null,
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and normalizes saved onboarding preferences", () => {
    localStorage.setItem(ONBOARDING_WORKFLOW_KEY, "chat");
    localStorage.setItem(
      ONBOARDING_CHAT_ENGINES_KEY,
      JSON.stringify(["claude", "invalid", "codex", "claude"]),
    );

    expect(readStoredOnboardingState()).toEqual({
      completed: false,
      legacyCompleted: false,
      preferredWorkflow: "chat",
      selectedChatEngines: ["codex", "claude"],
    });
  });

  it("persists workflow and chat engine selection in stable order", () => {
    useOnboardingStore.getState().setPreferredWorkflow("chat");
    useOnboardingStore.getState().setSelectedChatEngines(["claude", "codex", "claude"]);

    expect(localStorage.getItem(ONBOARDING_WORKFLOW_KEY)).toBe("chat");
    expect(localStorage.getItem(ONBOARDING_CHAT_ENGINES_KEY)).toBe(
      JSON.stringify(["codex", "claude"]),
    );
  });

  it("tracks legacy completion separately from the new onboarding flag", () => {
    localStorage.setItem(LEGACY_SETUP_COMPLETED_KEY, "1");

    expect(readStoredOnboardingState()).toEqual({
      completed: false,
      legacyCompleted: true,
      preferredWorkflow: null,
      selectedChatEngines: [],
    });
  });

  it("uses the direct harness install path and records completion state", async () => {
    mockIpc.installHarness.mockResolvedValue({
      success: true,
      message: "ok",
    });

    const ok = await useOnboardingStore.getState().installHarness("codex", "Codex CLI");
    useOnboardingStore.getState().complete();

    expect(ok).toBe(true);
    expect(mockIpc.installHarness).toHaveBeenCalledWith("codex");
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe("1");
    expect(useOnboardingStore.getState().isCompleted()).toBe(true);
  });
});
