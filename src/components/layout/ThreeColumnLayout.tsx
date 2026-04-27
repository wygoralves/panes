import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ActiveWorkspacePaneShell } from "../workspace/WorkspacePaneShell";
import { HarnessPanel } from "../onboarding/HarnessPanel";
import { WorkspaceSettingsPage } from "../workspace/WorkspaceSettingsPage";
import { GitPanel } from "../git/GitPanel";
import { usesCustomWindowFrame } from "../../lib/windowActions";
import { useUiStore } from "../../stores/uiStore";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import {
  GitFlyoutContext,
  isTargetWithinGitFlyoutRegion,
} from "../../lib/gitFlyoutRegion";

const SIDEBAR_WIDTH_KEY = "panes:sidebar-width";
const GIT_PANEL_SIZE_KEY = "panes:git-panel-size";
const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 380;
const DEFAULT_SIDEBAR = 220;
const MIN_GIT_PANEL_SIZE = 18;
const MAX_GIT_PANEL_SIZE = 40;
const DEFAULT_GIT_PANEL_SIZE = 26;
const MIN_GIT_FLYOUT_WIDTH = 260;
const MAX_GIT_FLYOUT_WIDTH = 560;
const RESIZE_HANDLE_CLICK_THRESHOLD = 4;

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

function loadGitPanelSize(): number {
  try {
    const stored = localStorage.getItem(GIT_PANEL_SIZE_KEY);
    if (stored) {
      const value = Number.parseFloat(stored);
      if (value >= MIN_GIT_PANEL_SIZE && value <= MAX_GIT_PANEL_SIZE) {
        return value;
      }
    }
  } catch {
    // Ignore storage failures in non-browser/test environments.
  }
  return DEFAULT_GIT_PANEL_SIZE;
}

