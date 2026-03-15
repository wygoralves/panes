import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
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

  return (
    <div className="confirm-dialog-backdrop" onMouseDown={handleClose}>
      <div
        className="confirm-dialog-card"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 420, maxHeight: "80vh", overflow: "auto" }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("powerModal.title")}</span>
          <button
            type="button"
            onClick={handleClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-secondary)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Keep Awake main toggle */}
        <ToggleRow
          label={t("powerModal.keepAwake")}
          description={t("powerModal.keepAwakeDescription")}
          checked={keepAwakeEnabled}
          onChange={setKeepAwakeEnabled}
        />

        {/* Display Section */}
        <SectionDivider label={t("powerModal.displaySection")} />

        <ToggleRow
          label={t("powerModal.preventDisplaySleep")}
          description={t("powerModal.preventDisplaySleepDescription")}
          checked={preventDisplaySleep}
          onChange={setPreventDisplaySleep}
          disabled={disabled}
        />
        <ToggleRow
          label={t("powerModal.preventScreenSaver")}
          description={t("powerModal.preventScreenSaverDescription")}
          checked={preventScreenSaver}
          onChange={setPreventScreenSaver}
          disabled={disabled}
        />
        {isMacOrLinux && (
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2, marginBottom: 8, paddingLeft: 4 }}>
            {t("powerModal.displayLinkedNote")}
          </div>
        )}

        {/* Power Source Section */}
        <SectionDivider label={t("powerModal.powerSourceSection")} />

        <ToggleRow
          label={t("powerModal.acOnlyMode")}
          description={t("powerModal.acOnlyModeDescription")}
          checked={acOnlyMode}
          onChange={setAcOnlyMode}
          disabled={disabled}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", opacity: disabled ? 0.5 : 1 }}>
          <input
            type="checkbox"
            checked={batteryThresholdEnabled}
            onChange={(e) => setBatteryThresholdEnabled(e.target.checked)}
            disabled={disabled}
            style={{ margin: 0 }}
          />
          <span style={{ fontSize: 13 }}>{t("powerModal.batteryThreshold")}</span>
          {batteryThresholdEnabled && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
              <input
                type="number"
                min={1}
                max={99}
                value={batteryThreshold}
                onChange={(e) => setBatteryThreshold(Math.max(1, Math.min(99, Number(e.target.value))))}
                disabled={disabled}
                style={{
                  width: 48,
                  padding: "2px 4px",
                  fontSize: 13,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 4,
                  color: "var(--text-primary)",
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: 13 }}>%</span>
            </span>
          )}
        </div>

        {/* Session Section */}
        <SectionDivider label={t("powerModal.sessionSection")} />

        <div style={{ padding: "4px 4px", opacity: disabled ? 0.5 : 1 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0", cursor: disabled ? "default" : "pointer" }}>
            <input
              type="radio"
              name="session-mode"
              checked={sessionMode === "indefinite"}
              onChange={() => setSessionMode("indefinite")}
              disabled={disabled}
              style={{ margin: 0 }}
            />
            {t("powerModal.indefinite")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0", cursor: disabled ? "default" : "pointer" }}>
            <input
              type="radio"
              name="session-mode"
              checked={sessionMode === "fixed"}
              onChange={() => setSessionMode("fixed")}
              disabled={disabled}
              style={{ margin: 0 }}
            />
            {t("powerModal.fixedDuration")}
          </label>

          {sessionMode === "fixed" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, paddingLeft: 22 }}>
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => { setSessionDuration(preset.value); setCustomMinutes(""); }}
                  disabled={disabled}
                  style={{
                    padding: "3px 10px",
                    fontSize: 12,
                    borderRadius: 4,
                    border: "1px solid var(--border-subtle)",
                    background: sessionDuration === preset.value && !customMinutes ? "var(--accent)" : "var(--bg-secondary)",
                    color: sessionDuration === preset.value && !customMinutes ? "white" : "var(--text-primary)",
                    cursor: disabled ? "default" : "pointer",
                  }}
                >
                  {t(`powerModal.${preset.label}`)}
                </button>
              ))}
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
                  style={{
                    width: 60,
                    padding: "2px 4px",
                    fontSize: 12,
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 4,
                    color: "var(--text-primary)",
                    textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{t("powerModal.customMinutes")}</span>
              </span>
            </div>
          )}
        </div>

        {/* Status Section (only shown when enabled and active) */}
        {keepAwakeState?.enabled && (
          <>
            <SectionDivider label={t("powerModal.statusSection")} />
            <div style={{ padding: "4px 4px", fontSize: 12, color: "var(--text-secondary)" }}>
              {keepAwakeState.onAcPower != null && (
                <div style={{ padding: "2px 0" }}>
                  {t("powerModal.statusPower")}: {keepAwakeState.onAcPower ? t("powerModal.statusAc") : `${t("powerModal.statusBattery")} ${keepAwakeState.batteryPercent ?? "?"}%`}
                </div>
              )}
              <div style={{ padding: "2px 0" }}>
                {t("powerModal.statusSession")}: {keepAwakeState.sessionRemainingSecs != null
                  ? t("powerModal.statusRemaining", { time: formatRemaining(keepAwakeState.sessionRemainingSecs) })
                  : t("powerModal.statusIndefinite")}
              </div>
              <div style={{ padding: "2px 0" }}>
                {keepAwakeState.pausedDueToBattery
                  ? t("powerModal.statusPausedBattery")
                  : keepAwakeState.active
                    ? t("powerModal.statusActive")
                    : t("powerModal.statusPaused")}
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClose}
            style={{ padding: "5px 16px", fontSize: 13 }}
          >
            {t("powerModal.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSave()}
            disabled={loading}
            style={{ padding: "5px 16px", fontSize: 13 }}
          >
            {t("powerModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-tertiary)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      padding: "12px 0 4px",
      borderTop: "1px solid var(--border-subtle)",
      marginTop: 8,
    }}>
      {label}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        padding: "6px 4px",
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left",
        color: "var(--text-primary)",
      }}
    >
      <div>
        <div style={{ fontSize: 13 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>{description}</div>
      </div>
      <span
        style={{
          width: 28,
          height: 16,
          borderRadius: 8,
          background: checked ? "var(--accent)" : "rgba(255,255,255,0.12)",
          display: "flex",
          alignItems: "center",
          padding: "0 2px",
          flexShrink: 0,
          transition: "background 0.2s",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "white",
            transform: checked ? "translateX(12px)" : "translateX(0)",
            transition: "transform 0.2s",
            opacity: checked ? 1 : 0.6,
          }}
        />
      </span>
    </button>
  );
}
