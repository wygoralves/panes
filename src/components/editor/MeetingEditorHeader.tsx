import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Circle, Globe, Loader2, Square } from "lucide-react";

export type MeetingLanguage = "en" | "pt";
export type MeetingRecorderState = "idle" | "recording" | "transcribing";

interface Props {
  language?: MeetingLanguage;
  onLanguageChange?: (v: MeetingLanguage) => void;
  recorderState?: MeetingRecorderState;
  onRecord?: () => void;
  titleHint?: string;
  isSaving?: boolean;
  elapsedSeconds?: number;
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
  onRecord,
  titleHint,
  isSaving = false,
  elapsedSeconds = 0,
}: Props = {}) {
  const { t } = useTranslation("app");
  const [fallbackLanguage, setFallbackLanguage] = useState<MeetingLanguage>("en");
  const effectiveLanguage = language ?? fallbackLanguage;
  const setLanguage = onLanguageChange ?? setFallbackLanguage;
  const recordable = typeof onRecord === "function";
  const isRecording = recorderState === "recording";
  const isTranscribing = recorderState === "transcribing";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
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
        <span
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={titleHint}
        >
          {titleHint ?? t("meetings.editorLabel")}
        </span>
        {isSaving ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--text-3)",
              fontSize: 11,
              marginLeft: 6,
            }}
          >
            <Loader2 size={10} className="animate-spin" />
            {t("meetings.saving")}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <LanguageToggle
          value={effectiveLanguage}
          onChange={setLanguage}
          disabled={isRecording || isTranscribing}
        />
        <button
          type="button"
          onClick={recordable && !isTranscribing ? onRecord : undefined}
          disabled={!recordable || isTranscribing}
          title={
            !recordable
              ? t("meetings.recordingComingSoon")
              : isTranscribing
                ? t("meetings.transcribingHint")
                : isRecording
                  ? t("meetings.stopHint")
                  : t("meetings.recordHint")
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            minWidth: 88,
            justifyContent: "center",
            background: isRecording
              ? "rgba(220, 60, 60, 0.18)"
              : isTranscribing
                ? "rgba(255,255,255,0.04)"
                : "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 4,
            color: isRecording ? "var(--text-1)" : "var(--text-2)",
            cursor: recordable && !isTranscribing ? "pointer" : "not-allowed",
            fontSize: 12,
            opacity: recordable || isRecording ? 1 : 0.6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {isTranscribing ? (
            <>
              <Loader2 size={10} className="animate-spin" />
              {t("meetings.transcribing")}
            </>
          ) : isRecording ? (
            <>
              <Square size={9} fill="currentColor" color="#dc3c3c" />
              {t("meetings.stop")} · {formatElapsed(elapsedSeconds)}
            </>
          ) : (
            <>
              <Circle size={10} fill="currentColor" color={recordable ? "#dc3c3c" : "currentColor"} />
              {t("meetings.record")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function LanguageToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: MeetingLanguage;
  onChange: (v: MeetingLanguage) => void;
  disabled?: boolean;
}) {
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
      <Globe size={11} style={{ opacity: 0.5, margin: "0 6px" }} />
      {(["en", "pt"] as MeetingLanguage[]).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={disabled ? undefined : () => onChange(lang)}
          disabled={disabled}
          style={{
            padding: "3px 10px",
            border: "none",
            background: value === lang ? "rgba(255,255,255,0.08)" : "transparent",
            color: value === lang ? "var(--text-1)" : "var(--text-3)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: value === lang ? 500 : 400,
            textTransform: "uppercase",
          }}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}

export function isMeetingFilePath(filePath: string): boolean {
  return filePath.includes("/Panes Meetings/") && filePath.endsWith(".md");
}
