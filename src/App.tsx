import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { EngineHealthBanner } from "./components/onboarding/EngineHealthBanner";
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
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none", zIndex: 10 }}>
        <div style={{ pointerEvents: "auto" }}>
          <EngineHealthBanner />
        </div>
      </div>
    </div>
  );
}
