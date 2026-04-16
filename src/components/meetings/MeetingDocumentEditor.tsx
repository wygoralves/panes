import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ipc, type Meeting } from "../../lib/ipc";
import { CodeMirrorEditor } from "../editor/CodeMirrorEditor";
import { MeetingEditorHeader } from "../editor/MeetingEditorHeader";

const AUTOSAVE_DELAY_MS = 1200;
const RECORDING_DURATION_SECONDS = 10;
const DEFAULT_MODEL = "ggml-base.bin";

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
  const [isRecording, setIsRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [language, setLanguage] = useState<"en" | "pt">("en");
  const latestContentRef = useRef<string>("");

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
        latestContentRef.current = result.content;
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

  // Autosave debounced: writes to disk when content diverges from savedContent.
  useEffect(() => {
    if (isLoading) return;
    if (content === savedContent) return;
    latestContentRef.current = content;
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

  async function onRecord() {
    if (isRecording) return;
    setIsRecording(true);
    setRecordError(null);
    try {
      await invoke("record_meeting", {
        meetingPath: meeting.path,
        durationSeconds: RECORDING_DURATION_SECONDS,
        language,
        modelFilename: DEFAULT_MODEL,
      });
      await loadFile();
    } catch (e) {
      setRecordError(String(e));
    } finally {
      setIsRecording(false);
    }
  }

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
        isRecording={isRecording}
        onRecord={() => void onRecord()}
        titleHint={meeting.title}
        isSaving={isSaving}
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
