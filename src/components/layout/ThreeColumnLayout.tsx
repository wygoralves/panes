import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { GitPanel } from "../git/GitPanel";

export function ThreeColumnLayout() {
  return (
    <PanelGroup direction="horizontal" className="app-shell">
      <Panel defaultSize={18} minSize={14} className="panel">
        <Sidebar />
      </Panel>
      <PanelResizeHandle style={{ width: 1, background: "var(--border)" }} />
      <Panel defaultSize={52} minSize={35} className="panel">
        <ChatPanel />
      </Panel>
      <PanelResizeHandle style={{ width: 1, background: "var(--border)" }} />
      <Panel defaultSize={30} minSize={22} className="panel">
        <GitPanel />
      </Panel>
    </PanelGroup>
  );
}
