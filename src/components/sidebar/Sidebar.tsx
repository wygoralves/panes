import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Plus,
  FolderOpen,
  FolderGit2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Archive,
  RotateCcw,
  Settings,
  Pin,
  PinOff,
  Package,
  Play,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useSetupStore } from "../../stores/setupStore";
import { useUpdateStore } from "../../stores/updateStore";
import { useHarnessStore } from "../../stores/harnessStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { UpdateDialog } from "../onboarding/UpdateDialog";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type { Thread, Workspace } from "../../types";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

interface ProjectGroup {
  workspace: Workspace;
  threads: Thread[];
}

const MAX_VISIBLE_THREADS = 8;
const DEFAULT_SCAN_DEPTH = 3;
const MIN_SCAN_DEPTH = 0;
const MAX_SCAN_DEPTH = 12;
const SCAN_DEPTH_STORAGE_KEY = "panes.workspace.scanDepth";

function readDefaultScanDepth(): number {
  const stored = window.localStorage.getItem(SCAN_DEPTH_STORAGE_KEY);
  if (!stored) return DEFAULT_SCAN_DEPTH;
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_DEPTH;
  if (parsed < MIN_SCAN_DEPTH || parsed > MAX_SCAN_DEPTH) return DEFAULT_SCAN_DEPTH;
  return parsed;
}

function parseScanDepth(input: string): number | null {
  const parsed = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < MIN_SCAN_DEPTH || parsed > MAX_SCAN_DEPTH) return null;
  return parsed;
}

/* ─────────────────────────────────────────────────────
   Sidebar content — shared between pinned and flyout
   ───────────────────────────────────────────────────── */

