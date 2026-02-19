import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useEngineStore } from "../../stores/engineStore";

export function EngineHealthBanner() {
  const { health } = useEngineStore();
  const codexState = useMemo(() => health.codex, [health]);

  if (!codexState || codexState.available) {
    return null;
  }

  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "10px 14px",
        borderRadius: "var(--radius-md)",
        background: "rgba(251, 191, 36, 0.06)",
        border: "1px solid rgba(251, 191, 36, 0.15)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <AlertTriangle size={16} style={{ color: "var(--warning)", flexShrink: 0 }} />
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
          Codex engine not detected
        </p>
        <p style={{ margin: "3px 0 0", color: "var(--text-2)", fontSize: 12 }}>
          Install Codex CLI and authenticate before starting chat turns.
        </p>
      </div>
    </div>
  );
}
