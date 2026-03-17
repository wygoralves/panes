import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RemoteAttachApp } from "./remote/RemoteAttachApp";
import { AppErrorBoundary } from "./components/shared/AppErrorBoundary";
import { initializeI18n } from "./i18n";
import { ipc } from "./lib/ipc";
import { getBrowserLocaleFallback } from "./lib/locale";
import { setPanesTransport } from "./lib/panesTransport";
import { createTauriTransport } from "./lib/tauriTransport";
import "./globals.css";

function isRemoteAttachMode(): boolean {
  const search = new URLSearchParams(window.location.search);
  return (
    window.location.pathname === "/remote" ||
    search.get("remote") === "1" ||
    search.has("remoteUrl")
  );
}

async function bootstrap() {
  const remoteAttachMode = isRemoteAttachMode();
  let locale = getBrowserLocaleFallback();

  if (!remoteAttachMode) {
    setPanesTransport(createTauriTransport());
    try {
      locale = await ipc.getAppLocale();
    } catch {
      // Frontend-only dev/test contexts won't have the Tauri invoke bridge.
    }
  }

  await initializeI18n(locale);

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        {remoteAttachMode ? <RemoteAttachApp /> : <App />}
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
