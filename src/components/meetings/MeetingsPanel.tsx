import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Download } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ipc, listenWhisperModelDownload, type Meeting } from "../../lib/ipc";
import { MeetingDocumentEditor } from "./MeetingDocumentEditor";
import { MeetingsListPanel } from "./MeetingsListPanel";
import { ModelCatalogModal } from "./ModelCatalogModal";
import "./meetings.css";

type RecorderState = "idle" | "recording" | "paused";

export function MeetingsPanel() {
  const { t } = useTranslation(["app"]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showModelCatalog, setShowModelCatalog] = useState(false);
  const [hasDownloadedModel, setHasDownloadedModel] =
    useState<boolean | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const modelListenerRef = useRef<UnlistenFn | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await ipc.listMeetings();
      setMeetings(list);
      setSelectedPath((prev) => prev ?? list[0]?.path ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshModelState = useCallback(async () => {
    try {
      const list = await ipc.listWhisperModels();
      setHasDownloadedModel(list.some((m) => m.downloaded));
    } catch {
      setHasDownloadedModel(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshModelState();
    void (async () => {
      modelListenerRef.current = await listenWhisperModelDownload((progress) => {
        if (progress.done) void refreshModelState();
      });
    })();
    return () => {
      if (modelListenerRef.current) modelListenerRef.current();
    };
  }, [refreshModelState]);

  const selected = useMemo(
    () => meetings.find((m) => m.path === selectedPath) ?? null,
    [meetings, selectedPath],
  );

  const onNewMeeting = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await ipc.createMeeting(null);
      await refresh();
      setSelectedPath(created.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [creating, refresh]);

  const liveMeetingPath =
    recorderState === "idle" ? null : selected?.path ?? null;

  return (
    <div className="meetings-redesign">
      <MeetingsListPanel
        meetings={meetings}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
        onOpenCatalog={() => setShowModelCatalog(true)}
        liveMeetingPath={liveMeetingPath}
        loading={loading}
        error={error}
      />

      <main
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {hasDownloadedModel === false ? (
          <div className="mr-setup-banner">
            <div className="mr-setup-banner-left">
              <Download className="mr-setup-banner-icon" size={14} />
              <div>
                <div className="mr-setup-banner-title">
                  {t("app:meetings.setupBannerTitle")}
                </div>
                <div className="mr-setup-banner-hint">
                  {t("app:meetings.setupBannerHint")}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="mr-record-secondary"
              onClick={() => setShowModelCatalog(true)}
              style={{
                height: 30,
                color: "var(--text-1)",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <Download size={12} />
              {t("app:meetings.setupBannerAction")}
            </button>
          </div>
        ) : null}

        {selected ? (
          <MeetingDocumentEditor
            key={selected.path}
            meeting={selected}
            onRecorderStateChange={setRecorderState}
            onNewMeeting={() => void onNewMeeting()}
            creatingMeeting={creating}
          />
        ) : (
          <div className="mr-empty">
            <div className="mr-empty-icon">
              <AudioLines size={22} strokeWidth={1.4} />
            </div>
            <div className="mr-empty-title">
              {t("app:meetings.noSelectionTitle")}
            </div>
            <div className="mr-empty-hint">
              {t("app:meetings.noSelectionHint")}
            </div>
            <button
              type="button"
              className="mr-header-record-btn"
              onClick={() => void onNewMeeting()}
              disabled={creating}
              style={{ marginTop: 8 }}
            >
              <span className="mr-header-rec-dot" />
              {t("app:meetings.recordNewMeeting")}
            </button>
          </div>
        )}
      </main>

      {showModelCatalog ? (
        <ModelCatalogModal onClose={() => setShowModelCatalog(false)} />
      ) : null}
    </div>
  );
}
