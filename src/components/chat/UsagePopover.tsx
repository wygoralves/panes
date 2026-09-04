import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  shouldShowUsageTrigger,
  tightestUsage,
  usageLevel,
  usageWindowCandidates,
} from "../../lib/usageWindows";
import type { TFunction } from "i18next";
import type { ContextUsage } from "../../types";

const POPOVER_WIDTH = 360;
const VIEWPORT_MARGIN = 8;

/** A plan window the popover can draw: `percent` is the budget left, as the store reports it. */
export interface UsageWindow {
  label: string;
  percent: number | null;
  resetsAt: string | null;
}

interface Props {
  usage: ContextUsage;
  /** Weekly window for the selected Claude model family; Claude threads only. */
  familyWindow?: UsageWindow | null;
  onOpenDetails: () => void;
}

/** A window's remaining budget, rounded for display; null when unknown. */
function leftPercent(remainingPercent: number | null): number | null {
  if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent)) {
    return null;
  }
  return clampPercent(remainingPercent);
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Time left before a window resets, never below a minute so the copy stays a duration. */
function formatResetTime(t: TFunction<"chat">, isoDate: string | null): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const diffMin = Math.max(1, Math.round((date.getTime() - Date.now()) / 60_000));
  if (diffMin < 60) return t("status.minutesShort", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return t("status.hoursMinutesShort", { hours: diffHr, minutes: diffMin % 60 });
  }
  const diffDays = Math.floor(diffHr / 24);
  return t("status.daysHoursShort", { days: diffDays, hours: diffHr % 24 });
}

/** 387_500 -> "387.5k", 1_200_000 -> "1.2M". */
function formatTokenCount(tokens: number): string {
  const scale = (value: number, suffix: string) => {
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
  };
  if (tokens >= 1_000_000) return scale(tokens / 1_000_000, "M");
  if (tokens >= 1_000) return scale(tokens / 1_000, "k");
  return String(Math.round(tokens));
}

/**
 * Composer bars and popover bars share one three-state scheme, each coloured by
 * its own limit rather than by the tightest one. Bars carry the budget left, so
 * a full bar is plenty and it drains toward warning then critical.
 */
function levelModifier(percentLeft: number): "" | "--warning" | "--critical" {
  const level = usageLevel(percentLeft);
  if (level === "critical") return "--critical";
  if (level === "warning") return "--warning";
  return "";
}

function fillClass(base: string, percentLeft: number): string {
  const modifier = levelModifier(percentLeft);
  return modifier ? `${base} ${base}${modifier}` : base;
}

function UsageMeter({
  label,
  meta,
  percent,
}: {
  label: string;
  meta?: string | null;
  /** Budget left for this window, 0-100. */
  percent: number;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="usage-popover-meter">
      <div className="usage-popover-row">
        <span className="usage-popover-label">{label}</span>
        <span className="usage-popover-meta">
          {meta ? <span>{meta}</span> : null}
          <span className="usage-popover-percent">
            {t("status.percentLeft", { percent })}
          </span>
        </span>
      </div>
      <div className="usage-popover-bar">
        <div
          className={fillClass("usage-popover-bar-fill", percent)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function UsagePopover({ usage, familyWindow = null, onOpenDetails }: Props) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  const contextLeft = leftPercent(usage.contextPercent);
  const candidates = useMemo(
    () =>
      usageWindowCandidates(usage, familyWindow, {
        context: t("status.contextWindow"),
        fiveHour: t("status.fiveHourLimit"),
        weekly: t("status.weeklyAllModels"),
      }),
    [familyWindow, t, usage],
  );
  const binding = useMemo(() => tightestUsage(candidates), [candidates]);
  const contextTokens =
    usage.currentTokens !== null && usage.maxContextTokens !== null
      ? `${formatTokenCount(usage.currentTokens)} / ${formatTokenCount(usage.maxContextTokens)}`
      : null;

  const windows = useMemo<UsageWindow[]>(() => {
    const rows: UsageWindow[] = [
      {
        label: t("status.fiveHourLimit"),
        percent: usage.windowFiveHourPercent,
        resetsAt: usage.windowFiveHourResetsAt,
      },
      {
        label: t("status.weeklyAllModels"),
        percent: usage.windowWeeklyPercent,
        resetsAt: usage.windowWeeklyResetsAt,
      },
    ];
    if (familyWindow) {
      rows.push(familyWindow);
    }
    return rows.filter((row) => leftPercent(row.percent) !== null);
  }, [familyWindow, t, usage]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const alignedRight = rect.right - POPOVER_WIDTH;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(alignedRight, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
    );

    setPos({ bottom: window.innerHeight - rect.top + 6, left });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const openDetails = useCallback(() => {
    setOpen(false);
    onOpenDetails();
  }, [onOpenDetails]);

  if (!shouldShowUsageTrigger(usage)) {
    return null;
  }

  const meterTitle =
    binding === null
      ? t("status.openUsagePopover")
      : t("status.ringUsage", { label: binding.label, percent: `${binding.percentLeft}%` });

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="usage-popover"
          role="dialog"
          aria-label={t("status.openUsagePopover")}
          style={{ position: "fixed", bottom: pos.bottom, left: pos.left }}
        >
          {contextLeft !== null ? (
            <UsageMeter
              label={t("status.contextWindow")}
              meta={contextTokens}
              percent={contextLeft}
            />
          ) : null}

          {windows.length > 0 ? (
            <>
              {contextLeft !== null ? <div className="usage-popover-divider" /> : null}
              <div className="usage-popover-head">{t("status.planLimits")}</div>
              {windows.map((row) => (
                <UsageMeter
                  key={row.label}
                  label={row.label}
                  meta={
                    row.resetsAt
                      ? t("status.resetsIn", { time: formatResetTime(t, row.resetsAt) })
                      : null
                  }
                  percent={leftPercent(row.percent) ?? 0}
                />
              ))}
            </>
          ) : null}

          <div className="usage-popover-divider" />
          <div className="usage-popover-footer">
            <button type="button" className="usage-popover-link" onClick={openDetails}>
              {t("status.viewDetails")}
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="chat-usage-meter"
        onClick={() => setOpen((prev) => !prev)}
        title={meterTitle}
        aria-label={meterTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="chat-usage-meter-rows" aria-hidden="true">
          {candidates.length > 0 ? (
            candidates.map((candidate) => (
              <span key={candidate.source} className="chat-usage-meter-row">
                <span
                  className={fillClass("chat-usage-meter-row-fill", candidate.percentLeft)}
                  style={{ width: `${candidate.percentLeft}%` }}
                />
              </span>
            ))
          ) : (
            <span className="chat-usage-meter-row" />
          )}
        </span>
      </button>
      {popover}
    </>
  );
}
