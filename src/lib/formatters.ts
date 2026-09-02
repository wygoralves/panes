import { normalizeAppLocale, type AppLocale } from "./locale";

type RelativeTimeStyle = "compact" | "short-with-suffix";

interface RelativeTimeOptions {
  style?: RelativeTimeStyle;
}

const COMPACT_LABELS: Record<AppLocale, {
  now: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
}> = {
  en: {
    now: "now",
    minute: "m",
    hour: "h",
    day: "d",
    month: "mo",
  },
  "pt-BR": {
    now: "agora",
    minute: "min",
    hour: "h",
    day: "d",
    month: "mo",
  },
};

function asLocale(locale?: string | null): AppLocale {
  return normalizeAppLocale(locale);
}

/** SQLite's `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" in UTC with no
 * zone marker, which `Date` reads as local time. Tag it as UTC before
 * parsing, or every such stamp drifts by the local offset. */
const BARE_SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function normalizeTimestamp(value: string): string {
  return BARE_SQLITE_TIMESTAMP.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

function toDate(value: string | number | Date): Date | null {
  const normalized = typeof value === "string" ? normalizeTimestamp(value) : value;
  const normalizedValue = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(normalizedValue.getTime()) ? null : normalizedValue;
}

function formatCompactAmount(amount: number, unit: string, locale: AppLocale): string {
  if (locale === "en") {
    return `${amount}${unit}`;
  }
  return `${amount} ${unit}`;
}

export function formatRelativeTime(
  value: string | number | Date,
  locale?: string | null,
  options: RelativeTimeOptions = {},
): string {
  const date = toDate(value);
  if (!date) {
    return "";
  }

  const resolvedLocale = asLocale(locale);
  const labels = COMPACT_LABELS[resolvedLocale];
  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 45_000) {
    return labels.now;
  }

  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  if (minutes < 60) {
    const compact = formatCompactAmount(minutes, labels.minute, resolvedLocale);
    return options.style === "short-with-suffix"
      ? resolvedLocale === "pt-BR"
        ? `há ${minutes} ${labels.minute}`
        : `${compact} ago`
      : compact;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const compact = formatCompactAmount(hours, labels.hour, resolvedLocale);
    return options.style === "short-with-suffix"
      ? resolvedLocale === "pt-BR"
        ? `há ${hours} ${labels.hour}`
        : `${compact} ago`
      : compact;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    const compact = formatCompactAmount(days, labels.day, resolvedLocale);
    return options.style === "short-with-suffix"
      ? resolvedLocale === "pt-BR"
        ? `há ${days} ${labels.day}`
        : `${compact} ago`
      : compact;
  }

  const months = Math.floor(days / 30);
  const compact = formatCompactAmount(months, labels.month, resolvedLocale);
  return options.style === "short-with-suffix"
    ? resolvedLocale === "pt-BR"
      ? `há ${months} ${labels.month}`
      : `${compact} ago`
    : compact;
}

export function formatShortDate(value: string | number | Date, locale?: string | null): string {
  const date = toDate(value);
  if (!date) {
    return String(value);
  }

  return new Intl.DateTimeFormat(asLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDate(value: string | number | Date, locale?: string | null): string {
  const date = toDate(value);
  if (!date) {
    return String(value);
  }

  return new Intl.DateTimeFormat(asLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | number | Date, locale?: string | null): string {
  const date = toDate(value);
  if (!date) {
    return String(value);
  }

  return new Intl.DateTimeFormat(asLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value: string | number | Date, locale?: string | null): string {
  const date = toDate(value);
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(asLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
