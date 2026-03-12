import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  canContinueChatReadiness,
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

/* ─── Types ─── */

interface ReadinessState {
  loading: boolean;
  dependencyReport: DependencyReport | null;
  engineHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>>;
  error: string | null;
}

const EMPTY_READINESS_STATE: ReadinessState = {
  loading: false,
  dependencyReport: null,
  engineHealth: {},
  error: null,
};

/* ─── Constants ─── */

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
  if (workflow === "cli") return ["workflow", "cliProviders", "workspace"];
  if (workflow === "chat") return ["workflow", "chatEngines", "chatReadiness", "workspace"];
  return ["workflow"];
}

/* ─── Sub-components ─── */

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
      className="btn btn-ghost"
      onClick={() => void handleCopy()}
      style={{
        padding: "5px 8px",
        fontSize: 11,
        borderRadius: "var(--radius-sm)",
        color: copied ? "var(--success)" : undefined,
      }}
    >
      <ClipboardCopy size={11} />
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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  return (
    <pre
      ref={logRef}
      style={{
        margin: 0,
        padding: "10px 12px",
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: '"JetBrains Mono", monospace',
        background: "var(--bg-2)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        maxHeight: 160,
        overflow: "auto",
        color: "var(--text-3)",
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
                      : "var(--text-3)",
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
  const isWarning = tone === "warning";
  const IconComponent = isWarning ? AlertTriangle : Info;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "2px 0" }}>
      <IconComponent
        size={12}
        style={{
          flexShrink: 0,
          color: isWarning ? "var(--warning)" : "var(--text-3)",
          marginTop: 2,
        }}
      />
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
        {children}
      </p>
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
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "24px 22px",
        borderRadius: "var(--radius-md)",
        position: "relative",
        cursor: "pointer",
        border: active
          ? "1px solid var(--border-accent)"
          : "1px solid var(--border)",
        background: active
          ? "rgba(255, 107, 107, 0.04)"
          : "var(--bg-2)",
        transition: "border-color 120ms, background 120ms",
        display: "flex",
        flexDirection: "column" as const,
        gap: 16,
      }}
    >
      {active ? (
        <CheckCircle2
          size={14}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            color: "var(--accent)",
          }}
        />
      ) : null}
      <div style={{ color: active ? "var(--accent)" : "var(--text-3)", transition: "color 120ms" }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
          {title}
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-3)" }}>
          {description}
        </p>
      </div>
    </button>
  );
}

function ChatEngineCard({
  index,
  selected,
  description,
  id,
  onClick,
}: {
  index: number;
  selected: boolean;
  description: string;
  id: OnboardingChatEngineId;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        padding: "20px 18px",
        borderRadius: "var(--radius-md)",
        textAlign: "left",
        position: "relative",
        cursor: "pointer",
        border: selected
          ? "1px solid var(--border-accent)"
          : "1px solid var(--border)",
        background: selected
          ? "rgba(255, 107, 107, 0.04)"
          : "var(--bg-2)",
        transition: "border-color 120ms, background 120ms",
        animation: "ob-card-cascade 200ms var(--ease-out) both",
        animationDelay: `${index * 40}ms`,
        display: "flex",
        flexDirection: "column" as const,
        gap: 12,
      }}
    >
      {selected ? (
        <CheckCircle2
          size={13}
          style={{ position: "absolute", top: 14, right: 14, color: "var(--accent)" }}
        />
      ) : null}
      <div style={{ flexShrink: 0 }}>
        {getHarnessIcon(id, 22)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", marginBottom: 3 }}>
          {id === "codex" ? "Codex" : "Claude"}
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-3)" }}>
          {description}
        </p>
      </div>
    </button>
  );
}

/**
 * Flat tile row matching the hp-tile pattern from HarnessPanel.
 * No bordered card — just a row that highlights on hover.
 */
