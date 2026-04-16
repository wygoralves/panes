import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Circle, Globe, Loader2 } from "lucide-react";

export type MeetingLanguage = "en" | "pt";

interface Props {
  language?: MeetingLanguage;
  onLanguageChange?: (v: MeetingLanguage) => void;
  isRecording?: boolean;
  onRecord?: () => void;
  titleHint?: string;
  isSaving?: boolean;
}

export function MeetingEditorHeader({
  language,
  onLanguageChange,
  isRecording = false,
  onRecord,
  titleHint,
  isSaving = false,
}: Props = {}) {
  const { t } = useTranslation("app");
  const [fallbackLanguage, setFallbackLanguage] = useState<MeetingLanguage>("en");
  const effectiveLanguage = language ?? fallbackLanguage;
  const setLanguage = onLanguageChange ?? setFallbackLanguage;
  const recordable = typeof onRecord === "function";

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
        <LanguageToggle value={effectiveLanguage} onChange={setLanguage} />
        <button
          type="button"
          onClick={recordable && !isRecording ? onRecord : undefined}
          disabled={!recordable || isRecording}
          title={
            recordable
              ? isRecording
                ? t("meetings.recordingInProgress")
                : t("meetings.recordHint")
              : t("meetings.recordingComingSoon")
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: isRecording ? "rgba(220, 60, 60, 0.15)" : "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: isRecording ? "var(--text-1)" : "var(--text-2)",
            cursor: recordable && !isRecording ? "pointer" : "not-allowed",
            fontSize: 12,
            opacity: recordable || isRecording ? 1 : 0.6,
          }}
        >
          {isRecording ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Circle size={10} fill="currentColor" color={recordable ? "#dc3c3c" : "currentColor"} />
          )}
          {isRecording ? t("meetings.recording") : t("meetings.record")}
        </button>
      </div>
    </div>
  );
}

function LanguageToggle({
  value,
  onChange,
}: {
  value: MeetingLanguage;
  onChange: (v: MeetingLanguage) => void;
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
      }}
    >
      <Globe size={11} style={{ opacity: 0.5, margin: "0 6px" }} />
      {(["en", "pt"] as MeetingLanguage[]).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => onChange(lang)}
          style={{
            padding: "3px 10px",
            border: "none",
            background: value === lang ? "rgba(255,255,255,0.08)" : "transparent",
            color: value === lang ? "var(--text-1)" : "var(--text-3)",
            cursor: "pointer",
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
