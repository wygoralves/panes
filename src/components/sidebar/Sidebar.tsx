import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  Plus,
  FolderGit2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Archive,
  RotateCcw,
  Settings,
  Pin,
  PinOff,
  Terminal,
  Check,
  Rocket,
  RefreshCw,
  PillBottle,
  BellRing,
  Globe,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useUpdateStore } from "../../stores/updateStore";
import { canToggleKeepAwake, useKeepAwakeStore } from "../../stores/keepAwakeStore";
import { useTerminalNotificationSettingsStore } from "../../stores/terminalNotificationSettingsStore";
import { toast } from "../../stores/toastStore";
import { ipc } from "../../lib/ipc";
import { formatRelativeTime } from "../../lib/formatters";
import {
  emitTerminalAcceleratedRenderingChanged,
  getTerminalAcceleratedRenderingPreferenceVersion,
} from "../../lib/terminalRenderingSettings";
import {
  normalizeAppLocale,
  SUPPORTED_APP_LOCALES,
  type AppLocale,
} from "../../lib/locale";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { UpdateDialog } from "../onboarding/UpdateDialog";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { WorkspaceMoreMenu } from "../workspace/WorkspaceMoreMenu";
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
    createThread,
    refreshArchivedThreads,
  } = useThreadStore();
  const openOnboarding = useOnboardingStore((state) => state.openOnboarding);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const toggleSidebarPin = useUiStore((state) => state.toggleSidebarPin);
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const openWorkspaceSettings = useUiStore((state) => state.openWorkspaceSettings);
  const bindChatThread = useChatStore((s) => s.setActiveThread);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateSnoozed = useUpdateStore((s) => s.snoozed);
  const keepAwakeState = useKeepAwakeStore((s) => s.state);
  const keepAwakeLoading = useKeepAwakeStore((s) => s.loading);
  const toggleKeepAwake = useKeepAwakeStore((s) => s.toggle);
  const openPowerSettings = useKeepAwakeStore((s) => s.openPowerSettings);
  const terminalNotificationSettings = useTerminalNotificationSettingsStore((s) => s.settings);
  const terminalNotificationLoading = useTerminalNotificationSettingsStore((s) => s.loading);
  const terminalNotificationLoadedOnce = useTerminalNotificationSettingsStore((s) => s.loadedOnce);
  const terminalNotificationUpdatingChatEnabled = useTerminalNotificationSettingsStore((s) => s.updatingChatEnabled);
  const terminalNotificationUpdatingTerminalEnabled = useTerminalNotificationSettingsStore((s) => s.updatingTerminalEnabled);
  const toggleTerminalNotifications = useTerminalNotificationSettingsStore((s) => s.toggle);
  const openTerminalNotificationSettings = useTerminalNotificationSettingsStore((s) => s.openModal);
  const hasUpdate = updateStatus === "available" && !updateSnoozed;
  const keepAwakeAvailable = canToggleKeepAwake(keepAwakeState);

  const projects = useMemo<ProjectGroup[]>(
    () =>
      workspaces.map((ws) => ({
        workspace: ws,
        threads: threads.filter((t) => t.workspaceId === ws.id),
      })),
    [workspaces, threads],
  );

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [archiveWorkspacePrompt, setArchiveWorkspacePrompt] = useState<{
    workspace: Workspace;
  } | null>(null);
  const [archiveThreadPrompt, setArchiveThreadPrompt] = useState<{
    thread: Thread;
  } | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsMenuPos, setSettingsMenuPos] = useState({ top: 0, left: 0 });
  const [terminalAcceleratedRendering, setTerminalAcceleratedRendering] = useState(true);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const activeLocale = normalizeAppLocale(i18n.language);

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

  useEffect(() => {
    let cancelled = false;
    const requestVersion = getTerminalAcceleratedRenderingPreferenceVersion();
    ipc
      .getTerminalAcceleratedRendering()
      .then((enabled) => {
        if (
          !cancelled &&
          getTerminalAcceleratedRenderingPreferenceVersion() === requestVersion
        ) {
          setTerminalAcceleratedRendering(enabled);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (project.id !== activeWorkspaceId) {
      await setActiveWorkspace(project.id);
    }
    setActiveRepo(null, { remember: false });
    const createdThreadId = await createThread({
      workspaceId: project.id,
      repoId: null,
      title: t("app:sidebar.newThreadTitle"),
    });
    if (!createdThreadId) return;
    setCollapsed((prev) => ({ ...prev, [project.id]: false }));
    await bindChatThread(createdThreadId);
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

  async function onLocaleSelect(locale: AppLocale) {
    if (locale === activeLocale) return;

    try {
      const savedLocale = await ipc.setAppLocale(locale);
      await i18n.changeLanguage(savedLocale);
      toast.info(t("common:language.changed"));
    } catch {
      toast.error(t("app:sidebar.languageFailed"));
    }
  }

  async function onToggleTerminalAcceleratedRendering() {
    const nextValue = !terminalAcceleratedRendering;

    try {
      const saved = await ipc.setTerminalAcceleratedRendering(nextValue);
      setTerminalAcceleratedRendering(saved);
      emitTerminalAcceleratedRenderingChanged(saved);
    } catch {
      toast.error(t("app:sidebar.terminalAcceleratedRenderingFailed"));
    }
  }

  function getWorkspaceLabel(workspace: Workspace) {
    return workspace.name || workspace.rootPath.split("/").pop() || t("app:sidebar.workspaceFallback");
  }

  function getThreadLabel(thread: Thread) {
    return thread.title?.trim() || t("app:sidebar.untitledThread");
  }

  const keepAwakeDescription = useMemo(() => {
    if (!keepAwakeState) {
      return t("app:sidebar.keepAwakeDescription");
    }
    if (!keepAwakeState?.supported) {
      return t("app:sidebar.keepAwakeUnsupported");
    }
    if (keepAwakeState.enabled && !keepAwakeState.active) {
      return t("app:sidebar.keepAwakeInactive");
    }
    if (
      keepAwakeState.enabled &&
      keepAwakeState.active &&
      keepAwakeState.supportsClosedDisplay === false &&
      keepAwakeState.closedDisplayActive === false
    ) {
      return t("app:sidebar.keepAwakeLimited");
    }
    return t("app:sidebar.keepAwakeDescription");
  }, [keepAwakeState, t]);
  const terminalNotificationDescription = useMemo(() => {
    if (!terminalNotificationLoadedOnce || !terminalNotificationSettings) {
      return t("app:sidebar.terminalNotificationsDescription");
    }
    if (terminalNotificationSettings.chatEnabled && terminalNotificationSettings.terminalEnabled) {
      return t("app:sidebar.terminalNotificationsEnabledAll");
    }
    if (terminalNotificationSettings.chatEnabled) {
      return t("app:sidebar.terminalNotificationsEnabledChat");
    }
    if (terminalNotificationSettings.terminalEnabled) {
      return t("app:sidebar.terminalNotificationsEnabledTerminal");
    }
    if (terminalNotificationSettings.terminalSetupComplete) {
      return t("app:sidebar.terminalNotificationsReady");
    }
    return t("app:sidebar.terminalNotificationsDescription");
  }, [terminalNotificationLoadedOnce, terminalNotificationSettings, t]);

  const terminalNotificationAnyEnabled =
    (terminalNotificationSettings?.chatEnabled ?? false)
    || (terminalNotificationSettings?.terminalEnabled ?? false);
  const terminalNotificationBusy =
    (terminalNotificationLoading && !terminalNotificationLoadedOnce)
    || terminalNotificationUpdatingChatEnabled
    || terminalNotificationUpdatingTerminalEnabled;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "inherit",
        minWidth: 0,
      }}
    >
      {/* ── Header — drag region + actions ── */}
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          padding: "42px 12px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Top row: Pin button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 2,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-3)",
              }}
            >
              Panes
            </span>
            <button
              type="button"
              className={`sb-pin-btn ${sidebarPinned ? "sb-pin-btn-active" : ""}`}
              onClick={onPin ?? toggleSidebarPin}
              title={sidebarPinned ? t("app:sidebar.unpin") : t("app:sidebar.pin")}
            >
              {sidebarPinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>
          </div>

          {/* New thread */}
          <button
            type="button"
            className="sb-new-thread-btn"
            style={{ margin: 0 }}
            onClick={() => {
              const activeProject = projects.find(
                (p) => p.workspace.id === activeWorkspaceId,
              );
              if (activeProject) {
                void onCreateProjectThread(activeProject.workspace);
              }
            }}
          >
            <Plus size={14} strokeWidth={2.2} />
            {t("app:sidebar.newThread")}
          </button>

          {/* Agents */}
          <button
            type="button"
            className={`sb-open-project-btn${activeView === "harnesses" ? " sb-btn-active" : ""}`}
            style={{ margin: 0 }}
            onClick={() => setActiveView(activeView === "harnesses" ? "chat" : "harnesses")}
          >
            <Terminal size={13} strokeWidth={2} />
            {t("app:sidebar.agents")}
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 4 }}>
        <div className="sb-section-label">
          <span>{t("app:sidebar.projects")}</span>
          <button
            type="button"
            className="sb-add-project-btn"
            title={t("app:sidebar.openProject")}
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
            {t("app:sidebar.noProjects")}
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

            return (
              <div key={project.workspace.id} style={{ marginBottom: 2 }}>
                {/* Project header */}
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
                </button>

                {/* Threads */}
                {!isCollapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 1 }}>
                    {project.threads.length === 0 ? (
                      <div className="sb-no-threads">{t("app:sidebar.noThreads")}</div>
                    ) : (
                      <>
                        {visibleThreads.map((thread, i) => {
                          const isActive = thread.id === activeThreadId;
                          return (
                            <button
                              key={thread.id}
                              type="button"
                              className={`sb-thread sb-thread-animate ${isActive ? "sb-thread-active" : ""}`}
                              style={{ animationDelay: `${i * 20}ms` }}
                              onClick={() => void onSelectThread(thread)}
                            >
                              <span className="sb-thread-title">
                                {getThreadLabel(thread)}
                              </span>
                              <span className="sb-thread-time">
                                {thread.lastActivityAt
                                  ? formatRelativeTime(thread.lastActivityAt, i18n.language)
                                  : ""}
                              </span>
                              <span
                                role="button"
                                title={t("app:sidebar.archiveThread")}
                                className="sb-thread-archive"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onDeleteThread(thread);
                                }}
                              >
                                <Archive size={11} />
                              </span>
                            </button>
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
        <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 4 }}>
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
            <Settings size={14} style={{ opacity: 0.5 }} />
            {hasUpdate && <span className="sb-update-dot" />}
          </span>
          {t("app:sidebar.settings")}
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
            {/* ── Preferences ── */}
            <div
              style={{
                padding: "6px 12px 4px",
                fontSize: 10,
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {t("app:sidebar.preferences")}
            </div>
            <div
              className="git-action-menu-item"
              style={{
                justifyContent: "space-between",
                opacity: keepAwakeLoading || !keepAwakeAvailable ? 0.5 : 1,
              }}
            >
              <button
                type="button"
                title={keepAwakeDescription}
                onClick={() => openPowerSettings()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  padding: 0,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <PillBottle size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                {t("app:sidebar.keepAwake")}
              </button>
              <label
                className="ws-toggle"
                title={keepAwakeDescription}
                onClick={(e) => e.stopPropagation()}
                style={{ cursor: keepAwakeLoading || !keepAwakeAvailable ? "not-allowed" : undefined }}
              >
                <input
                  type="checkbox"
                  checked={keepAwakeState?.enabled ?? false}
                  disabled={keepAwakeLoading || !keepAwakeAvailable}
                  onChange={() => void toggleKeepAwake()}
                />
                <span className="ws-toggle-track" />
                <span className="ws-toggle-thumb" />
              </label>
            </div>
            <div
              className="git-action-menu-item"
              style={{
                justifyContent: "space-between",
                opacity:
                  terminalNotificationBusy
                    ? 0.75
                    : 1,
              }}
            >
              <button
                type="button"
                title={terminalNotificationDescription}
                onClick={() => openTerminalNotificationSettings()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  padding: 0,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <BellRing size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                {t("app:sidebar.terminalNotifications")}
              </button>
              <label
                className="ws-toggle"
                title={terminalNotificationDescription}
                onClick={(e) => e.stopPropagation()}
                style={{
                  cursor:
                    terminalNotificationBusy
                      ? "wait"
                      : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={terminalNotificationAnyEnabled}
                  disabled={terminalNotificationBusy}
                  onChange={() => { void toggleTerminalNotifications(); }}
                />
                <span className="ws-toggle-track" />
                <span className="ws-toggle-thumb" />
              </label>
            </div>
            <div className="git-action-menu-item" style={{ justifyContent: "space-between", cursor: "default" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Globe size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                {t("common:language.label")}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 6,
                  padding: 2,
                  gap: 2,
                }}
              >
                {SUPPORTED_APP_LOCALES.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    onClick={() => { void onLocaleSelect(locale); }}
                    style={{
                      fontSize: 11,
                      lineHeight: 1,
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: "none",
                      cursor: "pointer",
                      background: activeLocale === locale ? "var(--accent)" : "transparent",
                      color: activeLocale === locale ? "#fff" : "var(--text-3)",
                      fontWeight: activeLocale === locale ? 500 : 400,
                      boxShadow: "none",
                      transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
                    }}
                  >
                    {locale === "en" ? "EN-US" : "PT-BR"}
                  </button>
                ))}
              </span>
            </div>

            <div className="git-action-menu-divider" />
            <div
              style={{
                padding: "6px 10px 4px",
                fontSize: 11,
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {t("app:sidebar.terminal")}
            </div>
            <button
              type="button"
              className="git-action-menu-item"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onClick={() => {
                void onToggleTerminalAcceleratedRendering();
              }}
            >
              <span>{t("app:sidebar.terminalAcceleratedRendering")}</span>
              {terminalAcceleratedRendering ? <Check size={12} /> : null}
            </button>
            <div className="git-action-menu-divider" />

            {/* ── Actions ── */}
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
                setUpdateDialogOpen(true);
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <RefreshCw size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                {t("app:sidebar.checkUpdates")}
              </span>
              {hasUpdate && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
          </div>,
          document.body,
        )}

      <UpdateDialog open={updateDialogOpen} onClose={() => setUpdateDialogOpen(false)} />

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
            borderTop: "1px solid rgba(248, 113, 113, 0.15)",
            background: "rgba(248, 113, 113, 0.06)",
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
  const setActiveRepo = useWorkspaceStore((s) => s.setActiveRepo);
  const createThread = useThreadStore((s) => s.createThread);
  const bindChatThread = useChatStore((s) => s.setActiveThread);
  const hasUpdate = useUpdateStore((s) => s.status === "available" && !s.snoozed);
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);

  async function onNewThread() {
    const activeProject = projects.find((p) => p.id === activeWorkspaceId);
    if (!activeProject) return;
    setActiveRepo(null, { remember: false });
    const createdThreadId = await createThread({
      workspaceId: activeProject.id,
      repoId: null,
      title: t("sidebar.newThreadTitle"),
    });
    if (!createdThreadId) return;
    await bindChatThread(createdThreadId);
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
          <svg viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
            <rect x="10" y="36" width="94" height="94" stroke="white" strokeWidth="6"/>
            <rect x="36" y="10" width="94" height="94" stroke="white" strokeWidth="6"/>
            <rect x="23" y="23" width="94" height="94" stroke="white" strokeWidth="6"/>
            <rect x="50" y="50" width="40" height="40" fill="#FF6B6B"/>
          </svg>
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
                  fontSize: 12,
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
        className="sb-rail-btn"
        title={t("sidebar.settings")}
        style={{ marginBottom: 8 }}
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
            className={`sb-flyout ${hovered ? "sb-flyout-visible" : ""}`}
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
