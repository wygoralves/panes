import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Plus } from "lucide-react";
import { ipc, type Meeting } from "../../lib/ipc";
import { formatRelativeTime } from "../../lib/formatters";
import { MeetingDocumentEditor } from "./MeetingDocumentEditor";

export function MeetingsPanel() {
  const { t } = useTranslation(["app"]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
