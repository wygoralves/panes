import { useEffect } from "react";
import { X, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { isLinuxDesktop } from "../../lib/windowActions";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { GitDiffEditorPanel } from "./GitDiffEditorPanel";

export function FileEditorPanel() {
  const { t } = useTranslation("app");
  const tabs = useFileStore((s) => s.tabs);
  const activeTabId = useFileStore((s) => s.activeTabId);
  const pendingCloseTabId = useFileStore((s) => s.pendingCloseTabId);
  const setActiveTab = useFileStore((s) => s.setActiveTab);
  const saveTab = useFileStore((s) => s.saveTab);
  const setTabContent = useFileStore((s) => s.setTabContent);
  const requestCloseTab = useFileStore((s) => s.requestCloseTab);
  const confirmCloseTab = useFileStore((s) => s.confirmCloseTab);
  const cancelCloseTab = useFileStore((s) => s.cancelCloseTab);
  const focusMode = useUiStore((s) => s.focusMode);
  const showSidebar = useUiStore((s) => s.showSidebar);
  const showLinuxDragStrip = isLinuxDesktop() && !showSidebar;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
  const useTitlebarSafeInset = isMac && focusMode && !showSidebar;

  // Cmd+S to save — Cmd+W is handled via native menu "close-window" action.
  // Note: e.preventDefault() for Cmd+S is handled at the app level (App.tsx)
  // to prevent the browser save-page dialog in all contexts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key !== "s") return;

      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      const wsState = wsId ? useTerminalStore.getState().workspaces[wsId] : undefined;
      if (wsState?.layoutMode !== "editor") return;

      if (activeTabId) void saveTab(activeTabId);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId, saveTab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      {tabs.length > 0 && (
        <div className={`editor-tabs-bar${useTitlebarSafeInset ? " editor-tabs-bar-titlebar-safe" : ""}`}>
          {showLinuxDragStrip && (
            <div
              className="window-drag-strip"
              onMouseDown={handleDragMouseDown}
              onDoubleClick={handleDragDoubleClick}
            />
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`editor-tab ${tab.id === activeTabId ? "active" : ""}`}
            >
              <FileText
                size={12}
                style={{
                  flexShrink: 0,
                  color: tab.id === activeTabId ? "var(--text-2)" : "var(--text-3)",
                }}
              />
              <span className="editor-tab-name">{tab.fileName}</span>
              {tab.isDirty && <span className="editor-tab-dirty">&bull;</span>}
              <button
                type="button"
                className="editor-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  requestCloseTab(tab.id);
                }}
                title={t("editor.closeTab")}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeTab ? (
          activeTab.isLoading ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              {t("editor.loadingFile")}
            </div>
          ) : activeTab.loadError ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--danger)",
                fontSize: 12,
                padding: 24,
                textAlign: "center",
              }}
            >
              {activeTab.loadError}
            </div>
          ) : activeTab.renderMode === "git-diff-editor" ? (
            <GitDiffEditorPanel
              tab={activeTab}
              onChange={(content) => setTabContent(activeTab.id, content)}
            />
          ) : activeTab.isBinary ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              <FileText size={32} />
              {t("editor.binaryFile")}
            </div>
          ) : (
            <CodeMirrorEditor
              tabId={activeTab.id}
              content={activeTab.content}
              filePath={activeTab.filePath}
              onChange={(content) => setTabContent(activeTab.id, content)}
            />
          )
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--text-3)",
            }}
          >
            <FileText size={32} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: 13 }}>{t("editor.emptyTitle")}</p>
            <p style={{ fontSize: 11, opacity: 0.6 }}>
              {t("editor.emptyHint")}
            </p>
          </div>
        )}
      </div>

      {/* Dirty close confirm dialog */}
      <ConfirmDialog
        open={pendingCloseTabId !== null}
        title={t("editor.unsavedChangesTitle")}
        message={t("editor.unsavedChangesMessage", {
          name: tabs.find((tab) => tab.id === pendingCloseTabId)?.fileName ?? "",
        })}
        confirmLabel={t("editor.discard")}
        cancelLabel={t("editor.cancel")}
        onConfirm={confirmCloseTab}
        onCancel={cancelCloseTab}
      />
    </div>
  );
}
