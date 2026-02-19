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
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
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
  const { threads, activeThreadId, setActiveThread, removeThread } = useThreadStore();
  const bindChatThread = useChatStore((s) => s.setActiveThread);

  const projects = useMemo<ProjectGroup[]>(() => {
    return workspaces.map((ws) => ({
      workspace: ws,
      threads: threads.filter((t) => t.workspaceId === ws.id),
    }));
  }, [workspaces, threads]);

  // Track collapsed state per workspace — default open for active workspace
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (wsId: string) =>
    setCollapsed((prev) => ({ ...prev, [wsId]: !prev[wsId] }));

  async function onOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await openWorkspace(selected);
  }

  async function onSelectThread(thread: Thread) {
    // Switch to the project's workspace if needed
    if (thread.workspaceId !== activeWorkspaceId) {
      await setActiveWorkspace(thread.workspaceId);
    }
    if (thread.repoId) setActiveRepo(thread.repoId);
    setActiveThread(thread.id);
    await bindChatThread(thread.id);
  }

  async function onSelectProject(wsId: string) {
    // Expand the folder and switch workspace
    setCollapsed((prev) => ({ ...prev, [wsId]: false }));
    await setActiveWorkspace(wsId);
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
        className="drag-region"
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={() => void onOpenFolder()}
            style={{
              width: "100%",
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderRadius: "var(--radius-sm)",
              background: "var(--accent-dim)",
              border: "1px solid var(--border-accent)",
              color: "var(--accent)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all var(--duration-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "var(--accent-glow)";
              e.currentTarget.style.background = "rgba(14, 240, 195, 0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.background = "var(--accent-dim)";
            }}
          >
            <Plus size={15} strokeWidth={2.5} />
            New thread
          </button>
        </div>
      </div>


      {/* ── Projects Section ── */}
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

                  {/* Thread count badge */}
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

                {/* ── Chats inside this project ── */}
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
                      project.threads.map((thread, i) => {
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
                                ? "rgba(14, 240, 195, 0.08)"
                                : "transparent",
                              borderLeft: isActive
                                ? "2px solid var(--accent)"
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
                                opacity: isActive ? 0.9 : 0.35,
                                color: isActive ? "var(--accent)" : undefined,
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
                                opacity: 0.65,
                              }}
                            >
                              <Trash2 size={11} />
                            </span>

                            {/* Relative time */}
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
                          </button>
                        );
                      })
                    )}

                    {/* Repos under this workspace that have no thread yet */}
                    {repos
                      .filter(
                        (r) =>
                          r.workspaceId === project.workspace.id &&
                          !project.threads.some((t) => t.repoId === r.id),
                      )
                      .map((repo) => (
                        <button
                          key={repo.id}
                          type="button"
                          onClick={() => {
                            if (project.workspace.id !== activeWorkspaceId) {
                              void setActiveWorkspace(project.workspace.id);
                            }
                            setActiveRepo(repo.id);
                          }}
                          style={{
                            width: "100%",
                            padding: "5px 8px 5px 22px",
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            borderRadius: "var(--radius-sm)",
                            fontSize: 12,
                            color:
                              repo.id === activeRepoId
                                ? "var(--text-2)"
                                : "var(--text-3)",
                            background: "transparent",
                            cursor: "pointer",
                            transition:
                              "all var(--duration-fast) var(--ease-out)",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                              "rgba(255,255,255,0.03)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          <FolderOpen
                            size={12}
                            style={{ flexShrink: 0, opacity: 0.35 }}
                          />
                          <span style={{ opacity: 0.6 }}>{repo.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })
        )}
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
