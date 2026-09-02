import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  MessageSquare,
  PencilLine,
  Plus,
  RotateCcw,
} from "lucide-react";
import { engineKind } from "../../lib/engineKind";
import { formatRelativeTime } from "../../lib/formatters";
import { canSettleThread } from "../../lib/threadActions";
import { useSidebarViewStore } from "../../stores/sidebarViewStore";
import { useThreadReadStore } from "../../stores/threadReadStore";
import { getHarnessIcon } from "../shared/HarnessLogos";
import { InlineThreadTitle } from "./InlineThreadTitle";
import { ThreadStatusLabel } from "./ThreadStatusLabel";
import {
  getVisibleThreads,
  groupThreadsForInbox,
  resolveThreadDisplayStatus,
  resolveWorkingStartedAt,
  type InboxSectionId,
  type ThreadDisplayStatus,
} from "./statusGrouping";
import type { Thread, Workspace } from "../../types";

const SETTLED_INITIAL_COUNT = 10;
const SETTLED_PAGE_COUNT = 25;

interface Props {
  threads: Thread[];
  workspaces: Workspace[];
  activeThreadId: string | null;
  /** The project the list is filtered to, when it is. */
  filteredWorkspace: Workspace | null;
  onSelectThread: (thread: Thread) => void;
  onArchiveThread: (thread: Thread) => void;
  onSettleThread: (thread: Thread) => Promise<boolean>;
  onUnsettleThread: (thread: Thread) => Promise<boolean>;
  onRenameThread: (thread: Thread, title: string) => Promise<boolean>;
  onNewThread: () => void;
  getThreadLabel: (thread: Thread) => string;
  getWorkspaceLabel: (workspace: Workspace) => string;
}

/** The state glyph at the head of a row: a halo dot for an approval, a red
 * dot for a failure, a ring while working, a green dot for an unread
 * completion, and a quiet check for everything that rests. */
function StatusGlyph({ status }: { status: ThreadDisplayStatus | "settled" }) {
  let inner: ReactNode;
  if (status === "draft") {
    inner = <PencilLine size={11} strokeWidth={1.8} />;
  } else if (status === "working") {
    inner = <span className="sb-status-glyph-ring" />;
  } else if (status === "approval" || status === "failed" || status === "done") {
    inner = <span className="sb-status-glyph-dot" />;
  } else {
    inner = <Check size={11} strokeWidth={2} />;
  }
  return (
    <span className="sb-status-glyph" data-status={status} aria-hidden="true">
      {inner}
    </span>
  );
}

export function StatusThreadList({
  threads,
  workspaces,
  activeThreadId,
  filteredWorkspace,
  onSelectThread,
  onArchiveThread,
  onSettleThread,
  onUnsettleThread,
  onRenameThread,
  onNewThread,
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

  const groups = useMemo(
    () => groupThreadsForInbox(threads, lastVisitedAtByThread, activeThreadId),
    [activeThreadId, lastVisitedAtByThread, threads],
  );

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

  const quiet = groups.needsYou.length === 0 && groups.working.length === 0;
  // With nothing left above it, the shelf is the list: it opens on its own so
  // a fully settled project never shows a blank sidebar.
  const shelfOpen = !settledCollapsed || (quiet && groups.done.length === 0);

  function renderTrailing(thread: Thread, sectionId: InboxSectionId, isActive: boolean) {
    if (sectionId === "settled") {
      return (
        <span className="sb-status-time">
          {thread.settledAt ? formatRelativeTime(thread.settledAt, i18n.language) : ""}
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

  function renderRow(thread: Thread, sectionId: InboxSectionId) {
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
    const glyphStatus = sectionId === "settled" ? "settled" : display.status;
    const canSettle = canSettleThread(thread) && display.status !== "draft";
    const engineIcon = getHarnessIcon(engineKind(thread.engineId), 10);

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
        <StatusGlyph status={glyphStatus} />
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
                  disabled={sectionId !== "settled" && !canSettle}
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
          <span className="sb-status-meta">
            <span className="sb-status-meta-project">{workspaceLabel}</span>
            <span className="sb-status-meta-engine" aria-hidden="true">
              {engineIcon}
            </span>
          </span>
        </span>
      </div>
    );
  }

  function renderSection(sectionId: Exclude<InboxSectionId, "settled">, labelKey: string) {
    const items = groups[sectionId];
    if (items.length === 0) return null;
    return (
      <div className="sb-inbox-section" data-section={sectionId}>
        <div className="sb-inbox-label">
          <span>{t(labelKey)}</span>
          <span className="sb-inbox-label-count">{items.length}</span>
        </div>
        <div className="sb-status-list">
          {items.map((thread) => renderRow(thread, sectionId))}
        </div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="sb-inbox-empty">
        <span className="sb-inbox-empty-mark">
          <MessageSquare size={14} strokeWidth={1.6} />
        </span>
        <span className="sb-inbox-empty-title">{t("app:sidebar.emptyThreadsTitle")}</span>
        <span className="sb-inbox-empty-body">
          {filteredWorkspace
            ? t("app:sidebar.emptyThreadsBodyProject", {
                project: getWorkspaceLabel(filteredWorkspace),
              })
            : t("app:sidebar.emptyThreadsBody")}
        </span>
        <button type="button" className="sb-inbox-empty-action" onClick={onNewThread}>
          <Plus size={12} strokeWidth={1.8} />
          {t("app:sidebar.newThread")}
          <kbd>⌘⇧N</kbd>
        </button>
      </div>
    );
  }

  return (
    <div className="sb-status-view">
      {quiet && (
        <div className="sb-inbox-quiet">
          <span className="sb-inbox-quiet-mark">
            <Check size={9} strokeWidth={2.5} />
          </span>
          {t("app:sidebar.allCaughtUp")}
        </div>
      )}

      {renderSection("drafts", "app:sidebar.inboxDrafts")}
      {renderSection("needsYou", "app:sidebar.inboxNeedsYou")}
      {renderSection("working", "app:sidebar.inboxWorking")}
      {renderSection("done", "app:sidebar.inboxDone")}

      {groups.settled.length > 0 && (
        <div className="sb-status-shelf">
          <button
            type="button"
            className="sb-status-section-label"
            aria-expanded={shelfOpen}
            aria-label={t(
              shelfOpen ? "app:sidebar.collapseSection" : "app:sidebar.expandSection",
              { section: t("app:sidebar.statusSettled") },
            )}
            onClick={toggleSettledCollapsed}
          >
            {shelfOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span>{t("app:sidebar.statusSettled")}</span>
            <span className="sb-inbox-label-count">{groups.settled.length}</span>
          </button>

          {shelfOpen && (
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
                  {t("app:sidebar.moreCount", { count: settledPage.hiddenCount })}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
