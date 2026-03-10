import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { HarnessPanel } from "../onboarding/HarnessPanel";
import { WorkspaceSettingsPage } from "../workspace/WorkspaceSettingsPage";
import { GitPanel } from "../git/GitPanel";
import { isLinuxDesktop } from "../../lib/windowActions";
import { useUiStore } from "../../stores/uiStore";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";

const SIDEBAR_WIDTH_KEY = "panes:sidebar-width";
const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 380;
const DEFAULT_SIDEBAR = 220;

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const v = parseInt(stored, 10);
      if (v >= MIN_SIDEBAR && v <= MAX_SIDEBAR) return v;
    }
  } catch { /* ignore */ }
  return DEFAULT_SIDEBAR;
}

export function ThreeColumnLayout() {
  const showSidebar = useUiStore((state) => state.showSidebar);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const showGitPanel = useUiStore((state) => state.showGitPanel);
  const focusMode = useUiStore((state) => state.focusMode);
  const activeView = useUiStore((state) => state.activeView);
  const linuxDesktop = isLinuxDesktop();

  const sidebarVisible = showSidebar && sidebarPinned;
  const centerDefaultSize = showGitPanel ? 74 : 100;
  const fullBleedContent = focusMode || !showSidebar;
  const showFocusDragStrip = focusMode && !showSidebar && !showGitPanel && !linuxDesktop;

  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const draggingRef = useRef(false);
  const handleRef = useRef<HTMLDivElement>(null);

  // Persist sidebar width
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch { /* ignore */ }
  }, [sidebarWidth]);

  const handleSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    draggingRef.current = true;
    handleRef.current?.classList.add("dragging");

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + delta)));
    }
    function onUp() {
      draggingRef.current = false;
      handleRef.current?.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  return (
    <div className="layout-root">
      {/* Unpinned sidebar — collapsed rail + hover flyout */}
      {showSidebar && !sidebarPinned && <Sidebar />}

      {/* Pinned sidebar */}
      {sidebarVisible && (
        <div className="layout-sidebar" style={{ width: sidebarWidth }}>
          <Sidebar />
        </div>
      )}

      {/* Sidebar resize handle (pinned only) */}
      {sidebarVisible && (
        <div
          ref={handleRef}
          className="sidebar-resize-handle"
          onMouseDown={handleSidebarResizeMouseDown}
        />
      )}

      {/* Floating content card */}
      <div className={`content-card ${fullBleedContent ? "content-card-full" : ""}`}>
        {showFocusDragStrip && (
          <div
            className="focus-drag-strip"
            onMouseDown={handleDragMouseDown}
            onDoubleClick={handleDragDoubleClick}
          />
        )}
        <PanelGroup
          key={`${showGitPanel}`}
          direction="horizontal"
          style={{ height: "100%", flex: 1 }}
        >
          <Panel defaultSize={centerDefaultSize} minSize={35}>
            <div className="content-panel" style={{ height: "100%" }}>
              {activeView === "harnesses" ? (
                <HarnessPanel />
              ) : activeView === "workspace-settings" ? (
                <WorkspaceSettingsPage />
              ) : (
                <ChatPanel />
              )}
            </div>
          </Panel>

          {showGitPanel && <PanelResizeHandle className="resize-handle" />}

          {showGitPanel && (
            <Panel defaultSize={26} minSize={18} maxSize={40}>
              <div className="content-panel" style={{ height: "100%" }}>
                <GitPanel />
              </div>
            </Panel>
          )}
        </PanelGroup>
      </div>
    </div>
  );
}
