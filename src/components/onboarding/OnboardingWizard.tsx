import { type ReactNode, useEffect, useRef, useState } from "react";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings2,
  Terminal,
  X,
} from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  isChatWorkflowReady,
  isCodexAuthDeferred,
  nextOnboardingStep,
  previousOnboardingStep,
  shouldAutoOpenOnboarding,
} from "../../lib/onboarding";
import { ipc } from "../../lib/ipc";
import { getHarnessInstallCommand } from "../../lib/harnessInstallActions";
import { getNodeManualGuidance } from "../../lib/setupGuidance";
import { useEngineStore } from "../../stores/engineStore";
import { useHarnessStore } from "../../stores/harnessStore";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type {
  DependencyReport,
  EngineHealth,
  HarnessInfo,
  OnboardingChatEngineId,
  OnboardingStep,
  OnboardingWorkflowPreference,
} from "../../types";

interface ReadinessState {
  loading: boolean;
  dependencyReport: DependencyReport | null;
  engineHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>>;
  error: string | null;
}

const CHAT_ENGINE_OPTIONS: Array<{
  id: OnboardingChatEngineId;
  descriptionKey: string;
}> = [
  { id: "codex", descriptionKey: "chatEngines.options.codex.description" },
  { id: "claude", descriptionKey: "chatEngines.options.claude.description" },
];

const STEP_TITLES: Record<
  OnboardingStep,
  { titleKey: string; subtitleKey: string }
> = {
  workflow: {
    titleKey: "workflow.title",
    subtitleKey: "workflow.subtitle",
  },
  cliProviders: {
    titleKey: "cliProviders.title",
    subtitleKey: "cliProviders.subtitle",
  },
  chatEngines: {
    titleKey: "chatEngines.title",
    subtitleKey: "chatEngines.subtitle",
  },
  chatReadiness: {
    titleKey: "chatReadiness.title",
    subtitleKey: "chatReadiness.subtitle",
  },
  workspace: {
    titleKey: "workspace.title",
    subtitleKey: "workspace.subtitle",
  },
};

function getVisibleSteps(
  workflow: OnboardingWorkflowPreference | null,
): OnboardingStep[] {
  if (workflow === "cli") {
    return ["workflow", "cliProviders", "workspace"];
  }

  if (workflow === "chat") {
    return ["workflow", "chatEngines", "chatReadiness", "workspace"];
  }

  return ["workflow"];
}

