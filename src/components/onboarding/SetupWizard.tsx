import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Settings2,
  X,
} from "lucide-react";
import { useSetupStore, type SetupPhase } from "../../stores/setupStore";
import { useEngineStore } from "../../stores/engineStore";
import { copyTextToClipboard } from "../../lib/clipboard";
import { getGitManualGuidance, getNodeManualGuidance } from "../../lib/setupGuidance";
import type { CodexProtocolDiagnostics, DepStatus, EngineHealth } from "../../types";

const SETUP_COMPLETED_KEY = "panes.setup.completed.v2";

function StatusIcon({ found }: { found: boolean }) {
  return found ? (
    <CheckCircle2 size={15} style={{ color: "var(--accent)" }} />
  ) : (
    <AlertTriangle size={15} style={{ color: "var(--warning)" }} />
  );
}

function DepCard({
  label,
  dep,
  description,
}: {
  label: string;
  dep: DepStatus;
  description: string;
}) {
  const { t } = useTranslation("setup");
  const borderColor = dep.found
    ? "rgba(255, 107, 107, 0.25)"
    : "rgba(251, 191, 36, 0.25)";
  const bgColor = dep.found
    ? "rgba(255, 107, 107, 0.04)"
    : "rgba(251, 191, 36, 0.04)";

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${borderColor}`,
        background: bgColor,
        padding: "12px 14px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: dep.found
            ? "rgba(255, 107, 107, 0.12)"
            : "rgba(251, 191, 36, 0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <StatusIcon found={dep.found} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--text-1)",
            lineHeight: 1.6,
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            color: "var(--text-2)",
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          {dep.found
            ? t("status.detectedWithPath", {
                version: dep.version ?? t("status.detected"),
                path: dep.path ? ` ${t("status.at")} ${dep.path}` : "",
              })
            : description}
        </p>
      </div>
    </div>
  );
}

function InstallLogView({ log }: { log: { dep: string; line: string; stream: string }[] }) {
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
        maxHeight: 280,
        overflow: "auto",
        color: "var(--text-2)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {log.length === 0
        ? t("install.waiting")
        : log.map((entry, i) => (
            <div
              key={i}
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

function ScanningPhase() {
  const { t } = useTranslation("setup");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "40px 0",
      }}
    >
      <Loader2
        size={28}
        style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
      />
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
        {t("scanning.checking")}
      </p>
    </div>
  );
}

function PlanPhase() {
  const { t } = useTranslation("setup");
  const { report, installAll } = useSetupStore();
  const [showManual, setShowManual] = useState(false);

  if (!report) return null;

  const needsInstall =
    (!report.node.found && report.node.canAutoInstall) ||
    (!report.codex.found && report.codex.canAutoInstall);

  const nodeManual = getNodeManualGuidance(report);
  const gitManual = getGitManualGuidance(report);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <DepCard
        label={t("deps.node.label")}
        dep={report.node}
        description={
          report.node.canAutoInstall
            ? t("deps.node.auto")
            : t("deps.node.manual")
        }
      />
      <DepCard
        label={t("deps.codex.label")}
        dep={report.codex}
        description={
          report.codex.canAutoInstall
            ? t("deps.codex.auto")
            : t("deps.codex.manual")
        }
      />
      <DepCard
        label={t("deps.git.label")}
        dep={report.git}
        description={t("deps.git.manual")}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 6,
        }}
      >
        {needsInstall && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void installAll()}
            style={{
              padding: "9px 18px",
              fontSize: 13,
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {t("actions.autoSetup")}
          </button>
        )}

        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowManual(!showManual)}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            cursor: "pointer",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            color: "var(--text-3)",
          }}
        >
          {t("actions.manualInstructions")}
          <ChevronDown
            size={12}
            style={{
              transform: showManual ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          />
        </button>
      </div>

      {showManual && (
        <div
          style={{
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "7px 12px",
              background: "var(--bg-3)",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-3)",
            }}
          >
            {t("manual.title")}
          </div>
          <div
            style={{
              background: "var(--code-bg)",
              padding: "12px 14px",
              display: "grid",
              gap: 10,
            }}
          >
            {!report.node.found && (
              <ManualStep
                label={t("manual.installNode")}
                command={nodeManual.command}
                alt={t(nodeManual.altKey, nodeManual.altVars)}
              />
            )}
            {!report.codex.found && (
              <ManualStep
                label={t("manual.installCodex")}
                command="npm install -g @openai/codex"
              />
            )}
            {!report.git.found && (
              <ManualStep
                label={t("manual.installGit")}
                command={gitManual.command}
                alt={t(gitManual.altKey, gitManual.altVars)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ManualStep({
  label,
  command,
  alt,
}: {
  label: string;
  command: string | null;
  alt?: string;
}) {
  const { t } = useTranslation(["setup", "common"]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!command) {
      return;
    }
    try {
      await copyTextToClipboard(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--text-2)",
        }}
      >
        {label}
      </p>
      {command && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code
            style={{
              flex: 1,
              fontSize: 12,
              fontFamily: '"JetBrains Mono", monospace',
              color: "var(--text-1)",
              padding: "4px 8px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.03)",
            }}
          >
            {command}
          </code>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void copy()}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {copied ? t("setup:manual.copied") : t("common:actions.copy")}
          </button>
        </div>
      )}
      {alt && (
        <p style={{ margin: "4px 0 0", fontSize: 10.5, color: "var(--text-3)" }}>
          {alt}
        </p>
      )}
    </div>
  );
}

function InstallingPhase() {
  const { t } = useTranslation("setup");
  const { installLog, installing } = useSetupStore();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12.5,
          color: "var(--text-1)",
          fontWeight: 500,
        }}
      >
        <Loader2
          size={14}
          style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
        />
        {installing
          ? t("install.installing", {
              name:
                installing === "node"
                  ? t("deps.node.label")
                  : installing === "codex"
                    ? t("deps.codex.label")
                    : installing === "git"
                      ? t("deps.git.label")
                      : installing,
            })
          : t("install.finishing")}
      </div>
      <InstallLogView log={installLog} />
    </div>
  );
}

function CompletePhase() {
  const { t } = useTranslation("setup");
  const { report, closeSetup } = useSetupStore();
  const loadEngines = useEngineStore((s) => s.load);

  function handleGetStarted() {
    localStorage.setItem(SETUP_COMPLETED_KEY, "1");
    closeSetup();
    void loadEngines();
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 6 }}>
        {report?.node.found && (
          <CheckItem
            label={t("deps.node.label")}
            detail={report.node.version ?? t("status.detected")}
          />
        )}
        {report?.codex.found && (
          <CheckItem
            label={t("deps.codex.label")}
            detail={report.codex.version ?? t("status.detected")}
          />
        )}
        {report?.git.found && (
          <CheckItem
            label={t("deps.git.label")}
            detail={report.git.version ?? t("status.detected")}
          />
        )}
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={handleGetStarted}
        style={{
          padding: "9px 18px",
          fontSize: 13,
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          width: "100%",
          marginTop: 4,
        }}
      >
        {t("actions.getStarted")}
      </button>
    </div>
  );
}

function CheckItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: "var(--radius-sm)",
        background: "rgba(255, 107, 107, 0.04)",
        border: "1px solid rgba(255, 107, 107, 0.2)",
      }}
    >
      <CheckCircle2 size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--text-1)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11.5,
          color: "var(--text-3)",
          marginLeft: "auto",
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        {detail}
      </span>
    </div>
  );
}

function DiagnosticsRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 3,
        padding: "8px 0",
        borderTop: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function formatMethodSummary(diagnostics: CodexProtocolDiagnostics) {
  const methods = diagnostics.methodAvailability ?? [];
  const available = methods.filter((item) => item.status === "available").length;
  const unsupported = methods.filter((item) => item.status === "unsupported").length;
  const errors = methods.filter((item) => item.status === "error").length;
  return { available, unsupported, errors };
}

function CodexDiagnosticsPanel({ health }: { health?: EngineHealth }) {
  const { t } = useTranslation("setup");
  const diagnostics = health?.protocolDiagnostics;
  const [open, setOpen] = useState(false);

  if (!health) {
    return null;
  }

  const summary = diagnostics
    ? t("diagnostics.methodsSummary", formatMethodSummary(diagnostics))
    : health.available
      ? t("diagnostics.notFetched")
      : health.details ?? t("diagnostics.notAvailable");
  const configWarning = diagnostics?.lastConfigWarning;
  const accountLogin = diagnostics?.lastAccountLogin;
  const mcpOauth = diagnostics?.lastMcpOauth;
  const capabilitySummary = diagnostics
    ? t("diagnostics.capabilitiesSummary", {
        experimental: diagnostics.experimentalFeatures.length,
        apps: diagnostics.apps.length,
        modes: diagnostics.collaborationModes.length,
      })
    : null;

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
          borderRadius: 0,
          color: "var(--text-1)",
        }}
      >
        <div style={{ display: "grid", gap: 3, textAlign: "left" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("diagnostics.title")}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{summary}</span>
        </div>
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </button>
      {open && (
        <div
          style={{
            padding: "0 14px 12px",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          {capabilitySummary && (
            <DiagnosticsRow label={t("diagnostics.capabilities")} value={capabilitySummary} />
          )}
          {diagnostics?.methodAvailability?.length ? (
            <DiagnosticsRow
              label={t("diagnostics.methods")}
              value={diagnostics.methodAvailability
                .map((item) => `${item.method}: ${item.status}`)
                .join(" | ")}
            />
          ) : null}
          {configWarning ? (
            <DiagnosticsRow
              label={t("diagnostics.lastConfigWarning")}
              value={[
                configWarning.summary,
                configWarning.path,
                configWarning.startLine ? t("diagnostics.line", { line: configWarning.startLine }) : null,
              ]
                .filter(Boolean)
                .join(" | ")}
            />
          ) : null}
          {accountLogin ? (
            <DiagnosticsRow
              label={t("diagnostics.lastAccountLogin")}
              value={accountLogin.success ? t("diagnostics.success") : accountLogin.error ?? t("diagnostics.failed")}
            />
          ) : null}
          {mcpOauth ? (
            <DiagnosticsRow
              label={t("diagnostics.lastMcpOauth")}
              value={mcpOauth.success ? `${mcpOauth.name}: ${t("diagnostics.successLower")}` : `${mcpOauth.name}: ${mcpOauth.error ?? t("diagnostics.failedLower")}`}
            />
          ) : null}
          {diagnostics?.fetchedAt ? (
            <DiagnosticsRow
              label={t("diagnostics.fetched")}
              value={`${diagnostics.fetchedAt}${diagnostics.stale ? ` ${t("diagnostics.stale")}` : ""}`}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ErrorPhase() {
  const { t } = useTranslation(["setup", "common"]);
  const { error, verify } = useSetupStore();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "var(--radius-sm)",
          background: "rgba(251, 191, 36, 0.06)",
          border: "1px solid rgba(251, 191, 36, 0.2)",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <AlertTriangle
          size={15}
          style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }}
        />
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-1)", lineHeight: 1.5 }}>
          {error ?? t("setup:error.unexpected")}
        </p>
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={() => void verify()}
        style={{
          padding: "8px 16px",
          fontSize: 12.5,
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          width: "100%",
        }}
      >
        {t("common:actions.retry")}
      </button>
    </div>
  );
}

function PhaseContent({ phase }: { phase: SetupPhase }) {
  switch (phase) {
    case "scanning":
      return <ScanningPhase />;
    case "plan":
      return <PlanPhase />;
    case "installing":
      return <InstallingPhase />;
    case "complete":
      return <CompletePhase />;
    case "error":
      return <ErrorPhase />;
  }
}

export function SetupWizard() {
  const { t } = useTranslation(["setup", "common"]);
  const open = useSetupStore((s) => s.open);
  const phase = useSetupStore((s) => s.phase);
  const openSetup = useSetupStore((s) => s.openSetup);
  const closeSetup = useSetupStore((s) => s.closeSetup);
  const scan = useSetupStore((s) => s.scan);

  const loadedOnce = useEngineStore((s) => s.loadedOnce);
  const loadingEngines = useEngineStore((s) => s.loading);
  const health = useEngineStore((s) => s.health);
  const codexHealth = health.codex;

  const hasTriggered = useRef(false);

  // Auto-open: when engine health is loaded and codex is not available
  useEffect(() => {
    if (hasTriggered.current) return;
    if (!loadedOnce || loadingEngines) return;

    const codexAvailable = health.codex?.available ?? false;
    const isCompleted = localStorage.getItem(SETUP_COMPLETED_KEY) === "1";

    if (!codexAvailable) {
      hasTriggered.current = true;
      openSetup();
    } else if (!isCompleted) {
      // Codex is available but setup was never completed — mark as completed
      localStorage.setItem(SETUP_COMPLETED_KEY, "1");
    }
  }, [loadedOnce, loadingEngines, health, openSetup]);

  // Start scanning when the wizard opens
  useEffect(() => {
    if (open) {
      void scan();
    }
  }, [open, scan]);

  if (!open) return null;

  const isComplete = phase === "complete";

  const title = isComplete
    ? t("setup:header.completeTitle")
    : phase === "installing"
      ? t("setup:header.installingTitle")
      : phase === "error"
        ? t("setup:header.errorTitle")
        : t("setup:header.systemTitle");

  const subtitle = isComplete
    ? t("setup:header.completeSubtitle")
    : phase === "scanning"
      ? t("setup:header.scanningSubtitle")
      : phase === "installing"
        ? t("setup:header.installingSubtitle")
        : phase === "error"
          ? t("setup:header.errorSubtitle")
          : t("setup:header.planSubtitle");

  function handleClose() {
    closeSetup();
  }

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
          width: "min(640px, 100%)",
          maxHeight: "84vh",
          overflow: "auto",
          display: "grid",
          gap: 20,
          padding: "20px 22px",
          boxShadow:
            "0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06)",
          animation: "slide-up 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              border: isComplete
                ? "1px solid rgba(255, 107, 107, 0.3)"
                : "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isComplete
                ? "rgba(255, 107, 107, 0.08)"
                : "var(--bg-2)",
              flexShrink: 0,
              transition: "all 0.2s",
            }}
          >
            {isComplete ? (
              <CheckCircle2 size={16} style={{ color: "var(--accent)" }} />
            ) : (
              <Settings2 size={16} style={{ color: "var(--text-2)" }} />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                margin: 0,
                fontSize: 14.5,
                fontWeight: 600,
                color: "var(--text-1)",
                lineHeight: 1.4,
              }}
            >
              {title}
            </p>
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 12,
                color: isComplete ? "var(--accent)" : "var(--text-2)",
                lineHeight: 1.4,
                transition: "color 0.2s",
              }}
            >
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-3)",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.12s",
            }}
            className="btn-ghost"
            title={t("common:actions.close")}
          >
            <X size={14} />
          </button>
        </div>

        {/* Phase content */}
        <PhaseContent phase={phase} />

        <CodexDiagnosticsPanel health={codexHealth} />

        {/* Footer — Recheck for non-scanning/installing phases */}
        {phase === "plan" && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              borderTop: "1px solid var(--border)",
              marginTop: -4,
              paddingTop: 14,
            }}
          >
            <button
              type="button"
              className="btn-outline"
              onClick={() => void useSetupStore.getState().verify()}
              style={{
                padding: "7px 16px",
                fontSize: 12,
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t("setup:actions.recheck")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
