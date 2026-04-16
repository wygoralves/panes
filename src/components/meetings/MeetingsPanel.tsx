import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Download, Plus, Settings } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ipc, listenWhisperModelDownload, type Meeting } from "../../lib/ipc";
import { formatRelativeTime } from "../../lib/formatters";
import { MeetingDocumentEditor } from "./MeetingDocumentEditor";
import { ModelCatalogModal } from "./ModelCatalogModal";

export function MeetingsPanel() {
  const { t } = useTranslation(["app"]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showModelCatalog, setShowModelCatalog] = useState(false);
  const [hasDownloadedModel, setHasDownloadedModel] = useState<boolean | null>(null);
  const modelListenerRef = useRef<UnlistenFn | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await ipc.listMeetings();
      setMeetings(list);
      // Auto-select the newest meeting on first load so the right pane
      // is never empty when there's at least one meeting on disk.
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

  async function onNewMeeting() {
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
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(255,255,255,0.01)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AudioLines size={16} strokeWidth={1.5} style={{ opacity: 0.75 }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {t("app:sidebar.meetings")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={() => setShowModelCatalog(true)}
              title={t("app:meetings.modelCatalogTitle")}
              className="sb-add-project-btn"
              style={{ border: "none" }}
            >
              <Settings size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => void onNewMeeting()}
              disabled={creating}
              title={t("app:meetings.newMeeting")}
              className="sb-add-project-btn"
              style={{ border: "none" }}
            >
              <Plus size={12} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {loading ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              {t("app:meetings.loading")}
            </div>
          ) : error ? (
            <div style={{ padding: 16, fontSize: 12, color: "var(--danger)" }}>{error}</div>
          ) : meetings.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {t("app:meetings.emptyTitle")}
              <br />
              <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                {t("app:meetings.emptyHint")}
              </span>
            </div>
          ) : (
            <MeetingList
              meetings={meetings}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          )}
        </div>
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {hasDownloadedModel === false ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 16px",
              margin: "8px 12px 0",
              borderRadius: "var(--radius-md)",
              background: "rgba(210, 170, 80, 0.08)",
              border: "1px solid rgba(210, 170, 80, 0.25)",
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Download size={14} style={{ opacity: 0.85, color: "rgba(220, 195, 120, 0.95)" }} />
              <div>
                <div style={{ fontWeight: 500, color: "var(--text-1)" }}>
                  {t("app:meetings.setupBannerTitle")}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-3)" }}>
                  {t("app:meetings.setupBannerHint")}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModelCatalog(true)}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <Download size={12} />
              {t("app:meetings.setupBannerAction")}
            </button>
          </div>
        ) : null}

        {selected ? (
          <MeetingDocumentEditor key={selected.path} meeting={selected} />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--text-3)",
              padding: 32,
              textAlign: "center",
            }}
          >
            <AudioLines size={40} strokeWidth={1.25} style={{ opacity: 0.35 }} />
            <div style={{ fontWeight: 500, color: "var(--text-2)" }}>
              {t("app:meetings.noSelectionTitle")}
            </div>
            <div style={{ maxWidth: 320, lineHeight: 1.5, fontSize: 13 }}>
              {t("app:meetings.noSelectionHint")}
            </div>
          </div>
        )}
      </main>
      {showModelCatalog ? (
        <ModelCatalogModal onClose={() => setShowModelCatalog(false)} />
      ) : null}
    </div>
  );
}

function MeetingList({
  meetings,
  selectedPath,
  onSelect,
}: {
  meetings: Meeting[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: "4px 6px",
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {meetings.map((m) => {
        const active = m.path === selectedPath;
        return (
          <li key={m.path}>
            <button
              type="button"
              onClick={() => onSelect(m.path)}
              title={m.path}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                background: active ? "rgba(255,255,255,0.06)" : "transparent",
                border: "1px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                color: active ? "var(--text-1)" : "var(--text-2)",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.title}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {formatRelativeTime(new Date(m.updatedAt))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
