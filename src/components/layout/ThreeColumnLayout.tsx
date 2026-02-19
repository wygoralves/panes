import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { GitPanel } from "../git/GitPanel";

export function ThreeColumnLayout() {
  return (
    <div className="app-shell app-shell-grid">
      <section className="panel">
        <Sidebar />
      </section>
      <section className="panel">
        <ChatPanel />
      </section>
      <section className="panel">
        <GitPanel />
      </section>
    </div>
  );
}
