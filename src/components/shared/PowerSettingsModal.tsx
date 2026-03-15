import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Zap,
  Monitor,
  BatteryCharging,
  Timer,
  Plug,
  ShieldOff,
  Clock,
  Infinity as InfinityIcon,
  MonitorDown,
  Download,
  Check as CheckIcon,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useKeepAwakeStore } from "../../stores/keepAwakeStore";
import type { KeepAwakeState, PowerSettingsInput } from "../../types";

const DURATION_PRESETS = [
  { label: "duration30m", value: 1800, icon: <Clock size={11} /> },
  { label: "duration1h", value: 3600, icon: <Clock size={11} /> },
  { label: "duration2h", value: 7200, icon: <Clock size={11} /> },
] as const;

const DEFAULT_SESSION_DURATION_SECS = 3600;
const DEFAULT_BATTERY_THRESHOLD = 20;

type SessionMode = "indefinite" | "fixed";

interface SessionState {
  sessionMode: SessionMode;
  sessionDuration: number;
  customHours: string;
  customMinutes: string;
}

function isPresetDuration(durationSecs: number) {
  return DURATION_PRESETS.some((preset) => preset.value === durationSecs);
}

/** True when either custom field has a non-empty value. */
function hasCustomTime(customHours: string, customMinutes: string) {
  return customHours.trim() !== "" || customMinutes.trim() !== "";
}

/** Convert separate h/m strings to total seconds. Returns null if both are empty. */
export function customTimeToSecs(customHours: string, customMinutes: string): number | null {
  const h = Number(customHours.trim() || "0");
  const m = Number(customMinutes.trim() || "0");
  if ((!Number.isFinite(h) || h < 0) && (!Number.isFinite(m) || m < 0)) return null;
  const totalSecs = Math.round((Math.max(0, h) * 3600) + (Math.max(0, m) * 60));
  return totalSecs > 0 ? totalSecs : null;
}

/** Decompose seconds into hours + minutes strings for the custom inputs. */
export function secsToCustomTime(secs: number): { customHours: string; customMinutes: string } {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return {
    customHours: h > 0 ? String(h) : "",
    customMinutes: m > 0 ? String(m) : "",
  };
}

export function deriveSessionState(sessionDurationSecs: number | null | undefined): SessionState {
  if (sessionDurationSecs == null) {
    return {
      sessionMode: "indefinite",
      sessionDuration: DEFAULT_SESSION_DURATION_SECS,
      customHours: "",
      customMinutes: "",
    };
  }

  if (isPresetDuration(sessionDurationSecs)) {
    return {
      sessionMode: "fixed",
      sessionDuration: sessionDurationSecs,
      customHours: "",
      customMinutes: "",
    };
  }

  const { customHours, customMinutes } = secsToCustomTime(sessionDurationSecs);
  return {
    sessionMode: "fixed",
    sessionDuration: sessionDurationSecs,
    customHours,
    customMinutes,
  };
}

export function normalizeFixedSessionState(
  sessionDuration: number,
  customHours: string,
  customMinutes: string,
): SessionState {
  if (hasCustomTime(customHours, customMinutes)) {
    return {
      sessionMode: "fixed",
      sessionDuration,
      customHours,
      customMinutes,
    };
  }

  if (isPresetDuration(sessionDuration)) {
    return {
      sessionMode: "fixed",
      sessionDuration,
      customHours: "",
      customMinutes: "",
    };
  }

  return {
    sessionMode: "fixed",
    sessionDuration: DEFAULT_SESSION_DURATION_SECS,
    customHours: "",
    customMinutes: "",
  };
}

export function applyCustomTimeInput(
  hours: string,
  minutes: string,
  currentSessionDuration: number,
): Pick<SessionState, "sessionDuration" | "customHours" | "customMinutes"> {
  const totalSecs = customTimeToSecs(hours, minutes);
  if (totalSecs != null) {
    return {
      sessionDuration: totalSecs,
      customHours: hours,
      customMinutes: minutes,
    };
  }

  const fallback = normalizeFixedSessionState(currentSessionDuration, "", "");
  return {
    sessionDuration: fallback.sessionDuration,
    customHours: "",
    customMinutes: "",
  };
}

