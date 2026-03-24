import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  MessageSquare,
  Play,
  TerminalSquare,
  Volume2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTerminalNotificationSettingsStore } from "../../stores/terminalNotificationSettingsStore";
import { Dropdown } from "./Dropdown";
import { getHarnessIcon } from "./HarnessLogos";
import type {
  TerminalNotificationIntegrationId,
  TerminalNotificationIntegrationStatus,
} from "../../types";

const SOUND_OPTIONS = [
  "Glass", "Ping", "Pop", "Purr", "Tink",
  "Blow", "Bottle", "Frog", "Funk", "Hero",
  "Morse", "Sosumi", "Submarine", "Basso",
] as const;

function needsAction(status: TerminalNotificationIntegrationStatus) {
  return !status.configured;
}

export function TerminalNotificationSettingsModal() {
  const { t } = useTranslation("app");
  const open = useTerminalNotificationSettingsStore((s) => s.modalOpen);
  const settings = useTerminalNotificationSettingsStore((s) => s.settings);
  const loading = useTerminalNotificationSettingsStore((s) => s.loading);
  const loadedOnce = useTerminalNotificationSettingsStore((s) => s.loadedOnce);
  const updatingChatEnabled = useTerminalNotificationSettingsStore((s) => s.updatingChatEnabled);
  const updatingTerminalEnabled = useTerminalNotificationSettingsStore((s) => s.updatingTerminalEnabled);
  const installingIntegration = useTerminalNotificationSettingsStore((s) => s.installingIntegration);
  const load = useTerminalNotificationSettingsStore((s) => s.load);
  const close = useTerminalNotificationSettingsStore((s) => s.closeModal);
  const setChatEnabled = useTerminalNotificationSettingsStore((s) => s.setChatEnabled);
  const setTerminalEnabled = useTerminalNotificationSettingsStore((s) => s.setTerminalEnabled);
  const setNotificationSound = useTerminalNotificationSettingsStore((s) => s.setNotificationSound);
  const previewSound = useTerminalNotificationSettingsStore((s) => s.previewSound);
  const installIntegration = useTerminalNotificationSettingsStore((s) => s.installIntegration);

  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    if (!open || loadedOnce || loading) return;
    void load();
  }, [load, loadedOnce, loading, open]);

  // Reset manage panel when modal closes
  useEffect(() => {
    if (!open) setManageOpen(false);
  }, [open]);

  const handleClose = useCallback(() => close(), [close]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleClose, open]);

  if (!open) return null;

  const claude = settings?.claude ?? { configured: false, configExists: false, conflict: false };
  const codex = settings?.codex ?? { configured: false, configExists: false, conflict: false };
  const integrationBusy = loading || installingIntegration !== null;
  const terminalBusy = loading || updatingTerminalEnabled || installingIntegration !== null;
  const terminalToggleDisabled = terminalBusy;

  const allConfigured = claude.configured && codex.configured;
  const anyNeedsSetup = needsAction(claude) || needsAction(codex);

  // Show expanded integrations when: any needs setup, or user clicked manage
  const showExpanded = anyNeedsSetup || manageOpen;

  const chatOn = settings?.chatEnabled ?? false;
  const terminalOn = settings?.terminalEnabled ?? false;

  function renderIntegrationRow(
    id: TerminalNotificationIntegrationId,
    status: TerminalNotificationIntegrationStatus,
  ) {
    const actionNeeded = needsAction(status);
    const actionLabel = status.configured
      ? t("notificationSettings.reinstall")
      : status.conflict
        ? t("notificationSettings.replace")
        : t("notificationSettings.install");
    const installing = installingIntegration === id;

    return (
      <div className="ntf-setup-card" data-needs-action={String(actionNeeded)} key={id}>
        <div className="ntf-setup-left">
          <div className="ntf-setup-name">
            {getHarnessIcon(id === "claude" ? "claude-code" : "codex", 13)}
            {t(`notificationSettings.integrations.${id}.title`)}
          </div>
          <div className="ntf-setup-desc">
            {t(`notificationSettings.integrations.${id}.description`)}
          </div>
          {status.configPath && (
            <div className="ntf-setup-path" title={status.configPath}>
              {status.configPath}
            </div>
          )}
        </div>
        <button
          type="button"
          className="ntf-setup-btn"
          data-primary={String(!status.configured)}
          disabled={integrationBusy}
          onClick={() => { void installIntegration(id); }}
        >
          <Download size={10} />
          {installing ? t("notificationSettings.installing") : actionLabel}
        </button>
      </div>
    );
  }

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div className="ws-modal" style={{ width: "min(540px, calc(100vw - 40px))" }}>
        {/* Header */}
        <div className="ws-header">
          <div className="ws-header-icon">
            <BellRing size={18} />
          </div>
          <div className="ws-header-text">
            <h2 className="ws-header-title">
              {t("notificationSettings.title")}
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>
              {t("notificationSettings.descriptionShort")}
            </p>
          </div>
          <button type="button" className="ws-close" onClick={handleClose} aria-label={t("notificationSettings.close")}>
            <X size={16} />
          </button>
        </div>

        <div className="ws-divider" />

        {/* Body */}
        <div className="ws-body" style={{ display: "flex", flexDirection: "column", gap: 0, paddingTop: 4 }}>
          {/* Chat toggle row */}
          <div className="ntf-row">
            <div className="ntf-row-left">
              <div className="ntf-row-icon" data-on={String(chatOn)}>
                <MessageSquare size={14} />
              </div>
              <div>
                <div className="ntf-row-title">{t("notificationSettings.chatCard.title")}</div>
                <div className="ntf-row-desc">{t("notificationSettings.chatCard.descriptionShort")}</div>
              </div>
            </div>
            <label className="ws-toggle" style={{ cursor: loading || updatingChatEnabled ? "wait" : "pointer" }}>
              <input
                type="checkbox"
                checked={chatOn}
                disabled={loading || updatingChatEnabled}
                onChange={() => { void setChatEnabled(!chatOn); }}
              />
              <span className="ws-toggle-track" />
              <span className="ws-toggle-thumb" />
            </label>
          </div>

          {/* Terminal toggle row */}
          <div className="ntf-row">
            <div className="ntf-row-left">
              <div className="ntf-row-icon" data-on={String(terminalOn)}>
                <TerminalSquare size={14} />
              </div>
              <div>
                <div className="ntf-row-title">{t("notificationSettings.terminalCard.title")}</div>
                <div className="ntf-row-desc">{t("notificationSettings.terminalCard.descriptionShort")}</div>
              </div>
            </div>
            <label className="ws-toggle" style={{ cursor: terminalToggleDisabled ? "wait" : "pointer" }}>
              <input
                type="checkbox"
                checked={terminalOn}
                disabled={terminalToggleDisabled}
                onChange={() => { void setTerminalEnabled(!terminalOn); }}
              />
              <span className="ws-toggle-track" />
              <span className="ws-toggle-thumb" />
            </label>
          </div>

          {/* Sound picker row */}
          <div className="ntf-row">
            <div className="ntf-row-left">
              <div className="ntf-row-icon" data-on={String((settings?.notificationSound ?? "Glass") !== "none")}>
                <Volume2 size={14} />
              </div>
              <div>
                <div className="ntf-row-title">{t("notificationSettings.sound.title")}</div>
                <div className="ntf-row-desc">{t("notificationSettings.sound.description")}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Dropdown
                options={[
                  { value: "none", label: t("notificationSettings.sound.none") },
                  ...SOUND_OPTIONS.map((name) => ({ value: name, label: name })),
                ]}
                value={settings?.notificationSound ?? "Glass"}
                onChange={(value) => {
                  void setNotificationSound(value);
                  if (value !== "none") {
                    void previewSound(value);
                  }
                }}
                disabled={loading}
              />
              <button
                type="button"
                className="ntf-preview-btn"
                disabled={loading || (settings?.notificationSound ?? "Glass") === "none"}
                onClick={() => { void previewSound(settings?.notificationSound ?? "Glass"); }}
                aria-label={t("notificationSettings.sound.preview")}
                title={t("notificationSettings.sound.preview")}
              >
                <Play size={10} />
              </button>
            </div>
          </div>

          {/* Integration status section */}
          <div className="ntf-section-gap" />

          {allConfigured && (
            <div className="ntf-hooks-row">
              <div className="ntf-hook-item">
                <CheckCircle2 size={10} />
                {t("notificationSettings.integrations.claude.title")}
              </div>
              <div className="ntf-hook-item">
                <CheckCircle2 size={10} />
                {t("notificationSettings.integrations.codex.title")}
              </div>
              <button
                type="button"
                className="ntf-hooks-manage"
                onClick={() => setManageOpen(!manageOpen)}
              >
                {manageOpen ? t("notificationSettings.collapse") : t("notificationSettings.manage")}
                {manageOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
            </div>
          )}

          <div className="ntf-expand-wrap" data-open={String(showExpanded)}>
            <div className="ntf-expand-inner">
              <div className="ntf-setup-area">
                {renderIntegrationRow("claude", claude)}
                {renderIntegrationRow("codex", codex)}
                <div className="ntf-footnote">
                  {t("notificationSettings.workflowShort")}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
