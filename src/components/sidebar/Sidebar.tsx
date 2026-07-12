import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  Command,
  Plus,
  FolderGit2,
  MessageSquare,
  Cog,
  ChevronDown,
  ChevronRight,
  Archive,
  RotateCcw,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Terminal,
  Rocket,
  RefreshCw,
  Gauge,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useUpdateStore } from "../../stores/updateStore";
import { formatRelativeTime } from "../../lib/formatters";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { createAndActivateWorkspaceThread } from "../../lib/newThreadActions";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { PanesMark } from "../shared/PanesBrand";
import { WorkspaceMoreMenu } from "../workspace/WorkspaceMoreMenu";
import { normalizeSidebarCollapsedState } from "./sidebarCollapseState";
import type { Thread, Workspace } from "../../types";

interface ProjectGroup {
  workspace: Workspace;
  threads: Thread[];
}

const MAX_VISIBLE_THREADS = 8;
const LEGACY_SCAN_DEPTH_STORAGE_KEY = "panes.workspace.scanDepth";
const LEGACY_SCAN_DEPTH_MIN = 0;
const LEGACY_SCAN_DEPTH_MAX = 12;

function readLegacyDefaultScanDepth(): number | undefined {
  const stored = window.localStorage.getItem(LEGACY_SCAN_DEPTH_STORAGE_KEY);
  if (!stored) return undefined;
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < LEGACY_SCAN_DEPTH_MIN || parsed > LEGACY_SCAN_DEPTH_MAX) {
    return undefined;
  }
  return parsed;
}

/* ─────────────────────────────────────────────────────
   Sidebar content — shared between pinned and flyout
   ───────────────────────────────────────────────────── */