export function getPrimaryStatusKey(
  state: Pick<KeepAwakeState, "active" | "pausedDueToBattery" | "onAcPower">,
) {
  if (state.active) {
    return "powerModal.statusActive";
  }
  if (state.pausedDueToBattery && state.onAcPower !== true) {
    return "powerModal.statusPausedBattery";
  }
  return "powerModal.statusPaused";
}

export function getStatusMessage(
  state: Pick<KeepAwakeState, "active" | "message">,
) {
  if (state.active) {
    return null;
  }
  const message = state.message?.trim();
  return message ? message : null;
}

function formatRemaining(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function resetPowerSettingsForm(
  setKeepAwakeEnabled: (value: boolean) => void,
  setPreventDisplaySleep: (value: boolean) => void,
  setPreventScreenSaver: (value: boolean) => void,
  setAcOnlyMode: (value: boolean) => void,
  setBatteryThresholdEnabled: (value: boolean) => void,
  setBatteryThreshold: (value: number) => void,
  setSessionMode: (value: SessionMode) => void,
  setSessionDuration: (value: number) => void,
  setCustomHours: (value: string) => void,
  setCustomMinutes: (value: string) => void,
  setPreventClosedDisplaySleep: (value: boolean) => void,
) {
  setKeepAwakeEnabled(false);
  setPreventDisplaySleep(false);
  setPreventScreenSaver(false);
  setAcOnlyMode(false);
  setBatteryThresholdEnabled(false);
  setBatteryThreshold(DEFAULT_BATTERY_THRESHOLD);
  setSessionMode("indefinite");
  setSessionDuration(DEFAULT_SESSION_DURATION_SECS);
  setCustomHours("");
  setCustomMinutes("");
  setPreventClosedDisplaySleep(false);
}

export function PowerSettingsModal() {
  const { t } = useTranslation("app");
  const open = useKeepAwakeStore((s) => s.powerSettingsOpen);
  const close = useKeepAwakeStore((s) => s.closePowerSettings);
  const loadPowerSettings = useKeepAwakeStore((s) => s.loadPowerSettings);
  const savePowerSettings = useKeepAwakeStore((s) => s.savePowerSettings);
  const keepAwakeState = useKeepAwakeStore((s) => s.state);
  const loading = useKeepAwakeStore((s) => s.loading);
  const powerSettingsLoading = useKeepAwakeStore((s) => s.powerSettingsLoading);
  const powerSettingsLoaded = useKeepAwakeStore((s) => s.powerSettingsLoaded);
  const helperStatus = useKeepAwakeStore((s) => s.helperStatus);
  const helperLoading = useKeepAwakeStore((s) => s.helperLoading);
  const loadHelperStatus = useKeepAwakeStore((s) => s.loadHelperStatus);
  const registerHelper = useKeepAwakeStore((s) => s.registerHelper);

  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false);
  const [preventDisplaySleep, setPreventDisplaySleep] = useState(false);
  const [preventScreenSaver, setPreventScreenSaver] = useState(false);
  const [acOnlyMode, setAcOnlyMode] = useState(false);
  const [batteryThresholdEnabled, setBatteryThresholdEnabled] = useState(false);
  const [batteryThreshold, setBatteryThreshold] = useState(20);
  const [sessionMode, setSessionMode] = useState<SessionMode>("indefinite");
  const [sessionDuration, setSessionDuration] = useState(DEFAULT_SESSION_DURATION_SECS);
  const [customHours, setCustomHours] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");
  const [preventClosedDisplaySleep, setPreventClosedDisplaySleep] = useState(false);
  const isMacOS = navigator.platform.startsWith("Mac");

  useEffect(() => {
    if (!open) return;
    resetPowerSettingsForm(
      setKeepAwakeEnabled,
      setPreventDisplaySleep,
      setPreventScreenSaver,
      setAcOnlyMode,
      setBatteryThresholdEnabled,
      setBatteryThreshold,
      setSessionMode,
      setSessionDuration,
      setCustomHours,
      setCustomMinutes,
      setPreventClosedDisplaySleep,
    );
    let cancelled = false;
    void loadPowerSettings().then((settings) => {
      if (cancelled || !settings) return;
      setKeepAwakeEnabled(settings.keepAwakeEnabled);
      setPreventDisplaySleep(settings.preventDisplaySleep);
      setPreventScreenSaver(settings.preventScreenSaver);
      setAcOnlyMode(settings.acOnlyMode);
      setBatteryThresholdEnabled(settings.batteryThreshold != null);
      setBatteryThreshold(settings.batteryThreshold ?? DEFAULT_BATTERY_THRESHOLD);
      const nextSessionState = deriveSessionState(settings.sessionDurationSecs);
      setSessionMode(nextSessionState.sessionMode);
      setSessionDuration(nextSessionState.sessionDuration);
      setCustomHours(nextSessionState.customHours);
      setCustomMinutes(nextSessionState.customMinutes);
      setPreventClosedDisplaySleep(settings.preventClosedDisplaySleep);
      if (isMacOS && settings.preventClosedDisplaySleep) {
        void loadHelperStatus();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, loadPowerSettings, loadHelperStatus]);

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
    if (powerSettingsLoading || !powerSettingsLoaded) {
      return;
    }
    const input: PowerSettingsInput = {
      keepAwakeEnabled,
      preventDisplaySleep,
      preventScreenSaver,
      acOnlyMode,
      batteryThreshold: batteryThresholdEnabled ? batteryThreshold : null,
      sessionDurationSecs: sessionMode === "fixed" ? sessionDuration : null,
      preventClosedDisplaySleep,
    };
    const result = await savePowerSettings(input);
    if (result) handleClose();
  };

  const formLocked = powerSettingsLoading || !powerSettingsLoaded;
  const disabled = formLocked || !keepAwakeEnabled;
  const isMacOrLinux = navigator.platform.startsWith("Mac") || navigator.platform.startsWith("Linux");

  const statusActive = keepAwakeState?.enabled && keepAwakeState?.active;
  const statusPaused = keepAwakeState?.enabled && keepAwakeState?.pausedDueToBattery;
  const primaryStatusKey = keepAwakeState
    ? getPrimaryStatusKey(keepAwakeState)
    : "powerModal.statusPaused";
  const statusMessage = keepAwakeState ? getStatusMessage(keepAwakeState) : null;

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
        style={{ width: "min(580px, calc(100vw - 48px))", maxHeight: "calc(100vh - 60px)" }}
      >
        {/* ── Header ── */}
        <div className="ws-header" style={{ padding: "20px 24px 0" }}>
          <div className="ws-header-icon" style={{ width: 40, height: 40, borderRadius: 12 }}>
            <Zap size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="ws-header-title" style={{ fontSize: 15 }}>{t("powerModal.title")}</h2>
            <div className="ws-header-path" style={{ marginTop: 2 }}>
              {t("powerModal.keepAwakeDescription")}
            </div>
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

        <div className="ws-divider" style={{ margin: "14px 24px 0" }} />

        {/* ── Scrollable Body ── */}
        <div className="ws-body" style={{ padding: "16px 24px 24px" }}>

          {/* ── Main Toggle — hero card ── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderRadius: "var(--radius-md)",
            background: keepAwakeEnabled
              ? "rgba(255, 107, 107, 0.06)"
              : "rgba(255, 255, 255, 0.03)",
            border: keepAwakeEnabled
              ? "1px solid rgba(255, 107, 107, 0.14)"
              : "1px solid rgba(255, 255, 255, 0.06)",
            transition: "all var(--duration-normal) var(--ease-out)",
            marginBottom: 6,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Zap
                size={16}
                style={{
                  color: keepAwakeEnabled ? "var(--accent)" : "var(--text-3)",
                  transition: "color var(--duration-normal) var(--ease-out)",
                }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                  {t("powerModal.keepAwake")}
                </div>
              </div>
            </div>
            <ToggleSwitch
              checked={keepAwakeEnabled}
              onChange={setKeepAwakeEnabled}
              disabled={formLocked}
            />
          </div>

          {/* ── Display Section ── */}
          <SectionLabel icon={<Monitor size={12} />} label={t("powerModal.displaySection")} />

          <SettingsCard disabled={disabled}>
            <SettingsRow
              label={t("powerModal.preventDisplaySleep")}
              description={t("powerModal.preventDisplaySleepDescription")}
            >
              <ToggleSwitch
                checked={preventDisplaySleep}
                onChange={setPreventDisplaySleep}
                disabled={disabled}
              />
            </SettingsRow>

            <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "0 -2px" }} />

            <SettingsRow
              label={t("powerModal.preventScreenSaver")}
              description={t("powerModal.preventScreenSaverDescription")}
            >
              <ToggleSwitch
                checked={preventScreenSaver}
                onChange={setPreventScreenSaver}
                disabled={disabled}
              />
            </SettingsRow>
          </SettingsCard>

          {isMacOrLinux && (
            <div style={{
              fontSize: 10,
              color: "var(--text-3)",
              padding: "4px 2px 0",
              fontStyle: "italic",
              opacity: 0.7,
            }}>
              {t("powerModal.displayLinkedNote")}
            </div>
          )}

          {/* ── Power Source Section ── */}
          <SectionLabel icon={<BatteryCharging size={12} />} label={t("powerModal.powerSourceSection")} />

          <SettingsCard disabled={disabled}>
            <SettingsRow
              label={t("powerModal.acOnlyMode")}
              description={t("powerModal.acOnlyModeDescription")}
              icon={<Plug size={13} style={{ color: "var(--text-3)", opacity: 0.6 }} />}
            >
              <ToggleSwitch
                checked={acOnlyMode}
                onChange={setAcOnlyMode}
                disabled={disabled}
              />
            </SettingsRow>

            <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "0 -2px" }} />

            <SettingsRow
              label={t("powerModal.batteryThreshold")}
              description={t("powerModal.batteryThresholdDescription")}
              icon={<ShieldOff size={13} style={{ color: "var(--text-3)", opacity: 0.6 }} />}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {batteryThresholdEnabled && (
                  <span style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    animation: "fade-in var(--duration-fast) var(--ease-out)",
                  }}>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={batteryThreshold}
                      onChange={(e) => setBatteryThreshold(Math.max(1, Math.min(99, Number(e.target.value))))}
                      disabled={disabled}
                      className="ws-depth-input"
                    />
                    <span style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 500 }}>%</span>
                  </span>
                )}
                <ToggleSwitch
                  checked={batteryThresholdEnabled}
                  onChange={setBatteryThresholdEnabled}
                  disabled={disabled}
                />
              </div>
            </SettingsRow>
          </SettingsCard>

          {/* ── Advanced (macOS lid-close) ── */}
          {isMacOS && (
            <>
              <SectionLabel icon={<MonitorDown size={12} />} label={t("powerModal.closedDisplaySection")} />

              <SettingsCard disabled={disabled}>
                <SettingsRow
                  label={t("powerModal.preventClosedDisplaySleep")}
                  description={t("powerModal.preventClosedDisplaySleepDescription")}
                >
                  <ToggleSwitch
                    checked={preventClosedDisplaySleep}
                    onChange={(value) => {
                      setPreventClosedDisplaySleep(value);
                      if (value && !helperStatus) {
                        void loadHelperStatus();
                      }
                    }}
                    disabled={disabled}
                  />
                </SettingsRow>
              </SettingsCard>

              {preventClosedDisplaySleep && keepAwakeEnabled && !formLocked && (
                <div style={{
                  marginTop: 6,
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  animation: "fade-in var(--duration-fast) var(--ease-out)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {helperStatus?.status === "registered" && (
                      <>
                        <CheckIcon size={13} style={{ color: "var(--success)", flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                          {t("powerModal.helperInstalled")}
                        </span>
                      </>
                    )}
                    {helperStatus?.status === "requiresApproval" && (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <AlertTriangle size={13} style={{ color: "var(--warning)", flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, color: "var(--warning)" }}>
                            {t("powerModal.helperPendingApproval")}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6, paddingLeft: 21 }}>
                          {t("powerModal.helperApprovalNote")}
                        </div>
                      </div>
                    )}
                    {helperStatus?.status === "notRegistered" && (
                      <>
                        <Download size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: "var(--text-3)", flex: 1 }}>
                          {t("powerModal.helperNotInstalled")}
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: 11, padding: "4px 12px" }}
                          disabled={helperLoading}
                          onClick={() => void registerHelper()}
                        >
                          {helperLoading
                            ? t("powerModal.helperInstallingButton")
                            : t("powerModal.helperInstallButton")}
                        </button>
                      </>
                    )}
                    {helperStatus?.status === "notFound" && (
                      <>
                        <AlertTriangle size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {t("powerModal.helperPasswordFallback")}
                        </span>
                      </>
                    )}
                    {!helperStatus && helperLoading && (
                      <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>...</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Session Section ── */}
          <SectionLabel icon={<Timer size={12} />} label={t("powerModal.sessionSection")} />

          <SettingsCard disabled={disabled}>
            <div style={{ padding: "8px 2px" }}>
              {/* Mode selector pills */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <RadioPill
                  label={t("powerModal.indefinite")}
                  checked={sessionMode === "indefinite"}
                  onChange={() => {
                    setSessionMode("indefinite");
                    setCustomHours("");
                    setCustomMinutes("");
                  }}
                  disabled={disabled}
                  icon={<InfinityIcon size={12} />}
                />
                <RadioPill
                  label={t("powerModal.fixedDuration")}
                  checked={sessionMode === "fixed"}
                  onChange={() => {
                    const nextSessionState = normalizeFixedSessionState(sessionDuration, customHours, customMinutes);
                    setSessionMode(nextSessionState.sessionMode);
                    setSessionDuration(nextSessionState.sessionDuration);
                    setCustomHours(nextSessionState.customHours);
                    setCustomMinutes(nextSessionState.customMinutes);
                  }}
                  disabled={disabled}
                  icon={<Timer size={12} />}
                />
              </div>

              {/* Duration presets */}
              {sessionMode === "fixed" && (
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  animation: "fade-in var(--duration-fast) var(--ease-out)",
                }}>
                  {DURATION_PRESETS.map((preset) => {
                    const isCustom = hasCustomTime(customHours, customMinutes);
                    const isActive = sessionDuration === preset.value && !isCustom;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => { setSessionDuration(preset.value); setCustomHours(""); setCustomMinutes(""); }}
                        disabled={disabled}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "5px 12px",
                          fontSize: 11,
                          fontWeight: 500,
                          borderRadius: "var(--radius-sm)",
                          border: isActive
                            ? "1px solid rgba(255, 107, 107, 0.25)"
                            : "1px solid rgba(255, 255, 255, 0.08)",
                          background: isActive
                            ? "rgba(255, 107, 107, 0.10)"
                            : "rgba(255, 255, 255, 0.03)",
                          color: isActive ? "var(--accent)" : "var(--text-2)",
                          cursor: disabled ? "not-allowed" : "pointer",
                          transition: "all var(--duration-fast) var(--ease-out)",
                        }}
                      >
                        {preset.icon}
                        {t(`powerModal.${preset.label}`)}
                      </button>
                    );
                  })}

                  {/* Custom hours + minutes input */}
                  {(() => {
                    const isCustomActive = hasCustomTime(customHours, customMinutes);
                    const customBorder = isCustomActive
                      ? "1px solid rgba(255, 107, 107, 0.25)"
                      : "1px solid rgba(255, 255, 255, 0.08)";
                    const customBg = isCustomActive
                      ? "rgba(255, 107, 107, 0.10)"
                      : "rgba(255, 255, 255, 0.03)";
                    const inputColor = isCustomActive ? "var(--accent)" : "var(--text-2)";
                    const inputStyle = {
                      width: 32,
                      padding: "5px 2px",
                      fontSize: 11,
                      fontWeight: 500 as const,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: inputColor,
                      textAlign: "center" as const,
                      fontFamily: "inherit",
                    };
                    const labelStyle = {
                      fontSize: 10,
                      color: "var(--text-3)",
                      fontWeight: 500,
                      whiteSpace: "nowrap" as const,
                    };
                    const applyCustom = (h: string, m: string) => {
                      const next = applyCustomTimeInput(h, m, sessionDuration);
                      setCustomHours(next.customHours);
                      setCustomMinutes(next.customMinutes);
                      setSessionDuration(next.sessionDuration);
                    };
                    return (
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        padding: "0 8px 0 0",
                        borderRadius: "var(--radius-sm)",
                        border: customBorder,
                        background: customBg,
                        transition: "all var(--duration-fast) var(--ease-out)",
                      }}>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          placeholder="0"
                          value={customHours}
                          onChange={(e) => applyCustom(e.target.value, customMinutes)}
                          disabled={disabled}
                          style={inputStyle}
                        />
                        <span style={labelStyle}>{t("powerModal.customHours")}</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          placeholder="0"
                          value={customMinutes}
                          onChange={(e) => applyCustom(customHours, e.target.value)}
                          disabled={disabled}
                          style={inputStyle}
                        />
                        <span style={labelStyle}>{t("powerModal.customMinutesShort")}</span>
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          </SettingsCard>

          {/* ── Live Status ── */}
          {keepAwakeState?.enabled && (
            <>
              <SectionLabel icon={<Zap size={12} />} label={t("powerModal.statusSection")} />

              <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                padding: "6px 0 2px",
              }}>
                <StatusPill
                  color={statusPaused ? "var(--warning)" : statusActive ? "var(--success)" : "var(--text-3)"}
                  label={t(primaryStatusKey)}
                  pulse={statusActive}
                />

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

                <StatusPill
                  color="var(--accent-2)"
                  label={
                    keepAwakeState.sessionRemainingSecs != null
                      ? t("powerModal.statusRemaining", { time: formatRemaining(keepAwakeState.sessionRemainingSecs) })
                      : t("powerModal.statusIndefinite")
                  }
                />
              </div>

              {statusMessage && (
                <div style={{
                  marginTop: 10,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--warning)",
                }}>
                  {statusMessage}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="ws-footer" style={{ padding: "12px 24px" }}>
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
              disabled={loading || formLocked}
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
      paddingTop: 18,
      paddingBottom: 6,
    }}>
      <span style={{ color: "var(--accent)", display: "flex", opacity: 0.7 }}>{icon}</span>
      <span className="ws-section-label" style={{ paddingBottom: 0 }}>{label}</span>
    </div>
  );
}

