import { useTranslation } from "react-i18next";
import {
  canLinuxWindowResize,
  shouldShowLinuxWindowChrome,
  type LinuxWindowFrameState,
} from "../../lib/linuxWindowFrame";
import {
  minimizeCurrentWindow,
  requestWindowClose,
  toggleCurrentWindowMaximize,
} from "../../lib/windowActions";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { LinuxWindowResizeHandles } from "./LinuxWindowResizeHandles";

interface LinuxWindowFrameProps {
  frameState: LinuxWindowFrameState;
}

export function LinuxWindowFrame({ frameState }: LinuxWindowFrameProps) {
  const { t } = useTranslation("app");
  const showChrome = shouldShowLinuxWindowChrome(frameState);

  return (
    <>
      {showChrome && (
        <div
          className="linux-window-chrome"
          onMouseDown={handleDragMouseDown}
          onDoubleClick={handleDragDoubleClick}
        >
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
                void requestWindowClose();
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
