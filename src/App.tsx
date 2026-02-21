import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { SearchModal } from "./components/chat/SearchModal";
import { EngineHealthBanner } from "./components/onboarding/EngineHealthBanner";
import { EngineSetupWizard } from "./components/onboarding/EngineSetupWizard";
import { UpdateBanner } from "./components/onboarding/UpdateBanner";
import { useUpdateStore } from "./stores/updateStore";
import { listenThreadUpdated } from "./lib/ipc";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useEngineStore } from "./stores/engineStore";
import { useUiStore } from "./stores/uiStore";
import { useThreadStore } from "./stores/threadStore";
import { useGitStore } from "./stores/gitStore";

export function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const loadEngines = useEngineStore((s) => s.load);
  const refreshAllThreads = useThreadStore((s) => s.refreshAllThreads);
  const refreshThreads = useThreadStore((s) => s.refreshThreads);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleGitPanel = useUiStore((s) => s.toggleGitPanel);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);

  useEffect(() => {
    void loadWorkspaces();
    void loadEngines();
  }, [loadWorkspaces, loadEngines]);

  useEffect(() => {
    void refreshAllThreads(workspaces.map((workspace) => workspace.id));
  }, [workspaces, refreshAllThreads]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenThreadUpdated(({ workspaceId }) => {
      void refreshThreads(workspaceId);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshThreads]);

  useEffect(() => {
    function onBeforeUnload() {
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (wsId) {
        useGitStore.getState().flushDrafts(wsId);
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdate();
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

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
          <UpdateBanner />
          <EngineHealthBanner />
        </div>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <EngineSetupWizard />
    </div>
  );
}