function SidebarContent({ onPin }: { onPin?: () => void }) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const {
    workspaces,
    archivedWorkspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    setActiveRepo,
    openWorkspace,
    removeWorkspace,
    restoreWorkspace,
    refreshArchivedWorkspaces,
    error,
  } = useWorkspaceStore();
  const {
    threads,
    archivedThreadsByWorkspace,
    activeThreadId,
    setActiveThread,
    removeThread,
    restoreThread,
    refreshArchivedThreads,
  } = useThreadStore();
  const openOnboarding = useOnboardingStore((state) => state.openOnboarding);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const toggleSidebarPin = useUiStore((state) => state.toggleSidebarPin);
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const openSettings = useUiStore((state) => state.openSettings);
  const openWorkspaceSettings = useUiStore((state) => state.openWorkspaceSettings);
  const openCommandPalette = useUiStore((state) => state.openCommandPalette);
  const bindChatThread = useChatStore((s) => s.setActiveThread);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateSnoozed = useUpdateStore((s) => s.snoozed);
  const hasUpdate = updateStatus === "available" && !updateSnoozed;

  const projects = useMemo<ProjectGroup[]>(
    () =>
      workspaces.map((ws) => ({
        workspace: ws,
        threads: threads.filter((t) => t.workspaceId === ws.id),
      })),
    [workspaces, threads],
  );
  const workspaceIds = useMemo(() => workspaces.map((workspace) => workspace.id), [workspaces]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    normalizeSidebarCollapsedState(workspaceIds, activeWorkspaceId, {}, null),
  );
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archiveWorkspacePrompt, setArchiveWorkspacePrompt] = useState<{
    workspace: Workspace;
  } | null>(null);
  const [archiveThreadPrompt, setArchiveThreadPrompt] = useState<{
    thread: Thread;
  } | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsMenuPos, setSettingsMenuPos] = useState({ top: 0, left: 0 });
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const previousSyncedActiveWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);

  const closeSettingsMenu = useCallback(() => setSettingsMenuOpen(false), []);

  useEffect(() => {
    if (!settingsMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        settingsMenuRef.current?.contains(target) ||
        settingsTriggerRef.current?.contains(target)
      )
        return;
      closeSettingsMenu();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeSettingsMenu();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [settingsMenuOpen, closeSettingsMenu]);

  const archivedThreads = useMemo(
    () =>
      activeWorkspaceId
        ? archivedThreadsByWorkspace[activeWorkspaceId] ?? []
        : [],
    [archivedThreadsByWorkspace, activeWorkspaceId],
  );

  const toggleCollapse = (wsId: string) =>
    setCollapsed((prev) => ({ ...prev, [wsId]: !prev[wsId] }));

  useEffect(() => {
    setCollapsed((prev) =>
      normalizeSidebarCollapsedState(
        workspaceIds,
        activeWorkspaceId,
        prev,
        previousSyncedActiveWorkspaceIdRef.current,
      ),
    );
    previousSyncedActiveWorkspaceIdRef.current = activeWorkspaceId;
  }, [workspaceIds, activeWorkspaceId]);

  useEffect(() => {
    void refreshArchivedWorkspaces();
  }, [refreshArchivedWorkspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshArchivedThreads(activeWorkspaceId);
  }, [activeWorkspaceId, refreshArchivedThreads]);

  async function onOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await openWorkspace(selected, readLegacyDefaultScanDepth());
  }

  async function onSelectThread(thread: Thread) {
    if (activeView !== "chat") setActiveView("chat");
    if (thread.workspaceId !== activeWorkspaceId) {
      await setActiveWorkspace(thread.workspaceId);
    }
    if (thread.repoId) {
      setActiveRepo(thread.repoId);
    } else {
      setActiveRepo(null, { remember: false });
    }
    setActiveThread(thread.id);
    await bindChatThread(thread.id);
  }

  async function onSelectProject(wsId: string) {
    if (activeView !== "chat") setActiveView("chat");
    setCollapsed(
      Object.fromEntries(projects.map((p) => [p.workspace.id, p.workspace.id !== wsId]))
    );
    await setActiveWorkspace(wsId);
  }

  async function onCreateProjectThread(project: Workspace) {
    const createdThreadId = await createAndActivateWorkspaceThread(project.id);
    if (!createdThreadId) return;
    setCollapsed((prev) => ({ ...prev, [project.id]: false }));
  }

  function onDeleteWorkspace(project: Workspace) {
    setArchiveWorkspacePrompt({ workspace: project });
  }

  async function executeArchiveWorkspace(project: Workspace) {
    setArchiveWorkspacePrompt(null);
    const wasActive = project.id === activeWorkspaceId;
    await removeWorkspace(project.id);
    if (wasActive) {
      setActiveThread(null);
      await bindChatThread(null);
    }
  }

  function onDeleteThread(thread: Thread) {
    setArchiveThreadPrompt({ thread });
  }

  async function executeArchiveThread(thread: Thread) {
    setArchiveThreadPrompt(null);
    const wasActive = thread.id === activeThreadId;
    await removeThread(thread.id);
    if (wasActive) {
      setActiveThread(null);
      await bindChatThread(null);
    }
  }

  async function onRestoreWorkspace(workspace: Workspace) {
    await restoreWorkspace(workspace.id);
  }

  async function onRestoreThread(thread: Thread) {
    await restoreThread(thread.id);
  }

  function getWorkspaceLabel(workspace: Workspace) {
    return workspace.name || workspace.rootPath.split("/").pop() || t("app:sidebar.workspaceFallback");
  }

  function getThreadLabel(thread: Thread) {
    return thread.title?.trim() || t("app:sidebar.untitledThread");
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "inherit",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* ── Drag region ── */}
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{ height: 34, flexShrink: 0 }}
      />

      {/* ── Nav items ── */}
      <div style={{ padding: "0 8px 4px", flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* New thread */}
          <button
            type="button"
            className="sb-nav-item"
            onClick={() => {
              const activeProject = projects.find(
                (p) => p.workspace.id === activeWorkspaceId,
              );
              if (activeProject) {
                void onCreateProjectThread(activeProject.workspace);
              }
            }}
          >
            <Plus size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            {t("app:sidebar.newThread")}
            <span className="sb-nav-item-shortcut">⌘⇧N</span>
          </button>

          {/* Commands — general command palette */}
          <button
            type="button"
            className="sb-nav-item"
            onClick={() => openCommandPalette()}
          >
            <Command size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            {t("app:commandPalette.group.commands")}
            <span className="sb-nav-item-shortcut">⌘K</span>
          </button>

          {/* Search workspace */}
          <button
            type="button"
            className="sb-nav-item"
            onClick={() => openCommandPalette({ variant: "search", initialQuery: "?" })}
          >
            <Search size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            {t("app:sidebar.search")}
            <span className="sb-nav-item-shortcut">⌘⇧F</span>
          </button>

          {/* Agents */}
          <button
            type="button"
            className={`sb-nav-item${activeView === "harnesses" ? " sb-nav-item-active" : ""}`}
            onClick={() => setActiveView(activeView === "harnesses" ? "chat" : "harnesses")}
          >
            <Terminal size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            {t("app:sidebar.agents")}
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 4, borderTop: "1px solid var(--wash-06)", marginTop: 4 }}>
        <div className="sb-section-label">
          <span>{t("app:sidebar.workspaces")}</span>
          <button
            type="button"
            className="sb-add-project-btn"
            title={t("app:sidebar.openWorkspace")}
            onClick={() => {
              if (activeView !== "chat") setActiveView("chat");
              void onOpenFolder();
            }}
          >
            <Plus size={12} strokeWidth={2.2} />
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="sb-empty">
            {t("app:sidebar.noWorkspaces")}
            <br />
            {t("app:sidebar.openFolder")}
          </div>
        ) : (
          projects.map((project) => {
            const isActiveProject = project.workspace.id === activeWorkspaceId;
            const isCollapsed = collapsed[project.workspace.id] ?? false;
            const projectName = getWorkspaceLabel(project.workspace);
            const isShowingAll = showAll[project.workspace.id] ?? false;
            const visibleThreads = isShowingAll
              ? project.threads
              : project.threads.slice(0, MAX_VISIBLE_THREADS);
            const hasMore = project.threads.length > MAX_VISIBLE_THREADS;
            const constrainExpandedThreads = isShowingAll && hasMore;

            return (
              <div key={project.workspace.id} style={{ marginBottom: 2 }}>
                {/* Workspace header */}
                <button
                  type="button"
                  className={`sb-project ${isActiveProject ? "sb-project-active" : ""}`}
                  onClick={() => {
                    if (isActiveProject) {
                      toggleCollapse(project.workspace.id);
                    } else {
                      void onSelectProject(project.workspace.id);
                    }
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} style={{ flexShrink: 0, opacity: 0.4 }} />
                  ) : (
                    <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.4 }} />
                  )}
                  <FolderGit2
                    size={14}
                    style={{
                      flexShrink: 0,
                      color: isActiveProject ? "var(--accent)" : "var(--text-3)",
                    }}
                  />
                  <span className="sb-project-name">{projectName}</span>

                  <span className="sb-project-trailing">
                    {project.threads.length > 0 && (
                      <span className="sb-project-count">
                        {project.threads.length}
                      </span>
                    )}
                    <WorkspaceMoreMenu
                      workspace={project.workspace}
                      onOpenSettings={() => openWorkspaceSettings(project.workspace.id)}
                      onArchive={() => onDeleteWorkspace(project.workspace)}
                    />
                  </span>
                </button>

                {/* Threads — tree-line indented */}
                {!isCollapsed && (
                  <div
                    className={`sb-thread-tree${constrainExpandedThreads ? " sb-thread-tree-scrollable" : ""}`}
                  >
                    {project.threads.length === 0 ? (
                      <div className="sb-no-threads">{t("app:sidebar.noThreads")}</div>
                    ) : (
                      <>
                        {visibleThreads.map((thread, i) => {
                          const isActive = thread.id === activeThreadId;
                          return (
                            <div
                              key={thread.id}
                              role="button"
                              tabIndex={0}
                              className={`sb-thread sb-thread-animate ${isActive ? "sb-thread-active" : ""}`}
                              style={{ animationDelay: `${i * 20}ms` }}
                              onClick={() => void onSelectThread(thread)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void onSelectThread(thread);
                                }
                              }}
                            >
                              <span className="sb-thread-title">
                                {getThreadLabel(thread)}
                              </span>
                              <span className="sb-thread-trailing">
                                <span className="sb-thread-time">
                                  {thread.lastActivityAt
                                    ? formatRelativeTime(thread.lastActivityAt, i18n.language)
                                    : ""}
                                </span>
                                <button
                                  type="button"
                                  title={t("app:sidebar.archiveThread")}
                                  aria-label={t("app:sidebar.archiveThread")}
                                  className="sb-thread-archive"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onDeleteThread(thread);
                                  }}
                                >
                                  <Archive size={11} />
                                </button>
                              </span>
                            </div>
                          );
                        })}

                        {hasMore && !isShowingAll && (
                          <button
                            type="button"
                            className="sb-show-more"
                            onClick={() =>
                              setShowAll((prev) => ({
                                ...prev,
                                [project.workspace.id]: true,
                              }))
                            }
                          >
                            {t("app:sidebar.showMore", {
                              count: project.threads.length - MAX_VISIBLE_THREADS,
                            })}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Archived section */}
        <div style={{ marginTop: 8, borderTop: "1px solid var(--wash-06)", paddingTop: 4 }}>
          <button
            type="button"
            className="sb-archived-toggle"
            onClick={() => setArchivedOpen((c) => !c)}
          >
            {archivedOpen ? (
              <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            ) : (
              <ChevronRight size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            )}
            <Archive size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{ flex: 1, textAlign: "left" }}>{t("app:sidebar.archived")}</span>
            <span className="sb-project-count" style={{ fontSize: 9 }}>
              {archivedWorkspaces.length + archivedThreads.length}
            </span>
          </button>

          {archivedOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4 }}>
              {archivedWorkspaces.map((workspace) => (
                <div key={workspace.id} className="sb-archived-item">
                  <FolderGit2 size={12} style={{ flexShrink: 0, color: "var(--text-3)" }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={workspace.name || workspace.rootPath}
                  >
                    {getWorkspaceLabel(workspace)}
                  </span>
                  <button
                    type="button"
                    className="sb-archived-restore"
                    onClick={() => void onRestoreWorkspace(workspace)}
                    title={t("app:sidebar.restoreWorkspace")}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              ))}

              {archivedThreads.map((thread) => (
                <div key={thread.id} className="sb-archived-item">
                  <MessageSquare size={12} style={{ flexShrink: 0, color: "var(--text-3)" }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={getThreadLabel(thread)}
                  >
                    {getThreadLabel(thread)}
                  </span>
                  <button
                    type="button"
                    className="sb-archived-restore"
                    onClick={() => void onRestoreThread(thread)}
                    title={t("app:sidebar.restoreThread")}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              ))}

              {archivedWorkspaces.length === 0 && archivedThreads.length === 0 && (
                <div className="sb-no-threads">{t("app:sidebar.nothingArchived")}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="sb-footer">
        <button
          ref={settingsTriggerRef}
          type="button"
          className="sb-settings-btn"
          aria-expanded={settingsMenuOpen}
          onClick={() => {
            if (settingsMenuOpen) {
              closeSettingsMenu();
              return;
            }
            const rect = settingsTriggerRef.current?.getBoundingClientRect();
            if (rect) {
              setSettingsMenuPos({ top: rect.top - 4, left: rect.left });
            }
            setSettingsMenuOpen(true);
          }}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <Cog size={15} />
            {hasUpdate && <span className="sb-update-dot" />}
          </span>
          {t("app:sidebar.manage")}
          <ChevronDown size={12} style={{ marginLeft: "auto", opacity: 0.5 }} />
        </button>
        <button
          type="button"
          className="shell-pin-btn"
          onClick={onPin ?? toggleSidebarPin}
          title={sidebarPinned ? t("app:sidebar.unpin") : t("app:sidebar.pin")}
          aria-label={sidebarPinned ? t("app:sidebar.unpin") : t("app:sidebar.pin")}
        >
          {sidebarPinned ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
      </div>

      {/* Settings portal menu */}
      {settingsMenuOpen &&
        createPortal(
          <div
            ref={settingsMenuRef}
            className="git-action-menu"
            style={{
              position: "fixed",
              bottom: window.innerHeight - settingsMenuPos.top,
              left: settingsMenuPos.left,
              minWidth: 260,
            }}
          >
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => {
                closeSettingsMenu();
                openSettings(activeWorkspaceId);
              }}
            >
              <Settings size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              {t("app:sidebar.settings")}
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => {
                closeSettingsMenu();
                openSettings(activeWorkspaceId, "usage");
              }}
            >
              <Gauge size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              {t("app:sidebar.usageLimits")}
            </button>
            <div className="git-action-menu-divider" />
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => {
                closeSettingsMenu();
                openOnboarding();
              }}
            >
              <Rocket size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              {t("app:sidebar.engineSetup")}
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              style={{ justifyContent: "space-between" }}
              onClick={() => {
                closeSettingsMenu();
                openSettings(activeWorkspaceId, "about");
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <RefreshCw size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                {t("app:sidebar.aboutUpdates")}
              </span>
              {hasUpdate && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent-indicator)",
                    boxShadow: "0 0 0 1px var(--accent)",
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
          </div>,
          document.body,
        )}

      {createPortal(
        <ConfirmDialog
          open={archiveWorkspacePrompt !== null}
          title={t("app:sidebar.archiveWorkspaceTitle")}
          message={
            archiveWorkspacePrompt
              ? t("app:sidebar.archiveWorkspaceMessage", {
                  name: getWorkspaceLabel(archiveWorkspacePrompt.workspace),
                })
              : ""
          }
          confirmLabel={t("app:sidebar.archive")}
          onConfirm={() => {
            if (archiveWorkspacePrompt) void executeArchiveWorkspace(archiveWorkspacePrompt.workspace);
          }}
          onCancel={() => setArchiveWorkspacePrompt(null)}
        />,
        document.body,
      )}

      {createPortal(
        <ConfirmDialog
          open={archiveThreadPrompt !== null}
          title={t("app:sidebar.archiveThreadTitle")}
          message={
            archiveThreadPrompt
              ? t("app:sidebar.archiveThreadMessage", {
                  name: getThreadLabel(archiveThreadPrompt.thread),
                })
              : ""
          }
          confirmLabel={t("app:sidebar.archive")}
          onConfirm={() => {
            if (archiveThreadPrompt) void executeArchiveThread(archiveThreadPrompt.thread);
          }}
          onCancel={() => setArchiveThreadPrompt(null)}
        />,
        document.body,
      )}

      {error && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--danger)",
            borderTop: "1px solid var(--danger-border)",
            background: "var(--danger-surface)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   Collapsed rail — shown when unpinned
   ───────────────────────────────────────────────────── */

function CollapsedRail({
  onHoverStart,
  onHoverEnd,
  flyoutVisible,
}: {
  onHoverStart: () => void;
  onHoverEnd: () => void;
  flyoutVisible?: boolean;
}) {
  const { t } = useTranslation("app");
  const projects = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const hasUpdate = useUpdateStore((s) => s.status === "available" && !s.snoozed);
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const openSettings = useUiStore((s) => s.openSettings);
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);

  async function onNewThread() {
    const activeProject = projects.find((p) => p.id === activeWorkspaceId);
    if (!activeProject) return;
    await createAndActivateWorkspaceThread(activeProject.id);
  }

  return (
    <div
      className="sb-rail"
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      style={{
        opacity: flyoutVisible ? 0 : 1,
        transition: "opacity 150ms var(--ease-out)",
      }}
    >
      {/* Drag region + logo — 74px to clear macOS traffic lights */}
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          height: 74,
          width: "100%",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 4,
        }}
      >
        <button
          type="button"
          className="sb-rail-btn no-drag"
          onClick={() => void onNewThread()}
          disabled={!activeWorkspaceId}
          title={t("sidebar.newThread")}
          style={{
            opacity: activeWorkspaceId ? 1 : 0.45,
            border: "none",
            background: "transparent",
          }}
        >
          <PanesMark size={20} />
        </button>
      </div>

      <div className="sb-rail-divider" />

      {/* Nav icons — Commands, Search, Agents */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <button
          type="button"
          className="sb-rail-btn no-drag"
          onClick={() => openCommandPalette()}
          title={t("sidebar.commands", "Commands")}
          style={{ border: "none", background: "transparent" }}
        >
          <Command size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="sb-rail-btn no-drag"
          onClick={() => openCommandPalette({ variant: "search", initialQuery: "?" })}
          title={t("sidebar.search")}
          style={{ border: "none", background: "transparent" }}
        >
          <Search size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className={`sb-rail-btn no-drag ${activeView === "harnesses" ? "sb-rail-btn-active" : ""}`}
          onClick={() => setActiveView(activeView === "harnesses" ? "chat" : "harnesses")}
          title={t("sidebar.agents")}
          style={{ border: "none", background: "transparent" }}
        >
          <Terminal size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="sb-rail-divider" />

      {/* Project icons */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          paddingTop: 4,
          overflow: "auto",
        }}
      >
        {projects.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          const name = ws.name || ws.rootPath.split("/").pop() || "P";
          return (
            <button
              key={ws.id}
              type="button"
              className={`sb-rail-btn ${isActive ? "sb-rail-btn-active" : ""}`}
              title={ws.name || ws.rootPath}
              onClick={() => { if (activeView !== "chat") setActiveView("chat"); void setActiveWorkspace(ws.id); }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                {name.charAt(0).toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sb-rail-divider" />

      {/* Settings at bottom */}
      <button
        type="button"
        className={`sb-rail-btn ${activeView === "settings" ? "sb-rail-btn-active" : ""}`}
        title={t("sidebar.settings")}
        style={{ marginBottom: 8 }}
        onClick={() => openSettings(activeWorkspaceId)}
      >
        <Settings size={15} />
        {hasUpdate && <span className="sb-update-dot" />}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   Main Sidebar export
   ───────────────────────────────────────────────────── */

export function Sidebar() {
  const sidebarPinned = useUiStore((s) => s.sidebarPinned);
  const toggleSidebarPin = useUiStore((s) => s.toggleSidebarPin);
  const [hovered, setHovered] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // When pinned, render the full sidebar content directly
  if (sidebarPinned) {
    return <SidebarContent />;
  }

  // When unpinned, render rail + hover flyout
  const handleHoverStart = () => {
    clearTimeout(hoverTimeout.current);
    setHovered(true);
  };

  const handleHoverEnd = () => {
    hoverTimeout.current = setTimeout(() => setHovered(false), 200);
  };

  const handleFlyoutEnter = () => {
    clearTimeout(hoverTimeout.current);
    setHovered(true);
  };

  const handleFlyoutLeave = () => {
    hoverTimeout.current = setTimeout(() => setHovered(false), 150);
  };

  return (
    <>
      <CollapsedRail onHoverStart={handleHoverStart} onHoverEnd={handleHoverEnd} flyoutVisible={hovered} />

      {/* Flyout overlay */}
      {createPortal(
        <div
          className="sb-flyout-wrapper"
          onMouseEnter={handleFlyoutEnter}
          onMouseLeave={handleFlyoutLeave}
          style={{ pointerEvents: hovered ? "auto" : "none" }}
        >
          <div
            ref={flyoutRef}
            className={`shell-flyout shell-flyout-left ${hovered ? "shell-flyout-visible" : ""}`}
          >
            <SidebarContent
              onPin={() => {
                setHovered(false);
                toggleSidebarPin();
              }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
