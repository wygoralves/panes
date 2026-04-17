import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  Circle,
  Eye,
  FileText,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Play,
  Speaker,
  Square,
} from "lucide-react";

export type MeetingLanguage = "auto" | "en" | "pt";
export type MeetingRecorderState = "idle" | "recording" | "paused";
export type MeetingTranscribeState = "idle" | "transcribing";
export type MeetingRecordAction = "start" | "pause" | "resume" | "stop";
export type MeetingSources = "mic" | "system" | "both";

interface Props {
  language?: MeetingLanguage;
  onLanguageChange?: (v: MeetingLanguage) => void;
  recorderState?: MeetingRecorderState;
  transcribeState?: MeetingTranscribeState;
  onRecordAction?: (action: MeetingRecordAction) => void;
  onTranscribe?: () => void;
  hasAudio?: boolean;
  title?: string;
  onTitleChange?: (v: string) => void;
  isSaving?: boolean;
  elapsedSeconds?: number;
  sources?: MeetingSources;
  onSourcesChange?: (s: MeetingSources) => void;
  micLevel?: number;
  systemLevel?: number;
  viewMode?: "edit" | "preview";
  onViewModeChange?: (mode: "edit" | "preview") => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MeetingEditorHeader({
  language,
  onLanguageChange,
  recorderState = "idle",
  transcribeState = "idle",
  onRecordAction,
  onTranscribe,
  hasAudio = false,
  title,
  onTitleChange,
  isSaving = false,
  elapsedSeconds = 0,
  sources = "both",
  onSourcesChange,
  micLevel = 0,
  systemLevel = 0,
  viewMode = "edit",
  onViewModeChange,
}: Props = {}) {
  const { t } = useTranslation("app");
  const [fallbackLanguage, setFallbackLanguage] = useState<MeetingLanguage>("auto");
  const effectiveLanguage = language ?? fallbackLanguage;
  const setLanguage = onLanguageChange ?? setFallbackLanguage;

  const isRecording = recorderState === "recording";
  const isPaused = recorderState === "paused";
  const isActiveCapture = isRecording || isPaused;
  const isTranscribing = transcribeState === "transcribing";
  const recordable = typeof onRecordAction === "function";
  const canTranscribe = hasAudio && typeof onTranscribe === "function" && !isActiveCapture;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          flex: 1,
        }}
      >
        <AudioLines size={14} strokeWidth={1.5} style={{ opacity: 0.7, flexShrink: 0 }} />
        <input
          type="text"
          value={title ?? ""}
          onChange={onTitleChange ? (e) => onTitleChange(e.target.value) : undefined}
          placeholder={t("meetings.titlePlaceholder")}
          disabled={isActiveCapture || isTranscribing || !onTitleChange}
          style={{
            minWidth: 0,
            flex: 1,
            padding: "2px 4px",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 3,
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.background = "rgba(255,255,255,0.03)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.background = "transparent";
          }}
        />
        {isSaving ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--text-3)",
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            <Loader2 size={10} className="animate-spin" />
            {t("meetings.saving")}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {onViewModeChange ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              onViewModeChange(viewMode === "edit" ? "preview" : "edit")
            }
            title={
              viewMode === "edit"
                ? t("meetings.viewPreviewHint")
                : t("meetings.viewEditHint")
            }
            aria-label={
              viewMode === "edit"
                ? t("meetings.viewPreview")
                : t("meetings.viewEdit")
            }
            style={{ padding: "6px 8px", minWidth: 0 }}
          >
            {viewMode === "edit" ? <Eye size={13} /> : <Pencil size={13} />}
          </button>
        ) : null}
        <SourcesToggle
          value={sources}
          onChange={onSourcesChange}
          disabled={isActiveCapture || isTranscribing}
          micLabel={t("meetings.sourceMic")}
          systemLabel={t("meetings.sourceSystem")}
          micLevel={isRecording ? micLevel : -1}
          systemLevel={isRecording ? systemLevel : -1}
        />
        <LanguageToggle
          value={effectiveLanguage}
          onChange={setLanguage}
          disabled={isActiveCapture || isTranscribing}
          autoLabel={t("meetings.languageAuto")}
        />

        {isRecording ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={recordable ? () => onRecordAction("pause") : undefined}
              title={t("meetings.pauseHint")}
            >
              <Pause size={11} fill="currentColor" />
              {t("meetings.pause")}
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={recordable ? () => onRecordAction("stop") : undefined}
              title={t("meetings.stopHint")}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <Square size={9} fill="currentColor" />
              {t("meetings.stop")} · {formatElapsed(elapsedSeconds)}
            </button>
          </>
        ) : isPaused ? (
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={recordable ? () => onRecordAction("resume") : undefined}
              title={t("meetings.resumeHint")}
            >
              <Play size={11} fill="currentColor" />
              {t("meetings.resume")}
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={recordable ? () => onRecordAction("stop") : undefined}
              title={t("meetings.stopHint")}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <Square size={9} fill="currentColor" />
              {t("meetings.stop")} · {formatElapsed(elapsedSeconds)}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={
                recordable && !isTranscribing ? () => onRecordAction("start") : undefined
              }
              disabled={!recordable || isTranscribing}
              title={hasAudio ? t("meetings.reRecordHint") : t("meetings.recordHint")}
            >
              <Circle size={10} fill="#dc3c3c" strokeWidth={0} />
              {hasAudio ? t("meetings.reRecord") : t("meetings.record")}
            </button>
            {isTranscribing ? (
              <button type="button" className="btn btn-ghost" disabled>
                <Loader2 size={11} className="animate-spin" />
                {t("meetings.transcribing")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={canTranscribe ? onTranscribe : undefined}
                disabled={!canTranscribe}
                title={
                  !hasAudio
                    ? t("meetings.transcribeNoAudio")
                    : t("meetings.transcribeHint")
                }
              >
                <FileText size={11} />
                {t("meetings.transcribe")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SourcesToggle({
  value,
  onChange,
  disabled = false,
  micLabel,
  systemLabel,
  micLevel,
  systemLevel,
}: {
  value: MeetingSources;
  onChange?: (v: MeetingSources) => void;
  disabled?: boolean;
  micLabel: string;
  systemLabel: string;
  micLevel: number;
  systemLevel: number;
}) {
  const micOn = value === "mic" || value === "both";
  const systemOn = value === "system" || value === "both";

  function toggleMic() {
    if (!onChange) return;
    if (micOn && !systemOn) return; // at least one source required
    onChange(systemOn ? (micOn ? "system" : "both") : "mic");
  }
  function toggleSystem() {
    if (!onChange) return;
    if (systemOn && !micOn) return; // at least one source required
    onChange(micOn ? (systemOn ? "mic" : "both") : "system");
  }

  const cellStyle = (active: boolean, interactive: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 27,
    padding: "0 10px",
    border: "none",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-3)",
    cursor: interactive ? "pointer" : "not-allowed",
    fontSize: 12,
    fontWeight: active ? 500 : 400,
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        opacity: disabled || !onChange ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        onClick={disabled ? undefined : toggleMic}
        disabled={disabled || !onChange}
        title={micLabel}
        style={cellStyle(micOn, !disabled && !!onChange)}
      >
        <Mic size={11} />
        {micLabel}
        <LevelDot level={micLevel} active={micOn} />
      </button>
      <button
        type="button"
        onClick={disabled ? undefined : toggleSystem}
        disabled={disabled || !onChange}
        title={systemLabel}
        style={cellStyle(systemOn, !disabled && !!onChange)}
      >
        <Speaker size={11} />
        {systemLabel}
        <LevelDot level={systemLevel} active={systemOn} />
      </button>
    </div>
  );
}

/// Tiny colored dot showing whether the source is currently picking up
/// signal. -1 means "not recording"; 0 means "recording but silent"; >0
/// is mean |amplitude| in [0, 1]. Threshold 0.001 matches the silent-tap
/// floor used in capture validation, so any plausible voice/music lights
/// the dot green.
function LevelDot({ level, active }: { level: number; active: boolean }) {
  if (level < 0 || !active) return null;
  const live = level > 0.001;
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        marginLeft: 2,
        background: live ? "#4cc56a" : "rgba(255,255,255,0.18)",
        boxShadow: live ? "0 0 6px rgba(76,197,106,0.65)" : "none",
        transition: "background 0.2s ease, box-shadow 0.2s ease",
      }}
    />
  );
}

function LanguageToggle({
  value,
  onChange,
  disabled = false,
  autoLabel,
}: {
  value: MeetingLanguage;
  onChange: (v: MeetingLanguage) => void;
  disabled?: boolean;
  autoLabel: string;
}) {
  const options: { value: MeetingLanguage; label: string }[] = [
    { value: "auto", label: autoLabel },
    { value: "en", label: "EN" },
    { value: "pt", label: "PT" },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={disabled ? undefined : () => onChange(opt.value)}
          disabled={disabled}
          style={{
            height: 27,
            padding: "0 10px",
            border: "none",
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            background:
              value === opt.value ? "rgba(255,255,255,0.08)" : "transparent",
            color: value === opt.value ? "var(--text-1)" : "var(--text-3)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: value === opt.value ? 500 : 400,
            letterSpacing: opt.value === "auto" ? 0 : 0.4,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function isMeetingFilePath(filePath: string): boolean {
  return filePath.includes("/Panes Meetings/") && filePath.endsWith(".md");
}