export function ThreeColumnLayout() {
  const { t } = useTranslation("git");
  const showSidebar = useUiStore((state) => state.showSidebar);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const toggleSidebarPin = useUiStore((state) => state.toggleSidebarPin);
  const showGitPanel = useUiStore((state) => state.showGitPanel);
  const gitPanelPinned = useUiStore((state) => state.gitPanelPinned);
  const setGitPanelPinned = useUiStore((state) => state.setGitPanelPinned);
  const focusMode = useUiStore((state) => state.focusMode);
  const activeView = useUiStore((state) => state.activeView);
  const customWindowFrame = usesCustomWindowFrame();

  const sidebarDocked = showSidebar && sidebarPinned;
  const gitPanelDocked = showGitPanel && gitPanelPinned;
  const fullBleedContent = focusMode || !showSidebar;
  const showFocusDragStrip = focusMode && !showSidebar && !gitPanelDocked && !customWindowFrame;

  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [gitPanelSize, setGitPanelSize] = useState(loadGitPanelSize);
  const [contentCardWidth, setContentCardWidth] = useState(0);
  const [gitFlyoutVisible, setGitFlyoutVisible] = useState(false);
  const sidebarHandleRef = useRef<HTMLDivElement>(null);
  const contentCardRef = useRef<HTMLDivElement>(null);
  const gitFlyoutRef = useRef<HTMLDivElement>(null);
  const gitTriggerRef = useRef<HTMLButtonElement>(null);
  const gitFlyoutCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch { /* ignore */ }
  }, [sidebarWidth]);

  useEffect(() => {
    try { localStorage.setItem(GIT_PANEL_SIZE_KEY, String(gitPanelSize)); } catch { /* ignore */ }
  }, [gitPanelSize]);

  useEffect(() => {
    const contentCard = contentCardRef.current;
    if (!contentCard) {
      return;
    }

    const updateWidth = () => {
      setContentCardWidth(contentCard.getBoundingClientRect().width);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(contentCard);
    return () => observer.disconnect();
  }, []);

  const clearGitFlyoutCloseTimer = useCallback(() => {
    if (gitFlyoutCloseTimerRef.current !== null) {
      window.clearTimeout(gitFlyoutCloseTimerRef.current);
      gitFlyoutCloseTimerRef.current = null;
    }
  }, []);

  const openGitFlyout = useCallback(() => {
    if (!showGitPanel || gitPanelPinned) {
      return;
    }
    clearGitFlyoutCloseTimer();
    setGitFlyoutVisible(true);
  }, [clearGitFlyoutCloseTimer, gitPanelPinned, showGitPanel]);

  const closeGitFlyout = useCallback((delay = 0) => {
    clearGitFlyoutCloseTimer();
    if (delay <= 0) {
      setGitFlyoutVisible(false);
      return;
    }
    gitFlyoutCloseTimerRef.current = window.setTimeout(() => {
      gitFlyoutCloseTimerRef.current = null;
      setGitFlyoutVisible(false);
    }, delay);
  }, [clearGitFlyoutCloseTimer]);

  useEffect(() => {
    if (!showGitPanel || gitPanelPinned) {
      setGitFlyoutVisible(false);
      clearGitFlyoutCloseTimer();
    }
  }, [clearGitFlyoutCloseTimer, gitPanelPinned, showGitPanel]);

  useEffect(() => () => clearGitFlyoutCloseTimer(), [clearGitFlyoutCloseTimer]);

  const handleSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let isDragging = false;
    sidebarHandleRef.current?.classList.add("dragging");

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      if (!isDragging && Math.abs(delta) < RESIZE_HANDLE_CLICK_THRESHOLD) {
        return;
      }
      isDragging = true;
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + delta)));
    }

    function onUp(ev: MouseEvent) {
      sidebarHandleRef.current?.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!isDragging && Math.abs(ev.clientX - startX) < RESIZE_HANDLE_CLICK_THRESHOLD) {
        toggleSidebarPin();
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth, toggleSidebarPin]);

  const handleGitTriggerBlur = useCallback((event: React.FocusEvent<HTMLButtonElement>) => {
    const nextTarget = event.relatedTarget;
    if (isTargetWithinGitFlyoutRegion(nextTarget, [gitFlyoutRef.current, gitTriggerRef.current])) {
      return;
    }
    closeGitFlyout();
  }, [closeGitFlyout]);

  const handleGitFlyoutBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (isTargetWithinGitFlyoutRegion(nextTarget, [gitFlyoutRef.current, gitTriggerRef.current])) {
      return;
    }
    closeGitFlyout();
  }, [closeGitFlyout]);

  const gitFlyoutContextValue = useMemo(
    () => ({
      openFlyout: openGitFlyout,
      scheduleClose: closeGitFlyout,
      isTargetWithinRegion: (target: EventTarget | null) =>
        isTargetWithinGitFlyoutRegion(target, [gitFlyoutRef.current, gitTriggerRef.current]),
    }),
    [closeGitFlyout, openGitFlyout],
  );

  const floatingGitWidth = Math.min(
    MAX_GIT_FLYOUT_WIDTH,
    Math.max(
      MIN_GIT_FLYOUT_WIDTH,
      Math.round(((contentCardWidth || 1200) * gitPanelSize) / 100),
    ),
  );

  const mainContent = (
    activeView === "harnesses" ? (
      <HarnessPanel />
    ) : activeView === "workspace-settings" ? (
      <WorkspaceSettingsPage />
    ) : (
      <ActiveWorkspacePaneShell />
    )
  );

  return (
    <div className="layout-root">
      {/* Unpinned sidebar — collapsed rail + hover flyout */}
      {showSidebar && !sidebarPinned && <Sidebar />}

      {/* Pinned sidebar */}
      {sidebarDocked && (
        <div className="layout-sidebar" style={{ width: sidebarWidth }}>
          <Sidebar />
        </div>
      )}

      {/* Sidebar resize handle (pinned only) */}
      {sidebarDocked && (
        <div
          ref={sidebarHandleRef}
          className="sidebar-resize-handle"
          onMouseDown={handleSidebarResizeMouseDown}
        />
      )}

      {/* Floating content card */}
      <div
        ref={contentCardRef}
        className={`content-card ${fullBleedContent ? "content-card-full" : ""}`}
      >
        {showFocusDragStrip && (
          <div
            className="focus-drag-strip"
            onMouseDown={handleDragMouseDown}
            onDoubleClick={handleDragDoubleClick}
          />
        )}

        {gitPanelDocked ? (
          <PanelGroup
            key="main-layout-docked"
            id="main-layout-panels"
            autoSaveId="panes:main-layout-panels"
            direction="horizontal"
            style={{ height: "100%", flex: 1 }}
          >
            <Panel
              id="main-layout-content"
              order={1}
              defaultSize={100 - gitPanelSize}
              minSize={35}
            >
              <div className="content-panel" style={{ height: "100%" }}>
                {mainContent}
              </div>
            </Panel>

            <PanelResizeHandle
              id="main-layout-git-resize-handle"
              className="resize-handle"
              aria-label={t("panel.unpin")}
              title={t("panel.unpin")}
              onClick={() => setGitPanelPinned(false)}
            />

            <Panel
              id="main-layout-git-panel"
              order={2}
              defaultSize={gitPanelSize}
              minSize={MIN_GIT_PANEL_SIZE}
              maxSize={MAX_GIT_PANEL_SIZE}
              onResize={setGitPanelSize}
            >
              <div className="content-panel" style={{ height: "100%" }}>
                <GitPanel />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <div className="content-panel" style={{ height: "100%", flex: 1 }}>
            {mainContent}
          </div>
        )}

        {showGitPanel && !gitPanelPinned ? (
          <GitFlyoutContext.Provider value={gitFlyoutContextValue}>
            <button
              ref={gitTriggerRef}
              type="button"
              className={`git-flyout-trigger${gitFlyoutVisible ? " git-flyout-trigger-active" : ""}`}
              title={t("panel.reveal")}
              aria-label={t("panel.reveal")}
              onMouseEnter={openGitFlyout}
              onMouseLeave={() => closeGitFlyout(200)}
              onFocus={openGitFlyout}
              onBlur={handleGitTriggerBlur}
            />

            <div
              ref={gitFlyoutRef}
              className="git-flyout-wrapper"
              style={{
                width: floatingGitWidth,
                maxWidth: "calc(100% - 12px)",
                pointerEvents: gitFlyoutVisible ? "auto" : "none",
              }}
              onMouseEnter={openGitFlyout}
              onMouseLeave={() => closeGitFlyout(150)}
              onFocusCapture={openGitFlyout}
              onBlurCapture={handleGitFlyoutBlurCapture}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  closeGitFlyout();
                  gitTriggerRef.current?.focus();
                }
              }}
            >
              <div
                className={`shell-flyout shell-flyout-right ${gitFlyoutVisible ? "shell-flyout-visible" : ""}`}
                style={{
                  width: floatingGitWidth,
                  maxWidth: "calc(100% - 12px)",
                }}
              >
                <GitPanel
                  mode="flyout"
                  visible={gitFlyoutVisible}
                  onPin={() => {
                    setGitPanelPinned(true);
                    setGitFlyoutVisible(false);
                  }}
                />
              </div>
            </div>
          </GitFlyoutContext.Provider>
        ) : null}
      </div>
    </div>
  );
}
