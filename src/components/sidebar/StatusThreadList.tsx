import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  RotateCcw,
} from "lucide-react";
import { formatRelativeTime } from "../../lib/formatters";
import { canSettleThread } from "../../lib/threadActions";
import { useSidebarViewStore } from "../../stores/sidebarViewStore";
import { useThreadReadStore } from "../../stores/threadReadStore";
import { InlineThreadTitle } from "./InlineThreadTitle";
import { ProjectIcon } from "./ProjectIcon";
import { ThreadStatusLabel } from "./ThreadStatusLabel";
import {
  getVisibleThreads,
  groupThreadsByStatus,
  resolveThreadDisplayStatus,
  resolveWorkingStartedAt,
  sortActiveThreads,
  sortSettledThreads,
  type StatusSectionId,
} from "./statusGrouping";
import type { Thread, Workspace } from "../../types";

const SETTLED_INITIAL_COUNT = 10;
const SETTLED_PAGE_COUNT = 25;

interface Props {
  threads: Thread[];
  workspaces: Workspace[];
  activeThreadId: string | null;
  onSelectThread: (thread: Thread) => void;
  onArchiveThread: (thread: Thread) => void;
  onSettleThread: (thread: Thread) => Promise<boolean>;
  onUnsettleThread: (thread: Thread) => Promise<boolean>;
  onRenameThread: (thread: Thread, title: string) => Promise<boolean>;
  getThreadLabel: (thread: Thread) => string;
  getWorkspaceLabel: (workspace: Workspace) => string;
}