function ProviderRow({
  index,
  disabled,
  description,
  harness,
  installing,
  onInstall,
  onOpenWebsite,
}: {
  index: number;
  disabled: boolean;
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
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "var(--bg-2)",
        animation: "ob-card-cascade 200ms var(--ease-out) both",
        animationDelay: `${index * 30}ms`,
      }}
    >
      {/* Icon — no container, show logo directly */}
      <div style={{ width: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {getHarnessIcon(harness.id, harness.native ? 22 : 18)}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            {harness.name}
          </span>
          {harness.found ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: 10.5,
                fontWeight: 500,
                color: "var(--success)",
              }}
            >
              <CheckCircle2 size={10} />
              {t("app:harnesses.installed")}
            </span>
          ) : null}
        </div>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.4 }}>
          {description}
        </p>
        {harness.version ? (
          <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: '"JetBrains Mono", monospace' }}>
            {harness.version}
          </span>
        ) : null}
      </div>

      {/* Actions */}
      {!harness.found ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {canInstall ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onInstall}
              disabled={disabled}
              style={{
                padding: "5px 10px",
                fontSize: 11,
                borderRadius: "var(--radius-sm)",
                opacity: disabled ? 0.4 : 1,
              }}
            >
              {installing ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Download size={11} />
              )}
              {t("setup:actions.install")}
            </button>
          ) : null}
          {canInstall && installCommand ? <CopyCommandButton command={installCommand} /> : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onOpenWebsite}
            style={{ padding: "5px 8px", fontSize: 11, borderRadius: "var(--radius-sm)" }}
          >
            <ExternalLink size={11} />
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
  disabled,
  installing,
  label,
  onInstall,
}: {
  actionLabel?: string;
  command?: string | null;
  description: string;
  disabled: boolean;
  installing: boolean;
  label: string;
  onInstall?: () => void;
}) {
  const { t } = useTranslation("setup");

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        background: "var(--bg-2)",
        padding: "14px 16px",
        display: "grid",
        gap: 10,
      }}
    >
      <div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{label}</span>
        <p style={{ margin: "2px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--text-3)" }}>
          {description}
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {onInstall ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onInstall}
            disabled={disabled}
            style={{
              padding: "5px 10px",
              fontSize: 11,
              borderRadius: "var(--radius-sm)",
              opacity: disabled ? 0.4 : 1,
            }}
          >
            {installing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            {actionLabel ?? t("actions.install")}
          </button>
        ) : null}
        {command ? <CopyCommandButton command={command} /> : null}
      </div>
    </div>
  );
}

function ReadinessEngineRow({
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
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 5,
          background: available ? "var(--success)" : "var(--warning)",
          transition: "background 120ms",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            {engineId === "codex" ? "Codex" : "Claude"}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10.5,
              fontWeight: 500,
              color: available ? "var(--success)" : "var(--warning)",
            }}
          >
            {available ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
            {available ? t("chatReadiness.status.ready") : t("chatReadiness.status.attention")}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--text-3)" }}>
          {health?.details ?? t("chatReadiness.status.pending")}
        </p>
        {health?.version ? (
          <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: '"JetBrains Mono", monospace' }}>
            {health.version}
          </span>
        ) : null}

        {warnings.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--warning)" }}>
              {t("chatReadiness.sections.warnings")}
            </span>
            {warnings.map((w) => (
              <p key={w} style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-3)" }}>{w}</p>
            ))}
          </div>
        ) : null}

        {checks.length > 0 ? (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {checks.map((c) => (
              <code
                key={c}
                style={{
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  padding: "2px 5px",
                  borderRadius: 3,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                }}
              >
                {c}
              </code>
            ))}
          </div>
        ) : null}

        {fixes.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)" }}>
              {t("chatReadiness.sections.fixes")}
            </span>
            {fixes.map((f) => (
              <p key={f} style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-3)" }}>{f}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceRow({
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
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        border: selected
          ? "1px solid var(--border-accent)"
          : "1px solid var(--border)",
        background: selected
          ? "rgba(255, 107, 107, 0.04)"
          : "var(--bg-2)",
        transition: "border-color 120ms, background 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
          {workspace.name}
        </span>
        {active ? (
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-2)" }}>
            {t("workspace.current")}
          </span>
        ) : null}
      </div>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          lineHeight: 1.3,
          fontFamily: '"JetBrains Mono", monospace',
          wordBreak: "break-word",
        }}
      >
        {workspace.rootPath}
      </span>
    </button>
  );
}

