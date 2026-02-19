import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { GitPanel } from "../git/GitPanel";
import { useUiStore } from "../../stores/uiStore";

export function ThreeColumnLayout() {
  const showSidebar = useUiStore((state) => state.showSidebar);
  const showGitPanel = useUiStore((state) => state.showGitPanel);
  const centerDefaultSize = showSidebar && showGitPanel ? 56 : showSidebar || showGitPanel ? 74 : 100;

  return (
    <PanelGroup key={`${showSidebar}-${showGitPanel}`} direction="horizontal" style={{ height: "100%" }}>
      {showSidebar && (
        <Panel defaultSize={18} minSize={14} maxSize={28}>
          <div className="panel panel-border-r" style={{ height: "100%" }}>
            <Sidebar />
          </div>
        </Panel>
      )}

      {showSidebar && <PanelResizeHandle className="resize-handle" />}

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
  );
}
