import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Plus,
  FolderOpen,
  FolderGit2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Trash2,
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

export function Sidebar() {
  const {
    workspaces,
    repos,
    activeRepoId,
    activeWorkspaceId,
    setActiveWorkspace,
    setActiveRepo,
    openWorkspace,
    removeWorkspace,
    error,
  } = useWorkspaceStore();
  const { threads, activeThreadId, setActiveThread, removeThread, createThread } = useThreadStore();
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
  const toggleCollapse = (wsId: string) =>
    setCollapsed((prev) => ({ ...prev, [wsId]: !prev[wsId] }));

  async function onOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await openWorkspace(selected);
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
      `Remove workspace "${project.name}" and all related repos/threads/messages? This cannot be undone.`,
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
    const confirmed = window.confirm(`Delete thread "${threadLabel}"? This cannot be undone.`);
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
                    title="Remove workspace"
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
                    <Trash2 size={11} />
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
                                title="Delete thread"
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
                                <Trash2 size={11} />
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
      </div>

      {/* ── Settings ── */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={openEngineSetup}
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
          Engine setup
        </button>
      </div>

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
