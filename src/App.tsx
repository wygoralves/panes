import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useEngineStore } from "./stores/engineStore";

export function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const loadEngines = useEngineStore((s) => s.load);

  useEffect(() => {
    void loadWorkspaces();
    void loadEngines();
  }, [loadWorkspaces, loadEngines]);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", zIndex: 1 }}>
      <ThreeColumnLayout />
    </div>
  );
}
