import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Download, Loader2, Star, Trash2, X } from "lucide-react";
import {
  ipc,
  listenWhisperModelDownload,
  type WhisperModel,
  type WhisperModelTier,
} from "../../lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface Props {
  onClose: () => void;
}

interface DownloadState {
  downloaded: number;
  total: number;
}

function formatBytes(n: number): string {
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(0)} MB`;
  return `${(n / 1_073_741_824).toFixed(2)} GB`;
}

function tierColor(tier: WhisperModelTier): string {
  switch (tier) {
    case "recommended":
      return "rgba(76, 175, 80, 0.85)";
    case "high":
      return "rgba(96, 145, 220, 0.85)";
    case "balanced":
      return "rgba(160, 160, 180, 0.85)";
    case "fast":
      return "rgba(200, 170, 80, 0.8)";
    default:
      return "rgba(200, 120, 120, 0.6)";
  }
}

export function ModelCatalogModal({ onClose }: Props) {
  const { t } = useTranslation("app");
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [active, setActive] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await ipc.listWhisperModels();
      setModels(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      unlistenRef.current = await listenWhisperModelDownload((progress) => {
        setDownloads((prev) => ({
          ...prev,
          [progress.name]: {
            downloaded: progress.downloaded,
            total: progress.total,
          },
        }));
        if (progress.done) {
          setActive((current) => (current === progress.name ? null : current));
          void refresh();
        }
      });
    })();
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, [refresh]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function startDownload(name: string) {
    setActive(name);
    setDownloads((prev) => ({
      ...prev,
      [name]: { downloaded: 0, total: 0 },
    }));
    try {
      await ipc.downloadWhisperModel(name);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setActive((current) => (current === name ? null : current));
    }
  }

  async function deleteModel(name: string) {
    try {
      await ipc.deleteWhisperModel(name);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "80vh",
          background: "var(--surface-1, #1e1e22)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 10px 60px rgba(0,0,0,0.45)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {t("meetings.modelCatalogTitle")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              {t("meetings.modelCatalogHint")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-2)",
              cursor: "pointer",
              padding: 4,
            }}
            title={t("common:close", { defaultValue: "Close" })}
          >
            <X size={16} />
          </button>
        </header>

        {error ? (
          <div
            style={{
              padding: "10px 16px",
              background: "rgba(255, 80, 80, 0.1)",
              color: "var(--text-2)",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ overflow: "auto", padding: "8px 0" }}>
          {loading ? (
            <div
              style={{
                padding: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              {t("meetings.loading")}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: "0 10px" }}>
              {models.map((m) => {
                const progress = downloads[m.name];
                const isDownloading = active === m.name;
                const pct =
                  isDownloading && progress && progress.total > 0
                    ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
                    : 0;
                return (
                  <li
                    key={m.name}
                    style={{
                      padding: "12px 14px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)" }}>
                          {m.displayName}
                        </span>
                        {m.tier === "recommended" ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              fontSize: 10,
                              fontWeight: 500,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: tierColor(m.tier),
                              color: "#fff",
                              textTransform: "uppercase",
                            }}
                          >
                            <Star size={9} fill="currentColor" />
                            {t("meetings.modelTierRecommended")}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 500,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: tierColor(m.tier),
                              color: "#fff",
                              textTransform: "uppercase",
                            }}
                          >
                            {t(`meetings.modelTier_${m.tier}`)}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {formatBytes(m.sizeBytes)}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {m.downloaded ? (
                          <>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                color: "rgba(76, 175, 80, 0.95)",
                                fontSize: 12,
                              }}
                            >
                              <Check size={12} />
                              {t("meetings.modelReady")}
                            </span>
                            <button
                              type="button"
                              onClick={() => void deleteModel(m.name)}
                              title={t("meetings.modelDelete")}
                              style={{
                                background: "transparent",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "var(--text-3)",
                                borderRadius: 4,
                                padding: "4px 8px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11,
                              }}
                            >
                              <Trash2 size={11} />
                              {t("meetings.modelDelete")}
                            </button>
                          </>
                        ) : isDownloading ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              color: "var(--text-2)",
                              fontSize: 12,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            <Loader2 size={12} className="animate-spin" />
                            {pct}%
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void startDownload(m.name)}
                            disabled={!!active}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 10px",
                              background: "rgba(96, 145, 220, 0.15)",
                              border: "1px solid rgba(96, 145, 220, 0.35)",
                              borderRadius: 4,
                              color: "var(--text-1)",
                              fontSize: 12,
                              cursor: active ? "not-allowed" : "pointer",
                              opacity: active ? 0.5 : 1,
                            }}
                          >
                            <Download size={12} />
                            {t("meetings.modelDownload")}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{m.description}</div>
                    {isDownloading ? (
                      <div
                        style={{
                          height: 4,
                          background: "rgba(255,255,255,0.06)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "rgba(96, 145, 220, 0.85)",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