/* ─── Main Wizard ─── */

export function OnboardingWizard() {
  const { t } = useTranslation(["setup", "common", "app"]);
  const open = useOnboardingStore((s) => s.open);
  const completed = useOnboardingStore((s) => s.completed);
  const legacyCompleted = useOnboardingStore((s) => s.legacyCompleted);
  const step = useOnboardingStore((s) => s.step);
  const preferredWorkflow = useOnboardingStore((s) => s.preferredWorkflow);
  const selectedChatEngines = useOnboardingStore((s) => s.selectedChatEngines);
  const selectedWorkspaceId = useOnboardingStore((s) => s.selectedWorkspaceId);
  const installLog = useOnboardingStore((s) => s.installLog);
  const installing = useOnboardingStore((s) => s.installing);
  const installError = useOnboardingStore((s) => s.error);
  const openOnboarding = useOnboardingStore((s) => s.openOnboarding);
  const closeOnboarding = useOnboardingStore((s) => s.closeOnboarding);
  const setStep = useOnboardingStore((s) => s.setStep);
  const setPreferredWorkflow = useOnboardingStore((s) => s.setPreferredWorkflow);
  const toggleChatEngine = useOnboardingStore((s) => s.toggleChatEngine);
  const setSelectedWorkspaceId = useOnboardingStore((s) => s.setSelectedWorkspaceId);
  const clearInstallState = useOnboardingStore((s) => s.clearInstallState);
  const installDependency = useOnboardingStore((s) => s.installDependency);
  const installHarness = useOnboardingStore((s) => s.installHarness);
  const completeOnboarding = useOnboardingStore((s) => s.complete);

  const harnessPhase = useHarnessStore((s) => s.phase);
  const harnessError = useHarnessStore((s) => s.error);
  const harnesses = useHarnessStore((s) => s.harnesses);
  const scanHarnesses = useHarnessStore((s) => s.scan);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceLoading = useWorkspaceStore((s) => s.loading);
  const workspaceError = useWorkspaceStore((s) => s.error);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const loadedOnce = useEngineStore((s) => s.loadedOnce);
  const loadingEngines = useEngineStore((s) => s.loading);
  const loadEngines = useEngineStore((s) => s.load);

  const setActiveView = useUiStore((s) => s.setActiveView);

  const autoOpenedRef = useRef(false);
  const readinessRequestRef = useRef(0);
  const [workspaceConfirmed, setWorkspaceConfirmed] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessState>(EMPTY_READINESS_STATE);
  const [stepDirection, setStepDirection] = useState<"forward" | "back">("forward");
  const [stepAnimKey, setStepAnimKey] = useState(0);

  const visibleSteps = getVisibleSteps(preferredWorkflow);
  const currentStepIndex = visibleSteps.indexOf(step);
  const stepMetadata = STEP_TITLES[step];
  const chatWorkflowReady = isChatWorkflowReady(
    selectedChatEngines,
    readiness.dependencyReport,
    readiness.engineHealth,
  );
  const chatReady = canContinueChatReadiness(
    selectedChatEngines,
    readiness.dependencyReport,
    readiness.engineHealth,
    readiness.loading,
    readiness.error,
  );
  const codexAuthDeferred =
    selectedChatEngines.includes("codex") &&
    readiness.dependencyReport?.node.found === true &&
    readiness.dependencyReport.codex.found === true &&
    isCodexAuthDeferred(readiness.engineHealth.codex);
  const busy = Boolean(installing) || workspaceLoading;

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

  const progressPercent =
    visibleSteps.length > 1
      ? ((Math.max(0, currentStepIndex) + 1) / visibleSteps.length) * 100
      : 0;

  /* ─── Effects ─── */

  useEffect(() => {
    if (autoOpenedRef.current || open) return;
    if (!shouldAutoOpenOnboarding({ loadedOnce, loadingEngines, completed, legacyCompleted })) return;
    autoOpenedRef.current = true;
    openOnboarding();
  }, [completed, legacyCompleted, loadedOnce, loadingEngines, open, openOnboarding]);

  useEffect(() => {
    if (!open) return;
    readinessRequestRef.current += 1;
    setWorkspaceConfirmed(false);
    setReadiness(EMPTY_READINESS_STATE);
  }, [open]);

  useEffect(() => {
    if (!open || selectedWorkspaceId || !activeWorkspaceId) return;
    setSelectedWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId, open, selectedWorkspaceId, setSelectedWorkspaceId]);

  useEffect(() => {
    if (!open || step !== "cliProviders") return;
    if (harnesses.length === 0 || harnessPhase === "error") void scanHarnesses();
  }, [harnessPhase, harnesses.length, open, scanHarnesses, step]);

  async function refreshReadiness() {
    const requestId = ++readinessRequestRef.current;
    setReadiness((s) => ({ ...s, loading: true, error: null }));
    try {
      const dependencyReport = await ipc.checkDependencies();
      const engineResults = await Promise.allSettled(
        selectedChatEngines.map((id) => ipc.engineHealth(id)),
      );
      const nextHealth: Partial<Record<OnboardingChatEngineId, EngineHealth>> = {};
      engineResults.forEach((result, i) => {
        const eid = selectedChatEngines[i];
        if (!eid) return;
        if (result.status === "fulfilled") { nextHealth[eid] = result.value; return; }
        nextHealth[eid] = {
          id: eid, available: false, details: String(result.reason),
          warnings: [], checks: [], fixes: [],
        };
      });
      if (requestId !== readinessRequestRef.current) return;
      setReadiness({ loading: false, dependencyReport, engineHealth: nextHealth, error: null });
      void loadEngines();
    } catch (error) {
      if (requestId !== readinessRequestRef.current) return;
      setReadiness((s) => ({
        ...s, loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  useEffect(() => {
    if (!open || step !== "chatReadiness" || selectedChatEngines.length === 0) return;
    void refreshReadiness();
  }, [open, selectedChatEngines, step]);

  /* ─── Handlers ─── */

  const handleClose = useCallback(() => {
    if (busy) return;
    closeOnboarding();
  }, [busy, closeOnboarding]);

  function handleBack() {
    if (busy) return;
    clearInstallState();
    setStepDirection("back");
    setStepAnimKey((k) => k + 1);
    setStep(previousOnboardingStep(step, preferredWorkflow));
  }

  function handleNext() {
    if (busy) return;
    clearInstallState();
    setStepDirection("forward");
    setStepAnimKey((k) => k + 1);
    setStep(nextOnboardingStep(step, preferredWorkflow));
  }

  async function handleInstallHarness(harness: HarnessInfo) {
    if (installing) return;
    clearInstallState();
    const ok = await installHarness(harness.id, harness.name);
    if (ok) await scanHarnesses();
  }

  async function handleInstallNode() {
    if (installing) return;
    const report = readiness.dependencyReport;
    if (!report?.node.installMethod) return;
    clearInstallState();
    const ok = await installDependency("node", report.node.installMethod, t("chatReadiness.deps.node"));
    if (ok) await refreshReadiness();
  }

  async function handleInstallCodex() {
    if (installing) return;
    const report = readiness.dependencyReport;
    if (!report?.codex.installMethod) return;
    clearInstallState();
    const ok = await installDependency("codex", report.codex.installMethod, "Codex CLI");
    if (ok) await refreshReadiness();
  }

  async function handleOpenWebsite(url: string) {
    try { await openExternal(url); } catch { /* best-effort */ }
  }

  async function handleOpenWorkspaceFolder() {
    const selected = await openDirectoryDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await openWorkspace(selected);
    const opened = useWorkspaceStore.getState().workspaces.find((w) => w.rootPath === selected);
    if (!opened) return;
    setSelectedWorkspaceId(opened.id);
    setWorkspaceConfirmed(true);
  }

  const handleFinish = useCallback(async () => {
    if (!selectedWorkspaceId || !preferredWorkflow || busy) return;
    if (selectedWorkspaceId !== activeWorkspaceId) await setActiveWorkspace(selectedWorkspaceId);
    if (preferredWorkflow === "chat") await loadEngines();
    completeOnboarding();
    setActiveView(preferredWorkflow === "cli" ? "harnesses" : "chat");
  }, [selectedWorkspaceId, preferredWorkflow, busy, activeWorkspaceId, setActiveWorkspace, loadEngines, completeOnboarding, setActiveView]);

  /* ─── Keyboard ─── */

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) handleClose();
      if (e.key === "Enter" && canContinue && !busy) {
        if (step === "workspace") void handleFinish();
        else handleNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, canContinue, step, handleClose, handleFinish]);

  const nodeManualGuidance = readiness.dependencyReport
    ? getNodeManualGuidance(readiness.dependencyReport)
    : null;

  if (!open) return null;

  /* ─── Render ─── */

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        animation: "ob-backdrop-in 250ms var(--ease-out) both",
      }}
      onClick={handleClose}
    >
      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — viewport-edge positioned */}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleClose}
          disabled={busy}
          style={{
            position: "absolute",
            top: 16,
            right: 20,
            zIndex: 2,
            width: 28,
            height: 28,
            padding: 0,
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-3)",
            opacity: busy ? 0.4 : 1,
          }}
          title={t("common:actions.close")}
        >
          <X size={14} />
        </button>

        {/* Progress bar */}
        <div style={{ padding: "16px 24px 0", flexShrink: 0 }}>
          <div
            style={{
              height: 1,
              background: "rgba(255, 255, 255, 0.06)",
              maxWidth: "min(90%, 1100px)",
              margin: "0 auto",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPercent}%`,
                background: "var(--accent)",
                transition: "width 300ms var(--ease-out)",
              }}
            />
          </div>
        </div>

        {/* Scroll area — margin:auto centers vertically when content is short */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center" }}>
          <div
            style={{
              width: "min(90%, 1100px)",
              margin: "auto 0",
              padding: "32px 0 96px",
            }}
          >
            {/* Heading */}
            <div
              key={`heading-${step}`}
              style={{
                marginBottom: 28,
                animation: "ob-heading-in 200ms var(--ease-out) both",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase" as const,
                  color: "var(--text-3)",
                  marginBottom: 6,
                }}
              >
                {t("setup:footer.stepCounter", {
                  current: Math.max(1, currentStepIndex + 1),
                  total: visibleSteps.length,
                })}
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, margin: "0 0 6px", color: "var(--text-1)" }}>
                {t(`setup:${stepMetadata.titleKey}`)}
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-3)", lineHeight: 1.5, margin: 0 }}>
                {t(`setup:${stepMetadata.subtitleKey}`)}
              </p>
            </div>

            {/* Step body */}
            <div
              key={stepAnimKey}
              style={{
                animation: stepDirection === "forward"
                  ? "ob-step-enter-forward 180ms var(--ease-out) both"
                  : "ob-step-enter-back 180ms var(--ease-out) both",
              }}
            >
              {/* ── Workflow ── */}
              {step === "workflow" ? (
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                  <WorkflowCard
                    active={preferredWorkflow === "cli"}
                    description={t("setup:workflow.options.cli.description")}
                    icon={<Terminal size={28} />}
                    title={t("setup:workflow.options.cli.title")}
                    onClick={() => setPreferredWorkflow("cli")}
                  />
                  <WorkflowCard
                    active={preferredWorkflow === "chat"}
                    description={t("setup:workflow.options.chat.description")}
                    icon={<MessageSquare size={28} />}
                    title={t("setup:workflow.options.chat.title")}
                    onClick={() => setPreferredWorkflow("chat")}
                  />
                </div>
              ) : null}

              {/* ── CLI Providers ── */}
              {step === "cliProviders" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
                      {t("setup:cliProviders.helper")}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void scanHarnesses()}
                      disabled={harnessPhase === "scanning" || Boolean(installing)}
                      title={t("setup:actions.refreshProviders")}
                      style={{ width: 28, height: 28, padding: 0, borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <RefreshCw
                        size={12}
                        style={{ animation: harnessPhase === "scanning" ? "spin 1s linear infinite" : "none" }}
                      />
                    </button>
                  </div>

                  {harnessError ? <StatusMessage tone="warning">{harnessError}</StatusMessage> : null}

                  {harnessPhase === "scanning" && harnesses.length === 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "24px 12px" }}>
                      <Loader2 size={14} style={{ color: "var(--text-3)", animation: "spin 1s linear infinite" }} />
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {t("setup:cliProviders.scanning")}
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {harnesses.map((harness, index) => (
                        <ProviderRow
                          key={harness.id}
                          index={index}
                          disabled={Boolean(installing)}
                          harness={harness}
                          description={t(`app:harnesses.descriptions.${harness.id}`, { defaultValue: harness.description })}
                          installing={installing?.kind === "harness" && installing.id === harness.id}
                          onInstall={() => void handleInstallHarness(harness)}
                          onOpenWebsite={() => void handleOpenWebsite(harness.website)}
                        />
                      ))}
                    </div>
                  )}

                  {installing?.kind === "harness" || installLog.length > 0 || installError ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {installing ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
                          <Loader2 size={12} style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }} />
                          {t("setup:install.installing", { name: installing.label })}
                        </div>
                      ) : null}
                      <InstallLogView log={installLog} />
                      {installError ? <StatusMessage tone="warning">{installError}</StatusMessage> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── Chat Engines ── */}
              {step === "chatEngines" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
                    {t("setup:chatEngines.helper")}
                  </p>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                    {CHAT_ENGINE_OPTIONS.map((engine, index) => (
                      <ChatEngineCard
                        key={engine.id}
                        index={index}
                        id={engine.id}
                        description={t(`setup:${engine.descriptionKey}`)}
                        selected={selectedChatEngines.includes(engine.id)}
                        onClick={() => toggleChatEngine(engine.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* ── Chat Readiness ── */}
              {step === "chatReadiness" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
                      {t("setup:chatReadiness.helper")}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void refreshReadiness()}
                      disabled={readiness.loading || Boolean(installing)}
                      title={t("setup:actions.refreshStatus")}
                      style={{ width: 28, height: 28, padding: 0, borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <RefreshCw
                        size={12}
                        style={{ animation: readiness.loading ? "spin 1s linear infinite" : "none" }}
                      />
                    </button>
                  </div>

                  {readiness.error ? <StatusMessage tone="warning">{readiness.error}</StatusMessage> : null}

                  {readiness.loading && !readiness.dependencyReport ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "24px 12px" }}>
                      <Loader2 size={14} style={{ color: "var(--text-3)", animation: "spin 1s linear infinite" }} />
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {t("setup:chatReadiness.loading")}
                      </span>
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
                      disabled={Boolean(installing)}
                      installing={installing?.kind === "dependency" && installing.id === "node"}
                      onInstall={
                        readiness.dependencyReport.node.canAutoInstall && readiness.dependencyReport.node.installMethod
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
                      disabled={Boolean(installing)}
                      installing={installing?.kind === "dependency" && installing.id === "codex"}
                      onInstall={
                        readiness.dependencyReport.codex.canAutoInstall && readiness.dependencyReport.codex.installMethod
                          ? () => void handleInstallCodex()
                          : undefined
                      }
                    />
                  ) : null}

                  <div>
                    {selectedChatEngines.map((engineId) => (
                      <ReadinessEngineRow
                        key={engineId}
                        engineId={engineId}
                        health={readiness.engineHealth[engineId]}
                      />
                    ))}
                  </div>

                  {!readiness.loading && !readiness.error && codexAuthDeferred ? (
                    <StatusMessage tone="info">{t("setup:chatReadiness.authDeferred")}</StatusMessage>
                  ) : !readiness.loading && !readiness.error && chatWorkflowReady ? (
                    <StatusMessage tone="info">{t("setup:chatReadiness.readyHint")}</StatusMessage>
                  ) : null}

                  {installing?.kind === "dependency" || installLog.length > 0 || installError ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {installing ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
                          <Loader2 size={12} style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }} />
                          {t("setup:install.installing", { name: installing.label })}
                        </div>
                      ) : null}
                      <InstallLogView log={installLog} />
                      {installError ? <StatusMessage tone="warning">{installError}</StatusMessage> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── Workspace ── */}
              {step === "workspace" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
                    {t("setup:workspace.helper")}
                  </p>

                  {workspaces.length > 0 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {workspaces.map((ws) => (
                        <WorkspaceRow
                          key={ws.id}
                          workspace={ws}
                          active={ws.id === activeWorkspaceId}
                          selected={ws.id === selectedWorkspaceId}
                          onClick={() => { setSelectedWorkspaceId(ws.id); setWorkspaceConfirmed(true); }}
                        />
                      ))}
                    </div>
                  ) : (
                    <StatusMessage tone="warning">{t("setup:workspace.empty")}</StatusMessage>
                  )}

                  <div>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => void handleOpenWorkspaceFolder()}
                      disabled={workspaceLoading}
                      style={{ padding: "6px 10px", fontSize: 12, borderRadius: "var(--radius-sm)" }}
                    >
                      {workspaceLoading ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
                      {t("setup:actions.openFolder")}
                    </button>
                  </div>

                  {workspaceError ? <StatusMessage tone="warning">{workspaceError}</StatusMessage> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "20px 24px",
            background: "linear-gradient(to top, rgba(0, 0, 0, 0.90) 40%, transparent)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              maxWidth: "min(90%, 1100px)",
              margin: "0 auto",
              pointerEvents: "auto",
            }}
          >
            {/* Buttons */}
            <div style={{ display: "flex", gap: 6 }}>
              {step !== "workflow" ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleBack}
                  disabled={busy}
                  style={{ padding: "7px 12px", fontSize: 12, borderRadius: "var(--radius-sm)", opacity: busy ? 0.4 : 1 }}
                >
                  <ArrowLeft size={12} />
                  {t("setup:actions.back")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleClose}
                  disabled={busy}
                  style={{ padding: "7px 12px", fontSize: 12, borderRadius: "var(--radius-sm)" }}
                >
                  {t("common:actions.notNow")}
                </button>
              )}

              {step === "workspace" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleFinish()}
                  disabled={!canContinue || busy}
                  style={{ padding: "7px 14px", fontSize: 12, borderRadius: "var(--radius-sm)", opacity: !canContinue || busy ? 0.4 : 1 }}
                >
                  <CheckCircle2 size={12} />
                  {t("setup:actions.finish")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleNext}
                  disabled={!canContinue || busy}
                  style={{ padding: "7px 14px", fontSize: 12, borderRadius: "var(--radius-sm)", opacity: !canContinue || busy ? 0.4 : 1 }}
                >
                  {t("setup:actions.continue")}
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
