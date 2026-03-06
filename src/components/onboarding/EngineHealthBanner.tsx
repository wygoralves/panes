import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useEngineStore } from "../../stores/engineStore";

function isInformationalCodexWarning(warning: string): boolean {
  const normalized = warning.toLowerCase();
  return normalized.includes("forcing codex external sandbox mode on macos");
}

function formatConfigWarningLocation(
  warning: { path?: string; startLine?: number; startColumn?: number } | undefined,
) {
  if (!warning?.path) {
    return null;
  }

  const line = warning.startLine ? `:${warning.startLine}` : "";
  const column = warning.startColumn ? `:${warning.startColumn}` : "";
  return `${warning.path}${line}${column}`;
}

export function EngineHealthBanner() {
  const { health, error } = useEngineStore();
  const codexState = useMemo(() => health.codex, [health]);
  const codexWarnings = codexState?.warnings ?? [];
  const codexWarning = codexWarnings.find((warning) => !isInformationalCodexWarning(warning));
  const diagnostics = codexState?.protocolDiagnostics;
  const configWarning = diagnostics?.lastConfigWarning;
  const configWarningLocation = formatConfigWarningLocation(configWarning);

  if (!codexState && !error) {
    return null;
  }

  if (codexState?.available && !codexWarning && !configWarning && !diagnostics?.stale) {
    return null;
  }

  const title = !codexState?.available
    ? "Codex engine not detected"
    : configWarning
      ? "Codex config warning"
      : diagnostics?.stale
        ? "Codex runtime sync is stale"
        : "Codex sandbox check failed";
  const description = !codexState?.available
    ? codexState?.details ??
      error ??
      "Install Codex CLI and authenticate before starting chat turns."
    : configWarning
      ? configWarning.details ?? configWarning.summary
      : diagnostics?.stale
        ? "Panes could not refresh the latest Codex capability snapshot. Runtime notifications may be delayed until the next successful reconnect."
        : codexWarning ??
          "Codex is installed, but the local OS sandbox check failed.";
  const commandHint = !codexState?.available
    ? codexState?.fixes?.[0] ?? codexState?.checks?.[0]
    : configWarning
      ? configWarningLocation
      : codexState?.checks?.find((command) => command.includes("sandbox-exec")) ??
        "sandbox-exec -p '(version 1) (allow default)' /usr/bin/true";

  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "10px 14px",
        borderRadius: "var(--radius-md)",
        background: "rgba(251, 191, 36, 0.06)",
        border: "1px solid rgba(251, 191, 36, 0.15)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <AlertTriangle size={16} style={{ color: "var(--warning)", flexShrink: 0 }} />
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
          {title}
        </p>
        <p style={{ margin: "3px 0 0", color: "var(--text-2)", fontSize: 12 }}>
          {description}
        </p>
        {commandHint && (
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--text-3)",
              fontSize: 11,
              fontFamily: '"JetBrains Mono", monospace',
              whiteSpace: "pre-wrap",
            }}
          >
            {configWarning ? "Location: " : "Run in Terminal: "}
            {commandHint}
          </p>
        )}
      </div>
    </div>
  );
}
