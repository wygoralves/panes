import { Dropdown } from "./Dropdown";
import { runEditMenuAction } from "../../lib/nativeEditActions";
import { useSetupStore } from "../../stores/setupStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTranslation } from "react-i18next";
import {
  canLinuxWindowResize,
  shouldShowLinuxWindowChrome,
  type LinuxWindowFrameState,
} from "../../lib/linuxWindowFrame";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  requestWindowClose,
  toggleCurrentWindowMaximize,
  toggleWindowFullscreen,
} from "../../lib/windowActions";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { LinuxWindowResizeHandles } from "./LinuxWindowResizeHandles";

interface LinuxWindowFrameProps {
  frameState: LinuxWindowFrameState;
}

const MENU_SENTINEL = "__linux-window-menu__";
const LINUX_MENU_TRIGGER_STYLE = {
  height: 28,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-2)",
  fontSize: 12,
  fontWeight: 500,
  gap: 6,
} as const;

export function LinuxWindowFrame({ frameState }: LinuxWindowFrameProps) {
  const { t } = useTranslation(["app", "native"]);
  const showChrome = shouldShowLinuxWindowChrome(frameState);

  const panesMenuOptions = [
    { value: "open-setup", label: t("app:sidebar.engineSetup") },
    { value: "close-app", label: t("native:menu.close") },
  ];
  const editMenuOptions = [
    { value: "edit-undo", label: t("native:menu.undo"), shortcut: "Ctrl+Z" },
    { value: "edit-redo", label: t("native:menu.redo"), shortcut: "Ctrl+Shift+Z" },
    { value: "edit-cut", label: t("native:menu.cut"), shortcut: "Ctrl+X" },
    { value: "edit-copy", label: t("native:menu.copy"), shortcut: "Ctrl+C" },
    { value: "edit-paste", label: t("native:menu.paste"), shortcut: "Ctrl+V" },
    { value: "edit-select-all", label: t("native:menu.selectAll"), shortcut: "Ctrl+A" },
  ];
  const viewMenuOptions = [
    { value: "toggle-sidebar", label: t("native:menu.toggleSidebar"), shortcut: "Ctrl+B" },
    { value: "toggle-git-panel", label: t("native:menu.toggleGitPanel"), shortcut: "Ctrl+Shift+B" },
    { value: "toggle-focus-mode", label: t("native:menu.toggleFocusMode"), shortcut: "Ctrl+Alt+F" },
    { value: "toggle-fullscreen", label: t("native:menu.toggleFullscreen"), shortcut: "F11" },
    { value: "toggle-search", label: t("native:menu.search"), shortcut: "Ctrl+Shift+F" },
    { value: "toggle-terminal", label: t("native:menu.toggleTerminal"), shortcut: "Ctrl+Shift+T" },
  ];

  function handleAppMenuAction(value: string) {
    switch (value) {
      case "open-setup":
        useSetupStore.getState().openSetup();
        return;
      case "close-app":
        void closeCurrentWindow();
        return;
      default:
        return;
    }
  }

  function handleEditAction(value: string) {
    void runEditMenuAction(value as
      | "edit-undo"
      | "edit-redo"
      | "edit-cut"
      | "edit-copy"
      | "edit-paste"
      | "edit-select-all");
  }

  function handleViewAction(value: string) {
    switch (value) {
      case "toggle-sidebar":
        useUiStore.getState().toggleSidebar();
        return;
      case "toggle-git-panel":
        useUiStore.getState().toggleGitPanel();
        return;
      case "toggle-focus-mode":
        useUiStore.getState().toggleFocusMode();
        return;
      case "toggle-fullscreen":
        void toggleWindowFullscreen();
        return;
      case "toggle-search":
        useUiStore.getState().openCommandPalette({ variant: "search", initialQuery: "?" });
        return;
      case "toggle-terminal": {
        const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        if (workspaceId) {
          void useTerminalStore.getState().cycleLayoutMode(workspaceId);
        }
        return;
      }
      default:
        return;
    }
  }

  return (
    <>
      {showChrome && (
        <div
          className="linux-window-chrome"
          onMouseDown={handleDragMouseDown}
          onDoubleClick={handleDragDoubleClick}
        >
          <div className="linux-window-chrome-menus no-drag">
            <Dropdown
              options={panesMenuOptions}
              value={MENU_SENTINEL}
              onChange={handleAppMenuAction}
              selectedLabel={t("native:app.submenu")}
              triggerStyle={LINUX_MENU_TRIGGER_STYLE}
            />
            <Dropdown
              options={editMenuOptions}
              value={MENU_SENTINEL}
              onChange={handleEditAction}
              selectedLabel={t("native:menu.edit")}
              triggerStyle={LINUX_MENU_TRIGGER_STYLE}
            />
            <Dropdown
              options={viewMenuOptions}
              value={MENU_SENTINEL}
              onChange={handleViewAction}
              selectedLabel={t("native:menu.view")}
              triggerStyle={LINUX_MENU_TRIGGER_STYLE}
            />
          </div>
          <div className="linux-window-chrome-drag-region" />
          <div className="linux-window-chrome-controls no-drag">
            <button
              type="button"
              className="linux-window-control"
              aria-label={t("windowControls.minimize")}
              title={t("windowControls.minimize")}
              onClick={() => {
                void minimizeCurrentWindow();
              }}
            >
              <span className="linux-window-control-icon linux-window-control-icon-minimize" />
            </button>
            <button
              type="button"
              className="linux-window-control"
              aria-label={t(frameState.isMaximized ? "windowControls.restore" : "windowControls.maximize")}
              title={t(frameState.isMaximized ? "windowControls.restore" : "windowControls.maximize")}
              onClick={() => {
                void toggleCurrentWindowMaximize();
              }}
            >
              <span
                className={`linux-window-control-icon ${
                  frameState.isMaximized
                    ? "linux-window-control-icon-restore"
                    : "linux-window-control-icon-maximize"
                }`}
              />
            </button>
            <button
              type="button"
              className="linux-window-control linux-window-control-close"
              aria-label={t("windowControls.close")}
              title={t("windowControls.close")}
              onClick={() => {
                void closeCurrentWindow();
              }}
            >
              <span className="linux-window-control-icon linux-window-control-icon-close" />
            </button>
          </div>
        </div>
      )}
      <LinuxWindowResizeHandles canResize={canLinuxWindowResize(frameState)} />
    </>
  );
}
