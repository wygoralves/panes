import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { normalizeAppLocale } from "../lib/locale";
import commonEn from "./resources/en/common.json";
import appEn from "./resources/en/app.json";
import chatEn from "./resources/en/chat.json";
import workspaceEn from "./resources/en/workspace.json";
import setupEn from "./resources/en/setup.json";
import gitEn from "./resources/en/git.json";
import nativeEn from "./resources/en/native.json";
import commonPtBr from "./resources/pt-BR/common.json";
import appPtBr from "./resources/pt-BR/app.json";
import chatPtBr from "./resources/pt-BR/chat.json";
import workspacePtBr from "./resources/pt-BR/workspace.json";
import setupPtBr from "./resources/pt-BR/setup.json";
import gitPtBr from "./resources/pt-BR/git.json";
import nativePtBr from "./resources/pt-BR/native.json";

const resources = {
  en: {
    common: commonEn,
    app: appEn,
    chat: chatEn,
    workspace: workspaceEn,
    setup: setupEn,
    git: gitEn,
    native: nativeEn,
  },
  "pt-BR": {
    common: commonPtBr,
    app: appPtBr,
    chat: chatPtBr,
    workspace: workspacePtBr,
    setup: setupPtBr,
    git: gitPtBr,
    native: nativePtBr,
  },
} as const;

let initialized = false;

export async function initializeI18n(locale?: string | null) {
  const language = normalizeAppLocale(locale);

  if (!initialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: "en",
      defaultNS: "common",
      ns: ["common", "app", "chat", "workspace", "setup", "git", "native"],
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    });
    initialized = true;
    return i18n;
  }

  await i18n.changeLanguage(language);
  return i18n;
}

export function t(key: string, options?: Record<string, unknown>) {
  return i18n.t(key, options);
}

export { i18n };
