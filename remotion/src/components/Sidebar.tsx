import React from "react";
import {
  Plus,
  FolderGit2,
  ChevronDown,
  ChevronRight,
  Archive,
  Settings,
  Pin,
  Terminal,
} from "lucide-react";
import {
  workspaces,
  threads,
  type MockWorkspace,
  type MockThread,
} from "../data/mockData";

/* ─────────────────────────────────────────────────────
   Panes logo SVG — exact replica of the rail icon
   ───────────────────────────────────────────────────── */

function PanesLogo({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
    >
      <rect x="10" y="36" width="94" height="94" stroke="white" strokeWidth="6" />
      <rect x="36" y="10" width="94" height="94" stroke="white" strokeWidth="6" />
      <rect x="23" y="23" width="94" height="94" stroke="white" strokeWidth="6" />
      <rect x="50" y="50" width="40" height="40" fill="#48F3CD" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────
   Sidebar Content (full expanded view)
   ───────────────────────────────────────────────────── */

interface ProjectGroup {
  workspace: MockWorkspace;
  threads: MockThread[];
}

interface SidebarProps {
  /** Which workspace is selected */
  activeWorkspaceId?: string;
  /** Which thread is selected */
  activeThreadId?: string;
  /** Whether sidebar is pinned */
  pinned?: boolean;
  /** Which workspaces are collapsed */
  collapsedWorkspaces?: string[];
  /** Show archived section */
  showArchived?: boolean;
}

export function SidebarContent({
  activeWorkspaceId = "ws-1",
  activeThreadId = "t-1",
  pinned = true,
  collapsedWorkspaces = [],
  showArchived = false,
}: SidebarProps) {
  const projects: ProjectGroup[] = workspaces.map((ws) => ({
    workspace: ws,
    threads: threads.filter((t) => t.workspaceId === ws.id),
  }));

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
        style={{
          padding: "42px 12px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Top row: Brand + Pin */}
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
                textTransform: "uppercase" as const,
                color: "var(--text-3)",
              }}
            >
              Panes
            </span>
            <button
              type="button"
              className={`sb-pin-btn ${pinned ? "sb-pin-btn-active" : ""}`}
            >
              <Pin size={13} />
            </button>
          </div>

          {/* New thread */}
          <button
            type="button"
            className="sb-new-thread-btn"
            style={{ margin: 0 }}
          >
            <Plus size={14} strokeWidth={2.2} />
            New thread
          </button>

          {/* Agents */}
          <button
            type="button"
            className="sb-open-project-btn"
            style={{ margin: 0 }}
          >
            <Terminal size={13} strokeWidth={2} />
            Agents
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 4 }}>
        <div className="sb-section-label">
          <span>Projects</span>
          <button type="button" className="sb-add-project-btn" title="Open project">
            <Plus size={12} strokeWidth={2.2} />
          </button>
        </div>

        {projects.map((project) => {
          const isActiveProject = project.workspace.id === activeWorkspaceId;
          const isCollapsed = collapsedWorkspaces.includes(project.workspace.id);
          const projectName =
            project.workspace.name ||
            project.workspace.rootPath.split("/").pop() ||
            "Project";

          return (
            <div key={project.workspace.id} style={{ marginBottom: 2 }}>
              {/* Project header */}
              <button
                type="button"
                className={`sb-project ${isActiveProject ? "sb-project-active" : ""}`}
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

                <span className="sb-project-archive">
                  <Archive size={11} />
                </span>
              </button>

              {/* Threads */}
              {!isCollapsed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 1 }}>
                  {project.threads.length === 0 ? (
                    <div className="sb-no-threads">No threads</div>
                  ) : (
                    project.threads.map((thread, i) => {
                      const isActive = thread.id === activeThreadId;
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          className={`sb-thread sb-thread-animate ${isActive ? "sb-thread-active" : ""}`}
                          style={{ animationDelay: `${i * 20}ms` }}
                        >
                          <span className="sb-thread-title">
                            {thread.title || "Untitled thread"}
                          </span>
                          <span className="sb-thread-time">
                            {thread.lastActivityAt}
                          </span>
                          <span className="sb-thread-archive">
                            <Archive size={11} />
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Archived section */}
        <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 4 }}>
          <button type="button" className="sb-archived-toggle">
            {showArchived ? (
              <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            ) : (
              <ChevronRight size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            )}
            <Archive size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{ flex: 1, textAlign: "left" as const }}>Archived</span>
            <span className="sb-project-count" style={{ fontSize: 9 }}>
              0
            </span>
          </button>

          {showArchived && (
            <div className="sb-no-threads">Nothing archived.</div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="sb-footer">
        <button type="button" className="sb-settings-btn">
          <span style={{ position: "relative" as const, display: "inline-flex" }}>
            <Settings size={14} style={{ opacity: 0.5 }} />
          </span>
          Settings
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   Collapsed Rail — shown when unpinned
   ───────────────────────────────────────────────────── */

export function CollapsedRail({
  activeWorkspaceId = "ws-1",
}: {
  activeWorkspaceId?: string;
}) {
  return (
    <div className="sb-rail">
      {/* Drag region + logo — total 74px to align with chat header */}
      <div
        style={{
          height: 74,
          width: "100%",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 4,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button type="button" className="sb-rail-btn" title="New thread">
          <PanesLogo size={24} />
        </button>
      </div>

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
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          const name = ws.name || ws.rootPath.split("/").pop() || "P";
          return (
            <button
              key={ws.id}
              type="button"
              className={`sb-rail-btn ${isActive ? "sb-rail-btn-active" : ""}`}
              title={ws.name || ws.rootPath}
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
      <button type="button" className="sb-rail-btn" title="Settings" style={{ marginBottom: 8 }}>
        <Settings size={15} />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   Sidebar — main export (pinned mode for videos)
   ───────────────────────────────────────────────────── */

export function Sidebar(props: SidebarProps) {
  return <SidebarContent {...props} />;
}
