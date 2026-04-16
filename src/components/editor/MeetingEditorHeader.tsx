import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  Circle,
  FileText,
  Loader2,
  Pause,
  Play,
  Square,
} from "lucide-react";
import type { WhisperModel } from "../../lib/ipc";

export type MeetingLanguage = "auto" | "en" | "pt";
export type MeetingRecorderState = "idle" | "recording" | "paused";
export type MeetingTranscribeState = "idle" | "transcribing";
export type MeetingRecordAction = "start" | "pause" | "resume" | "stop";

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
  availableModels?: WhisperModel[];
  selectedModel?: string | null;
  onModelChange?: (name: string | null) => void;
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
  availableModels,
  selectedModel,
  onModelChange,
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
        {availableModels && availableModels.length > 0 ? (
          <ModelDropdown
            models={availableModels}
            selected={selectedModel ?? null}
            onChange={onModelChange ?? (() => {})}
            disabled={isActiveCapture || isTranscribing}
            autoLabel={t("meetings.modelAuto")}
          />
        ) : null}
        <LanguageToggle
          value={effectiveLanguage}
          onChange={setLanguage}
          disabled={isActiveCapture || isTranscribing}
          autoLabel={t("meetings.languageAuto")}
        />

        {/* Record / Pause / Resume / Stop cluster */}
        {isRecording ? (
          <>
            <ActionButton
              tone="neutral"
              onClick={recordable ? () => onRecordAction("pause") : undefined}
              title={t("meetings.pauseHint")}
              icon={<Pause size={11} fill="currentColor" />}
              label={t("meetings.pause")}
            />
            <ActionButton
              tone="stop"
              onClick={recordable ? () => onRecordAction("stop") : undefined}
              title={t("meetings.stopHint")}
              icon={<Square size={9} fill="currentColor" color="#dc3c3c" />}
              label={`${t("meetings.stop")} · ${formatElapsed(elapsedSeconds)}`}
            />
          </>
        ) : isPaused ? (
          <>
            <ActionButton
              tone="resume"
              onClick={recordable ? () => onRecordAction("resume") : undefined}
              title={t("meetings.resumeHint")}
              icon={<Play size={11} fill="currentColor" />}
              label={t("meetings.resume")}
            />
            <ActionButton
              tone="stop"
              onClick={recordable ? () => onRecordAction("stop") : undefined}
              title={t("meetings.stopHint")}
              icon={<Square size={9} fill="currentColor" color="#dc3c3c" />}
              label={`${t("meetings.stop")} · ${formatElapsed(elapsedSeconds)}`}
            />
          </>
        ) : (
          <>
            <ActionButton
              tone="record"
              onClick={recordable && !isTranscribing ? () => onRecordAction("start") : undefined}
              title={hasAudio ? t("meetings.reRecordHint") : t("meetings.recordHint")}
              icon={<Circle size={10} fill="currentColor" color="#dc3c3c" />}
              label={hasAudio ? t("meetings.reRecord") : t("meetings.record")}
              disabled={!recordable || isTranscribing}
            />
            {isTranscribing ? (
              <ActionButton
                tone="neutral"
                disabled
                icon={<Loader2 size={10} className="animate-spin" />}
                label={t("meetings.transcribing")}
              />
            ) : (
              <ActionButton
                tone="transcribe"
                onClick={canTranscribe ? onTranscribe : undefined}
                title={
                  !hasAudio
                    ? t("meetings.transcribeNoAudio")
                    : t("meetings.transcribeHint")
                }
                icon={<FileText size={11} />}
                label={t("meetings.transcribe")}
                disabled={!canTranscribe}
              />
            )}
          </>
        )}
      </div>
    </div>
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
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        overflow: "hidden",
        fontSize: 11,
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
            padding: "3px 10px",
            border: "none",
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

function ModelDropdown({
  models,
  selected,
  onChange,
  disabled,
  autoLabel,
}: {
  models: WhisperModel[];
  selected: string | null;
  onChange: (name: string | null) => void;
  disabled: boolean;
  autoLabel: string;
}) {
  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      disabled={disabled}
      title={autoLabel}
      style={{
        padding: "3px 8px",
        fontSize: 11,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 4,
        background: "transparent",
        color: "var(--text-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        maxWidth: 160,
      }}
    >
      <option value="">{autoLabel}</option>
      {models.map((m) => (
        <option key={m.name} value={m.name}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}

type ActionTone = "record" | "stop" | "neutral" | "resume" | "transcribe";

function ActionButton({
  tone,
  onClick,
  title,
  icon,
  label,
  disabled,
}: {
  tone: ActionTone;
  onClick?: () => void;
  title?: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  const effectivelyDisabled = disabled || !onClick;
  const background =
    tone === "stop"
      ? "rgba(220, 60, 60, 0.18)"
      : tone === "resume"
        ? "rgba(76, 175, 80, 0.14)"
        : tone === "transcribe"
          ? "rgba(96, 145, 220, 0.14)"
          : tone === "record"
            ? "transparent"
            : "transparent";
  const color =
    tone === "stop" || tone === "resume" || tone === "transcribe"
      ? "var(--text-1)"
      : "var(--text-2)";
  return (
    <button
      type="button"
      onClick={effectivelyDisabled ? undefined : onClick}
      disabled={effectivelyDisabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        minWidth: 88,
        justifyContent: "center",
        background,
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 4,
        color,
        cursor: effectivelyDisabled ? "not-allowed" : "pointer",
        fontSize: 12,
        opacity: effectivelyDisabled ? 0.5 : 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

export function isMeetingFilePath(filePath: string): boolean {
  return filePath.includes("/Panes Meetings/") && filePath.endsWith(".md");
}
