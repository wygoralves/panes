import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { GitPanel } from "../git/GitPanel";
import { useUiStore } from "../../stores/uiStore";

export function ThreeColumnLayout() {
  const showSidebar = useUiStore((state) => state.showSidebar);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const showGitPanel = useUiStore((state) => state.showGitPanel);

  const sidebarVisible = showSidebar && sidebarPinned;
  const centerDefaultSize = sidebarVisible && showGitPanel ? 56 : sidebarVisible || showGitPanel ? 74 : 100;

  return (
    <div style={{ height: "100%", display: "flex" }}>
      {/* Unpinned sidebar — collapsed rail + hover flyout, outside PanelGroup */}
      {showSidebar && !sidebarPinned && <Sidebar />}

      {/* Main panel group */}
      <PanelGroup key={`${sidebarVisible}-${showGitPanel}`} direction="horizontal" style={{ height: "100%", flex: 1 }}>
        {sidebarVisible && (
          <Panel defaultSize={18} minSize={14} maxSize={28}>
            <div className="panel panel-border-r" style={{ height: "100%" }}>
              <Sidebar />
            </div>
          </Panel>
        )}

        {sidebarVisible && <PanelResizeHandle className="resize-handle" />}

        <Panel defaultSize={centerDefaultSize} minSize={35}>
          <div className="panel" style={{ height: "100%" }}>
            <ChatPanel />
          </div>
        </Panel>

        {showGitPanel && <PanelResizeHandle className="resize-handle" />}

        {showGitPanel && (
          <Panel defaultSize={26} minSize={18} maxSize={40}>
            <div className="panel" style={{ height: "100%" }}>
              <GitPanel />
            </div>
          </Panel>
        )}
      </PanelGroup>
    </div>
  );
}
