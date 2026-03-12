import { create } from "zustand";
import { ipc, listenInstallProgress } from "../lib/ipc";
import { normalizeOnboardingHarnessInstallId } from "../lib/onboarding";
import type {
  OnboardingChatEngineId,
  OnboardingStep,
  OnboardingWorkflowPreference,
} from "../types";

export const LEGACY_SETUP_COMPLETED_KEY = "panes.setup.completed.v2";
export const ONBOARDING_COMPLETED_KEY = "panes.onboarding.completed.v1";
export const ONBOARDING_WORKFLOW_KEY = "panes.onboarding.workflow.v1";
export const ONBOARDING_CHAT_ENGINES_KEY = "panes.onboarding.chatEngines.v1";

const CHAT_ENGINE_ORDER: OnboardingChatEngineId[] = ["codex", "claude"];

export interface OnboardingInstallLogEntry {
  dep: string;
  line: string;
  stream: string;
}

export interface OnboardingInstallTarget {
  kind: "dependency" | "harness";
  id: string;
  label: string;
}

interface OnboardingState {
  open: boolean;
  completed: boolean;
  legacyCompleted: boolean;
  step: OnboardingStep;
  preferredWorkflow: OnboardingWorkflowPreference | null;
  selectedChatEngines: OnboardingChatEngineId[];
  selectedWorkspaceId: string | null;
  installLog: OnboardingInstallLogEntry[];
  installing: OnboardingInstallTarget | null;
  error: string | null;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  isCompleted: () => boolean;
  hasLegacyCompletion: () => boolean;
  setStep: (step: OnboardingStep) => void;
  setPreferredWorkflow: (workflow: OnboardingWorkflowPreference | null) => void;
  setSelectedChatEngines: (engines: OnboardingChatEngineId[]) => void;
  toggleChatEngine: (engine: OnboardingChatEngineId) => void;
  setSelectedWorkspaceId: (workspaceId: string | null) => void;
  clearInstallState: () => void;
  installDependency: (dependency: string, method: string, label?: string) => Promise<boolean>;
  installHarness: (harnessId: string, label?: string) => Promise<boolean>;
  complete: () => void;
}

function readBooleanKey(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBooleanKey(key: string, value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(key, "1");
      return;
    }
    localStorage.removeItem(key);
  } catch {
    // Ignore persistence failures in tests or restricted environments.
  }
}

function normalizeWorkflow(
  value: string | null,
): OnboardingWorkflowPreference | null {
  return value === "cli" || value === "chat" ? value : null;
}

function readWorkflow(): OnboardingWorkflowPreference | null {
  try {
    return normalizeWorkflow(localStorage.getItem(ONBOARDING_WORKFLOW_KEY));
  } catch {
    return null;
  }
}

function writeWorkflow(workflow: OnboardingWorkflowPreference | null): void {
  try {
    if (!workflow) {
      localStorage.removeItem(ONBOARDING_WORKFLOW_KEY);
      return;
    }
    localStorage.setItem(ONBOARDING_WORKFLOW_KEY, workflow);
  } catch {
    // Ignore persistence failures in tests or restricted environments.
  }
}

function normalizeChatEngines(values: Iterable<unknown>): OnboardingChatEngineId[] {
  const selected = new Set<OnboardingChatEngineId>();

  for (const value of values) {
    if (value === "codex" || value === "claude") {
      selected.add(value);
    }
  }

  return CHAT_ENGINE_ORDER.filter((engine) => selected.has(engine));
}

function readChatEngines(): OnboardingChatEngineId[] {
  try {
    const raw = localStorage.getItem(ONBOARDING_CHAT_ENGINES_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeChatEngines(parsed);
  } catch {
    return [];
  }
}

function writeChatEngines(engines: OnboardingChatEngineId[]): void {
  try {
    if (engines.length === 0) {
      localStorage.removeItem(ONBOARDING_CHAT_ENGINES_KEY);
      return;
    }
    localStorage.setItem(
      ONBOARDING_CHAT_ENGINES_KEY,
      JSON.stringify(normalizeChatEngines(engines)),
    );
  } catch {
    // Ignore persistence failures in tests or restricted environments.
  }
}

export function readStoredOnboardingState() {
  return {
    completed: readBooleanKey(ONBOARDING_COMPLETED_KEY),
    legacyCompleted: readBooleanKey(LEGACY_SETUP_COMPLETED_KEY),
    preferredWorkflow: readWorkflow(),
    selectedChatEngines: readChatEngines(),
  };
}

function describeInstallTarget(
  kind: "dependency" | "harness",
  id: string,
  label?: string,
): OnboardingInstallTarget {
  return {
    kind,
    id,
    label: label ?? id,
  };
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  open: false,
  ...readStoredOnboardingState(),
  step: "workflow",
  selectedWorkspaceId: null,
  installLog: [],
  installing: null,
  error: null,

  openOnboarding: () =>
    set((state) => ({
      open: true,
      step: "workflow",
      selectedWorkspaceId: null,
      installLog: [],
      installing: null,
      error: null,
      preferredWorkflow: state.preferredWorkflow,
      selectedChatEngines: state.selectedChatEngines,
    })),
  closeOnboarding: () => set({ open: false, installLog: [], error: null, installing: null }),
  isCompleted: () => get().completed,
  hasLegacyCompletion: () => get().legacyCompleted,
  setStep: (step) => set({ step, error: null }),
  setPreferredWorkflow: (workflow) => {
    writeWorkflow(workflow);
    set({ preferredWorkflow: workflow });
  },
  setSelectedChatEngines: (engines) => {
    const normalized = normalizeChatEngines(engines);
    writeChatEngines(normalized);
    set({ selectedChatEngines: normalized });
  },
  toggleChatEngine: (engine) => {
    const current = get().selectedChatEngines;
    const next = current.includes(engine)
      ? current.filter((entry) => entry !== engine)
      : [...current, engine];
    get().setSelectedChatEngines(next);
  },
  setSelectedWorkspaceId: (workspaceId) => set({ selectedWorkspaceId: workspaceId }),
  clearInstallState: () => set({ installLog: [], installing: null, error: null }),
  installDependency: async (dependency, method, label) => {
    if (get().installing) {
      return false;
    }

    set({
      installing: describeInstallTarget("dependency", dependency, label),
      error: null,
    });

    let unlisten: (() => void) | null = null;

    try {
      unlisten = await listenInstallProgress((event) => {
        set((state) => ({
          installLog: [
            ...state.installLog,
            { dep: event.dependency, line: event.line, stream: event.stream },
          ],
        }));
      });
      const result = await ipc.installDependency(dependency, method);
      return result.success;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ installing: null });
      unlisten?.();
    }
  },
  installHarness: async (harnessId, label) => {
    if (get().installing) {
      return false;
    }

    const installId = normalizeOnboardingHarnessInstallId(harnessId);
    set({
      installing: describeInstallTarget("harness", installId, label),
      error: null,
    });

    let unlisten: (() => void) | null = null;

    try {
      unlisten = await listenInstallProgress((event) => {
        set((state) => ({
          installLog: [
            ...state.installLog,
            { dep: event.dependency, line: event.line, stream: event.stream },
          ],
        }));
      });
      const result = await ipc.installHarness(installId);
      return result.success;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ installing: null });
      unlisten?.();
    }
  },
  complete: () => {
    writeBooleanKey(ONBOARDING_COMPLETED_KEY, true);
    set({ completed: true, open: false, error: null, installing: null });
  },
}));
