import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Copy,
  Loader2,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useEngineStore } from "../../stores/engineStore";
import { useUiStore } from "../../stores/uiStore";
import type { EngineCheckResult } from "../../types";

type StepStatus = "ok" | "error" | "pending";

const DISMISS_STORAGE_KEY = "panes.engine-setup.dismissed.v1";

function readDismissedState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(DISMISS_STORAGE_KEY) === "1";
}

function writeDismissedState(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  if (value) {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
  } else {
    window.localStorage.removeItem(DISMISS_STORAGE_KEY);
  }
}

function StepItem({
  step,
  title,
  description,
  status,
}: {
  step: number;
  title: string;
  description: string;
  status: StepStatus;
}) {
  const borderColor =
    status === "ok"
      ? "rgba(52, 211, 153, 0.25)"
      : status === "error"
        ? "rgba(251, 191, 36, 0.25)"
        : "var(--border)";

  const bgColor =
    status === "ok"
      ? "rgba(52, 211, 153, 0.04)"
      : status === "error"
        ? "rgba(251, 191, 36, 0.04)"
        : "var(--bg-2)";

  const icon =
    status === "ok" ? (
      <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
    ) : status === "error" ? (
      <AlertTriangle size={15} style={{ color: "var(--warning)" }} />
    ) : (
      <CircleDashed size={15} style={{ color: "var(--text-3)" }} />
    );

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
          background:
            status === "ok"
              ? "rgba(52, 211, 153, 0.12)"
              : status === "error"
                ? "rgba(251, 191, 36, 0.12)"
                : "var(--bg-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {status === "pending" ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-3)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {step}
          </span>
        ) : (
          icon
        )}
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
          {title}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            color: "var(--text-2)",
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

