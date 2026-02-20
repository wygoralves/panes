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
  Filter,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
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
  if (!stored) {
    return DEFAULT_SCAN_DEPTH;
  }

  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SCAN_DEPTH;
  }

  if (parsed < MIN_SCAN_DEPTH || parsed > MAX_SCAN_DEPTH) {
    return DEFAULT_SCAN_DEPTH;
  }

  return parsed;
}

function parseScanDepth(input: string): number | null {
  const parsed = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < MIN_SCAN_DEPTH || parsed > MAX_SCAN_DEPTH) {
    return null;
  }

  return parsed;
}

export function Sidebar() {
  const {
    workspaces,
    archivedWorkspaces,
    repos,
    activeRepoId,
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
  const openEngineSetup = useUiStore((state) => state.openEngineSetup);
  const bindChatThread = useChatStore((s) => s.setActiveThread);

  const projects = useMemo<ProjectGroup[]>(() => {
    return workspaces.map((ws) => ({
      workspace: ws,
      threads: threads.filter((t) => t.workspaceId === ws.id),
    }));
  }, [workspaces, threads]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [advancedScanOpen, setAdvancedScanOpen] = useState(false);
  const [advancedScanDraft, setAdvancedScanDraft] = useState(() =>
    String(readDefaultScanDepth()),
  );
  const [advancedScanError, setAdvancedScanError] = useState<string | null>(null);
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
      ) return;
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
    if (!activeWorkspaceId) {
      return;
    }
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

    if (!createdThreadId) {
      return;
    }

    setCollapsed((prev) => ({ ...prev, [project.id]: false }));
    await bindChatThread(createdThreadId);
  }

  async function onDeleteWorkspace(project: Workspace) {
    const confirmed = window.confirm(
      `Archive workspace "${project.name}" and hide its repos/threads/messages from the sidebar? You can reopen this folder later to restore it.`,
    );
    if (!confirmed) {
      return;
    }

    const wasActive = project.id === activeWorkspaceId;
    await removeWorkspace(project.id);

    if (wasActive) {
      setActiveThread(null);
      await bindChatThread(null);
    }
  }

  async function onDeleteThread(thread: Thread) {
    const threadLabel = thread.title?.trim() || "Untitled thread";
    const confirmed = window.confirm(
      `Archive thread "${threadLabel}"? It will be hidden from this project list.`,
    );
    if (!confirmed) {
      return;
    }

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

  function toggleArchivedSection() {
    setArchivedOpen((current) => !current);
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
      }}
    >
      {/* ── Header ── */}
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          padding: "42px 14px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* New thread button */}
          <button
            type="button"
            onClick={() => {
              const activeProject = projects.find((p) => p.workspace.id === activeWorkspaceId);
              if (activeProject) {
                void onCreateProjectThread(activeProject.workspace);
              }
            }}
            style={{
              width: "100%",
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              color: "var(--text-1)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all var(--duration-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-4)";
              e.currentTarget.style.borderColor = "var(--border-active)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-3)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <Plus size={14} strokeWidth={2.2} />
            New thread
          </button>

          {/* Open project button */}
          <button
            type="button"
            onClick={() => void onOpenFolder()}
            style={{
              width: "100%",
              padding: "7px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
              fontSize: 12,
              fontWeight: 400,
              cursor: "pointer",
              transition: "all var(--duration-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-3)";
              e.currentTarget.style.color = "var(--text-1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-2)";
            }}
          >
            <FolderOpen size={13} strokeWidth={2} />
            Open Project
          </button>
        </div>
      </div>

      {/* ── Threads Section ── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "6px 8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 6px 6px",
          }}
        >
          <span className="section-label">Projects</span>
          <Filter size={12} style={{ color: "var(--text-3)", opacity: 0.6 }} />
        </div>

        {projects.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: "20px 8px",
              color: "var(--text-3)",
              fontSize: 12,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            No projects yet.
            <br />
            Open a folder to get started.
          </p>
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
                {/* ── Project Folder Header ── */}
                <button
                  type="button"
                  onClick={() => {
                    if (isActiveProject) {
                      toggleCollapse(project.workspace.id);
                    } else {
                      void onSelectProject(project.workspace.id);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "6px 6px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13,
                    fontWeight: isActiveProject ? 500 : 400,
                    color: isActiveProject ? "var(--text-1)" : "var(--text-2)",
                    background: isActiveProject
                      ? "rgba(255,255,255,0.04)"
                      : "transparent",
                    cursor: "pointer",
                    transition: "all var(--duration-fast) var(--ease-out)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActiveProject)
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActiveProject)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight
                      size={13}
                      style={{ flexShrink: 0, opacity: 0.4 }}
                    />
                  ) : (
                    <ChevronDown
                      size={13}
                      style={{ flexShrink: 0, opacity: 0.4 }}
                    />
                  )}
                  <FolderGit2
                    size={14}
                    style={{
                      flexShrink: 0,
                      color: isActiveProject ? "var(--accent)" : "var(--text-3)",
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {projectName}
                  </span>

                  {project.threads.length > 0 && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 500,
                        padding: "1px 6px",
                        borderRadius: 99,
                        background: "rgba(255,255,255,0.06)",
                        color: "var(--text-3)",
                      }}
                    >
                      {project.threads.length}
                    </span>
                  )}

                  <span
                    role="button"
                    title="Archive workspace"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDeleteWorkspace(project.workspace);
                    }}
                    style={{
                      marginLeft: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      color: "var(--text-3)",
                      opacity: 0.65,
                    }}
                  >
                    <Archive size={11} />
                  </span>
                </button>

                {/* ── Threads inside this project ── */}
                {!isCollapsed && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      paddingLeft: 8,
                      marginTop: 1,
                    }}
                  >
                    {project.threads.length === 0 ? (
                      <p
                        style={{
                          margin: 0,
                          padding: "4px 6px 4px 28px",
                          fontSize: 11.5,
                          color: "var(--text-3)",
                          fontStyle: "italic",
                        }}
                      >
                        No threads
                      </p>
                    ) : (
                      <>
                        {visibleThreads.map((thread, i) => {
                          const isActive = thread.id === activeThreadId;
                          return (
                            <button
                              key={thread.id}
                              type="button"
                              onClick={() => void onSelectThread(thread)}
                              className="animate-slide-in-left"
                              style={{
                                animationDelay: `${i * 25}ms`,
                                width: "100%",
                                padding: "6px 8px 6px 22px",
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                borderRadius: "var(--radius-sm)",
                                fontSize: 12.5,
                                textAlign: "left",
                                cursor: "pointer",
                                transition: "all var(--duration-fast) var(--ease-out)",
                                background: isActive
                                  ? "rgba(255, 255, 255, 0.06)"
                                  : "transparent",
                                borderLeft: isActive
                                  ? "2px solid var(--text-1)"
                                  : "2px solid transparent",
                                color: isActive ? "var(--text-1)" : "var(--text-2)",
                              }}
                              onMouseEnter={(e) => {
                                if (!isActive)
                                  e.currentTarget.style.background =
                                    "rgba(255,255,255,0.03)";
                              }}
                              onMouseLeave={(e) => {
                                if (!isActive)
                                  e.currentTarget.style.background = "transparent";
                              }}
                            >
                              <MessageSquare
                                size={13}
                                style={{
                                  flexShrink: 0,
                                  opacity: isActive ? 0.8 : 0.35,
                                }}
                              />
                              <span
                                style={{
                                  flex: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontWeight: isActive ? 500 : 400,
                                }}
                              >
                                {thread.title || "Untitled thread"}
                              </span>

                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 11,
                                  color: "var(--text-3)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {thread.lastActivityAt
                                  ? relativeTime(thread.lastActivityAt)
                                  : ""}
                              </span>

                              <span
                                role="button"
                                title="Archive thread"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onDeleteThread(thread);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 18,
                                  height: 18,
                                  borderRadius: 6,
                                  color: "var(--text-3)",
                                  opacity: 0,
                                  transition: "opacity var(--duration-fast)",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.opacity = "0.8";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.opacity = "0";
                                }}
                              >
                                <Archive size={11} />
                              </span>
                            </button>
                          );
                        })}

                        {/* Show more */}
                        {hasMore && !isShowingAll && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowAll((prev) => ({
                                ...prev,
                                [project.workspace.id]: true,
                              }))
                            }
                            style={{
                              padding: "4px 8px 4px 30px",
                              fontSize: 11.5,
                              color: "var(--text-3)",
                              background: "transparent",
                              cursor: "pointer",
                              textAlign: "left",
                              transition: "color var(--duration-fast)",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "var(--text-2)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--text-3)";
                            }}
                          >
                            Show more
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

        <div style={{ marginTop: 12, padding: "8px 6px 2px" }}>
          <button
            type="button"
            onClick={toggleArchivedSection}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 4px",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              color: "var(--text-3)",
              cursor: "pointer",
              fontSize: 12,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = "var(--text-2)";
              event.currentTarget.style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = "var(--text-3)";
              event.currentTarget.style.background = "transparent";
            }}
          >
            {archivedOpen ? (
              <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            ) : (
              <ChevronRight size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            )}
            <Archive size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            <span style={{ flex: 1, textAlign: "left" }}>Archived</span>
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-3)",
              }}
            >
              {archivedWorkspaces.length + archivedThreads.length}
            </span>
          </button>

          {archivedOpen && (
            <div
              style={{
                marginTop: 6,
                paddingLeft: 6,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {archivedWorkspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <FolderGit2 size={12} style={{ flexShrink: 0, color: "var(--text-3)" }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 11.5,
                      color: "var(--text-2)",
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
                    onClick={() => void onRestoreWorkspace(workspace)}
                    title="Restore workspace"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      color: "var(--text-3)",
                      cursor: "pointer",
                    }}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              ))}

              {archivedThreads.map((thread) => (
                <div
                  key={thread.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <MessageSquare size={12} style={{ flexShrink: 0, color: "var(--text-3)" }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 11.5,
                      color: "var(--text-2)",
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
                    onClick={() => void onRestoreThread(thread)}
                    title="Restore thread"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      color: "var(--text-3)",
                      cursor: "pointer",
                    }}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              ))}

              {archivedWorkspaces.length === 0 && archivedThreads.length === 0 && (
                <p
                  style={{
                    margin: 0,
                    padding: "4px 2px",
                    fontSize: 11,
                    color: "var(--text-3)",
                    fontStyle: "italic",
                  }}
                >
                  Nothing archived.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Settings ── */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <button
          ref={settingsTriggerRef}
          type="button"
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 4px",
            fontSize: 13,
            color: "var(--text-2)",
            background: "transparent",
            cursor: "pointer",
            width: "100%",
            borderRadius: "var(--radius-sm)",
            transition: "color var(--duration-fast)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-2)";
          }}
        >
          <Settings size={14} style={{ opacity: 0.6 }} />
          Settings
        </button>

        {advancedScanOpen && (
          <div
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-2)",
              padding: "8px",
              display: "grid",
              gap: 6,
            }}
          >
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)" }}>
              Default depth used when opening new projects ({MIN_SCAN_DEPTH}-{MAX_SCAN_DEPTH}).
            </p>
            <input
              type="number"
              min={MIN_SCAN_DEPTH}
              max={MAX_SCAN_DEPTH}
              step={1}
              value={advancedScanDraft}
              onChange={(event) => {
                setAdvancedScanDraft(event.target.value);
                if (advancedScanError) {
                  setAdvancedScanError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveAdvancedScanConfig();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setAdvancedScanOpen(false);
                  setAdvancedScanError(null);
                }
              }}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-1)",
                color: "var(--text-1)",
                fontSize: 12,
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
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onClick={() => {
                closeSettingsMenu();
                toggleAdvancedScanConfig();
              }}
            >
              <span>Scan depth</span>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: "var(--text-3)" }}>
                {readDefaultScanDepth()}
              </span>
            </button>
          </div>,
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
