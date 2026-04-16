import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AudioLines, Check, Download, Loader2, Star, Trash2, X } from "lucide-react";
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

function tierToken(tier: WhisperModelTier): { bg: string; fg: string } {
  switch (tier) {
    case "recommended":
      return { bg: "rgba(76, 175, 80, 0.18)", fg: "rgba(120, 200, 120, 1)" };
    case "high":
      return { bg: "rgba(96, 145, 220, 0.18)", fg: "rgba(140, 185, 235, 1)" };
    case "balanced":
      return { bg: "rgba(180, 180, 200, 0.12)", fg: "var(--text-2)" };
    case "fast":
      return { bg: "rgba(210, 180, 90, 0.18)", fg: "rgba(225, 200, 120, 1)" };
    default:
      return { bg: "rgba(200, 120, 120, 0.16)", fg: "rgba(220, 160, 160, 1)" };
  }
}

export function ModelCatalogModal({ onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
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
      className="confirm-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ws-modal"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 60px)",
        }}
      >
        <div className="ws-header" style={{ padding: "20px 24px 0" }}>
          <div
            className="ws-header-icon"
            style={{ width: 40, height: 40, borderRadius: 12 }}
          >
            <AudioLines size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="ws-header-title" style={{ fontSize: 15 }}>
              {t("app:meetings.modelCatalogTitle")}
            </h2>
            <div className="ws-header-path" style={{ marginTop: 2 }}>
              {t("app:meetings.modelCatalogHint")}
            </div>
          </div>
          <button
            type="button"
            className="ws-close"
            onClick={onClose}
            style={{ background: "none", border: "none" }}
            title={t("common:close", { defaultValue: "Close" })}
          >
            <X size={15} />
          </button>
        </div>

        <div className="ws-divider" style={{ margin: "14px 24px 0" }} />

        {error ? (
          <div
            style={{
              margin: "14px 24px 0",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "rgba(255, 80, 80, 0.08)",
              border: "1px solid rgba(255, 80, 80, 0.2)",
              color: "var(--text-2)",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="ws-body" style={{ padding: "16px 24px 24px" }}>
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
              {t("app:meetings.loading")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {models.map((m) => {
                const progress = downloads[m.name];
                const isDownloading = active === m.name;
                const pct =
                  isDownloading && progress && progress.total > 0
                    ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
                    : 0;
                const { bg, fg } = tierToken(m.tier);
                const isRecommended = m.tier === "recommended";
                return (
                  <div
                    key={m.name}
                    style={{
                      borderRadius: "var(--radius-md)",
                      background: "rgba(255, 255, 255, 0.02)",
                      border: `1px solid ${isRecommended ? "rgba(76, 175, 80, 0.25)" : "rgba(255, 255, 255, 0.06)"}`,
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--text-1)",
                          }}
                        >
                          {m.displayName}
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            fontSize: 10,
                            fontWeight: 500,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: bg,
                            color: fg,
                            textTransform: "uppercase",
                            letterSpacing: 0.3,
                          }}
                        >
                          {isRecommended ? (
                            <Star size={9} fill="currentColor" />
                          ) : null}
                          {t(`app:meetings.modelTier_${m.tier}`)}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {formatBytes(m.sizeBytes)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexShrink: 0,
                        }}
                      >
                        {m.downloaded ? (
                          <>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                color: "rgba(120, 200, 120, 1)",
                                fontSize: 12,
                                fontWeight: 500,
                              }}
                            >
                              <Check size={12} />
                              {t("app:meetings.modelReady")}
                            </span>
                            <button
                              type="button"
                              className="btn btn-cancel-ghost"
                              onClick={() => void deleteModel(m.name)}
                              title={t("app:meetings.modelDelete")}
                              style={{
                                padding: "5px 10px",
                                fontSize: 11,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Trash2 size={11} />
                              {t("app:meetings.modelDelete")}
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
                            className="btn btn-primary"
                            onClick={() => void startDownload(m.name)}
                            disabled={!!active}
                            style={{
                              padding: "5px 12px",
                              fontSize: 12,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Download size={12} />
                            {t("app:meetings.modelDownload")}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.45 }}>
                      {m.description}
                    </div>
                    {isDownloading ? (
                      <div
                        style={{
                          height: 3,
                          background: "rgba(255,255,255,0.06)",
                          borderRadius: 2,
                          overflow: "hidden",
                          marginTop: 2,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "var(--accent)",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
