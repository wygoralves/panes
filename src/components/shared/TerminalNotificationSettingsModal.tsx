import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  BellRing,
  Bot,
  CheckCircle2,
  Download,
  TerminalSquare,
  TriangleAlert,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTerminalNotificationSettingsStore } from "../../stores/terminalNotificationSettingsStore";
import type {
  TerminalNotificationIntegrationId,
  TerminalNotificationIntegrationStatus,
} from "../../types";

interface IntegrationCardProps {
  integration: TerminalNotificationIntegrationId;
  status: TerminalNotificationIntegrationStatus;
  installing: boolean;
  disabled: boolean;
  onInstall: (integration: TerminalNotificationIntegrationId) => void;
}

function statusTone(status: TerminalNotificationIntegrationStatus) {
  if (status.configured) {
    return {
      color: "var(--success)",
      background: "rgba(74, 222, 128, 0.12)",
      border: "rgba(74, 222, 128, 0.22)",
    };
  }
  if (status.conflict || status.detail) {
    return {
      color: "var(--warning)",
      background: "rgba(251, 191, 36, 0.12)",
      border: "rgba(251, 191, 36, 0.22)",
    };
  }
  return {
    color: "var(--text-3)",
    background: "rgba(255, 255, 255, 0.04)",
    border: "rgba(255, 255, 255, 0.08)",
  };
}

