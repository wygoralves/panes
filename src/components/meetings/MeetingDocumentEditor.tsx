import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { ipc, type Meeting } from "../../lib/ipc";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import {
  MeetingEditorHeader,
  type MeetingLanguage,
} from "../editor/MeetingEditorHeader";

const AUTOSAVE_DELAY_MS = 1200;

// Model priority used when auto-selecting which downloaded Whisper model to
// feed the transcriber with. Order from best → worst so larger/better models
// win when present. Keep in sync with the catalog in commands/meetings.rs.
const MODEL_PRIORITY = [
  "ggml-large-v3-turbo.bin",
  "ggml-medium.bin",
  "ggml-small.bin",
  "ggml-base.bin",
  "ggml-tiny.bin",
];

type RecorderState = "idle" | "recording" | "transcribing";

function dirnameOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i >= 0 ? filePath.substring(0, i) : filePath;
}

export function MeetingDocumentEditor({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation("app");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recordError, setRecordError] = useState<string | null>(null);
  const [language, setLanguage] = useState<MeetingLanguage>("en");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recordStartedAtRef = useRef<number>(0);

  const dir = dirnameOf(meeting.path);

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

  // Debounced autosave of editor content back to disk.
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

  // Recording timer.
  useEffect(() => {
    if (recorderState !== "recording") return;
    recordStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    const handle = window.setInterval(() => {
      setElapsedSeconds(
        Math.floor((Date.now() - recordStartedAtRef.current) / 1000),
      );
    }, 1000);
    return () => window.clearInterval(handle);
  }, [recorderState]);

  const startRecording = useCallback(async () => {
    setRecordError(null);
    try {
      await ipc.startMeetingRecording(meeting.path);
      setRecorderState("recording");
    } catch (e) {
      setRecordError(String(e));
    }
  }, [meeting.path]);

  const stopRecording = useCallback(async () => {
    setRecorderState("transcribing");
    try {
      const models = await ipc.listWhisperModels();
      const chosen = MODEL_PRIORITY.find((n) =>
        models.some((m) => m.name === n && m.downloaded),
      );
      if (!chosen) {
        throw new Error(
          "No Whisper model is downloaded. Open the model catalog from the Meetings sidebar.",
        );
      }
      await ipc.stopMeetingRecording(meeting.path, language, chosen);
      await loadFile();
    } catch (e) {
      setRecordError(String(e));
    } finally {
      setRecorderState("idle");
    }
  }, [meeting.path, language, loadFile]);

  const onRecordToggle = useCallback(() => {
    if (recorderState === "idle") void startRecording();
    else if (recorderState === "recording") void stopRecording();
    // "transcribing" ignores clicks
  }, [recorderState, startRecording, stopRecording]);

  if (isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--text-3)",
          fontSize: 13,
        }}
      >
        <Loader2 size={14} className="animate-spin" />
        {t("meetings.loading")}
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        style={{
          flex: 1,
          padding: 24,
          color: "var(--danger)",
          fontSize: 13,
        }}
      >
        {loadError}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MeetingEditorHeader
        language={language}
        onLanguageChange={setLanguage}
        recorderState={recorderState}
        onRecord={onRecordToggle}
        titleHint={meeting.title}
        isSaving={isSaving}
        elapsedSeconds={elapsedSeconds}
      />
      {recordError ? (
        <div
          style={{
            padding: "8px 16px",
            background: "rgba(255, 80, 80, 0.1)",
            color: "var(--text-2)",
            fontSize: 12,
          }}
        >
          {recordError}
        </div>
      ) : null}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <CodeMirrorEditor
          tabId={`meeting:${meeting.path}`}
          content={content}
          filePath={meeting.path}
          onChange={setContent}
          pendingReveal={null}
          onRevealHandled={() => {}}
        />
      </div>
    </div>
  );
}
