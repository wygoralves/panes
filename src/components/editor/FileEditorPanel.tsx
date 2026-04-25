import { useEffect } from "react";
import { ExternalLink, Eye, FileDiff, FileText, Loader2, PanelLeftOpen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  resolveOwningRepoForAbsolutePath,
  resolveRelativePathWithinRoot,
} from "../../lib/fileRootUtils";
import { ipc } from "../../lib/ipc";
import { isMarkdownPreviewFile } from "../../lib/editorFileTypes";
import { useFileStore } from "../../stores/fileStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { toast } from "../../stores/toastStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { isMacDesktop } from "../../lib/windowActions";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { GitDiffEditorPanel } from "./GitDiffEditorPanel";
import { MarkdownPreviewPanel } from "./MarkdownPreviewPanel";

interface FileEditorPanelProps {
  embedded?: boolean;
}

export function FileEditorPanel({ embedded = false }: FileEditorPanelProps = {}) {
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
  const clearPendingReveal = useFileStore((s) => s.clearPendingReveal);
  const setTabRenderMode = useFileStore((s) => s.setTabRenderMode);
  const focusMode = useUiStore((s) => s.focusMode);
  const showSidebar = useUiStore((s) => s.showSidebar);
  const showExplorer = useUiStore((s) => s.showExplorer);
  const setExplorerOpen = useUiStore((s) => s.setExplorerOpen);
  const repos = useWorkspaceStore((s) => s.repos);
  const activeRepoId = useWorkspaceStore((s) => s.activeRepoId);
  const openFile = useFileStore((s) => s.openFile);
  const openGitDiffFile = useFileStore((s) => s.openGitDiffFile);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isMac = isMacDesktop();
  const useTitlebarSafeInset = !embedded && isMac && focusMode && !showSidebar;
  const activeTabOwnership = activeTab
    ? (
        (activeTab.gitRepoPath && activeTab.gitFilePath)
          ? {
              repoPath: activeTab.gitRepoPath,
              filePath: activeTab.gitFilePath,
            }
          : (() => {
              const ownership = resolveOwningRepoForAbsolutePath(
                activeTab.absolutePath,
                repos,
                activeRepoId,
              );
              return ownership
                ? { repoPath: ownership.repo.path, filePath: ownership.filePath }
                : null;
            })()
      )
    : null;
  const canToggleDiffView = Boolean(
    activeTab
      && activeTabOwnership
      && !activeTab.isLoading
      && !activeTab.loadError
      && (activeTab.renderMode === "git-diff-editor" || !activeTab.isBinary),
  );
  const canToggleMarkdownPreview = Boolean(
    activeTab
      && !activeTab.isLoading
      && !activeTab.loadError
      && !activeTab.isBinary
      && isMarkdownPreviewFile(activeTab.filePath),
  );
  const canOpenInDefaultApp = Boolean(
    activeTab
      && !activeTab.isLoading
      && !activeTab.loadError,
  );
  const diffToggleLabel = activeTab?.renderMode === "git-diff-editor"
    ? t("editor.hideDiff")
    : t("editor.showDiff");
  const markdownPreviewToggleLabel = activeTab?.renderMode === "markdown-preview"
    ? t("editor.hideMarkdownPreview")
    : t("editor.showMarkdownPreview");
  const openInDefaultAppLabel = t("editor.openInDefaultApp");

  function handleToggleDiffView() {
    if (!activeTab || !activeTabOwnership) {
      return;
    }

    if (activeTab.renderMode === "git-diff-editor") {
      void openFile(activeTab.rootPath, activeTab.filePath);
      return;
    }

    const repoPath = activeTabOwnership.repoPath;
    const gitFilePath = activeTab.gitFilePath
      ?? resolveRelativePathWithinRoot(activeTab.absolutePath, repoPath);
    if (!gitFilePath) {
      return;
    }

    void openGitDiffFile(repoPath, gitFilePath, { source: "changes" });
  }

  function handleToggleMarkdownPreview() {
    if (!activeTab) {
      return;
    }

    setTabRenderMode(
      activeTab.id,
      activeTab.renderMode === "markdown-preview" ? "plain-editor" : "markdown-preview",
    );
  }

  async function handleOpenInDefaultApp() {
    if (!activeTab) {
      return;
    }

    try {
      await ipc.openPathWithDefaultApp(activeTab.absolutePath);
    } catch {
      toast.error(t("editor.toasts.openExternalFailed"));
    }
  }

  // Cmd+S to save — Cmd+W is handled via native menu "close-window" action.
  // Note: e.preventDefault() for Cmd+S is handled at the app level (App.tsx)
  // to prevent the browser save-page dialog in all contexts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key !== "s") return;

      if (!embedded) {
        const wsId = useWorkspaceStore.getState().activeWorkspaceId;
        const wsState = wsId ? useTerminalStore.getState().workspaces[wsId] : undefined;
        if (wsState?.layoutMode !== "editor") return;
      }

      if (activeTabId) void saveTab(activeTabId);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId, embedded, saveTab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      {tabs.length > 0 && (
        <div className={`editor-tabs-bar${useTitlebarSafeInset ? " editor-tabs-bar-titlebar-safe" : ""}`}>
          <div className="editor-tabs-bar-scroll">
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
          {(!showExplorer || canToggleMarkdownPreview || canOpenInDefaultApp || canToggleDiffView) ? (
            <div className="editor-tabs-actions">
              {!showExplorer && (
                <button
                  type="button"
                  className="editor-tab-action"
                  onClick={() => setExplorerOpen(true)}
                  title={t("explorer.expand")}
                  aria-label={t("explorer.expand")}
                >
                  <PanelLeftOpen size={13} />
                </button>
              )}
              {canToggleMarkdownPreview ? (
                <button
                  type="button"
                  className={`editor-tab-action${activeTab?.renderMode === "markdown-preview" ? " active" : ""}`}
                  onClick={handleToggleMarkdownPreview}
                  title={markdownPreviewToggleLabel}
                  aria-label={markdownPreviewToggleLabel}
                >
                  <Eye size={12} />
                </button>
              ) : null}
              {canOpenInDefaultApp ? (
                <button
                  type="button"
                  className="editor-tab-action"
                  onClick={() => void handleOpenInDefaultApp()}
                  title={openInDefaultAppLabel}
                  aria-label={openInDefaultAppLabel}
                >
                  <ExternalLink size={12} />
                </button>
              ) : null}
              {canToggleDiffView ? (
                <button
                  type="button"
                  className={`editor-tab-action${activeTab?.renderMode === "git-diff-editor" ? " active" : ""}`}
                  onClick={handleToggleDiffView}
                  title={diffToggleLabel}
                  aria-label={diffToggleLabel}
                >
                  <FileDiff size={12} />
                </button>
              ) : null}
            </div>
          ) : null}
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
          ) : activeTab.renderMode === "markdown-preview" ? (
            <MarkdownPreviewPanel content={activeTab.content} />
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
              pendingReveal={activeTab.pendingReveal}
              onRevealHandled={(nonce) => clearPendingReveal(activeTab.id, nonce)}
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
            {!showExplorer ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setExplorerOpen(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <PanelLeftOpen size={14} />
                {t("explorer.expand")}
              </button>
            ) : null}
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
