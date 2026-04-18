import { useTranslation } from "react-i18next";
import { Code, FileText, MessageSquare } from "lucide-react";

export type DocTab = "meeting" | "transcript" | "source";

interface Props {
  active: DocTab;
  onChange: (tab: DocTab) => void;
  transcriptSegments: number | null;
}

export function DocTabs({ active, onChange, transcriptSegments }: Props) {
  const { t } = useTranslation("app");
  return (
    <div className="mr-tab-bar" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={active === "meeting"}
        className={active === "meeting" ? "on" : ""}
        onClick={() => onChange("meeting")}
      >
        <FileText size={12} strokeWidth={1.5} />
        {t("meetings.tabMeeting")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "transcript"}
        className={active === "transcript" ? "on" : ""}
        onClick={() => onChange("transcript")}
      >
        <MessageSquare size={12} strokeWidth={1.5} />
        {t("meetings.tabTranscript")}
        {typeof transcriptSegments === "number" && transcriptSegments > 0 ? (
          <span className="mr-tab-count">{transcriptSegments}</span>
        ) : null}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "source"}
        className={active === "source" ? "on" : ""}
        onClick={() => onChange("source")}
      >
        <Code size={12} strokeWidth={1.5} />
        {t("meetings.tabSource")}
      </button>
      <div className="mr-tab-spacer" />
    </div>
  );
}
