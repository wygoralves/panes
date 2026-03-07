import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("app");
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
    ? t("engineHealth.missingTitle")
    : configWarning
      ? t("engineHealth.configWarningTitle")
      : diagnostics?.stale
        ? t("engineHealth.staleTitle")
        : t("engineHealth.sandboxTitle");
  const description = !codexState?.available
    ? codexState?.details ??
      error ??
      t("engineHealth.missingMessage")
    : configWarning
      ? configWarning.details ?? configWarning.summary
      : diagnostics?.stale
        ? t("engineHealth.staleMessage")
        : codexWarning ??
          t("engineHealth.sandboxMessage");
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
            {configWarning ? `${t("engineHealth.location")} ` : `${t("engineHealth.runInTerminal")} `}
            {commandHint}
          </p>
        )}
      </div>
    </div>
  );
}
