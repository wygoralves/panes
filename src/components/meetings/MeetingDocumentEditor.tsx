import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  ipc,
  listenWhisperModelDownload,
  type Meeting,
  type WhisperModel,
} from "../../lib/ipc";
import {
  parseFrontmatterValue,
  updateFrontmatterValue,
} from "../../lib/meetingFrontmatter";
import { toast } from "../../stores/toastStore";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { DocHeader, type Language, type Sources } from "./DocHeader";
import { DocTabs, type DocTab } from "./DocTabs";
import { RecordBar, type RecordAction, type RecordBarState } from "./RecordBar";

const AUTOSAVE_DELAY_MS = 1200;
const LEVEL_POLL_MS = 150;

// Fallback priority when no per-meeting model override is set. Keep in sync
// with the catalog in commands/meetings.rs.
const MODEL_PRIORITY = [
  "ggml-large-v3-turbo.bin",
  "ggml-medium.bin",
  "ggml-small.bin",
  "ggml-base.bin",
  "ggml-tiny.bin",
];

type RecorderState = "idle" | "recording" | "paused";
type TranscribeState = "idle" | "transcribing";

interface Props {
  meeting: Meeting;
  onRecorderStateChange?: (state: RecorderState) => void;
  onNewMeeting?: () => void;
  creatingMeeting?: boolean;
}

function dirnameOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i >= 0 ? filePath.substring(0, i) : filePath;
}

function contentWithoutFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s+/, "");
}

function extractSection(body: string, name: string): string {
  const header = `## ${name}`;
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) return "";
  const tail = lines.slice(start + 1);
  const endIdx = tail.findIndex((l) => l.startsWith("## ") || l.startsWith("# "));
  const section = endIdx < 0 ? tail : tail.slice(0, endIdx);
  return section.join("\n").trim();
}

function replaceSection(body: string, name: string, newBody: string): string {
  const header = `## ${name}`;
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) {
    const suffix = body.endsWith("\n") ? "" : "\n";
    return `${body}${suffix}\n${header}\n\n${newBody.trim()}\n`;
  }
  const tail = lines.slice(start + 1);
  const endIdx = tail.findIndex((l) => l.startsWith("## ") || l.startsWith("# "));
  const before = lines.slice(0, start + 1);
  const after = endIdx < 0 ? [] : tail.slice(endIdx);
  const next = [...before, "", newBody.trim(), ""];
  if (after.length) next.push(...after);
  return next.join("\n").replace(/\n{3,}/g, "\n\n");
}

interface TranscriptSegment {
  t: string;
  speaker: string | null;
  text: string;
}

const SPEAKER_LINE_RE =
  /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s+([A-Za-z][\w .-]{0,24}?):\s+(.*)$/;
const TIME_LINE_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s+(.*)$/;

function parseTranscriptSegments(transcriptText: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const line of transcriptText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spk = trimmed.match(SPEAKER_LINE_RE);
    if (spk) {
      out.push({ t: spk[1], speaker: spk[2].trim(), text: spk[3].trim() });
      continue;
    }
    const timed = trimmed.match(TIME_LINE_RE);
    if (timed) {
      out.push({ t: timed[1], speaker: null, text: timed[2].trim() });
    }
  }
  return out;
}

function countTranscriptSegments(transcriptText: string): number {
  const segments = parseTranscriptSegments(transcriptText);
  if (segments.length > 0) return segments.length;
  const trimmed = transcriptText.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\n\s*\n/).filter(Boolean).length || 1;
}

function formatDurationFromSegments(transcriptText: string): string | null {
  const segments = parseTranscriptSegments(transcriptText);
  if (segments.length === 0) return null;
  return segments[segments.length - 1].t;
}

