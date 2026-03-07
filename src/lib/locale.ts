export const SUPPORTED_APP_LOCALES = ["en", "pt-BR"] as const;

export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number];

export function normalizeAppLocale(value?: string | null): AppLocale {
  const normalized = String(value ?? "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();

  if (normalized === "pt" || normalized.startsWith("pt-")) {
    return "pt-BR";
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }

  return "en";
}

export function isAppLocale(value?: string | null): value is AppLocale {
  return SUPPORTED_APP_LOCALES.includes(value as AppLocale);
}

export function getBrowserLocaleFallback(): AppLocale {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    return normalizeAppLocale(navigator.language);
  }
  return "en";
}

export function getLocaleDisplayName(locale: AppLocale): string {
  switch (locale) {
    case "pt-BR":
      return "Português (Brasil)";
    case "en":
    default:
      return "English";
  }
}
