import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { EngineHealthBanner } from "./components/onboarding/EngineHealthBanner";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useEngineStore } from "./stores/engineStore";

export function App() {
  const loadWorkspaces = useWorkspaceStore((state) => state.loadWorkspaces);
  const loadEngines = useEngineStore((state) => state.load);

  useEffect(() => {
    void loadWorkspaces();
    void loadEngines();
  }, [loadWorkspaces, loadEngines]);

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div style={{ padding: "8px 12px" }}>
        <EngineHealthBanner />
      </div>
      <ThreeColumnLayout />
    </div>
  );
}
