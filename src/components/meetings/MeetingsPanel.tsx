import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Plus } from "lucide-react";
import { ipc, type Meeting } from "../../lib/ipc";
import { formatRelativeTime } from "../../lib/formatters";
import { useFileStore } from "../../stores/fileStore";
import { useUiStore } from "../../stores/uiStore";

function dirnameOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i >= 0 ? filePath.substring(0, i) : filePath;
}

export function MeetingsPanel() {
  const { t } = useTranslation(["app"]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const openFile = useFileStore((s) => s.openFile);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await ipc.listMeetings();
      setMeetings(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openMeeting = useCallback(
    async (meeting: Meeting) => {
      const dir = dirnameOf(meeting.path);
      try {
        await openFile(dir, meeting.path);
        setActiveView("chat");
      } catch (e) {
        setError(String(e));
      }
    },
    [openFile, setActiveView],
  );

  async function onNewMeeting() {
    if (creating) return;
    setCreating(true);
    try {
      const created = await ipc.createMeeting(null);
      await refresh();
      await openMeeting(created);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AudioLines size={18} strokeWidth={1.5} style={{ opacity: 0.7 }} />
          <span style={{ fontSize: 15, fontWeight: 500 }}>
            {t("app:sidebar.meetings")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void onNewMeeting()}
          disabled={creating}
          className="sb-add-project-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            width: "auto",
            height: "auto",
            fontSize: 13,
          }}
        >
          <Plus size={14} strokeWidth={2} />
          {creating ? t("app:meetings.creating") : t("app:meetings.newMeeting")}
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-3)" }}>
            {t("app:meetings.loading")}
          </div>
        ) : error ? (
          <div
            style={{
              padding: "16px 24px",
              margin: "0 16px",
              borderRadius: 6,
              background: "rgba(255, 80, 80, 0.08)",
              color: "var(--text-2)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : meetings.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <MeetingList meetings={meetings} onOpen={openMeeting} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ t }: { t: ReturnType<typeof useTranslation>["t"] }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--text-3)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <AudioLines size={40} strokeWidth={1.25} style={{ opacity: 0.35 }} />
      <div style={{ fontWeight: 500, color: "var(--text-2)" }}>
        {t("app:meetings.emptyTitle")}
      </div>
      <div style={{ maxWidth: 320, lineHeight: 1.5, fontSize: 13 }}>
        {t("app:meetings.emptyHint")}
      </div>
    </div>
  );
}

function MeetingList({
  meetings,
  onOpen,
}: {
  meetings: Meeting[];
  onOpen: (meeting: Meeting) => void | Promise<void>;
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: "0 8px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {meetings.map((m) => (
        <li key={m.path}>
          <button
            type="button"
            className="sb-nav-item"
            onClick={() => void onOpen(m)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 16px",
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
            title={m.path}
          >
            <div style={{ fontSize: 14, color: "var(--text-1)" }}>{m.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              {formatRelativeTime(new Date(m.updatedAt))}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
