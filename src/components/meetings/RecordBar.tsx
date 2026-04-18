import { useTranslation } from "react-i18next";
import {
  Circle,
  FileText,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Waveform } from "./Waveform";
import { LevelMeters } from "./LevelMeters";

export type RecordBarState =
  | "ready"        // idle, no audio yet
  | "recording"
  | "paused"
  | "transcribing"
  | "finished";    // idle, has audio

export type RecordAction = "start" | "pause" | "resume" | "stop";

interface Props {
  state: RecordBarState;
  elapsedSeconds: number;
  micEnabled: boolean;
  systemEnabled: boolean;
  micLevel: number;
  systemLevel: number;
  durationLabel?: string | null;
  segmentCount?: number;
  onAction: (action: RecordAction) => void;
  onTranscribe?: () => void;
  canTranscribe: boolean;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordBar({
  state,
  elapsedSeconds,
  micEnabled,
  systemEnabled,
  micLevel,
  systemLevel,
  durationLabel,
  segmentCount,
  onAction,
  onTranscribe,
  canTranscribe,
}: Props) {
  const { t } = useTranslation("app");
  const combinedLevel = Math.max(micEnabled ? micLevel : 0, systemEnabled ? systemLevel : 0);
  const isCapturing = state === "recording" || state === "paused";

  return (
    <div className={`mr-record-bar mr-state-${state}`}>
      {state === "transcribing" ? (
        <TranscribingContent />
      ) : isCapturing ? (
        <>
          <div className="mr-record-main">
            <button
              type="button"
              className="mr-record-primary mr-record-primary-stop"
              onClick={() => onAction("stop")}
              title={t("meetings.stopHint")}
            >
              <span className="mr-rec-dot" />
              {state === "recording"
                ? t("meetings.stop")
                : t("meetings.stopPaused")}
            </button>
            {state === "recording" ? (
              <button
                type="button"
                className="mr-record-icon-btn"
                onClick={() => onAction("pause")}
                title={t("meetings.pauseHint")}
                aria-label={t("meetings.pause")}
              >
                <Pause size={12} fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button
                type="button"
                className="mr-record-icon-btn"
                onClick={() => onAction("resume")}
                title={t("meetings.resumeHint")}
                aria-label={t("meetings.resume")}
              >
                <Play size={12} fill="currentColor" strokeWidth={0} />
              </button>
            )}
            <span className="mr-record-time">{formatElapsed(elapsedSeconds)}</span>
            <Waveform level={combinedLevel} active={state === "recording"} />
            <LevelMeters
              micOn={micEnabled}
              systemOn={systemEnabled}
              micLevel={micLevel}
              systemLevel={systemLevel}
              recording={state === "recording"}
            />
          </div>
        </>
      ) : state === "finished" ? (
        <>
          <div className="mr-record-main">
            <div className="mr-record-finished-label">
              <span className="mr-record-finished-dot" />
              <span className="mr-record-finished-title">
                {t("meetings.transcribed")}
              </span>
              <span className="mr-record-finished-sub">
                {[durationLabel, segmentCountLabel(t, segmentCount)]
                  .filter(Boolean)
                  .map((s) => `· ${s}`)
                  .join(" ")}
              </span>
            </div>
          </div>
          <div className="mr-record-ready-settings">
            <button
              type="button"
              className="mr-record-secondary"
              onClick={onTranscribe}
              disabled={!canTranscribe}
              title={t("meetings.retranscribeHint")}
            >
              <RotateCcw size={11} />
              <span className="mr-label-collapse">{t("meetings.retranscribe")}</span>
            </button>
            <button
              type="button"
              className="mr-record-secondary mr-record-danger-ghost"
              onClick={() => onAction("start")}
              title={t("meetings.reRecordHint")}
            >
              <Circle size={10} strokeWidth={2} />
              <span className="mr-label-collapse">{t("meetings.reRecord")}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mr-record-main">
            <button
              type="button"
              className="mr-record-primary"
              onClick={() => onAction("start")}
              title={t("meetings.recordHint")}
            >
              <span className="mr-rec-dot" />
              {t("meetings.recordMeeting")}
            </button>
            <div className="mr-record-hint">{t("meetings.recordBarHint")}</div>
          </div>
          {onTranscribe && canTranscribe ? (
            <div className="mr-record-ready-settings">
              <button
                type="button"
                className="mr-record-secondary"
                onClick={onTranscribe}
                title={t("meetings.transcribeHint")}
              >
                <FileText size={11} />
                <span className="mr-label-collapse">{t("meetings.transcribe")}</span>
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TranscribingContent() {
  const { t } = useTranslation("app");
  return (
    <div className="mr-record-main">
      <div className="mr-transcribing-line">
        <span className="mr-transcribing-dot" />
        <span className="mr-transcribing-label">
          {t("meetings.transcribingLabel")}
        </span>
        <div className="mr-transcribing-track">
          <div className="mr-transcribing-fill" />
        </div>
      </div>
    </div>
  );
}

function segmentCountLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  count: number | undefined,
): string | null {
  if (typeof count !== "number" || count <= 0) return null;
  return t("meetings.segmentsCount", { count });
}
