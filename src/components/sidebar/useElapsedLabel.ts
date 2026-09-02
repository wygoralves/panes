import { useEffect, useState } from "react";
import { formatWorkingDurationLabel } from "./statusGrouping";

/** Self-ticking elapsed label for working rows. Returns null when there is no
 * usable start timestamp, so a caller can render nothing without branching on
 * the parse itself. */
export function useElapsedLabel(startedAt: string | null): string | null {
  const startedMs = startedAt !== null ? Date.parse(startedAt) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedMs]);

  if (Number.isNaN(startedMs)) return null;
  return formatWorkingDurationLabel(now - startedMs);
}