function CopyCommandButton({ command }: { command: string }) {
  const { t } = useTranslation(["setup", "common"]);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyTextToClipboard(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={() => void handleCopy()}
      style={{
        padding: "7px 12px",
        fontSize: 11.5,
        borderRadius: "var(--radius-sm)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <ClipboardCopy size={12} />
      {copied ? t("setup:actions.copied") : t("common:actions.copy")}
    </button>
  );
}

function InstallLogView({
  log,
}: {
  log: { dep: string; line: string; stream: string }[];
}) {
  const { t } = useTranslation("setup");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log.length]);

  return (
    <pre
      ref={logRef}
      style={{
        margin: 0,
        padding: "12px 14px",
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: '"JetBrains Mono", monospace',
        background: "var(--code-bg)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        maxHeight: 220,
        overflow: "auto",
        color: "var(--text-2)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {log.length === 0
        ? t("install.waiting")
        : log.map((entry, index) => (
            <div
              key={`${entry.dep}-${index}`}
              style={{
                color:
                  entry.stream === "stderr"
                    ? "var(--warning)"
                    : entry.stream === "status"
                      ? "var(--accent)"
                      : "var(--text-2)",
              }}
            >
              {entry.line}
            </div>
          ))}
    </pre>
  );
}

function StatusMessage({
  tone,
  children,
}: {
  tone: "warning" | "info";
  children: string;
}) {
  const borderColor =
    tone === "warning"
      ? "rgba(251, 191, 36, 0.28)"
      : "rgba(90, 170, 255, 0.24)";
  const background =
    tone === "warning"
      ? "rgba(251, 191, 36, 0.07)"
      : "rgba(90, 170, 255, 0.08)";

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${borderColor}`,
        background,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <AlertTriangle
        size={15}
        style={{
          flexShrink: 0,
          color: tone === "warning" ? "var(--warning)" : "var(--accent)",
          marginTop: 1,
        }}
      />
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-1)", lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  );
}

function StepChip({
  active,
  complete,
  label,
}: {
  active: boolean;
  complete: boolean;
  label: string;
}) {
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: active
          ? "1px solid rgba(255, 107, 107, 0.4)"
          : complete
            ? "1px solid rgba(255, 107, 107, 0.25)"
            : "1px solid var(--border)",
        background: active
          ? "rgba(255, 107, 107, 0.1)"
          : complete
            ? "rgba(255, 107, 107, 0.05)"
            : "var(--bg-2)",
        fontSize: 11,
        fontWeight: 600,
        color: active ? "var(--accent)" : "var(--text-2)",
      }}
    >
      {label}
    </div>
  );
}

function WorkflowCard({
  active,
  description,
  icon,
  title,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 0,
        borderRadius: "var(--radius)",
        border: active
          ? "1px solid rgba(255, 107, 107, 0.35)"
          : "1px solid var(--border)",
        background: active ? "rgba(255, 107, 107, 0.06)" : "var(--bg-2)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 14,
          padding: "18px 18px 16px",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: active ? "rgba(255, 107, 107, 0.14)" : "var(--bg-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: active ? "var(--accent)" : "var(--text-2)",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
              {title}
            </span>
            {active ? (
              <CheckCircle2 size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}

function ChatEngineCard({
  selected,
  description,
  id,
  onClick,
}: {
  selected: boolean;
  description: string;
  id: OnboardingChatEngineId;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      style={{
        width: "100%",
        padding: "16px 16px 14px",
        borderRadius: "var(--radius)",
        textAlign: "left",
        border: selected
          ? "1px solid rgba(255, 107, 107, 0.35)"
          : "1px solid var(--border)",
        background: selected ? "rgba(255, 107, 107, 0.06)" : "var(--bg-2)",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: selected ? "rgba(255, 107, 107, 0.14)" : "var(--bg-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {getHarnessIcon(id, 18)}
        </div>
        <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
              {id === "codex" ? "Codex" : "Claude"}
            </span>
            {selected ? (
              <CheckCircle2 size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}

function ProviderCard({
  description,
  harness,
  installing,
  onInstall,
  onOpenWebsite,
}: {
  description: string;
  harness: HarnessInfo;
  installing: boolean;
  onInstall: () => void;
  onOpenWebsite: () => void;
}) {
  const { t } = useTranslation(["setup", "app"]);
  const installCommand = getHarnessInstallCommand(harness.id);
  const canInstall = harness.canAutoInstall && Boolean(installCommand);

  return (
    <div
      style={{
        borderRadius: "var(--radius)",
        border: harness.found
          ? "1px solid rgba(255, 107, 107, 0.25)"
          : "1px solid var(--border)",
        background: harness.found ? "rgba(255, 107, 107, 0.05)" : "var(--bg-2)",
        padding: "16px 16px 14px",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: harness.found ? "rgba(255, 107, 107, 0.14)" : "var(--bg-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {getHarnessIcon(harness.id, harness.native ? 20 : 18)}
        </div>
        <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>
              {harness.name}
            </span>
            {harness.found ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "var(--accent)",
                }}
              >
                <CheckCircle2 size={12} />
                {t("app:harnesses.installed")}
              </span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
            {description}
          </p>
          {harness.version ? (
            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: '"JetBrains Mono", monospace' }}>
              {harness.version}
            </span>
          ) : null}
        </div>
      </div>

      {!harness.found ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {canInstall ? (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={onInstall}
                disabled={installing}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {installing ? (
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <Download size={12} />
                )}
                {t("setup:actions.install")}
              </button>
              {installCommand ? <CopyCommandButton command={installCommand} /> : null}
            </>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={onOpenWebsite}
            style={{
              padding: "8px 12px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ExternalLink size={12} />
            {t("setup:actions.openWebsite")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ReadinessDependencyCard({
  actionLabel,
  command,
  description,
  installing,
  label,
  onInstall,
}: {
  actionLabel?: string;
  command?: string | null;
  description: string;
  installing: boolean;
  label: string;
  onInstall?: () => void;
}) {
  const { t } = useTranslation("setup");

  return (
    <div
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        background: "var(--bg-2)",
        padding: "14px 14px 13px",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{label}</span>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
          {description}
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {onInstall ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onInstall}
            disabled={installing}
            style={{
              padding: "8px 12px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {installing ? (
              <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Download size={12} />
            )}
            {actionLabel ?? t("actions.install")}
          </button>
        ) : null}
        {command ? <CopyCommandButton command={command} /> : null}
      </div>
    </div>
  );
}

function ReadinessEngineCard({
  engineId,
  health,
}: {
  engineId: OnboardingChatEngineId;
  health?: EngineHealth;
}) {
  const { t } = useTranslation("setup");
  const available = health?.available ?? false;
  const warnings = health?.warnings ?? [];
  const checks = health?.checks ?? [];
  const fixes = health?.fixes ?? [];

  return (
    <div
      style={{
        borderRadius: "var(--radius)",
        border: available
          ? "1px solid rgba(255, 107, 107, 0.25)"
          : "1px solid var(--border)",
        background: available ? "rgba(255, 107, 107, 0.05)" : "var(--bg-2)",
        padding: "14px 14px 12px",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: available ? "rgba(255, 107, 107, 0.14)" : "var(--bg-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {getHarnessIcon(engineId, 17)}
        </div>
        <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>
              {engineId === "codex" ? "Codex" : "Claude"}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: available ? "var(--accent)" : "var(--warning)",
              }}
            >
              {available ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {available ? t("chatReadiness.status.ready") : t("chatReadiness.status.attention")}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
            {health?.details ?? t("chatReadiness.status.pending")}
          </p>
          {health?.version ? (
            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: '"JetBrains Mono", monospace' }}>
              {health.version}
            </span>
          ) : null}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div style={{ display: "grid", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--warning)" }}>
            {t("chatReadiness.sections.warnings")}
          </span>
          {warnings.map((warning) => (
            <p key={warning} style={{ margin: 0, fontSize: 11.5, color: "var(--text-2)" }}>
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {checks.length > 0 ? (
        <div style={{ display: "grid", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>
            {t("chatReadiness.sections.checks")}
          </span>
          {checks.map((check) => (
            <code
              key={check}
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                padding: "4px 6px",
                borderRadius: 6,
                background: "var(--code-bg)",
                border: "1px solid var(--border)",
              }}
            >
              {check}
            </code>
          ))}
        </div>
      ) : null}

      {fixes.length > 0 ? (
        <div style={{ display: "grid", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>
            {t("chatReadiness.sections.fixes")}
          </span>
          {fixes.map((fix) => (
            <p key={fix} style={{ margin: 0, fontSize: 11.5, color: "var(--text-2)" }}>
              {fix}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceCard({
  active,
  onClick,
  selected,
  workspace,
}: {
  active: boolean;
  onClick: () => void;
  selected: boolean;
  workspace: { id: string; name: string; rootPath: string };
}) {
  const { t } = useTranslation("setup");

  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "14px 14px 13px",
        borderRadius: "var(--radius)",
        border: selected
          ? "1px solid rgba(255, 107, 107, 0.35)"
          : "1px solid var(--border)",
        background: selected ? "rgba(255, 107, 107, 0.06)" : "var(--bg-2)",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>
          {workspace.name}
        </span>
        {active ? (
          <span style={{ fontSize: 11, color: "var(--accent)" }}>{t("workspace.current")}</span>
        ) : null}
      </div>
      <span
        style={{
          fontSize: 11.5,
          color: "var(--text-2)",
          lineHeight: 1.5,
          fontFamily: '"JetBrains Mono", monospace',
          wordBreak: "break-word",
        }}
      >
        {workspace.rootPath}
      </span>
    </button>
  );
}

export function OnboardingWizard() {
  const { t } = useTranslation(["setup", "common", "app"]);
  const open = useOnboardingStore((state) => state.open);
  const completed = useOnboardingStore((state) => state.completed);
  const legacyCompleted = useOnboardingStore((state) => state.legacyCompleted);
  const step = useOnboardingStore((state) => state.step);
  const preferredWorkflow = useOnboardingStore((state) => state.preferredWorkflow);
  const selectedChatEngines = useOnboardingStore((state) => state.selectedChatEngines);
  const selectedWorkspaceId = useOnboardingStore((state) => state.selectedWorkspaceId);
  const installLog = useOnboardingStore((state) => state.installLog);
  const installing = useOnboardingStore((state) => state.installing);
  const installError = useOnboardingStore((state) => state.error);
  const openOnboarding = useOnboardingStore((state) => state.openOnboarding);
  const closeOnboarding = useOnboardingStore((state) => state.closeOnboarding);
  const setStep = useOnboardingStore((state) => state.setStep);
  const setPreferredWorkflow = useOnboardingStore((state) => state.setPreferredWorkflow);
  const toggleChatEngine = useOnboardingStore((state) => state.toggleChatEngine);
  const setSelectedWorkspaceId = useOnboardingStore((state) => state.setSelectedWorkspaceId);
  const clearInstallState = useOnboardingStore((state) => state.clearInstallState);
  const installDependency = useOnboardingStore((state) => state.installDependency);
  const installHarness = useOnboardingStore((state) => state.installHarness);
  const completeOnboarding = useOnboardingStore((state) => state.complete);

  const harnessPhase = useHarnessStore((state) => state.phase);
  const harnessError = useHarnessStore((state) => state.error);
  const harnesses = useHarnessStore((state) => state.harnesses);
  const scanHarnesses = useHarnessStore((state) => state.scan);

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceLoading = useWorkspaceStore((state) => state.loading);
  const workspaceError = useWorkspaceStore((state) => state.error);
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);

  const loadedOnce = useEngineStore((state) => state.loadedOnce);
  const loadingEngines = useEngineStore((state) => state.loading);
  const loadEngines = useEngineStore((state) => state.load);

  const setActiveView = useUiStore((state) => state.setActiveView);

  const autoOpenedRef = useRef(false);
  const readinessRequestRef = useRef(0);
  const [workspaceConfirmed, setWorkspaceConfirmed] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessState>({
    loading: false,
    dependencyReport: null,
    engineHealth: {},
    error: null,
  });

  const visibleSteps = getVisibleSteps(preferredWorkflow);
  const currentStepIndex = visibleSteps.indexOf(step);
  const stepMetadata = STEP_TITLES[step];
  const chatReady = isChatWorkflowReady(
    selectedChatEngines,
    readiness.dependencyReport,
    readiness.engineHealth,
  );
  const codexAuthDeferred =
    selectedChatEngines.includes("codex") &&
    readiness.dependencyReport?.node.found === true &&
    readiness.dependencyReport.codex.found === true &&
    isCodexAuthDeferred(readiness.engineHealth.codex);
  const busy = Boolean(installing) || workspaceLoading;

  useEffect(() => {
    if (autoOpenedRef.current || open) {
      return;
    }

    if (
      !shouldAutoOpenOnboarding({
        loadedOnce,
        loadingEngines,
        completed,
        legacyCompleted,
      })
    ) {
      return;
    }

    autoOpenedRef.current = true;
    openOnboarding();
  }, [completed, legacyCompleted, loadedOnce, loadingEngines, open, openOnboarding]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setWorkspaceConfirmed(false);
  }, [open]);

  useEffect(() => {
    if (!open || selectedWorkspaceId || !activeWorkspaceId) {
      return;
    }

    setSelectedWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId, open, selectedWorkspaceId, setSelectedWorkspaceId]);

  useEffect(() => {
    if (!open || step !== "cliProviders") {
      return;
    }

    if (harnesses.length === 0 || harnessPhase === "error") {
      void scanHarnesses();
    }
  }, [harnessPhase, harnesses.length, open, scanHarnesses, step]);

  async function refreshReadiness() {
    const requestId = ++readinessRequestRef.current;
    setReadiness((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const dependencyReport = await ipc.checkDependencies();
      const engineResults = await Promise.allSettled(
        selectedChatEngines.map((engineId) => ipc.engineHealth(engineId)),
      );
      const nextHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>> = {};

      engineResults.forEach((result, index) => {
        const engineId = selectedChatEngines[index];
        if (!engineId) {
          return;
        }

        if (result.status === "fulfilled") {
          nextHealth[engineId] = result.value;
          return;
        }

        nextHealth[engineId] = {
          id: engineId,
          available: false,
          details: String(result.reason),
          warnings: [],
          checks: [],
          fixes: [],
        };
      });

      if (requestId !== readinessRequestRef.current) {
        return;
      }

      setReadiness({
        loading: false,
        dependencyReport,
        engineHealth: nextHealth,
        error: null,
      });
      void loadEngines();
    } catch (error) {
      if (requestId !== readinessRequestRef.current) {
        return;
      }

      setReadiness((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  useEffect(() => {
    if (!open || step !== "chatReadiness" || selectedChatEngines.length === 0) {
      return;
    }

    void refreshReadiness();
  }, [open, selectedChatEngines, step]);

  function handleClose() {
    if (busy) {
      return;
    }

    closeOnboarding();
  }

  function handleBack() {
    if (busy) {
      return;
    }

    clearInstallState();
    setStep(previousOnboardingStep(step, preferredWorkflow));
  }

  function handleNext() {
    if (busy) {
      return;
    }

    clearInstallState();
    setStep(nextOnboardingStep(step, preferredWorkflow));
  }

  async function handleInstallHarness(harness: HarnessInfo) {
    clearInstallState();
    const ok = await installHarness(harness.id, harness.name);
    if (ok) {
      await scanHarnesses();
    }
  }

  async function handleInstallNode() {
    const report = readiness.dependencyReport;
    if (!report?.node.installMethod) {
      return;
    }

    clearInstallState();
    const ok = await installDependency("node", report.node.installMethod, t("chatReadiness.deps.node"));
    if (ok) {
      await refreshReadiness();
    }
  }

  async function handleInstallCodex() {
    const report = readiness.dependencyReport;
    if (!report?.codex.installMethod) {
      return;
    }

    clearInstallState();
    const ok = await installDependency("codex", report.codex.installMethod, "Codex CLI");
    if (ok) {
      await refreshReadiness();
    }
  }

  async function handleOpenWebsite(url: string) {
    try {
      await openExternal(url);
    } catch {
      // Ignore shell failures here; the action is best-effort.
    }
  }

  async function handleOpenWorkspaceFolder() {
    const selected = await openDirectoryDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) {
      return;
    }

    await openWorkspace(selected);
    const openedWorkspace = useWorkspaceStore
      .getState()
      .workspaces.find((workspace) => workspace.rootPath === selected);

    if (!openedWorkspace) {
      return;
    }

    setSelectedWorkspaceId(openedWorkspace.id);
    setWorkspaceConfirmed(true);
  }

  async function handleFinish() {
    if (!selectedWorkspaceId || !preferredWorkflow || busy) {
      return;
    }

    if (selectedWorkspaceId !== activeWorkspaceId) {
      await setActiveWorkspace(selectedWorkspaceId);
    }

    if (preferredWorkflow === "chat") {
      await loadEngines();
    }

    completeOnboarding();
    setActiveView(preferredWorkflow === "cli" ? "harnesses" : "chat");
  }

  if (!open) {
    return null;
  }

  const canContinue =
    step === "workflow"
      ? preferredWorkflow !== null
      : step === "chatEngines"
        ? selectedChatEngines.length > 0
        : step === "chatReadiness"
          ? chatReady
          : step === "workspace"
            ? selectedWorkspaceId !== null && workspaceConfirmed
            : true;

  const nodeManualGuidance = readiness.dependencyReport
    ? getNodeManualGuidance(readiness.dependencyReport)
    : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "fade-in 0.15s ease-out",
      }}
      onClick={handleClose}
    >
      <div
        className="surface"
        style={{
          width: "min(860px, 100%)",
          maxHeight: "88vh",
          overflow: "auto",
          display: "grid",
          gap: 22,
          padding: "22px 24px",
          boxShadow:
            "0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06)",
          animation: "slide-up 0.2s ease-out",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-2)",
              color: "var(--text-2)",
              flexShrink: 0,
            }}
          >
            <Settings2 size={16} />
          </div>
          <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
                {t(`setup:${stepMetadata.titleKey}`)}
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                {t(`setup:${stepMetadata.subtitleKey}`)}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {visibleSteps.map((visibleStep, index) => (
                <StepChip
                  key={visibleStep}
                  active={visibleStep === step}
                  complete={currentStepIndex > index}
                  label={t(`setup:steps.${visibleStep}`)}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleClose}
            disabled={busy}
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-3)",
              cursor: busy ? "default" : "pointer",
              flexShrink: 0,
            }}
            title={t("common:actions.close")}
          >
            <X size={14} />
          </button>
        </div>

        {step === "workflow" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <WorkflowCard
              active={preferredWorkflow === "cli"}
              description={t("setup:workflow.options.cli.description")}
              icon={<Terminal size={18} />}
              title={t("setup:workflow.options.cli.title")}
              onClick={() => setPreferredWorkflow("cli")}
            />
            <WorkflowCard
              active={preferredWorkflow === "chat"}
              description={t("setup:workflow.options.chat.description")}
              icon={<MessageSquare size={18} />}
              title={t("setup:workflow.options.chat.title")}
              onClick={() => setPreferredWorkflow("chat")}
            />
          </div>
        ) : null}

        {step === "cliProviders" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
                {t("setup:cliProviders.helper")}
              </p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void scanHarnesses()}
                disabled={harnessPhase === "scanning" || Boolean(installing)}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCw
                  size={12}
                  style={{
                    animation: harnessPhase === "scanning" ? "spin 1s linear infinite" : "none",
                  }}
                />
                {t("setup:actions.refreshProviders")}
              </button>
            </div>

            {harnessError ? <StatusMessage tone="warning">{harnessError}</StatusMessage> : null}

            {harnessPhase === "scanning" && harnesses.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  padding: "28px 0",
                }}
              >
                <Loader2
                  size={22}
                  style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
                />
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
                  {t("setup:cliProviders.scanning")}
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                }}
              >
                {harnesses.map((harness) => (
                  <ProviderCard
                    key={harness.id}
                    harness={harness}
                    description={t(`app:harnesses.descriptions.${harness.id}`, {
                      defaultValue: harness.description,
                    })}
                    installing={installing?.kind === "harness" && installing.id === harness.id}
                    onInstall={() => void handleInstallHarness(harness)}
                    onOpenWebsite={() => void handleOpenWebsite(harness.website)}
                  />
                ))}
              </div>
            )}

            {installing?.kind === "harness" || installLog.length > 0 || installError ? (
              <div style={{ display: "grid", gap: 10 }}>
                {installing ? (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: "var(--text-1)",
                    }}
                  >
                    <Loader2
                      size={13}
                      style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
                    />
                    {t("setup:install.installing", { name: installing.label })}
                  </div>
                ) : null}
                <InstallLogView log={installLog} />
                {installError ? <StatusMessage tone="warning">{installError}</StatusMessage> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "chatEngines" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
              {t("setup:chatEngines.helper")}
            </p>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              }}
            >
              {CHAT_ENGINE_OPTIONS.map((engine) => (
                <ChatEngineCard
                  key={engine.id}
                  id={engine.id}
                  description={t(`setup:${engine.descriptionKey}`)}
                  selected={selectedChatEngines.includes(engine.id)}
                  onClick={() => toggleChatEngine(engine.id)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === "chatReadiness" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
                {t("setup:chatReadiness.helper")}
              </p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void refreshReadiness()}
                disabled={readiness.loading || Boolean(installing)}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCw
                  size={12}
                  style={{
                    animation: readiness.loading ? "spin 1s linear infinite" : "none",
                  }}
                />
                {t("setup:actions.refreshStatus")}
              </button>
            </div>

            {readiness.error ? <StatusMessage tone="warning">{readiness.error}</StatusMessage> : null}

            {readiness.loading && !readiness.dependencyReport ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  padding: "24px 0",
                }}
              >
                <Loader2
                  size={22}
                  style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
                />
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
                  {t("setup:chatReadiness.loading")}
                </p>
              </div>
            ) : null}

            {readiness.dependencyReport && !readiness.dependencyReport.node.found ? (
              <ReadinessDependencyCard
                label={t("setup:chatReadiness.deps.node")}
                description={
                  readiness.dependencyReport.node.canAutoInstall
                    ? t("setup:chatReadiness.nodeInstallAvailable")
                    : t("setup:chatReadiness.nodeInstallManual")
                }
                command={nodeManualGuidance?.command ?? null}
                installing={installing?.kind === "dependency" && installing.id === "node"}
                onInstall={
                  readiness.dependencyReport.node.canAutoInstall &&
                  readiness.dependencyReport.node.installMethod
                    ? () => void handleInstallNode()
                    : undefined
                }
              />
            ) : null}

            {selectedChatEngines.includes("codex") &&
            readiness.dependencyReport &&
            !readiness.dependencyReport.codex.found ? (
              <ReadinessDependencyCard
                label="Codex CLI"
                description={
                  readiness.dependencyReport.codex.canAutoInstall
                    ? t("setup:chatReadiness.codexInstallAvailable")
                    : t("setup:chatReadiness.codexInstallManual")
                }
                command="npm install -g @openai/codex"
                installing={installing?.kind === "dependency" && installing.id === "codex"}
                onInstall={
                  readiness.dependencyReport.codex.canAutoInstall &&
                  readiness.dependencyReport.codex.installMethod
                    ? () => void handleInstallCodex()
                    : undefined
                }
              />
            ) : null}

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              }}
            >
              {selectedChatEngines.map((engineId) => (
                <ReadinessEngineCard
                  key={engineId}
                  engineId={engineId}
                  health={readiness.engineHealth[engineId]}
                />
              ))}
            </div>

            {codexAuthDeferred ? (
              <StatusMessage tone="info">{t("setup:chatReadiness.authDeferred")}</StatusMessage>
            ) : chatReady ? (
              <StatusMessage tone="info">{t("setup:chatReadiness.readyHint")}</StatusMessage>
            ) : null}

            {installing?.kind === "dependency" || installLog.length > 0 || installError ? (
              <div style={{ display: "grid", gap: 10 }}>
                {installing ? (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: "var(--text-1)",
                    }}
                  >
                    <Loader2
                      size={13}
                      style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
                    />
                    {t("setup:install.installing", { name: installing.label })}
                  </div>
                ) : null}
                <InstallLogView log={installLog} />
                {installError ? <StatusMessage tone="warning">{installError}</StatusMessage> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "workspace" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
              {t("setup:workspace.helper")}
            </p>

            {workspaces.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {workspaces.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    active={workspace.id === activeWorkspaceId}
                    selected={workspace.id === selectedWorkspaceId}
                    onClick={() => {
                      setSelectedWorkspaceId(workspace.id);
                      setWorkspaceConfirmed(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <StatusMessage tone="warning">{t("setup:workspace.empty")}</StatusMessage>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="btn-outline"
                onClick={() => void handleOpenWorkspaceFolder()}
                disabled={workspaceLoading}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {workspaceLoading ? (
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <FolderOpen size={12} />
                )}
                {t("setup:actions.openFolder")}
              </button>
            </div>

            {workspaceError ? <StatusMessage tone="warning">{workspaceError}</StatusMessage> : null}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderTop: "1px solid var(--border)",
            paddingTop: 16,
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {t("setup:footer.stepCounter", {
              current: currentStepIndex >= 0 ? currentStepIndex + 1 : 1,
              total: visibleSteps.length,
            })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {step !== "workflow" ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleBack}
                disabled={busy}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <ArrowLeft size={12} />
                {t("setup:actions.back")}
              </button>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleClose}
                disabled={busy}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {t("common:actions.notNow")}
              </button>
            )}

            {step === "workspace" ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleFinish()}
                disabled={!canContinue || busy}
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <CheckCircle2 size={12} />
                {t("setup:actions.finish")}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={handleNext}
                disabled={!canContinue || busy}
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {t("setup:actions.continue")}
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
