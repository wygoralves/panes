import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Settings } from "lucide-react";
import type { Meeting } from "../../lib/ipc";
import { formatRelativeTime } from "../../lib/formatters";

interface Props {
  meetings: Meeting[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onOpenCatalog: () => void;
  liveMeetingPath: string | null;
  loading: boolean;
  error: string | null;
}

type AgeBucket = "today" | "yesterday" | "thisWeek" | "lastWeek" | "earlier";

const BUCKET_ORDER: AgeBucket[] = [
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "earlier",
];

function bucketOf(iso: string): AgeBucket {
  const when = new Date(iso).getTime();
  if (Number.isNaN(when)) return "earlier";
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const thisWeekStart = todayStart - 7 * 86_400_000;
  const lastWeekStart = todayStart - 14 * 86_400_000;
  if (when >= todayStart) return "today";
  if (when >= yesterdayStart) return "yesterday";
  if (when >= thisWeekStart) return "thisWeek";
  if (when >= lastWeekStart) return "lastWeek";
  void now;
  return "earlier";
}

export function MeetingsListPanel({
  meetings,
  selectedPath,
  onSelect,
  onOpenCatalog,
  liveMeetingPath,
  loading,
  error,
}: Props) {
  const { t } = useTranslation("app");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) => m.title.toLowerCase().includes(q));
  }, [meetings, query]);

  const groups = useMemo(() => {
    const by: Record<AgeBucket, Meeting[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      lastWeek: [],
      earlier: [],
    };
    for (const m of filtered) {
      by[bucketOf(m.updatedAt)].push(m);
    }
    return by;
  }, [filtered]);

  return (
    <aside className="mr-list">
      <div className="mr-list-header">
        <div className="mr-list-title">
          <AudioLines size={14} strokeWidth={1.5} style={{ opacity: 0.8 }} />
          {t("sidebar.meetings")}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            className="mr-icon-btn"
            onClick={onOpenCatalog}
            title={t("meetings.modelCatalogTitle")}
          >
            <Settings size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="mr-search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("meetings.searchPlaceholder")}
          spellCheck={false}
        />
      </div>

      <div className="mr-list-scroll">
        {loading ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            {t("meetings.loading")}
          </div>
        ) : error ? (
          <div
            style={{
              padding: 16,
              fontSize: 12,
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {meetings.length === 0
              ? t("meetings.emptyTitle")
              : t("meetings.searchEmpty")}
          </div>
        ) : (
          BUCKET_ORDER.flatMap((bucket) => {
            const items = groups[bucket];
            if (!items.length) return [];
            return [
              <div key={`hdr-${bucket}`} className="mr-group-label">
                {t(`meetings.group_${bucket}`)}
              </div>,
              ...items.map((m) => (
                <button
                  key={m.path}
                  type="button"
                  className={`mr-row${m.path === selectedPath ? " active" : ""}`}
                  onClick={() => onSelect(m.path)}
                  title={m.path}
                >
                  <span className="mr-row-title">
                    {liveMeetingPath === m.path ? (
                      <span className="mr-live-pulse" aria-hidden="true" />
                    ) : null}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.title}
                    </span>
                  </span>
                  <span className="mr-row-meta">
                    <span>{formatRelativeTime(new Date(m.updatedAt))}</span>
                  </span>
                </button>
              )),
            ];
          })
        )}
      </div>
    </aside>
  );
}