function IntegrationCard({
  integration,
  status,
  installing,
  disabled,
  onInstall,
}: IntegrationCardProps) {
  const { t } = useTranslation("app");
  const tone = statusTone(status);
  const icon = integration === "claude" ? <Bot size={14} /> : <TerminalSquare size={14} />;
  const actionLabel = status.configured
    ? t("notificationSettings.reinstall")
    : status.conflict
      ? t("notificationSettings.replace")
      : t("notificationSettings.install");
  const statusLabel = status.configured
    ? t("notificationSettings.status.installed")
    : status.conflict || status.detail
      ? t("notificationSettings.status.needsAttention")
      : t("notificationSettings.status.notInstalled");

  return (
    <div
      style={{
        border: `1px solid ${tone.border}`,
        background: tone.background,
        borderRadius: "var(--radius-md)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "rgba(255, 255, 255, 0.06)",
              color: tone.color,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
              {t(`notificationSettings.integrations.${integration}.title`)}
            </div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>
              {t(`notificationSettings.integrations.${integration}.description`)}
            </div>
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 999,
            border: `1px solid ${tone.border}`,
            background: "rgba(0, 0, 0, 0.12)",
            color: tone.color,
            fontSize: 10.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {status.configured ? <CheckCircle2 size={11} /> : <TriangleAlert size={11} />}
          {statusLabel}
        </span>
      </div>

      {status.configPath && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            fontFamily: "\"JetBrains Mono\", monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={status.configPath}
        >
          {status.configPath}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minHeight: 18, fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
          {status.detail ?? t(`notificationSettings.integrations.${integration}.detail`)}
        </div>
        <button
          type="button"
          className="ws-prop-btn"
          disabled={disabled}
          onClick={() => onInstall(integration)}
          style={{
            flexShrink: 0,
            background: status.configured ? "rgba(255, 255, 255, 0.05)" : "var(--accent-dim)",
            borderColor: status.configured ? "rgba(255, 255, 255, 0.12)" : "var(--border-accent)",
            color: status.configured ? "var(--text-2)" : "var(--accent)",
          }}
        >
          <Download size={11} />
          {installing ? t("notificationSettings.installing") : actionLabel}
        </button>
      </div>
    </div>
  );
}

export function TerminalNotificationSettingsModal() {
  const { t } = useTranslation("app");
  const open = useTerminalNotificationSettingsStore((s) => s.modalOpen);
  const settings = useTerminalNotificationSettingsStore((s) => s.settings);
  const loading = useTerminalNotificationSettingsStore((s) => s.loading);
  const loadedOnce = useTerminalNotificationSettingsStore((s) => s.loadedOnce);
  const updatingEnabled = useTerminalNotificationSettingsStore((s) => s.updatingEnabled);
  const installingIntegration = useTerminalNotificationSettingsStore((s) => s.installingIntegration);
  const load = useTerminalNotificationSettingsStore((s) => s.load);
  const close = useTerminalNotificationSettingsStore((s) => s.closeModal);
  const setEnabled = useTerminalNotificationSettingsStore((s) => s.setEnabled);
  const installIntegration = useTerminalNotificationSettingsStore((s) => s.installIntegration);

  useEffect(() => {
    if (!open || loadedOnce || loading) {
      return;
    }
    void load();
  }, [load, loadedOnce, loading, open]);

  const handleClose = useCallback(() => close(), [close]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleClose, open]);

  if (!open) {
    return null;
  }

  const busy = loading || updatingEnabled || installingIntegration !== null;
  const canEnable = settings?.setupComplete ?? false;
  const primaryLabel = settings?.enabled
    ? t("notificationSettings.done")
    : t("notificationSettings.enableButton");
  const primaryDisabled = !settings?.enabled && (!canEnable || busy);

  const handlePrimaryAction = async () => {
    if (settings?.enabled) {
      handleClose();
      return;
    }
    const nextSettings = await setEnabled(true);
    if (nextSettings?.enabled) {
      handleClose();
    }
  };

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div className="ws-modal" style={{ width: "min(700px, calc(100vw - 40px))" }}>
        <div className="ws-header">
          <div className="ws-header-icon">
            <BellRing size={18} />
          </div>
          <div className="ws-header-text">
            <h2 className="ws-header-title" style={{ fontSize: 15 }}>
              {t("notificationSettings.title")}
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "var(--text-3)",
                lineHeight: 1.55,
              }}
            >
              {t("notificationSettings.description")}
            </p>
          </div>
          <button type="button" className="ws-close" onClick={handleClose} aria-label={t("notificationSettings.close")}>
            <X size={16} />
          </button>
        </div>

        <div className="ws-divider" />

        <div className="ws-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.03)",
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
              {t("notificationSettings.workflowTitle")}
            </div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
              {t("notificationSettings.workflowDescription")}
            </div>
          </div>

          {!canEnable && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "11px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid rgba(251, 191, 36, 0.22)",
                background: "rgba(251, 191, 36, 0.08)",
                color: "var(--text-2)",
              }}
            >
              <TriangleAlert size={15} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                {t("notificationSettings.setupRequired")}
              </div>
            </div>
          )}

          <div className="ws-section" style={{ marginBottom: 0 }}>
            <div className="ws-section-label">{t("notificationSettings.integrationsLabel")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <IntegrationCard
                integration="claude"
                status={settings?.claude ?? { configured: false, configExists: false, conflict: false }}
                installing={installingIntegration === "claude"}
                disabled={busy}
                onInstall={(integration) => { void installIntegration(integration); }}
              />
              <IntegrationCard
                integration="codex"
                status={settings?.codex ?? { configured: false, configExists: false, conflict: false }}
                installing={installingIntegration === "codex"}
                disabled={busy}
                onInstall={(integration) => { void installIntegration(integration); }}
              />
            </div>
          </div>
        </div>

        <div
          className="ws-footer"
          style={{
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>
            {t("notificationSettings.footerNote")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button type="button" className="ws-prop-btn" onClick={handleClose}>
              {t("notificationSettings.close")}
            </button>
            <button
              type="button"
              className="ws-prop-btn"
              disabled={primaryDisabled}
              onClick={() => { void handlePrimaryAction(); }}
              style={{
                background: "var(--accent-dim)",
                borderColor: "var(--border-accent)",
                color: "var(--accent)",
                minWidth: 132,
                justifyContent: "center",
              }}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