function CommandList({
  title,
  commands,
  onRunCheck,
}: {
  title: string;
  commands: string[];
  onRunCheck: (command: string) => Promise<EngineCheckResult>;
}) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [runningCheckCommand, setRunningCheckCommand] = useState<string | null>(null);
  const [resultsByCommand, setResultsByCommand] = useState<Record<string, EngineCheckResult>>({});
  const [errorsByCommand, setErrorsByCommand] = useState<Record<string, string>>({});

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      window.setTimeout(() => {
        setCopiedCommand((current) => (current === command ? null : current));
      }, 1400);
    } catch {
      setCopiedCommand(null);
    }
  }

  if (commands.length === 0) {
    return null;
  }

  async function runCheck(command: string) {
    setRunningCheckCommand(command);
    setErrorsByCommand((current) => {
      const next = { ...current };
      delete next[command];
      return next;
    });
    try {
      const result = await onRunCheck(command);
      setResultsByCommand((current) => ({
        ...current,
        [command]: result,
      }));
    } catch (error) {
      setErrorsByCommand((current) => ({
        ...current,
        [command]: String(error),
      }));
    } finally {
      setRunningCheckCommand((current) => (current === command ? null : current));
    }
  }

  return (
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
        {title}
      </div>
      <div style={{ background: "var(--code-bg)" }}>
        {commands.map((command, index) => {
          const result = resultsByCommand[command];
          const error = errorsByCommand[command];
          const hasResult = Boolean(result) || Boolean(error);
          const isRunning = runningCheckCommand === command;
          return (
            <div
              key={`${title}-${index}`}
              style={{
                padding: "10px 12px",
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: "var(--text-1)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    flex: 1,
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.03)",
                  }}
                >
                  <span style={{ color: "var(--text-3)", userSelect: "none" }}>$ </span>
                  {command}
                </code>
                <button
                  type="button"
                  onClick={() => void copyCommand(command)}
                  className="btn-ghost"
                  style={{
                    padding: "5px 10px",
                    fontSize: 11,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer",
                    flexShrink: 0,
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <Copy size={11} />
                  {copiedCommand === command ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => void runCheck(command)}
                  disabled={isRunning}
                  className="btn-outline"
                  style={{
                    padding: "5px 10px",
                    fontSize: 11,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: isRunning ? "not-allowed" : "pointer",
                    flexShrink: 0,
                    opacity: isRunning ? 0.6 : 1,
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {isRunning ? (
                    <>
                      <Loader2
                        size={11}
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                      Running
                    </>
                  ) : (
                    "Run check"
                  )}
                </button>
              </div>
              {hasResult ? (
                <div
                  style={{
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${result?.success ? "rgba(52, 211, 153, 0.2)" : "rgba(251, 191, 36, 0.2)"}`,
                    padding: "8px 10px",
                    background: result?.success
                      ? "rgba(52, 211, 153, 0.04)"
                      : "rgba(251, 191, 36, 0.04)",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {result ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11.5,
                          color: result.success ? "var(--success)" : "var(--warning)",
                          fontWeight: 600,
                        }}
                      >
                        {result.success ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <AlertTriangle size={12} />
                        )}
                        {result.success ? "Passed" : "Failed"}{" "}
                        <span style={{ fontWeight: 400, color: "var(--text-3)" }}>
                          exit {result.exitCode === null ? "null" : String(result.exitCode)} · {result.durationMs}ms
                        </span>
                      </div>
                      {result.stdout ? (
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 11,
                            lineHeight: 1.45,
                            fontFamily: '"JetBrains Mono", monospace',
                            color: "var(--text-2)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {result.stdout}
                        </pre>
                      ) : null}
                      {result.stderr ? (
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 11,
                            lineHeight: 1.45,
                            fontFamily: '"JetBrains Mono", monospace',
                            color: "var(--warning)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {result.stderr}
                        </pre>
                      ) : null}
                    </>
                  ) : null}
                  {error ? (
                    <p style={{ margin: 0, fontSize: 11.5, color: "var(--warning)" }}>{error}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EngineSetupWizard() {
  const loadEngines = useEngineStore((state) => state.load);
  const loadingEngines = useEngineStore((state) => state.loading);
  const loadedOnce = useEngineStore((state) => state.loadedOnce);
  const engineError = useEngineStore((state) => state.error);
  const health = useEngineStore((state) => state.health);

  const open = useUiStore((state) => state.engineSetupOpen);
  const openEngineSetup = useUiStore((state) => state.openEngineSetup);
  const closeEngineSetup = useUiStore((state) => state.closeEngineSetup);

  const [dismissed, setDismissed] = useState<boolean>(() => readDismissedState());

  const codexState = health.codex;
  const codexWarning = codexState?.warnings?.[0];
  const codexDetails = codexState?.details;
  const codexChecks =
    codexState?.checks && codexState.checks.length > 0
      ? codexState.checks
      : ["codex --version", "command -v codex"];
  const codexFixes = codexState?.fixes ?? [];

  const healthChecked = loadedOnce && !loadingEngines;
  const codexDetected = Boolean(codexState?.available);
  const sandboxReady = codexDetected && !codexWarning;
  const readyForChat = codexDetected;
  const hasBlockingIssue = healthChecked && !codexDetected;
  const allGreen = readyForChat && !codexWarning;

  const summary = useMemo(() => {
    if (!healthChecked) {
      return "Checking local engine health...";
    }
    if (readyForChat && !codexWarning) {
      return "All checks passed. You're ready to go.";
    }
    if (readyForChat && codexWarning) {
      return "Codex detected with warnings. Chat works, but sandbox needs attention.";
    }
    if (!codexDetected) {
      return codexDetails ?? engineError ?? "Codex CLI was not found in PATH.";
    }
    return codexWarning ?? "Codex was detected, but local sandbox checks failed.";
  }, [codexDetected, codexDetails, codexWarning, engineError, healthChecked, readyForChat]);

  useEffect(() => {
    if (!healthChecked) {
      return;
    }

    if (!hasBlockingIssue) {
      if (dismissed) {
        setDismissed(false);
        writeDismissedState(false);
      }
      return;
    }

    if (!dismissed && !open) {
      openEngineSetup();
    }
  }, [dismissed, hasBlockingIssue, healthChecked, open, openEngineSetup]);

  async function recheck() {
    await loadEngines();
  }

  async function runCommandCheck(command: string): Promise<EngineCheckResult> {
    return ipc.runEngineCheck("codex", command);
  }

  function dismissForNow() {
    setDismissed(true);
    writeDismissedState(true);
    closeEngineSetup();
  }

  function closeWizard() {
    if (hasBlockingIssue) {
      dismissForNow();
      return;
    }
    closeEngineSetup();
  }

  if (!open) {
    return null;
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
      onClick={closeWizard}
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
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              border: allGreen
                ? "1px solid rgba(52, 211, 153, 0.3)"
                : "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: allGreen
                ? "rgba(52, 211, 153, 0.08)"
                : "var(--bg-2)",
              flexShrink: 0,
              transition: "all 0.2s",
            }}
          >
            {allGreen ? (
              <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
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
              Engine Setup
            </p>
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 12,
                color: allGreen ? "var(--success)" : "var(--text-2)",
                lineHeight: 1.4,
                transition: "color 0.2s",
              }}
            >
              {summary}
            </p>
          </div>
          <button
            type="button"
            onClick={closeWizard}
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
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Steps */}
        <div style={{ display: "grid", gap: 6 }}>
          <StepItem
            step={1}
            title="Codex CLI detected"
            status={healthChecked ? (codexDetected ? "ok" : "error") : "pending"}
            description={
              codexDetected
                ? codexState?.version
                  ? `Version ${codexState.version} found in PATH.`
                  : "Detected and ready for chat turns."
                : codexDetails ??
                  engineError ??
                  "Install Codex CLI and ensure `codex` is available in your PATH."
            }
          />
          <StepItem
            step={2}
            title="Sandbox preflight"
            status={
              healthChecked
                ? codexDetected
                  ? sandboxReady
                    ? "ok"
                    : "error"
                  : "pending"
                : "pending"
            }
            description={
              !codexDetected
                ? "Runs after Codex CLI is detected."
                : sandboxReady
                  ? "Sandbox checks passed for local execution."
                  : codexWarning ??
                    "Sandbox check failed. Panes can still run with fallback behavior."
            }
          />
          <StepItem
            step={3}
            title="Ready for chat"
            status={healthChecked ? (readyForChat ? "ok" : "pending") : "pending"}
            description={
              readyForChat
                ? codexWarning
                  ? "Chat works with fallback sandbox mode. Fix sandbox warnings for full functionality."
                  : "All systems go. Open a workspace and start chatting."
                : "Complete the steps above to get started."
            }
          />
        </div>

        {/* Terminal checks — hidden when everything is green */}
        {!allGreen && (
          <>
            <CommandList
              title="Diagnostic commands"
              commands={codexChecks}
              onRunCheck={runCommandCheck}
            />
            {codexFixes.length > 0 && (
              <CommandList
                title="Suggested fixes"
                commands={codexFixes}
                onRunCheck={runCommandCheck}
              />
            )}
          </>
        )}

        {/* Footer actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            borderTop: "1px solid var(--border)",
            marginTop: -4,
            paddingTop: 14,
          }}
        >
          {hasBlockingIssue ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={dismissForNow}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Dismiss
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={closeEngineSetup}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Close
            </button>
          )}
          <button
            type="button"
            className={allGreen ? "btn-outline" : "btn-primary"}
            onClick={() => void recheck()}
            disabled={loadingEngines}
            style={{
              padding: "7px 16px",
              fontSize: 12,
              cursor: loadingEngines ? "not-allowed" : "pointer",
              borderRadius: "var(--radius-sm)",
              minWidth: 120,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: loadingEngines ? 0.7 : 1,
            }}
          >
            {loadingEngines ? (
              <>
                <Loader2
                  size={12}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw size={12} />
                Recheck
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
