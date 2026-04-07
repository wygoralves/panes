import React from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import { App } from "./App";
import { AppErrorBoundary } from "./components/shared/AppErrorBoundary";
import { initializeI18n } from "./i18n";
import { ipc } from "./lib/ipc";
import { getBrowserLocaleFallback } from "./lib/locale";
import "./globals.css";

async function bootstrap() {
  let locale = getBrowserLocaleFallback();

  try {
    locale = await ipc.getAppLocale();
  } catch {
    // Frontend-only dev/test contexts won't have the Tauri invoke bridge.
  }

  await initializeI18n(locale);

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
