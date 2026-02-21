import { Download, Loader, X, AlertTriangle } from "lucide-react";
import { useUpdateStore } from "../../stores/updateStore";

export function UpdateBanner() {
  const { status, version, error, dismissed, downloadAndInstall, dismiss } =
    useUpdateStore();

  if (dismissed || status === "idle" || status === "checking") {
    return null;
  }

  if (status === "error") {
    return (
      <div
        style={{
          margin: "12px 16px 0",
          padding: "10px 14px",
          borderRadius: "var(--radius-md)",
          background: "rgba(239, 68, 68, 0.06)",
          border: "1px solid rgba(239, 68, 68, 0.15)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <AlertTriangle
          size={16}
          style={{ color: "var(--error)", flexShrink: 0 }}
        />
        <p style={{ margin: 0, fontSize: 13, flex: 1 }}>
          Update failed{error ? `: ${error}` : ""}
        </p>
        <button
          onClick={dismiss}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: "var(--text-3)",
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div
        style={{
          margin: "12px 16px 0",
          padding: "10px 14px",
          borderRadius: "var(--radius-md)",
          background: "rgba(59, 130, 246, 0.06)",
          border: "1px solid rgba(59, 130, 246, 0.15)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Loader
          size={16}
          style={{ color: "var(--accent)", flexShrink: 0, animation: "spin 1s linear infinite" }}
        />
        <p style={{ margin: 0, fontSize: 13 }}>Restarting...</p>
      </div>
    );
  }

  if (status === "downloading") {
    return (
      <div
        style={{
          margin: "12px 16px 0",
          padding: "10px 14px",
          borderRadius: "var(--radius-md)",
          background: "rgba(59, 130, 246, 0.06)",
          border: "1px solid rgba(59, 130, 246, 0.15)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Loader
          size={16}
          style={{ color: "var(--accent)", flexShrink: 0, animation: "spin 1s linear infinite" }}
        />
        <p style={{ margin: 0, fontSize: 13 }}>Downloading update...</p>
      </div>
    );
  }

  // status === "available"
  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "10px 14px",
        borderRadius: "var(--radius-md)",
        background: "rgba(59, 130, 246, 0.06)",
        border: "1px solid rgba(59, 130, 246, 0.15)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Download
        size={16}
        style={{ color: "var(--accent)", flexShrink: 0 }}
      />
      <p style={{ margin: 0, fontSize: 13, flex: 1 }}>
        Update available — Panes v{version}
      </p>
      <button
        onClick={downloadAndInstall}
        style={{
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--radius-sm)",
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Install & Restart
      </button>
      <button
        onClick={dismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 2,
          color: "var(--text-3)",
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
