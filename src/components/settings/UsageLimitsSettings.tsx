import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { Ref } from "react";
import type { ChatProviderUsage, ChatProviderUsageWindow } from "../../types";

interface Props {
  surface?: "settings" | "modal";
  onClose?: () => void;
  closeButtonRef?: Ref<HTMLButtonElement>;
}

function windowLabelKey(kind: ChatProviderUsageWindow["kind"]) {
  switch (kind) {
    case "five_hour":
      return "app:settingsPage.usage.windows.fiveHour" as const;
    case "fable_weekly":
      return "app:settingsPage.usage.windows.fableWeekly" as const;
    case "opus_weekly":
      return "app:settingsPage.usage.windows.opusWeekly" as const;
    case "sonnet_weekly":
      return "app:settingsPage.usage.windows.sonnetWeekly" as const;
    default:
      return "app:settingsPage.usage.windows.weekly" as const;
  }
}

export function UsageLimitsSettings({
  surface = "settings",
  onClose,
  closeButtonRef,
}: Props = {}) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const [providers, setProviders] = useState<ChatProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setProviders(await ipc.getChatProviderUsage());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const formatReset = (timestamp: number | null) => {
    if (timestamp == null) return null;
    const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const isModal = surface === "modal";

  const providerGroup = (
    <div className="usp-group">
      {loading && providers.length === 0 ? (
        <div
          className="usp-usage-loading"
          role="status"
          aria-label={t("app:settingsPage.usage.loading")}
        >
          {[2, 5].map((windowCount, providerIndex) => (
            <div className="usp-usage-skeleton-provider" key={providerIndex} aria-hidden="true">
              <div className="usp-usage-skeleton-header">
                <span className="usp-usage-skeleton-icon" />
                <span className="usp-usage-skeleton-copy">
                  <span className="usp-usage-skeleton-name" />
                  <span className="usp-usage-skeleton-status" />
                </span>
              </div>
              <div className="usp-usage-skeleton-windows">
                {Array.from({ length: windowCount }, (_, windowIndex) => (
                  <span className="usp-usage-skeleton-window" key={windowIndex}>
                    <span className="usp-usage-skeleton-heading">
                      <span />
                      <span />
                    </span>
                    <span className="usp-usage-skeleton-progress" />
                    <span className="usp-usage-skeleton-reset" />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && failed ? (
        <div className="usp-usage-empty">
          <span>{t("app:settingsPage.usage.loadFailed")}</span>
          <button type="button" className="usp-button" onClick={() => void refresh()}>
            {t("common:actions.retry")}
          </button>
        </div>
      ) : null}

      {!failed && providers.map((provider) => (
        <div className="usp-usage-provider" key={provider.engineId}>
          <div className="usp-usage-provider-header">
            <span className="usp-row-icon">
              {getHarnessIcon(provider.engineId === "claude" ? "claude-code" : provider.engineId, 17)}
            </span>
            <span className="usp-usage-provider-copy">
              <strong>{provider.name}</strong>
              <span>
                {provider.available
                  ? t("app:settingsPage.usage.connected")
                  : t("app:settingsPage.usage.unavailable")}
              </span>
            </span>
          </div>

          {provider.available ? (
            <div className="usp-usage-window-list">
              {provider.windows.map((window) => {
                const remainingPercent = Math.max(0, Math.min(100, 100 - window.usedPercent));
                const level = remainingPercent <= 10
                  ? "critical"
                  : remainingPercent <= 25
                    ? "warning"
                    : "normal";
                const reset = formatReset(window.resetsAt);
                return (
                  <div className="usp-usage-window" key={window.kind} data-level={level}>
                    <div className="usp-usage-window-heading">
                      <span>{t(windowLabelKey(window.kind))}</span>
                      <strong>{t("app:settingsPage.usage.percentLeft", { percent: remainingPercent })}</strong>
                    </div>
                    <div
                      className="usp-usage-progress"
                      role="progressbar"
                      aria-label={t(windowLabelKey(window.kind))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPercent}
                    >
                      <span style={{ width: `${remainingPercent}%` }} />
                    </div>
                    {reset ? (
                      <span className="usp-usage-reset">
                        {t("app:settingsPage.usage.resets", { time: reset })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );

  return (
    <section className={`usp-section usp-section-first${isModal ? " usage-limits-modal-content" : ""}`}>
      <div className={isModal ? "ws-header usage-limits-modal-header" : "usp-section-header usp-usage-section-header"}>
        {isModal ? (
          <span className="ws-header-icon usage-limits-modal-icon">
            <Gauge size={18} />
          </span>
        ) : null}
        <div>
          <h2
            id={isModal ? "usage-limits-modal-title" : undefined}
            className={isModal ? "ws-header-title" : undefined}
          >
            {isModal
              ? t("app:settingsPage.sections.usage.title")
              : t("app:settingsPage.usage.providerLimits")}
          </h2>
          <p className={isModal ? "usage-limits-modal-description" : undefined}>
            {isModal
              ? t("app:settingsPage.sections.usage.description")
              : t("app:settingsPage.usage.providerLimitsDescription")}
          </p>
        </div>
        <div className={isModal ? "usage-limits-modal-actions" : undefined}>
          <button
            type="button"
            className="usp-button usage-limits-refresh"
            disabled={loading}
            onClick={() => void refresh()}
            aria-label={t("common:actions.refresh")}
          >
            <RefreshCw size={13} className={loading ? "usp-spin" : undefined} />
            <span>{t("common:actions.refresh")}</span>
          </button>
          {isModal ? (
            <button
              ref={closeButtonRef}
              type="button"
              className="ws-close"
              onClick={onClose}
              aria-label={t("common:actions.close")}
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </div>

      {isModal ? <div className="ws-divider usage-limits-modal-divider" /> : null}
      {isModal ? <div className="ws-body usage-limits-modal-body">{providerGroup}</div> : providerGroup}
    </section>
  );
}
