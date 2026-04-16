import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ipc, listenWhisperModelDownload, type Meeting, type WhisperModel } from "../../lib/ipc";
import {
  parseFrontmatterValue,
  updateFrontmatterValue,
} from "../../lib/meetingFrontmatter";
import { toast } from "../../stores/toastStore";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import {
  MeetingEditorHeader,
  type MeetingLanguage,
  type MeetingRecordAction,
} from "../editor/MeetingEditorHeader";

const AUTOSAVE_DELAY_MS = 1200;

// Fallback priority when no per-meeting model override is set. Order from
// best → worst so the auto-pick grabs the largest downloaded model. Keep in
// sync with the catalog in commands/meetings.rs.
const MODEL_PRIORITY = [
  "ggml-large-v3-turbo.bin",
  "ggml-medium.bin",
  "ggml-small.bin",
  "ggml-base.bin",
  "ggml-tiny.bin",
];

type RecorderState = "idle" | "recording" | "paused";
type TranscribeState = "idle" | "transcribing";

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
  const [transcribeState, setTranscribeState] = useState<TranscribeState>("idle");
  const [recordError, setRecordError] = useState<string | null>(null);
  const [language, setLanguage] = useState<MeetingLanguage>("auto");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [availableModels, setAvailableModels] = useState<WhisperModel[]>([]);
  const modelsListenerRef = useRef<UnlistenFn | null>(null);

  const dir = dirnameOf(meeting.path);

  const title = useMemo(
    () => parseFrontmatterValue(content, "title") ?? "",
    [content],
  );
  const selectedModel = useMemo(
    () => parseFrontmatterValue(content, "model"),
    [content],
  );
  const hasAudio = useMemo(
    () => !!parseFrontmatterValue(content, "audio"),
    [content],
  );

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

  // Seed the language toggle from the meeting's frontmatter on load.
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

  // Recording timer. Increments once per second only while "recording"; paused
  // state keeps the displayed elapsed time frozen. Reset when we return to idle.
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

  const onRecordAction = useCallback(
    async (action: MeetingRecordAction) => {
      setRecordError(null);
      try {
        switch (action) {
          case "start":
            await ipc.startMeetingRecording(meeting.path);
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
            break;
        }
      } catch (e) {
        setRecordError(String(e));
      }
    },
    [meeting.path, loadFile],
  );

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

  const onTranscribe = useCallback(async () => {
    setRecordError(null);
    setTranscribeState("transcribing");
    try {
      const chosen = pickTranscribeModel();
      if (!chosen) {
        throw new Error(
          "No Whisper model is downloaded. Open the model catalog from the Meetings sidebar.",
        );
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
  }, [language, loadFile, meeting.path, pickTranscribeModel]);

  const onTitleChange = useCallback((next: string) => {
    setContent((prev) => updateFrontmatterValue(prev, "title", next));
  }, []);

  const onModelChange = useCallback((next: string | null) => {
    setContent((prev) => updateFrontmatterValue(prev, "model", next ?? ""));
  }, []);

  const onLanguageChangeWrapped = useCallback((next: MeetingLanguage) => {
    setLanguage(next);
    setContent((prev) => updateFrontmatterValue(prev, "language", next));
  }, []);

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
        onLanguageChange={onLanguageChangeWrapped}
        recorderState={recorderState}
        transcribeState={transcribeState}
        onRecordAction={onRecordAction}
        onTranscribe={onTranscribe}
        hasAudio={hasAudio}
        title={title || meeting.title}
        onTitleChange={onTitleChange}
        isSaving={isSaving}
        elapsedSeconds={elapsedSeconds}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
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
