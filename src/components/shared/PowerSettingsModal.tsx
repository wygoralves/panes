import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Zap, Monitor, BatteryCharging, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useKeepAwakeStore } from "../../stores/keepAwakeStore";
import type { PowerSettingsInput } from "../../types";

const DURATION_PRESETS = [
  { label: "duration30m", value: 1800 },
  { label: "duration1h", value: 3600 },
  { label: "duration2h", value: 7200 },
] as const;

function formatRemaining(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function PowerSettingsModal() {
  const { t } = useTranslation("app");
  const open = useKeepAwakeStore((s) => s.powerSettingsOpen);
  const close = useKeepAwakeStore((s) => s.closePowerSettings);
  const loadPowerSettings = useKeepAwakeStore((s) => s.loadPowerSettings);
  const savePowerSettings = useKeepAwakeStore((s) => s.savePowerSettings);
  const keepAwakeState = useKeepAwakeStore((s) => s.state);
  const loading = useKeepAwakeStore((s) => s.loading);

  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false);
  const [preventDisplaySleep, setPreventDisplaySleep] = useState(false);
  const [preventScreenSaver, setPreventScreenSaver] = useState(false);
  const [acOnlyMode, setAcOnlyMode] = useState(false);
  const [batteryThresholdEnabled, setBatteryThresholdEnabled] = useState(false);
  const [batteryThreshold, setBatteryThreshold] = useState(20);
  const [sessionMode, setSessionMode] = useState<"indefinite" | "fixed">("indefinite");
  const [sessionDuration, setSessionDuration] = useState(3600);
  const [customMinutes, setCustomMinutes] = useState("");

  useEffect(() => {
    if (!open) return;
    void loadPowerSettings().then((settings) => {
      if (!settings) return;
      setKeepAwakeEnabled(settings.keepAwakeEnabled);
      setPreventDisplaySleep(settings.preventDisplaySleep);
      setPreventScreenSaver(settings.preventScreenSaver);
      setAcOnlyMode(settings.acOnlyMode);
      setBatteryThresholdEnabled(settings.batteryThreshold != null);
      setBatteryThreshold(settings.batteryThreshold ?? 20);
      if (settings.sessionDurationSecs != null) {
        setSessionMode("fixed");
        setSessionDuration(settings.sessionDurationSecs);
        if (!DURATION_PRESETS.some((p) => p.value === settings.sessionDurationSecs)) {
          setCustomMinutes(String(Math.round(settings.sessionDurationSecs / 60)));
        }
      } else {
        setSessionMode("indefinite");
      }
    });
  }, [open, loadPowerSettings]);

  const handleClose = useCallback(() => close(), [close]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleClose]);

  if (!open) return null;

  const handleSave = async () => {
    const input: PowerSettingsInput = {
      keepAwakeEnabled,
      preventDisplaySleep,
      preventScreenSaver,
      acOnlyMode,
      batteryThreshold: batteryThresholdEnabled ? batteryThreshold : null,
      sessionDurationSecs: sessionMode === "fixed" ? sessionDuration : null,
    };
    const result = await savePowerSettings(input);
    if (result) handleClose();
  };

  const disabled = !keepAwakeEnabled;
  const isMacOrLinux = navigator.platform.startsWith("Mac") || navigator.platform.startsWith("Linux");

  const statusActive = keepAwakeState?.enabled && keepAwakeState?.active;
  const statusPaused = keepAwakeState?.enabled && keepAwakeState?.pausedDueToBattery;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="ws-modal"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(460px, calc(100vw - 48px))", maxHeight: "calc(100vh - 60px)" }}
      >
        {/* ── Header ── */}
        <div className="ws-header">
          <div className="ws-header-icon">
            <Zap size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="ws-header-title">{t("powerModal.title")}</h2>
            <div className="ws-header-path">{t("powerModal.keepAwakeDescription")}</div>
          </div>
          <button
            type="button"
            className="ws-close"
            onClick={handleClose}
            style={{ background: "none", border: "none" }}
          >
            <X size={15} />
          </button>
        </div>

        <div className="ws-divider" />

        {/* ── Scrollable Body ── */}
        <div className="ws-body">

          {/* Main Toggle */}
          <div className="ws-prop" style={{ borderTop: "none", paddingBottom: 2 }}>
            <div className="ws-prop-label" style={{ width: "auto", flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                {t("powerModal.keepAwake")}
              </span>
            </div>
            <ToggleSwitch checked={keepAwakeEnabled} onChange={setKeepAwakeEnabled} />
          </div>

          {/* ── Display Section ── */}
          <SectionLabel icon={<Monitor size={12} />} label={t("powerModal.displaySection")} />

          <SettingsRow
            label={t("powerModal.preventDisplaySleep")}
            description={t("powerModal.preventDisplaySleepDescription")}
            disabled={disabled}
          >
            <ToggleSwitch
              checked={preventDisplaySleep}
              onChange={setPreventDisplaySleep}
              disabled={disabled}
            />
          </SettingsRow>

          <SettingsRow
            label={t("powerModal.preventScreenSaver")}
            description={t("powerModal.preventScreenSaverDescription")}
            disabled={disabled}
          >
            <ToggleSwitch
              checked={preventScreenSaver}
              onChange={setPreventScreenSaver}
              disabled={disabled}
            />
          </SettingsRow>

          {isMacOrLinux && (
            <div style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              padding: "2px 0 6px",
              fontStyle: "italic",
            }}>
              {t("powerModal.displayLinkedNote")}
            </div>
          )}

          {/* ── Power Source Section ── */}
          <SectionLabel icon={<BatteryCharging size={12} />} label={t("powerModal.powerSourceSection")} />

          <SettingsRow
            label={t("powerModal.acOnlyMode")}
            description={t("powerModal.acOnlyModeDescription")}
            disabled={disabled}
          >
            <ToggleSwitch
              checked={acOnlyMode}
              onChange={setAcOnlyMode}
              disabled={disabled}
            />
          </SettingsRow>

          <SettingsRow
            label={t("powerModal.batteryThreshold")}
            description={t("powerModal.batteryThresholdDescription")}
            disabled={disabled}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ToggleSwitch
                checked={batteryThresholdEnabled}
                onChange={setBatteryThresholdEnabled}
                disabled={disabled}
              />
              {batteryThresholdEnabled && (
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={batteryThreshold}
                    onChange={(e) => setBatteryThreshold(Math.max(1, Math.min(99, Number(e.target.value))))}
                    disabled={disabled}
                    className="ws-depth-input"
                  />
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>%</span>
                </span>
              )}
            </div>
          </SettingsRow>

          {/* ── Session Section ── */}
          <SectionLabel icon={<Timer size={12} />} label={t("powerModal.sessionSection")} />

          <div style={{ opacity: disabled ? 0.35 : 1, transition: "opacity var(--duration-fast) var(--ease-out)" }}>
            <div style={{ display: "flex", gap: 6, padding: "6px 0" }}>
              <RadioPill
                label={t("powerModal.indefinite")}
                checked={sessionMode === "indefinite"}
                onChange={() => setSessionMode("indefinite")}
                disabled={disabled}
              />
              <RadioPill
                label={t("powerModal.fixedDuration")}
                checked={sessionMode === "fixed"}
                onChange={() => setSessionMode("fixed")}
                disabled={disabled}
              />
            </div>

            {sessionMode === "fixed" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingTop: 4, paddingBottom: 4 }}>
                {DURATION_PRESETS.map((preset) => {
                  const isActive = sessionDuration === preset.value && !customMinutes;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => { setSessionDuration(preset.value); setCustomMinutes(""); }}
                      disabled={disabled}
                      className={isActive ? "ws-prop-btn ws-prop-btn-accent" : "ws-prop-btn"}
                    >
                      {t(`powerModal.${preset.label}`)}
                    </button>
                  );
                })}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    min={1}
                    placeholder={t("powerModal.durationCustom")}
                    value={customMinutes}
                    onChange={(e) => {
                      setCustomMinutes(e.target.value);
                      const mins = Number(e.target.value);
                      if (mins > 0) setSessionDuration(mins * 60);
                    }}
                    disabled={disabled}
                    className="ws-depth-input"
                    style={{ width: 52 }}
                  />
                  <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{t("powerModal.customMinutes")}</span>
                </span>
              </div>
            )}
          </div>

          {/* ── Live Status ── */}
          {keepAwakeState?.enabled && (
            <>
              <SectionLabel icon={<Zap size={12} />} label={t("powerModal.statusSection")} />

              <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "4px 0 2px",
              }}>
                {/* Status pill */}
                <StatusPill
                  color={statusPaused ? "var(--warning)" : statusActive ? "var(--success)" : "var(--text-3)"}
                  label={
                    statusPaused
                      ? t("powerModal.statusPausedBattery")
                      : statusActive
                        ? t("powerModal.statusActive")
                        : t("powerModal.statusPaused")
                  }
                />

                {/* Power source pill */}
                {keepAwakeState.onAcPower != null && (
                  <StatusPill
                    color={keepAwakeState.onAcPower ? "var(--info)" : "var(--warning)"}
                    label={
                      keepAwakeState.onAcPower
                        ? t("powerModal.statusAc")
                        : `${t("powerModal.statusBattery")} ${keepAwakeState.batteryPercent ?? "?"}%`
                    }
                  />
                )}

                {/* Session timer pill */}
                <StatusPill
                  color="var(--text-3)"
                  label={
                    keepAwakeState.sessionRemainingSecs != null
                      ? t("powerModal.statusRemaining", { time: formatRemaining(keepAwakeState.sessionRemainingSecs) })
                      : t("powerModal.statusIndefinite")
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="ws-footer">
          <div />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-cancel-ghost"
              onClick={handleClose}
            >
              {t("powerModal.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={loading}
            >
              {t("powerModal.save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Sub-components ── */

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      paddingTop: 14,
      paddingBottom: 4,
    }}>
      <span style={{ color: "var(--text-3)", display: "flex" }}>{icon}</span>
      <span className="ws-section-label" style={{ paddingBottom: 0 }}>{label}</span>
    </div>
  );
}

function SettingsRow({
  label,
  description,
  disabled = false,
  children,
}: {
  label: string;
  description: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="ws-prop"
      style={{
        opacity: disabled ? 0.35 : 1,
        transition: "opacity var(--duration-fast) var(--ease-out)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>{description}</div>
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="ws-toggle" style={{ cursor: disabled ? "not-allowed" : undefined }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="ws-toggle-track" />
      <span className="ws-toggle-thumb" />
    </label>
  );
}

function RadioPill({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={checked ? "ws-prop-btn ws-prop-btn-accent" : "ws-prop-btn"}
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {label}
    </button>
  );
}

function StatusPill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 8px",
      borderRadius: "var(--radius-sm)",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.06)",
      fontSize: 10.5,
      fontWeight: 500,
      color: "var(--text-2)",
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }} />
      {label}
    </span>
  );
}
