type PerfMetricName =
  | "chat.stream.flush.ms"
  | "chat.stream.events_per_sec"
  | "chat.render.commit.ms"
  | "git.refresh.ms"
  | "git.file_diff.ms";

interface PerfMetric {
  name: PerfMetricName;
  value: number;
  at: number;
  meta?: Record<string, unknown>;
}

interface PerfMetricSummary {
  count: number;
  avg: number;
  p95: number;
  max: number;
}

const MAX_STORED_METRICS = 4_000;
const WARN_COOLDOWN_MS = 8_000;
const PERF_BUDGETS: Record<PerfMetricName, number> = {
  "chat.stream.flush.ms": 12,
  "chat.stream.events_per_sec": 450,
  "chat.render.commit.ms": 16,
  "git.refresh.ms": 350,
  "git.file_diff.ms": 250,
};

const metrics: PerfMetric[] = [];
const lastWarnAtByMetric = new Map<PerfMetricName, number>();

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

export function recordPerfMetric(
  name: PerfMetricName,
  value: number,
  meta?: Record<string, unknown>,
) {
  if (!Number.isFinite(value)) {
    return;
  }

  const now = performance.now();
  metrics.push({ name, value, at: now, meta });
  if (metrics.length > MAX_STORED_METRICS) {
    metrics.splice(0, metrics.length - MAX_STORED_METRICS);
  }

  const budget = PERF_BUDGETS[name];
  if (value <= budget) {
    return;
  }

  const lastWarnAt = lastWarnAtByMetric.get(name) ?? 0;
  if (now - lastWarnAt < WARN_COOLDOWN_MS) {
    return;
  }
  lastWarnAtByMetric.set(name, now);

  const roundedValue = Math.round(value * 100) / 100;
  const roundedBudget = Math.round(budget * 100) / 100;
  console.warn(
    `[perf][budget] ${name}=${roundedValue} exceeds budget ${roundedBudget}`,
    meta ?? {},
  );
}

export function getPerfSnapshot(windowMs = 60_000): Record<PerfMetricName, PerfMetricSummary> {
  const now = performance.now();
  const from = now - Math.max(1, windowMs);
  const windowed = metrics.filter((metric) => metric.at >= from);

  const byName = new Map<PerfMetricName, number[]>();
  for (const metric of windowed) {
    const list = byName.get(metric.name);
    if (list) {
      list.push(metric.value);
    } else {
      byName.set(metric.name, [metric.value]);
    }
  }

  const result = {} as Record<PerfMetricName, PerfMetricSummary>;
  (Object.keys(PERF_BUDGETS) as PerfMetricName[]).forEach((name) => {
    const values = byName.get(name) ?? [];
    const count = values.length;
    const avg =
      count === 0
        ? 0
        : values.reduce((sum, current) => sum + current, 0) / count;
    const max = count === 0 ? 0 : Math.max(...values);
    result[name] = {
      count,
      avg,
      p95: percentile(values, 0.95),
      max,
    };
  });

  return result;
}

export function clearPerfMetrics() {
  metrics.length = 0;
  lastWarnAtByMetric.clear();
}

declare global {
  interface Window {
    __panesPerf?: {
      getSnapshot: (windowMs?: number) => Record<PerfMetricName, PerfMetricSummary>;
      clear: () => void;
      recent: () => PerfMetric[];
    };
  }
}

if (typeof window !== "undefined" && !window.__panesPerf) {
  window.__panesPerf = {
    getSnapshot: (windowMs?: number) => getPerfSnapshot(windowMs),
    clear: () => clearPerfMetrics(),
    recent: () => [...metrics],
  };
}

