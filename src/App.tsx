import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { SearchModal } from "./components/chat/SearchModal";
import { EngineHealthBanner } from "./components/onboarding/EngineHealthBanner";
import { HarnessPanel } from "./components/onboarding/HarnessPanel";
import { SetupWizard } from "./components/onboarding/SetupWizard";
import { ToastContainer } from "./components/shared/ToastContainer";
import { useUpdateStore } from "./stores/updateStore";
import { listenThreadUpdated, listenMenuAction } from "./lib/ipc";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useEngineStore } from "./stores/engineStore";
import { useUiStore } from "./stores/uiStore";
import { useThreadStore } from "./stores/threadStore";
import { useGitStore } from "./stores/gitStore";
import { useTerminalStore } from "./stores/terminalStore";
import { useFileStore } from "./stores/fileStore";
import { getActiveEditorView, openSearchPanel } from "./components/editor/CodeMirrorEditor";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Debounce guard: when both the JS keydown handler and the native menu-action
// fire for the same shortcut, only the first one within 100ms takes effect.
const shortcutLastFired = new Map<string, number>();
const SHORTCUT_DEBOUNCE_MS = 100;

function fireShortcut(id: string, action: () => void) {
  const now = Date.now();
  const last = shortcutLastFired.get(id) ?? 0;
  if (now - last < SHORTCUT_DEBOUNCE_MS) return;
  shortcutLastFired.set(id, now);
  action();
}

