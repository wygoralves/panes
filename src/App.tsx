import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { SearchModal } from "./components/chat/SearchModal";
import { EngineHealthBanner } from "./components/onboarding/EngineHealthBanner";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useEngineStore } from "./stores/engineStore";
import { useUiStore } from "./stores/uiStore";
import { useThreadStore } from "./stores/threadStore";

export function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const loadEngines = useEngineStore((s) => s.load);
  const refreshAllThreads = useThreadStore((s) => s.refreshAllThreads);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleGitPanel = useUiStore((s) => s.toggleGitPanel);

  useEffect(() => {
    void loadWorkspaces();
    void loadEngines();
  }, [loadWorkspaces, loadEngines]);

  useEffect(() => {
    void refreshAllThreads(workspaces.map((workspace) => workspace.id));
  }, [workspaces, refreshAllThreads]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const ctrlOrCmd = event.metaKey || event.ctrlKey;
      if (!ctrlOrCmd) {
        return;
      }

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.shiftKey && key === "b") {
        event.preventDefault();
        toggleGitPanel();
        return;
      }

      if (!event.shiftKey && key === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSearchOpen, toggleGitPanel, toggleSidebar]);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", zIndex: 1 }}>
      <ThreeColumnLayout />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none", zIndex: 10 }}>
        <div style={{ pointerEvents: "auto" }}>
          <EngineHealthBanner />
        </div>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
