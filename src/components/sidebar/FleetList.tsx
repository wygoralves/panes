import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive } from "lucide-react";
import { formatRelativeTime } from "../../lib/formatters";
import { groupThreadsForFleet, type FleetSectionId } from "./fleetGrouping";
import type { Thread, Workspace } from "../../types";

const MAX_VISIBLE_IDLE_THREADS = 8;

const MARK_BY_STATUS: Record<Thread["status"], string> = {
  streaming: "sb-fleet-mark-running",
  awaiting_approval: "sb-fleet-mark-attention",
  error: "sb-fleet-mark-error",
  completed: "sb-fleet-mark-review",
  idle: "",
};

interface FleetListProps {
  threads: Thread[];
  workspaces: Workspace[];
  activeThreadId: string | null;
  onSelectThread: (thread: Thread) => void;
  onArchiveThread: (thread: Thread) => void;
  getThreadLabel: (thread: Thread) => string;
  getWorkspaceLabel: (workspace: Workspace) => string;
}

export function FleetList({
  threads,
  workspaces,
  activeThreadId,
  onSelectThread,
  onArchiveThread,
  getThreadLabel,
  getWorkspaceLabel,
}: FleetListProps) {
  const { t, i18n } = useTranslation(["app"]);
  const [showAllIdle, setShowAllIdle] = useState(false);

  const groups = useMemo(() => groupThreadsForFleet(threads), [threads]);
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, getWorkspaceLabel(workspace)])),
    [workspaces, getWorkspaceLabel],
  );

  const quiet =
    threads.length > 0 && groups.needsYou.length === 0 && groups.running.length === 0;

  const sections: Array<{
    id: FleetSectionId;
    label: string;
    countClass: string;
    threads: Thread[];
    hiddenCount: number;
  }> = [
    {
      id: "needsYou",
      label: t("app:sidebar.fleetNeedsYou"),
      countClass: "sb-fleet-count-needs",
      threads: groups.needsYou,
      hiddenCount: 0,
    },
    {
      id: "running",
      label: t("app:sidebar.fleetRunning"),
      countClass: "sb-fleet-count-running",
      threads: groups.running,
      hiddenCount: 0,
    },
    {
      id: "review",
      label: t("app:sidebar.fleetReadyToReview"),
      countClass: "sb-fleet-count-review",
      threads: groups.review,
      hiddenCount: 0,
    },
    {
      id: "idle",
      label: t("app:sidebar.fleetIdle"),
      countClass: "",
      threads: showAllIdle ? groups.idle : groups.idle.slice(0, MAX_VISIBLE_IDLE_THREADS),
      hiddenCount: showAllIdle
        ? 0
        : Math.max(0, groups.idle.length - MAX_VISIBLE_IDLE_THREADS),
    },
  ];

  function renderTrailing(thread: Thread) {
    if (thread.status === "awaiting_approval") {
      return (
        <span className="sb-thread-approval" title={t("app:sidebar.needsApproval")}>
          <span className="sb-thread-approval-dot" />
          {t("app:sidebar.needsApproval")}
        </span>
      );
    }
    if (thread.status === "error") {
      return (
        <span className="sb-fleet-pill-danger" title={t("app:sidebar.fleetFailed")}>
          {t("app:sidebar.fleetFailed")}
        </span>
      );
    }
    return (
      <span className="sb-fleet-time">
        {thread.lastActivityAt
          ? formatRelativeTime(thread.lastActivityAt, i18n.language)
          : ""}
      </span>
    );
  }

  if (threads.length === 0) {
    return <div className="sb-no-threads">{t("app:sidebar.noThreads")}</div>;
  }

  return (
    <div>
      {quiet && <div className="sb-fleet-quiet">{t("app:sidebar.fleetQuiet")}</div>}

      {sections.map((section) => {
        if (section.threads.length === 0 && section.hiddenCount === 0) return null;
        return (
          <div key={section.id}>
            <div className="sb-fleet-section-label">
              <span>{section.label}</span>
              <span className={`sb-fleet-count ${section.countClass}`.trim()}>
                {section.id === "idle" ? groups.idle.length : section.threads.length}
              </span>
            </div>
            <div className="sb-fleet-list">
              {section.threads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                return (
                  <div
                    key={thread.id}
                    role="button"
                    tabIndex={0}
                    className={`sb-fleet-row${isActive ? " sb-fleet-row-active" : ""}`}
                    onClick={() => onSelectThread(thread)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectThread(thread);
                      }
                    }}
                  >
                    <span
                      className={`sb-fleet-mark ${MARK_BY_STATUS[thread.status] ?? ""}`.trim()}
                    />
                    <span className="sb-fleet-main">
                      <span className="sb-fleet-top">
                        <span className="sb-fleet-title">{getThreadLabel(thread)}</span>
                        <span className="sb-fleet-trailing">
                          {renderTrailing(thread)}
                          <button
                            type="button"
                            title={t("app:sidebar.archiveThread")}
                            aria-label={t("app:sidebar.archiveThread")}
                            className="sb-fleet-archive"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveThread(thread);
                            }}
                          >
                            <Archive size={11} />
                          </button>
                        </span>
                      </span>
                      <span className="sb-fleet-ctx">
                        {workspaceNames.get(thread.workspaceId) ?? ""}
                      </span>
                    </span>
                  </div>
                );
              })}

              {section.id === "idle" && section.hiddenCount > 0 && (
                <button
                  type="button"
                  className="sb-show-more"
                  onClick={() => setShowAllIdle(true)}
                >
                  {t("app:sidebar.showMore", { count: section.hiddenCount })}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
