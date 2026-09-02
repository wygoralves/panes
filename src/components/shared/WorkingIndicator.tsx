import { useEffect, useState, type ReactNode } from "react";

export type PixelGridTone = "neutral" | "info" | "amber" | "violet";
export type PixelGridVariant = "drive" | "orbit";

interface PixelGridProps {
  tone?: PixelGridTone;
  variant?: PixelGridVariant;
  className?: string;
}

const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** 3x3 pixel loader sized to the 18px block tile slot. */
export function PixelGrid({ tone = "neutral", variant = "drive", className }: PixelGridProps) {
  const classes = ["pixel-grid", `pixel-grid--${variant}`];
  if (tone !== "neutral") classes.push(`pixel-grid--${tone}`);
  if (className) classes.push(className);
  return (
    <span className={classes.join(" ")} aria-hidden="true">
      {CELLS.map((cell) => (
        <span key={cell} />
      ))}
    </span>
  );
}

function toEpochMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : value;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Milliseconds elapsed since `startedAt`, ticking while `active`. Ticks at
 * 100ms under a minute so tenths read live, then once a second.
 */
export function useElapsed(
  startedAt: number | string | null | undefined,
  active = true,
): number | null {
  const start = toEpochMs(startedAt);
  const [now, setNow] = useState(() => Date.now());
  const coarse = start != null && now - start >= 60_000;

  useEffect(() => {
    if (!active || start == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), coarse ? 1000 : 100);
    return () => clearInterval(id);
  }, [active, start, coarse]);

  if (start == null) return null;
  return Math.max(0, now - start);
}

/** "0.4s", "14.2s", "1m 02s", "1h 02m". */
export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

interface WorkingIndicatorProps {
  /** The phase the app is in, already translated. */
  label: string;
  /** Optional argument shown as a chip next to the label, such as a command. */
  chip?: ReactNode;
  chipMono?: boolean;
  startedAt?: number | string | null;
  tone?: PixelGridTone;
  variant?: PixelGridVariant;
  /** Shimmer the label while active. Defaults to true. */
  shimmer?: boolean;
  className?: string;
}

/** One row that says the app is working: loader, phase label, optional chip, live timer. */
export function WorkingIndicator({
  label,
  chip,
  chipMono = true,
  startedAt,
  tone = "neutral",
  variant = "drive",
  shimmer = true,
  className,
}: WorkingIndicatorProps) {
  const elapsed = useElapsed(startedAt);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`working-row${className ? ` ${className}` : ""}`}
    >
      <PixelGrid tone={tone} variant={variant} />
      <span className={`working-label${shimmer ? " msg-shimmer" : ""}`}>{label}</span>
      {chip != null && (
        <span className={`msg-chip${chipMono ? "" : " msg-chip--sans"}`}>
          <span className="msg-chip-text">{chip}</span>
        </span>
      )}
      {elapsed != null && <span className="working-time">{formatElapsed(elapsed)}</span>}
    </div>
  );
}
