import { useTranslation } from "react-i18next";
import { AudioLines } from "lucide-react";

export function MeetingsPanel() {
  const { t } = useTranslation(["app"]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-2)",
        padding: 32,
        textAlign: "center",
        gap: 12,
      }}
    >
      <AudioLines size={48} strokeWidth={1.25} style={{ opacity: 0.4 }} />
      <div style={{ fontSize: 18, fontWeight: 500, color: "var(--text-1)" }}>
        {t("app:sidebar.meetings")}
      </div>
      <div style={{ maxWidth: 360, lineHeight: 1.5 }}>
        Meeting recording and transcription is coming together on this branch.
        Nothing to record yet — the setup banner, model catalog, and list view
        land in upcoming commits.
      </div>
    </div>
  );
}
