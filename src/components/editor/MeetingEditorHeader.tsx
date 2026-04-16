import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Circle, Globe } from "lucide-react";

type MeetingLanguage = "en" | "pt";

export function MeetingEditorHeader() {
  const { t } = useTranslation("app");
  const [language, setLanguage] = useState<MeetingLanguage>("en");

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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AudioLines size={14} strokeWidth={1.5} style={{ opacity: 0.7 }} />
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
          {t("meetings.editorLabel")}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LanguageToggle value={language} onChange={setLanguage} />
        <button
          type="button"
          disabled
          title={t("meetings.recordingComingSoon")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "var(--text-3)",
            cursor: "not-allowed",
            fontSize: 12,
            opacity: 0.6,
          }}
        >
          <Circle size={10} fill="currentColor" />
          {t("meetings.record")}
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