function SidebarContent({ onPin }: { onPin?: () => void }) {
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
  const openEngineSetup = useSetupStore((state) => state.openSetup);
  const openHarnessPanel = useHarnessStore((state) => state.openPanel);
  const installedHarnesses = useHarnessStore((state) => state.harnesses.filter((h) => h.found));
  const harnessLaunch = useHarnessStore((state) => state.launch);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const toggleSidebarPin = useUiStore((state) => state.toggleSidebarPin);
  const bindChatThread = useChatStore((s) => s.setActiveThread);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateSnoozed = useUpdateStore((s) => s.snoozed);
  const hasUpdate = updateStatus === "available" && !updateSnoozed;
  const wsActiveId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setTermLayoutMode = useTerminalStore((s) => s.setLayoutMode);
  const createTermSession = useTerminalStore((s) => s.createSession);
  const termWorkspaces = useTerminalStore((s) => s.workspaces);

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
  const [advancedScanOpen, setAdvancedScanOpen] = useState(false);
  const [advancedScanDraft, setAdvancedScanDraft] = useState(() =>
    String(readDefaultScanDepth()),
  );
  const [advancedScanError, setAdvancedScanError] = useState<string | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
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
    void refreshArchivedWorkspaces();
  }, [refreshArchivedWorkspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshArchivedThreads(activeWorkspaceId);
  }, [activeWorkspaceId, refreshArchivedThreads]);

  async function onOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await openWorkspace(selected, readDefaultScanDepth());
  }

  function toggleAdvancedScanConfig() {
    setAdvancedScanOpen((current) => {
      const next = !current;
      if (next) {
        setAdvancedScanDraft(String(readDefaultScanDepth()));
        setAdvancedScanError(null);
      }
      return next;
    });
  }

  function saveAdvancedScanConfig() {
    const parsedDepth = parseScanDepth(advancedScanDraft);
    if (parsedDepth === null) {
      setAdvancedScanError(
        `Use an integer between ${MIN_SCAN_DEPTH} and ${MAX_SCAN_DEPTH}.`,
      );
      return;
    }
    setAdvancedScanError(null);
    window.localStorage.setItem(SCAN_DEPTH_STORAGE_KEY, String(parsedDepth));
    setAdvancedScanOpen(false);
  }

  async function onSelectThread(thread: Thread) {
    if (thread.workspaceId !== activeWorkspaceId) {
      await setActiveWorkspace(thread.workspaceId);
    }
    setActiveRepo(thread.repoId ?? null);
    setActiveThread(thread.id);
    await bindChatThread(thread.id);
  }

  async function onSelectProject(wsId: string) {
    setCollapsed((prev) => ({ ...prev, [wsId]: false }));
    await setActiveWorkspace(wsId);
  }

  async function onCreateProjectThread(project: Workspace) {
    if (project.id !== activeWorkspaceId) {
      await setActiveWorkspace(project.id);
    }
    setActiveRepo(null);
    const createdThreadId = await createThread({
      workspaceId: project.id,
      repoId: null,
      title: "New Thread",
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
              title={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
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
            New thread
          </button>

          {/* Open project */}
          <button
            type="button"
            className="sb-open-project-btn"
            style={{ margin: 0 }}
            onClick={() => void onOpenFolder()}
          >
            <FolderOpen size={13} strokeWidth={2} />
            Open project
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 4 }}>
        <div className="sb-section-label">
          <span>Projects</span>
        </div>

        {projects.length === 0 ? (
          <div className="sb-empty">
            No projects yet.
            <br />
            Open a folder to get started.
          </div>
        ) : (
          projects.map((project) => {
            const isActiveProject = project.workspace.id === activeWorkspaceId;
            const isCollapsed = collapsed[project.workspace.id] ?? false;
            const projectName =
              project.workspace.name ||
              project.workspace.rootPath.split("/").pop() ||
              "Project";
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

                  <span
                    role="button"
                    title="Archive workspace"
                    className="sb-project-archive"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDeleteWorkspace(project.workspace);
                    }}
                  >
                    <Archive size={11} />
                  </span>
                </button>

                {/* Threads */}
                {!isCollapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 1 }}>
                    {project.threads.length === 0 ? (
                      <div className="sb-no-threads">No threads</div>
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
                                {thread.title || "Untitled thread"}
                              </span>
                              <span className="sb-thread-time">
                                {thread.lastActivityAt
                                  ? relativeTime(thread.lastActivityAt)
                                  : ""}
                              </span>
                              <span
                                role="button"
                                title="Archive thread"
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
                            Show {project.threads.length - MAX_VISIBLE_THREADS} more
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
            <span style={{ flex: 1, textAlign: "left" }}>Archived</span>
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
                    {workspace.name || workspace.rootPath.split("/").pop() || "Workspace"}
                  </span>
                  <button
                    type="button"
                    className="sb-archived-restore"
                    onClick={() => void onRestoreWorkspace(workspace)}
                    title="Restore workspace"
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
                    title={thread.title || "Untitled thread"}
                  >
                    {thread.title || "Untitled thread"}
                  </span>
                  <button
                    type="button"
                    className="sb-archived-restore"
                    onClick={() => void onRestoreThread(thread)}
                    title="Restore thread"
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              ))}

              {archivedWorkspaces.length === 0 && archivedThreads.length === 0 && (
                <div className="sb-no-threads">Nothing archived.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Harness quick-launch ── */}
      {installedHarnesses.length > 0 && (
        <div className="sb-harness-section">
          <div className="sb-harness-label">
            <Package size={9} style={{ opacity: 0.5 }} />
            Harnesses
          </div>
          <div className="sb-harness-list">
            {installedHarnesses.map((h) => (
              <button
                key={h.id}
                type="button"
                className="sb-harness-chip"
                title={`Launch ${h.name}`}
                onClick={() => {
                  void (async () => {
                    const cmd = await harnessLaunch(h.id);
                    if (!cmd || !wsActiveId) return;
                    const ws = termWorkspaces[wsActiveId];
                    if (!ws || (ws.layoutMode !== "terminal" && ws.layoutMode !== "split")) {
                      await setTermLayoutMode(wsActiveId, "terminal");
                    }
                    const sid = await createTermSession(wsActiveId);
                    if (sid) {
                      setTimeout(async () => {
                        try {
                          const { ipc } = await import("../../lib/ipc");
                          await ipc.terminalWrite(wsActiveId, sid, cmd + "\r");
                        } catch { /* ignore */ }
                      }, 300);
                    }
                  })();
                }}
              >
                <span className="sb-harness-chip-dot" />
                <Play size={9} />
                {h.name}
              </button>
            ))}
          </div>
        </div>
      )}

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
          Settings
        </button>

        {advancedScanOpen && (
          <div className="sb-scan-config">
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)" }}>
              Default depth used when opening new projects ({MIN_SCAN_DEPTH}-{MAX_SCAN_DEPTH}).
            </p>
            <input
              type="number"
              min={MIN_SCAN_DEPTH}
              max={MAX_SCAN_DEPTH}
              step={1}
              value={advancedScanDraft}
              className="sb-scan-input"
              onChange={(e) => {
                setAdvancedScanDraft(e.target.value);
                if (advancedScanError) setAdvancedScanError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveAdvancedScanConfig();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAdvancedScanOpen(false);
                  setAdvancedScanError(null);
                }
              }}
            />
            {advancedScanError && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--danger)" }}>
                {advancedScanError}
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setAdvancedScanOpen(false);
                  setAdvancedScanError(null);
                }}
                style={{ padding: "5px 9px", fontSize: 11.5, cursor: "pointer" }}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={saveAdvancedScanConfig}
                style={{ padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}
              >
                Save
              </button>
            </div>
          </div>
        )}
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
              minWidth: 180,
            }}
          >
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => {
                closeSettingsMenu();
                openEngineSetup();
              }}
            >
              Engine setup
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
              onClick={() => {
                closeSettingsMenu();
                openHarnessPanel();
              }}
            >
              <Package size={12} style={{ opacity: 0.5 }} />
              <span>Harnesses</span>
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onClick={() => {
                closeSettingsMenu();
                setUpdateDialogOpen(true);
              }}
            >
              <span>Check for updates</span>
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
            <div style={{ height: 1, margin: "4px 0", background: "var(--border)" }} />
            <button
              type="button"
              className="git-action-menu-item"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onClick={() => {
                closeSettingsMenu();
                toggleAdvancedScanConfig();
              }}
            >
              <span>Scan depth</span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11,
                  color: "var(--text-3)",
                }}
              >
                {readDefaultScanDepth()}
              </span>
            </button>
          </div>,
          document.body,
        )}

      <UpdateDialog open={updateDialogOpen} onClose={() => setUpdateDialogOpen(false)} />

      <ConfirmDialog
        open={archiveWorkspacePrompt !== null}
        title="Archive workspace"
        message={
          archiveWorkspacePrompt
            ? `Archive workspace "${archiveWorkspacePrompt.workspace.name}" and hide its repos/threads/messages from the sidebar? You can reopen this folder later to restore it.`
            : ""
        }
        confirmLabel="Archive"
        onConfirm={() => {
          if (archiveWorkspacePrompt) void executeArchiveWorkspace(archiveWorkspacePrompt.workspace);
        }}
        onCancel={() => setArchiveWorkspacePrompt(null)}
      />

      <ConfirmDialog
        open={archiveThreadPrompt !== null}
        title="Archive thread"
        message={
          archiveThreadPrompt
            ? `Archive thread "${archiveThreadPrompt.thread.title?.trim() || "Untitled thread"}"? It will be hidden from this project list.`
            : ""
        }
        confirmLabel="Archive"
        onConfirm={() => {
          if (archiveThreadPrompt) void executeArchiveThread(archiveThreadPrompt.thread);
        }}
        onCancel={() => setArchiveThreadPrompt(null)}
      />

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
  const projects = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const setActiveRepo = useWorkspaceStore((s) => s.setActiveRepo);
  const createThread = useThreadStore((s) => s.createThread);
  const bindChatThread = useChatStore((s) => s.setActiveThread);
  const hasUpdate = useUpdateStore((s) => s.status === "available" && !s.snoozed);

  async function onNewThread() {
    const activeProject = projects.find((p) => p.id === activeWorkspaceId);
    if (!activeProject) return;
    setActiveRepo(null);
    const createdThreadId = await createThread({
      workspaceId: activeProject.id,
      repoId: null,
      title: "New Thread",
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
      {/* Drag region for traffic lights */}
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{ height: 42, width: "100%", flexShrink: 0 }}
      />

      {/* New thread button */}
      <button
        type="button"
        className="sb-rail-btn"
        onClick={() => void onNewThread()}
        disabled={!activeWorkspaceId}
        title="New thread"
        style={{
          marginBottom: 4,
          color: activeWorkspaceId ? "var(--accent)" : "var(--text-3)",
          opacity: activeWorkspaceId ? 1 : 0.45,
          border: "1px solid var(--border-accent)",
          background: "var(--accent-dim)",
        }}
      >
        <Plus size={16} strokeWidth={2.2} />
      </button>

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
              onClick={() => void setActiveWorkspace(ws.id)}
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
        title="Settings"
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
