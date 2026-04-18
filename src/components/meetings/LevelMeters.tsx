import { useTranslation } from "react-i18next";
import { Mic, Speaker } from "lucide-react";

const GAIN = 420;

interface Props {
  micOn: boolean;
  systemOn: boolean;
  micLevel: number;
  systemLevel: number;
  recording: boolean;
}

function fillPct(level: number): number {
  return Math.min(100, Math.max(0, level * GAIN));
}

export function LevelMeters({
  micOn,
  systemOn,
  micLevel,
  systemLevel,
  recording,
}: Props) {
  const { t } = useTranslation("app");
  return (
    <div className="mr-levels">
      <LevelCell
        label={t("meetings.sourceMic")}
        icon={<Mic size={10} strokeWidth={1.75} />}
        enabled={micOn}
        level={micLevel}
        recording={recording}
      />
      <LevelCell
        label={t("meetings.sourceSystem")}
        icon={<Speaker size={10} strokeWidth={1.75} />}
        enabled={systemOn}
        level={systemLevel}
        recording={recording}
      />
    </div>
  );
}

function LevelCell({
  label,
  icon,
  enabled,
  level,
  recording,
}: {
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  level: number;
  recording: boolean;
}) {
  const classes = ["mr-level-cell"];
  if (!enabled) classes.push("mr-level-muted");
  return (
    <div className={classes.join(" ")}>
      <div className="mr-level-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mr-level-track">
        <div
          className="mr-level-fill"
          style={{ width: `${enabled && recording ? fillPct(level) : 0}%` }}
        />
      </div>
    </div>
  );
}
