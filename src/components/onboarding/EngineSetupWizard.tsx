import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Copy,
  Loader2,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEngineStore } from "../../stores/engineStore";
import { useUiStore } from "../../stores/uiStore";

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
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: StepStatus;
}) {
  const icon =
    status === "ok" ? (
      <CheckCircle2 size={14} style={{ color: "var(--success)" }} />
    ) : status === "error" ? (
      <AlertTriangle size={14} style={{ color: "var(--warning)" }} />
    ) : (
      <CircleDashed size={14} style={{ color: "var(--text-3)" }} />
    );

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        background: "var(--bg-2)",
        padding: "10px 12px",
        display: "grid",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
          {title}
        </span>
      </div>
      <p style={{ margin: 0, color: "var(--text-2)", fontSize: 12, lineHeight: 1.45 }}>
        {description}
      </p>
    </div>
  );
}

function CommandList({
  title,
  commands,
}: {
  title: string;
  commands: string[];
}) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

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

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        background: "var(--code-bg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-3)",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 1 }}>
        {commands.map((command, index) => (
          <div
            key={`${title}-${index}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 10px",
              borderTop: index === 0 ? "none" : "1px solid var(--border)",
              background: "var(--code-bg)",
            }}
          >
            <code
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                fontFamily: '"JetBrains Mono", monospace',
                color: "var(--text-2)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                flex: 1,
              }}
            >
              {command}
            </code>
            <button
              type="button"
              onClick={() => void copyCommand(command)}
              className="btn-ghost"
              style={{
                padding: "5px 8px",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Copy size={12} />
              {copiedCommand === command ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EngineSetupWizard() {
  const loadEngines = useEngineStore((state) => state.load);
  const loadingEngines = useEngineStore((state) => state.loading);
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

  const healthChecked = !loadingEngines && Object.keys(health).length > 0;
  const codexDetected = Boolean(codexState?.available);
  const sandboxReady = codexDetected && !codexWarning;
  const readyForChat = codexDetected;
  const hasBlockingIssue = healthChecked && !codexDetected;

  const summary = useMemo(() => {
    if (!healthChecked) {
      return "Checking local engine health...";
    }
    if (readyForChat && !codexWarning) {
      return "Codex is ready. You can start chat turns now.";
    }
    if (readyForChat && codexWarning) {
      return "Codex is detected. Panes can run with fallback sandbox mode while you fix local sandbox checks.";
    }
    if (!codexDetected) {
      return codexDetails ?? "Codex CLI was not found in PATH.";
    }
    return codexWarning ?? "Codex was detected, but local sandbox checks failed.";
  }, [codexDetected, codexDetails, codexWarning, healthChecked, readyForChat]);

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
        background: "rgba(8, 9, 12, 0.70)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={closeWizard}
    >
      <div
        className="surface"
        style={{
          width: "min(760px, 100%)",
          maxHeight: "84vh",
          overflow: "auto",
          display: "grid",
          gap: 14,
          padding: 14,
          boxShadow: "0 22px 70px rgba(0, 0, 0, 0.45)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-2)",
              flexShrink: 0,
            }}
          >
            <TerminalSquare size={15} style={{ color: "var(--text-2)" }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
              Engine Setup Wizard
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-2)" }}>
              {summary}
            </p>
          </div>
          <button
            type="button"
            onClick={closeWizard}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-2)",
              cursor: "pointer",
              flexShrink: 0,
            }}
            title="Close setup wizard"
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <StepItem
            title="Codex CLI detected"
            status={healthChecked ? (codexDetected ? "ok" : "error") : "pending"}
            description={
              codexDetected
                ? codexState?.version
                  ? `Detected version ${codexState.version}.`
                  : "Detected and ready for chat turns."
                : codexDetails ??
                  "Install Codex CLI and ensure `codex` is available in your PATH."
            }
          />
          <StepItem
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
                ? "Sandbox checks run after Codex is detected."
                : sandboxReady
                  ? "Sandbox checks are healthy for local execution."
                  : codexWarning ??
                    "Local sandbox check failed. Panes can still run with fallback behavior, but setup should be fixed."
            }
          />
          <StepItem
            title="Ready to start chat turns"
            status={healthChecked ? (readyForChat ? "ok" : "pending") : "pending"}
            description={
              readyForChat
                ? codexWarning
                  ? "You can already start chat turns. Panes will use fallback sandbox mode while local checks are failing."
                  : "You can open a workspace and send messages now."
                : "Resolve steps above and click recheck."
            }
          />
        </div>

        <CommandList title="Terminal checks" commands={codexChecks} />
        {codexFixes.length > 0 && <CommandList title="Suggested fixes" commands={codexFixes} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {hasBlockingIssue ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={dismissForNow}
              style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
            >
              Not now
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={closeEngineSetup}
              style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
            >
              Close
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => void recheck()}
            style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer", minWidth: 112 }}
          >
            {loadingEngines ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Loader2
                  size={12}
                  style={{ animation: "pulse-soft 1s ease-in-out infinite" }}
                />
                Rechecking...
              </span>
            ) : (
              "Recheck now"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
