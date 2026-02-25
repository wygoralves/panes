import React from "react";
import { PanesSidebar, PanesSidebarRail } from "./PanesSidebar";
import { PanesChatPanel } from "./PanesChatPanel";
import { PanesGitPanel } from "./PanesGitPanel";
import { PanesTerminalPanel } from "./PanesTerminalPanel";
import { PanesFileEditor } from "./PanesFileEditor";

/* ── Resize Handle (visual only) ── */

function ResizeHandle({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) {
  if (direction === "horizontal") {
    return (
      <div
        className="resize-handle-vertical"
        style={{ width: "100%", height: 1 }}
      />
    );
  }
  return <div className="resize-handle" style={{ width: 1, height: "100%" }} />;
}

/* ── Layout mode switcher (visual only) ── */

function LayoutModeSwitcher({ active = "chat" }: { active?: "chat" | "editor" | "split" }) {
  return (
    <div className="layout-mode-switcher">
      <button className={`layout-mode-btn ${active === "chat" ? "active" : ""}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button className={`layout-mode-btn ${active === "split" ? "active" : ""}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button className={`layout-mode-btn ${active === "editor" ? "active" : ""}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   PanesApp — Full 1:1 three-column layout replica
   ───────────────────────────────────────────────────── */

export function PanesApp({
  showSidebar = true,
  sidebarPinned = true,
  showGitPanel = true,
  showTerminal = false,
  showFileEditor = false,
  showMultiRepo = false,
  layoutMode = "chat" as "chat" | "editor" | "split",
  sidebarWidth = "18%",
  centerWidth = "56%",
  gitWidth = "26%",
}: {
  showSidebar?: boolean;
  sidebarPinned?: boolean;
  showGitPanel?: boolean;
  showTerminal?: boolean;
  showFileEditor?: boolean;
  showMultiRepo?: boolean;
  layoutMode?: "chat" | "editor" | "split";
  sidebarWidth?: string;
  centerWidth?: string;
  gitWidth?: string;
}) {
  // Calculate widths based on visible panels
  const effectiveSidebarWidth = showSidebar && sidebarPinned ? sidebarWidth : "0";
  const effectiveGitWidth = showGitPanel ? gitWidth : "0";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "var(--bg-0)",
        overflow: "hidden",
        fontFamily: '"Sora", system-ui, -apple-system, sans-serif',
        fontSize: 13,
        color: "var(--text-1)",
        lineHeight: 1.5,
      }}
    >
      {/* ── Unpinned sidebar rail ── */}
      {showSidebar && !sidebarPinned && <PanesSidebarRail />}

      {/* ── Pinned sidebar ── */}
      {showSidebar && sidebarPinned && (
        <>
          <div
            className="panel panel-border-r"
            style={{ width: effectiveSidebarWidth, flexShrink: 0, height: "100%" }}
          >
            <PanesSidebar pinned={true} />
          </div>
          <ResizeHandle />
        </>
      )}

      {/* ── Center column ── */}
      <div
        className="panel"
        style={{
          flex: 1,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* Layout depends on mode */}
        {layoutMode === "chat" && !showTerminal && !showFileEditor && (
          <PanesChatPanel />
        )}

        {layoutMode === "chat" && showTerminal && (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PanesChatPanel />
            </div>
            <ResizeHandle direction="horizontal" />
            <div className="terminal-split-panel" style={{ height: "35%", flexShrink: 0 }}>
              <PanesTerminalPanel />
            </div>
          </>
        )}

        {layoutMode === "editor" && (
          <PanesFileEditor />
        )}

        {layoutMode === "split" && (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PanesChatPanel />
            </div>
            <ResizeHandle direction="horizontal" />
            <div style={{ height: "40%", flexShrink: 0, borderTop: "1px solid var(--border)" }}>
              <PanesFileEditor />
            </div>
          </>
        )}
      </div>

      {/* ── Git panel ── */}
      {showGitPanel && (
        <>
          <ResizeHandle />
          <div
            className="panel"
            style={{ width: effectiveGitWidth, flexShrink: 0, height: "100%" }}
          >
            <PanesGitPanel
              activeView="changes"
              showMultiRepo={showMultiRepo}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   PanesAppWithTerminal — Convenient preset
   ───────────────────────────────────────────────────── */

export function PanesAppWithTerminal() {
  return (
    <PanesApp
      showSidebar={true}
      sidebarPinned={true}
      showGitPanel={true}
      showTerminal={true}
    />
  );
}

/* ─────────────────────────────────────────────────────
   PanesAppWithEditor — File editor mode
   ───────────────────────────────────────────────────── */

export function PanesAppWithEditor() {
  return (
    <PanesApp
      showSidebar={true}
      sidebarPinned={true}
      showGitPanel={true}
      showFileEditor={true}
      layoutMode="editor"
    />
  );
}

/* ─────────────────────────────────────────────────────
   PanesAppSplitView — Chat + Editor split
   ───────────────────────────────────────────────────── */

export function PanesAppSplitView() {
  return (
    <PanesApp
      showSidebar={true}
      sidebarPinned={true}
      showGitPanel={true}
      layoutMode="split"
    />
  );
}

/* ─────────────────────────────────────────────────────
   PanesAppMultiRepo — Multi-repo git panel
   ───────────────────────────────────────────────────── */

export function PanesAppMultiRepo() {
  return (
    <PanesApp
      showSidebar={true}
      sidebarPinned={true}
      showGitPanel={true}
      showMultiRepo={true}
    />
  );
}