export function MeetingDocumentEditor({
  meeting,
  onRecorderStateChange,
  onNewMeeting,
  creatingMeeting,
}: Props) {
  const { t } = useTranslation("app");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [transcribeState, setTranscribeState] = useState<TranscribeState>("idle");
  const [recordError, setRecordError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>("auto");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [availableModels, setAvailableModels] = useState<WhisperModel[]>([]);
  const [levels, setLevels] = useState<{ mic: number; system: number }>({
    mic: 0,
    system: 0,
  });
  const [tab, setTab] = useState<DocTab>("meeting");
  const modelsListenerRef = useRef<UnlistenFn | null>(null);

  const dir = dirnameOf(meeting.path);

  // ── Frontmatter-derived values ─────────────────────────────────────────
  const title = useMemo(
    () => parseFrontmatterValue(content, "title") ?? "",
    [content],
  );
  const createdAt = useMemo(
    () => parseFrontmatterValue(content, "date"),
    [content],
  );
  const repo = useMemo(() => {
    const value = parseFrontmatterValue(content, "repo");
    return value && value.length > 0 ? value : null;
  }, [content]);
  const hasAudio = useMemo(
    () => !!parseFrontmatterValue(content, "audio"),
    [content],
  );
  const sources = useMemo<Sources>(() => {
    const value = parseFrontmatterValue(content, "sources");
    return value === "mic" || value === "system" || value === "both"
      ? value
      : "both";
  }, [content]);

  const bodyWithoutFm = useMemo(
    () => contentWithoutFrontmatter(content),
    [content],
  );
  const notesText = useMemo(() => extractSection(bodyWithoutFm, "Notes"), [
    bodyWithoutFm,
  ]);
  const transcriptText = useMemo(
    () => extractSection(bodyWithoutFm, "Transcript"),
    [bodyWithoutFm],
  );
  const segmentCount = useMemo(
    () => countTranscriptSegments(transcriptText),
    [transcriptText],
  );
  const durationLabel = useMemo(
    () => formatDurationFromSegments(transcriptText),
    [transcriptText],
  );

  const whenLabel = useMemo(() => {
    const src = createdAt ?? meeting.createdAt ?? meeting.updatedAt;
    if (!src) return "";
    const when = new Date(src);
    if (Number.isNaN(when.getTime())) return "";
    return when.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [createdAt, meeting.createdAt, meeting.updatedAt]);

  // ── Load / autosave ────────────────────────────────────────────────────
  const loadFile = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await ipc.readFile(dir, meeting.path);
      if (result.isBinary) {
        setLoadError("meeting file is unexpectedly binary");
      } else {
        setContent(result.content);
        setSavedContent(result.content);
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [dir, meeting.path]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  useEffect(() => {
    if (isLoading) return;
    const fmLang = parseFrontmatterValue(content, "language");
    if (fmLang === "auto" || fmLang === "en" || fmLang === "pt") {
      setLanguage(fmLang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const refreshModels = useCallback(async () => {
    try {
      const list = await ipc.listWhisperModels();
      setAvailableModels(list.filter((m) => m.downloaded));
    } catch {
      setAvailableModels([]);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
    void (async () => {
      modelsListenerRef.current = await listenWhisperModelDownload((p) => {
        if (p.done) void refreshModels();
      });
    })();
    return () => {
      if (modelsListenerRef.current) modelsListenerRef.current();
    };
  }, [refreshModels]);

  useEffect(() => {
    if (isLoading) return;
    if (content === savedContent) return;
    const handle = window.setTimeout(async () => {
      try {
        setIsSaving(true);
        await ipc.writeFile(dir, meeting.path, content, null);
        setSavedContent(content);
      } catch (e) {
        console.error("meeting autosave failed:", e);
      } finally {
        setIsSaving(false);
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [content, savedContent, isLoading, dir, meeting.path]);

  // ── Recorder timer + level polling ─────────────────────────────────────
  useEffect(() => {
    if (recorderState !== "recording") return;
    const handle = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [recorderState]);
  useEffect(() => {
    if (recorderState === "idle") setElapsedSeconds(0);
  }, [recorderState]);

  useEffect(() => {
    if (recorderState !== "recording") {
      setLevels({ mic: 0, system: 0 });
      return;
    }
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      try {
        const next = await ipc.getRecordingLevels(meeting.path);
        if (!cancelled) setLevels(next);
      } catch {
        // sidecar warming up; keep previous value
      }
    }
    void tick();
    const handle = window.setInterval(() => void tick(), LEVEL_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [recorderState, meeting.path]);

  // Let parent track current recorder state for list-level live-pulse.
  useEffect(() => {
    onRecorderStateChange?.(recorderState);
  }, [recorderState, onRecorderStateChange]);

  // ── Recorder actions ───────────────────────────────────────────────────
  const pickTranscribeModel = useCallback(() => {
    const preferred = parseFrontmatterValue(content, "model");
    if (preferred) {
      const found = availableModels.find((m) => m.name === preferred);
      if (found) return found.name;
    }
    return (
      MODEL_PRIORITY.find((n) => availableModels.some((m) => m.name === n)) ??
      null
    );
  }, [availableModels, content]);

  const runTranscription = useCallback(async () => {
    setRecordError(null);
    setTranscribeState("transcribing");
    try {
      const chosen = pickTranscribeModel();
      if (!chosen) {
        throw new Error(t("meetings.noModelAvailable"));
      }
      const transcript = await ipc.transcribeMeeting(
        meeting.path,
        language === "auto" ? null : language,
        chosen,
      );
      await loadFile();
      for (const warning of transcript.warnings) {
        toast.warning(warning, 10_000);
      }
    } catch (e) {
      setRecordError(String(e));
    } finally {
      setTranscribeState("idle");
    }
  }, [language, loadFile, meeting.path, pickTranscribeModel, t]);

  const onRecordAction = useCallback(
    async (action: RecordAction) => {
      setRecordError(null);
      try {
        switch (action) {
          case "start":
            await ipc.startMeetingRecording(meeting.path, sources);
            setRecorderState("recording");
            break;
          case "pause":
            await ipc.pauseMeetingRecording(meeting.path);
            setRecorderState("paused");
            break;
          case "resume":
            await ipc.resumeMeetingRecording(meeting.path);
            setRecorderState("recording");
            break;
          case "stop":
            await ipc.stopMeetingRecording(meeting.path);
            setRecorderState("idle");
            await loadFile();
            // Stop = finalize. Kick off transcription automatically so the
            // user doesn't need a second click.
            void runTranscription();
            break;
        }
      } catch (e) {
        setRecordError(String(e));
      }
    },
    [meeting.path, loadFile, sources, runTranscription],
  );

  const onTitleChange = useCallback((next: string) => {
    setContent((prev) => updateFrontmatterValue(prev, "title", next));
  }, []);

  const onSourcesChange = useCallback((next: Sources) => {
    setContent((prev) => updateFrontmatterValue(prev, "sources", next));
  }, []);

  const onLanguageChange = useCallback((next: Language) => {
    setLanguage(next);
    setContent((prev) => updateFrontmatterValue(prev, "language", next));
  }, []);

  const onNotesChange = useCallback(
    (next: string) => {
      setContent((prev) => {
        const fmMatch = prev.match(/^(---\n[\s\S]*?\n---\n?)/);
        const fm = fmMatch ? fmMatch[1] : "";
        const bodyRest = fmMatch ? prev.slice(fm.length) : prev;
        const updated = replaceSection(bodyRest, "Notes", next);
        return fm + updated;
      });
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="mr-doc">
        <div className="mr-empty" style={{ gap: 8 }}>
          <Loader2 size={16} className="animate-spin" />
          {t("meetings.loading")}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mr-doc">
        <div className="mr-error">{loadError}</div>
      </div>
    );
  }

  // Map internal recorder/transcribe state into RecordBar's visual state.
  const barState: RecordBarState =
    transcribeState === "transcribing"
      ? "transcribing"
      : recorderState === "recording"
        ? "recording"
        : recorderState === "paused"
          ? "paused"
          : hasAudio
            ? "finished"
            : "ready";

  const isCapturing = recorderState !== "idle";
  const isTranscribing = transcribeState === "transcribing";
  const canTranscribe = hasAudio && !isCapturing && !isTranscribing;

  const micEnabled = sources === "mic" || sources === "both";
  const systemEnabled = sources === "system" || sources === "both";

  return (
    <div className="mr-doc">
      <DocHeader
        title={title || meeting.title}
        onTitleChange={onTitleChange}
        titleDisabled={isCapturing || isTranscribing}
        whenLabel={whenLabel}
        durationLabel={durationLabel}
        repo={repo}
        language={language}
        onLanguageChange={onLanguageChange}
        sources={sources}
        onSourcesChange={onSourcesChange}
        isSaving={isSaving}
        settingsLocked={isCapturing || isTranscribing}
        onNewMeeting={onNewMeeting}
        newMeetingDisabled={
          !!creatingMeeting || isCapturing || isTranscribing
        }
      />

      <DocTabs
        active={tab}
        onChange={setTab}
        transcriptSegments={segmentCount > 0 ? segmentCount : null}
      />

      {recordError ? <div className="mr-error">{recordError}</div> : null}

      {tab === "source" ? (
        <div className="mr-source-host">
          <CodeMirrorEditor
            tabId={`meeting:${meeting.path}`}
            content={content}
            filePath={meeting.path}
            onChange={setContent}
            pendingReveal={null}
            onRevealHandled={() => {}}
          />
        </div>
      ) : (
        <>
          <RecordBar
            state={barState}
            elapsedSeconds={elapsedSeconds}
            micEnabled={micEnabled}
            systemEnabled={systemEnabled}
            micLevel={levels.mic}
            systemLevel={levels.system}
            durationLabel={durationLabel}
            segmentCount={segmentCount}
            onAction={onRecordAction}
            onTranscribe={runTranscription}
            canTranscribe={canTranscribe}
          />
          <div className="mr-doc-body">
            <div className="mr-doc-body-narrow">
              {tab === "meeting" ? (
                <MeetingTabBody
                  notes={notesText}
                  onNotesChange={onNotesChange}
                  transcript={transcriptText}
                  hasAudio={hasAudio}
                  isTranscribing={isTranscribing}
                  isCapturing={isCapturing}
                />
              ) : (
                <TranscriptTabBody
                  transcript={transcriptText}
                  hasAudio={hasAudio}
                  isCapturing={isCapturing}
                  isTranscribing={isTranscribing}
                  segmentCount={segmentCount}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MeetingTabBody({
  notes,
  onNotesChange,
  transcript,
  hasAudio,
  isCapturing,
  isTranscribing,
}: {
  notes: string;
  onNotesChange: (v: string) => void;
  transcript: string;
  hasAudio: boolean;
  isCapturing: boolean;
  isTranscribing: boolean;
}) {
  const { t } = useTranslation("app");
  return (
    <>
      <section className="mr-doc-section">
        <div className="mr-doc-section-head">
          <div className="mr-doc-section-label">
            {t("meetings.sectionNotes")}
          </div>
        </div>
        <textarea
          className="mr-notes-host"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={t("meetings.notesPlaceholder")}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: "rgba(255,255,255,0.015)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-1)",
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: "inherit",
            resize: "vertical",
            minHeight: 200,
            outline: "none",
          }}
        />
      </section>

      <section className="mr-doc-section">
        <div className="mr-doc-section-head">
          <div className="mr-doc-section-label">
            {t("meetings.sectionTranscript")}
          </div>
        </div>
        <TranscriptView
          transcript={transcript}
          hasAudio={hasAudio}
          isCapturing={isCapturing}
          isTranscribing={isTranscribing}
        />
      </section>
    </>
  );
}

function TranscriptTabBody({
  transcript,
  hasAudio,
  isCapturing,
  isTranscribing,
  segmentCount,
}: {
  transcript: string;
  hasAudio: boolean;
  isCapturing: boolean;
  isTranscribing: boolean;
  segmentCount: number;
}) {
  const { t } = useTranslation("app");
  return (
    <section className="mr-doc-section">
      <div className="mr-doc-section-head">
        <div className="mr-doc-section-label">
          {t("meetings.sectionTranscript")}
          {segmentCount > 0 ? (
            <span style={{ marginLeft: 4, color: "var(--text-3)" }}>
              · {t("meetings.segmentsCount", { count: segmentCount })}
            </span>
          ) : null}
        </div>
      </div>
      <TranscriptView
        transcript={transcript}
        hasAudio={hasAudio}
        isCapturing={isCapturing}
        isTranscribing={isTranscribing}
      />
    </section>
  );
}

function TranscriptView({
  transcript,
  hasAudio,
  isCapturing,
  isTranscribing,
}: {
  transcript: string;
  hasAudio: boolean;
  isCapturing: boolean;
  isTranscribing: boolean;
}) {
  const { t } = useTranslation("app");
  if (isTranscribing) {
    return (
      <div className="mr-transcript-empty">
        {t("meetings.transcriptPendingLabel")}
      </div>
    );
  }
  if (isCapturing) {
    return (
      <div className="mr-transcript-empty">
        {t("meetings.transcriptWhileRecording")}
      </div>
    );
  }
  if (!transcript) {
    return (
      <div className="mr-transcript-empty">
        {hasAudio
          ? t("meetings.transcriptNotYet")
          : t("meetings.transcriptNoAudio")}
      </div>
    );
  }
  const segments = parseTranscriptSegments(transcript);
  if (segments.length === 0) {
    // Older meeting transcribed before we started emitting [MM:SS] markers —
    // render as a single block so we don't eat the content. A retranscribe
    // will upgrade it to structured rows.
    return <pre className="mr-transcript-raw">{transcript}</pre>;
  }
  const hasSpeakers = segments.some((s) => s.speaker);
  return (
    <div className={`mr-transcript${hasSpeakers ? " mr-transcript-diarized" : ""}`}>
      {segments.map((s, i) => (
        <div key={i} className="mr-utter">
          <div className="mr-utter-meta">
            {s.speaker ? (
              <div
                className="mr-utter-speaker"
                style={{ color: speakerColor(s.speaker) }}
              >
                {s.speaker}
              </div>
            ) : null}
            <div className="mr-utter-time">{s.t}</div>
          </div>
          <div className="mr-utter-text">{s.text}</div>
        </div>
      ))}
    </div>
  );
}

const SPEAKER_PALETTE: Record<string, string> = {
  you: "#FF6B6B",
  others: "#60a5fa",
};

function speakerColor(name: string): string {
  const key = name.trim().toLowerCase();
  if (SPEAKER_PALETTE[key]) return SPEAKER_PALETTE[key];
  // Deterministic hash-based fallback so new speaker names get a stable color.
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const hues = [158, 38, 270, 210, 340, 180];
  const hue = hues[Math.abs(hash) % hues.length];
  return `hsl(${hue}deg 65% 65%)`;
}
