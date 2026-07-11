export const THEME_PREFERENCES = ["dark", "light", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ThemeMode = "dark" | "light";

export function isThemePreference(value?: string | null): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function normalizeThemePreference(value?: string | null): ThemePreference {
  return isThemePreference(value) ? value : "dark";
}

function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  if (preference === "system") {
    return systemPrefersLight() ? "light" : "dark";
  }
  return preference;
}

export function getCurrentThemeMode(): ThemeMode {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

const THEME_CHANGED_EVENT = "panes:theme-changed";

// Mirrors the blocking inline script in index.html, which reads this same key
// to stamp data-theme before first paint (a paint hint only; config.toml via
// the theme store is still the source of truth once it loads).
const THEME_STORAGE_KEY = "panes:theme-preference";

export interface ThemeChangedEventDetail {
  mode: ThemeMode;
}

let systemThemeListenerCleanup: (() => void) | null = null;

function cacheThemePreferenceHint(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private browsing, disabled cookies). The
    // cache is only a paint hint, so failing silently is fine.
  }
}

/** Resolve, stamp `data-theme` on the document root, and broadcast the change.
 * Safe to call before React mounts (main.tsx) and again whenever the user
 * changes their preference or the OS theme flips while "system" is active. */
export function applyThemePreference(preference: ThemePreference): ThemeMode {
  systemThemeListenerCleanup?.();
  systemThemeListenerCleanup = null;

  const mode = resolveThemeMode(preference);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = mode;
  }
  if (typeof window !== "undefined") {
    cacheThemePreferenceHint(preference);
  }

  if (
    preference === "system" &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const listener = () => applyThemePreference("system");
    media.addEventListener("change", listener);
    systemThemeListenerCleanup = () => media.removeEventListener("change", listener);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ThemeChangedEventDetail>(THEME_CHANGED_EVENT, { detail: { mode } }),
    );
  }

  return mode;
}

export function listenThemeChanged(handler: (mode: ThemeMode) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ThemeChangedEventDetail>).detail;
    handler(detail.mode);
  };
  window.addEventListener(THEME_CHANGED_EVENT, listener);
  return () => window.removeEventListener(THEME_CHANGED_EVENT, listener);
}

export interface XtermThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
}

const XTERM_THEMES: Record<ThemeMode, XtermThemeColors> = {
  dark: {
    background: "#010102",
    foreground: "#FAFAFB",
    cursor: "#61D596",
    selectionBackground: "rgba(97, 213, 150, 0.24)",
  },
  light: {
    background: "#ECECEF",
    foreground: "#18181C",
    cursor: "#006D40",
    selectionBackground: "rgba(0, 109, 64, 0.18)",
  },
};

export function getXtermThemeColors(mode: ThemeMode): XtermThemeColors {
  return XTERM_THEMES[mode];
}
