import { useCallback, useEffect, useState } from "react";
import { Gauge, KeyRound, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";
import { engineKind } from "../../lib/engineKind";
import { chatProviderForEngine, signInChatProviderInTerminal } from "../../lib/chatProviderSignIn";
import {
  clampRemainingPercent,
  describeUsageReset,
  usageLevel,
  usageResetDate,
} from "../../lib/usageWindows";
import { useChatProvidersStore } from "../../stores/chatProvidersStore";
import { useUiStore } from "../../stores/uiStore";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { Ref } from "react";
import type { ChatProviderUsage, ChatProviderUsageWindow } from "../../types";

interface Props {
  surface?: "settings" | "modal";
  onClose?: () => void;
  closeButtonRef?: Ref<HTMLButtonElement>;
}

const REFRESH_INTERVAL_MS = 60_000;

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

function providerIconId(engineId: string): string {
  const kind = engineKind(engineId);
  return kind === "claude" ? "claude-code" : kind;
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
  const [now, setNow] = useState(() => Date.now());
  const providerInstances = useChatProvidersStore((state) => state.providers);
  const loadProviderInstances = useChatProvidersStore((state) => state.load);
  const closeUsageLimitsModal = useUiStore((state) => state.closeUsageLimitsModal);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setProviders(await ipc.getChatProviderUsage());
      setNow(Date.now());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadProviderInstances();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadProviderInstances, refresh]);

  const formatAbsolute = (date: Date) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);

  const formatReset = (timestamp: number | null): string | null => {
    const reset = describeUsageReset(timestamp, now);
    if (!reset) return null;
    if (reset.kind === "minutes") {
      return t("app:settingsPage.usage.resetsIn", {
        duration: t("app:settingsPage.usage.minutes", { minutes: reset.minutes }),
      });
    }
    if (reset.kind === "hours") {
      return t("app:settingsPage.usage.resetsIn", {
        duration: t("app:settingsPage.usage.hoursMinutes", { hours: reset.hours, minutes: reset.minutes }),
      });
    }
    return t("app:settingsPage.usage.resets", { time: formatAbsolute(reset.date) });
  };

  const handleSignIn = async (engineId: string) => {
    const provider = chatProviderForEngine(engineId, providerInstances);
    const started = await signInChatProviderInTerminal(provider);
    if (started && surface === "modal") closeUsageLimitsModal();
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

      {!failed &&
        providers.map((provider) => {
          const instance = providerInstances.find((entry) => entry.id === provider.engineId);
          const detail = instance && !instance.builtIn && instance.homePath
            ? t("app:settingsPage.chat.ownLogin", { path: instance.homePath })
            : instance && !instance.builtIn
              ? t("app:settingsPage.chat.sharedInstall")
              : t("app:settingsPage.chat.defaultInstall");
          const windows = provider.available ? provider.windows : [];
          const primary = windows.find((window) => window.kind === "five_hour") ?? windows[0] ?? null;
          const secondary = windows.filter((window) => window !== primary);
          return (
            <div className="usp-usage-provider" key={provider.engineId}>
              <div className="usp-usage-provider-header">
                <span className="usp-row-icon">{getHarnessIcon(providerIconId(provider.engineId), 17)}</span>
                <span className="usp-usage-provider-copy">
                  <strong>{provider.name}</strong>
                  <span>{detail}</span>
                </span>
                {!provider.available ? (
                  <button
                    type="button"
                    className="usp-button usp-usage-signin"
                    onClick={() => void handleSignIn(provider.engineId)}
                  >
                    <KeyRound size={13} />
                    {t("app:settingsPage.chat.signIn")}
                  </button>
                ) : null}
              </div>

              {provider.available ? (
                <div className="usp-usage-window-list">
                  {primary ? <UsageWindowMeter window={primary} primary formatReset={formatReset} /> : null}
                  {secondary.length > 0 ? (
                    <div className={secondary.length > 1 ? "usp-usage-window-grid" : undefined}>
                      {secondary.map((window) => (
                        <UsageWindowMeter key={window.kind} window={window} formatReset={formatReset} />
                      ))}
                    </div>
                  ) : null}
                  {windows.length === 0 ? (
                    <p className="usp-usage-note">{t("app:settingsPage.usage.noWindows")}</p>
                  ) : null}
                </div>
              ) : (
                <p className="usp-usage-note">{t("app:settingsPage.usage.unavailable")}</p>
              )}
            </div>
          );
        })}
    </div>
  );

  function UsageWindowMeter({
    window,
    primary = false,
    formatReset,
  }: {
    window: ChatProviderUsageWindow;
    primary?: boolean;
    formatReset: (timestamp: number | null) => string | null;
  }) {
    const remainingPercent = clampRemainingPercent(window.usedPercent);
    const level = usageLevel(remainingPercent);
    const reset = formatReset(window.resetsAt);
    const resetDate = usageResetDate(window.resetsAt);
    const label = t(windowLabelKey(window.kind));
    return (
      <div
        className={`usp-usage-window${primary ? " usp-usage-window-primary" : ""}`}
        data-level={level}
      >
        <div className="usp-usage-window-heading">
          <span className="usp-usage-window-label">{label}</span>
          <span className="usp-usage-window-value">
            {t("app:settingsPage.usage.percentLeft", { percent: remainingPercent })}
          </span>
        </div>
        <div
          className="usp-usage-progress"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={remainingPercent}
        >
          <span style={{ width: `${remainingPercent}%` }} />
        </div>
        {reset ? (
          <span className="usp-usage-reset" title={resetDate ? formatAbsolute(resetDate) : undefined}>
            {reset}
          </span>
        ) : null}
      </div>
    );
  }

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