function SettingsCard({
  disabled = false,
  children,
}: {
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      borderRadius: "var(--radius-md)",
      background: "rgba(255, 255, 255, 0.02)",
      border: "1px solid rgba(255, 255, 255, 0.06)",
      padding: "2px 14px",
      opacity: disabled ? 0.35 : 1,
      transition: "opacity var(--duration-normal) var(--ease-out)",
    }}>
      {children}
    </div>
  );
}

function SettingsRow({
  label,
  description,
  icon,
  children,
}: {
  label: string;
  description: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      minHeight: 44,
      padding: "10px 2px",
      gap: 12,
    }}>
      {icon && <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2, lineHeight: 1.35 }}>
          {description}
        </div>
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
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        fontSize: 11.5,
        fontWeight: 500,
        borderRadius: "var(--radius-sm)",
        border: checked
          ? "1px solid rgba(255, 107, 107, 0.25)"
          : "1px solid rgba(255, 255, 255, 0.10)",
        background: checked
          ? "rgba(255, 107, 107, 0.08)"
          : "transparent",
        color: checked ? "var(--accent)" : "var(--text-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all var(--duration-fast) var(--ease-out)",
      }}
    >
      {icon && <span style={{ display: "flex", opacity: checked ? 1 : 0.5 }}>{icon}</span>}
      {label}
    </button>
  );
}

function StatusPill({
  color,
  label,
  pulse = false,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 10px",
      borderRadius: 99,
      background: "rgba(255, 255, 255, 0.03)",
      border: "1px solid rgba(255, 255, 255, 0.06)",
      fontSize: 10.5,
      fontWeight: 500,
      color: "var(--text-2)",
    }}>
      <span style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: pulse ? `0 0 6px ${color}` : undefined,
        animation: pulse ? "pulse-soft 2s ease-in-out infinite" : undefined,
      }} />
      {label}
    </span>
  );
}