export function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const loadEngines = useEngineStore((s) => s.load);
  const refreshAllThreads = useThreadStore((s) => s.refreshAllThreads);
  const refreshThreads = useThreadStore((s) => s.refreshThreads);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);

  useEffect(() => {
    void loadWorkspaces();
    void loadEngines();
  }, [loadWorkspaces, loadEngines]);

  useEffect(() => {
    void refreshAllThreads(workspaces.map((workspace) => workspace.id));
  }, [workspaces, refreshAllThreads]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenThreadUpdated(({ workspaceId }) => {
      void refreshThreads(workspaceId);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshThreads]);

  useEffect(() => {
    function onBeforeUnload() {
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (wsId) {
        useGitStore.getState().flushDrafts(wsId);
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdate();
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  // Handle app-level keyboard shortcuts via JavaScript keydown listeners.
  // On macOS, when a contenteditable element (CodeMirror editor) is focused,
  // WKWebView claims Cmd+key events for text formatting before they reach
  // Tauri's native menu accelerators. JavaScript keydown events still fire,
  // so the JS handler is the primary source of truth for these shortcuts.
  //
  // When the native menu accelerator DOES fire (non-contenteditable focus),
  // both the JS handler and the menu-action listener would toggle the same
  // state, canceling each other out. A debounce guard (`shortcutLastFired`)
  // prevents the second handler from re-toggling within 100ms.
  //
  // Cmd+E (editor toggle) has no native menu item — JS-only.
  // Cmd+S always prevents the browser save-page dialog.
  // Cmd+W is handled solely via the native menu "close-window" action.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      // On macOS/WebKit, e.key is lowercase even when Shift is held with Cmd,
      // so normalize to lowercase and use e.shiftKey to differentiate.
      const key = e.key.toLowerCase();

      // Always prevent Cmd+S from opening the browser save dialog
      if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        return;
      }

      switch (key) {
        case "e":
          if (e.shiftKey) return;
          e.preventDefault();
          {
            const wsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (!wsId) return;
            const ws = useTerminalStore.getState().workspaces[wsId];
            const current = ws?.layoutMode ?? "chat";
            if (current === "editor") {
              void useTerminalStore.getState().setLayoutMode(wsId, ws?.preEditorLayoutMode ?? "chat");
            } else {
              void useTerminalStore.getState().setLayoutMode(wsId, "editor");
            }
          }
          break;
        case "b":
          e.preventDefault();
          if (e.shiftKey) {
            fireShortcut("toggle-git-panel", () => useUiStore.getState().toggleGitPanel());
          } else {
            fireShortcut("toggle-sidebar", () => useUiStore.getState().toggleSidebar());
          }
          break;
        case "f": {
          if (!e.shiftKey) {
            // Cmd+F — editor find (only in editor mode)
            const wsIdF = useWorkspaceStore.getState().activeWorkspaceId;
            const wsFState = wsIdF ? useTerminalStore.getState().workspaces[wsIdF] : undefined;
            if (wsFState?.layoutMode === "editor") {
              e.preventDefault();
              const activeTabId = useFileStore.getState().activeTabId;
              if (activeTabId) {
                const view = getActiveEditorView(activeTabId);
                if (view) openSearchPanel(view);
              }
            }
            return;
          }
          // Cmd+Shift+F — global search modal
          e.preventDefault();
          fireShortcut("toggle-search", () => useUiStore.getState().setSearchOpen(true));
          break;
        }
        case "h": {
          if (e.shiftKey) return;
          // Cmd+H — editor find & replace (only in editor mode)
          const wsIdH = useWorkspaceStore.getState().activeWorkspaceId;
          const wsHState = wsIdH ? useTerminalStore.getState().workspaces[wsIdH] : undefined;
          if (wsHState?.layoutMode !== "editor") return;
          e.preventDefault();
          const activeTabIdH = useFileStore.getState().activeTabId;
          if (activeTabIdH) {
            const view = getActiveEditorView(activeTabIdH);
            if (view) {
              openSearchPanel(view);
              requestAnimationFrame(() => {
                const replaceInput = view.dom.querySelector<HTMLInputElement>("[name=replace]");
                replaceInput?.focus();
              });
            }
          }
          break;
        }
        case "t":
          e.preventDefault();
          if (e.shiftKey) {
            fireShortcut("toggle-terminal", () => {
              const wsId = useWorkspaceStore.getState().activeWorkspaceId;
              if (wsId) void useTerminalStore.getState().cycleLayoutMode(wsId);
            });
          } else {
            fireShortcut("new-terminal-tab", () => {
              const wsId = useWorkspaceStore.getState().activeWorkspaceId;
              if (!wsId) return;
              const ws = useTerminalStore.getState().workspaces[wsId];
              if (!ws || (ws.layoutMode !== "split" && ws.layoutMode !== "terminal")) return;
              void useTerminalStore.getState().createSession(wsId);
            });
          }
          break;
        case "d":
          e.preventDefault();
          fireShortcut(e.shiftKey ? "split-horizontal" : "split-vertical", () => {
            const wsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (!wsId) return;
            const ws = useTerminalStore.getState().workspaces[wsId];
            if (!ws || (ws.layoutMode !== "split" && ws.layoutMode !== "terminal")) return;
            const sid = ws.focusedSessionId;
            if (!sid) return;
            void useTerminalStore.getState().splitSession(
              wsId, sid, e.shiftKey ? "horizontal" : "vertical",
            );
          });
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listenMenuAction((action) => {
      switch (action) {
        case "toggle-sidebar":
          fireShortcut("toggle-sidebar", () => useUiStore.getState().toggleSidebar());
          break;
        case "toggle-git-panel":
          fireShortcut("toggle-git-panel", () => useUiStore.getState().toggleGitPanel());
          break;
        case "toggle-search":
          fireShortcut("toggle-search", () => useUiStore.getState().setSearchOpen(true));
          break;
        case "toggle-terminal":
          fireShortcut("toggle-terminal", () => {
            const wsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (wsId) void useTerminalStore.getState().cycleLayoutMode(wsId);
          });
          break;
        case "close-window": {
          const wsId = useWorkspaceStore.getState().activeWorkspaceId;
          const wsState = wsId ? useTerminalStore.getState().workspaces[wsId] : undefined;
          const fileState = useFileStore.getState();
          if (wsState?.layoutMode === "editor" && fileState.activeTabId) {
            fileState.requestCloseTab(fileState.activeTabId);
          } else {
            void getCurrentWindow().close();
          }
          break;
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", zIndex: 1 }}>
      <ThreeColumnLayout />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none", zIndex: 10 }}>
        <div style={{ pointerEvents: "auto" }}>
          <EngineHealthBanner />
        </div>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SetupWizard />
      <HarnessPanel />
      <ToastContainer />
    </div>
  );
}
