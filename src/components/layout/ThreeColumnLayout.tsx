import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { GitPanel } from "../git/GitPanel";

export function ThreeColumnLayout() {
  return (
    <PanelGroup direction="horizontal" style={{ height: "100%" }}>
      <Panel defaultSize={18} minSize={14} maxSize={28}>
        <div className="panel panel-border-r" style={{ height: "100%" }}>
          <Sidebar />
        </div>
      </Panel>

      <PanelResizeHandle className="resize-handle" />

      <Panel defaultSize={56} minSize={35}>
        <div className="panel" style={{ height: "100%" }}>
          <ChatPanel />
        </div>
      </Panel>

      <PanelResizeHandle className="resize-handle" />

      <Panel defaultSize={26} minSize={18} maxSize={40}>
        <div className="panel" style={{ height: "100%" }}>
          <GitPanel />
        </div>
      </Panel>
    </PanelGroup>
  );
}
