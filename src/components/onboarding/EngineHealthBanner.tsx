import { useMemo } from "react";
import { useEngineStore } from "../../stores/engineStore";

export function EngineHealthBanner() {
  const { health } = useEngineStore();

  const codexState = useMemo(() => health.codex, [health]);

  if (!codexState || codexState.available) {
    return null;
  }

  return (
    <div className="surface" style={{ padding: 12, marginBottom: 12 }}>
      <p style={{ margin: 0, fontWeight: 600 }}>Codex engine not detected</p>
      <p style={{ margin: "6px 0 0", color: "var(--text-soft)", fontSize: 13 }}>
        Install Codex CLI and authenticate before starting chat turns.
      </p>
    </div>
  );
}