export function StatusThreadList({
  threads,
  workspaces,
  activeThreadId,
  onSelectThread,
  onArchiveThread,
  onSettleThread,
  onUnsettleThread,
  onRenameThread,
  getThreadLabel,
  getWorkspaceLabel,
}: Props) {
  const { t, i18n } = useTranslation(["app"]);
  const settledCollapsed = useSidebarViewStore((state) => state.settledCollapsed);
  const toggleSettledCollapsed = useSidebarViewStore(
    (state) => state.toggleSettledCollapsed,
  );
  const projectFilterId = useSidebarViewStore((state) => state.projectFilterId);
  const lastVisitedAtByThread = useThreadReadStore(
    (state) => state.lastVisitedAtByThread,
  );
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_INITIAL_COUNT);

  // A scope change starts the settled tail over instead of inheriting a deep
  // page from the previous project.
  const lastFilterRef = useRef(projectFilterId);
  if (lastFilterRef.current !== projectFilterId) {
    lastFilterRef.current = projectFilterId;
    setSettledVisibleCount(SETTLED_INITIAL_COUNT);
  }

  const groups = useMemo(() => {
    const grouped = groupThreadsByStatus(threads);
    return {
      working: sortActiveThreads(grouped.working),
      settled: sortSettledThreads(grouped.settled),
    };
  }, [threads]);

  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );

  // Truncation always runs on the sorted list, so paging never reveals a
  // random slice of history.
  const settledPage = useMemo(
    () =>
      getVisibleThreads({
        threads: groups.settled,
        activeThreadId,
        visibleCount: settledVisibleCount,
      }),
    [activeThreadId, groups.settled, settledVisibleCount],
  );

  function renderTrailing(
    thread: Thread,
    sectionId: StatusSectionId,
    isActive: boolean,
  ) {
    if (sectionId === "settled") {
      return (
        <span className="sb-status-time">
          {thread.settledAt
            ? formatRelativeTime(thread.settledAt, i18n.language)
            : ""}
        </span>
      );
    }

    const display = resolveThreadDisplayStatus(
      thread,
      lastVisitedAtByThread[thread.id],
      isActive,
    );
    if (display.status === "ready") {
      return (
        <span className="sb-status-time">
          {thread.lastActivityAt
            ? formatRelativeTime(thread.lastActivityAt, i18n.language)
            : ""}
        </span>
      );
    }

    return (
      <ThreadStatusLabel
        status={display.status}
        startedAt={resolveWorkingStartedAt(thread)}
      />
    );
  }

  function renderRow(thread: Thread, sectionId: StatusSectionId) {
    const isActive = thread.id === activeThreadId;
    const workspace = workspaceById.get(thread.workspaceId);
    const workspaceLabel = workspace
      ? getWorkspaceLabel(workspace)
      : t("app:sidebar.workspaceFallback");
    const display = resolveThreadDisplayStatus(
      thread,
      lastVisitedAtByThread[thread.id],
      isActive,
    );
    const canSettle = canSettleThread(thread);

    return (
      <div
        key={thread.id}
        role="button"
        tabIndex={0}
        className={`sb-status-row${isActive ? " sb-status-row-active" : ""}${sectionId === "settled" ? " sb-status-row-settled" : ""}`}
        data-status={display.status}
        data-unread={display.isUnread ? "true" : undefined}
        onClick={() => onSelectThread(thread)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectThread(thread);
          }
        }}
      >
        <span className="sb-status-project-mark">
          <ProjectIcon label={workspaceLabel} active={isActive} />
        </span>
        <span className="sb-status-main">
          <span className="sb-status-top">
            <InlineThreadTitle
              className="sb-status-title"
              label={getThreadLabel(thread)}
              renameLabel={t("app:sidebar.renameThread")}
              onRename={(title) => onRenameThread(thread, title)}
            />
            <span className="sb-status-trailing">
              {renderTrailing(thread, sectionId, isActive)}
              <span className="sb-status-row-actions">
                <button
                  type="button"
                  title={
                    sectionId === "settled"
                      ? t("app:sidebar.unsettleThread")
                      : t("app:sidebar.settleThread")
                  }
                  aria-label={
                    sectionId === "settled"
                      ? t("app:sidebar.unsettleThread")
                      : t("app:sidebar.settleThread")
                  }
                  className="sb-status-action"
                  disabled={sectionId === "working" && !canSettle}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void (sectionId === "settled"
                      ? onUnsettleThread(thread)
                      : onSettleThread(thread));
                  }}
                >
                  {sectionId === "settled" ? (
                    <RotateCcw size={11} />
                  ) : (
                    <CircleCheck size={11} />
                  )}
                </button>
                <button
                  type="button"
                  title={t("app:sidebar.archiveThread")}
                  aria-label={t("app:sidebar.archiveThread")}
                  className="sb-status-action"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchiveThread(thread);
                  }}
                >
                  <Archive size={11} />
                </button>
              </span>
            </span>
          </span>
          {!projectFilterId && (
            <span className="sb-status-context">{workspaceLabel}</span>
          )}
        </span>
      </div>
    );
  }

  if (threads.length === 0) {
    return <div className="sb-no-threads">{t("app:sidebar.noThreads")}</div>;
  }

  return (
    <div className="sb-status-view">
      {/* Inbox: unlabeled, because it is the list, not a section of it. */}
      {groups.working.length > 0 ? (
        <div className="sb-status-list">
          {groups.working.map((thread) => renderRow(thread, "working"))}
        </div>
      ) : (
        <div className="sb-no-threads">{t("app:sidebar.nothingInProgress")}</div>
      )}

      {groups.settled.length > 0 && (
        <div className="sb-status-shelf">
          <button
            type="button"
            className="sb-status-section-label"
            aria-expanded={!settledCollapsed}
            aria-label={t(
              settledCollapsed
                ? "app:sidebar.expandSection"
                : "app:sidebar.collapseSection",
              { section: t("app:sidebar.statusSettled") },
            )}
            onClick={toggleSettledCollapsed}
          >
            {settledCollapsed ? (
              <ChevronRight size={11} />
            ) : (
              <ChevronDown size={11} />
            )}
            <span>{t("app:sidebar.statusSettled")}</span>
            <span className="sb-status-count">{groups.settled.length}</span>
          </button>

          {!settledCollapsed && (
            <div className="sb-status-list">
              {settledPage.visibleThreads.map((thread) => renderRow(thread, "settled"))}

              {settledPage.hiddenCount > 0 && (
                <button
                  type="button"
                  className="sb-show-more"
                  onClick={() =>
                    setSettledVisibleCount((count) => count + SETTLED_PAGE_COUNT)
                  }
                >
                  {t("app:sidebar.showMore", { count: settledPage.hiddenCount })}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
