import { useEffect } from "react";
import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { CommandPalette } from "./components/shared/CommandPalette";
import { SetupWizard } from "./components/onboarding/SetupWizard";
import { ToastContainer } from "./components/shared/ToastContainer";
import { useUpdateStore } from "./stores/updateStore";
import { useHarnessStore } from "./stores/harnessStore";
import { ipc, listenEngineRuntimeUpdated, listenMenuAction, listenThreadUpdated } from "./lib/ipc";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useEngineStore } from "./stores/engineStore";
import { useUiStore } from "./stores/uiStore";
import { useThreadStore } from "./stores/threadStore";
import { useGitStore } from "./stores/gitStore";
import { useTerminalStore, collectSessionIds } from "./stores/terminalStore";
import { useFileStore } from "./stores/fileStore";
import { toast } from "./stores/toastStore";
import type { RuntimeToast, Thread } from "./types";
import { getActiveEditorView, openSearchPanel } from "./components/editor/CodeMirrorEditor";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LinuxWindowResizeHandles } from "./components/shared/LinuxWindowResizeHandles";
import { isLinuxDesktop, requestWindowClose } from "./lib/windowActions";

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

async function toggleWindowFullscreen() {
  try {
    const currentWindow = getCurrentWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    await currentWindow.setFullscreen(!isFullscreen);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[App] Failed to toggle fullscreen", error);
    }
  }
}

function isCodexSyncRequired(thread: Thread | null | undefined): boolean {
  return thread?.engineId === "codex" && thread.engineMetadata?.codexSyncRequired === true;
}

function showRuntimeToast(runtimeToast?: RuntimeToast) {
  if (!runtimeToast) {
    return;
  }

  switch (runtimeToast.variant) {
    case "success":
      toast.success(runtimeToast.message);
      break;
    case "warning":
      toast.warning(runtimeToast.message);
      break;
    case "info":
      toast.info(runtimeToast.message);
      break;
    case "error":
    default:
      toast.error(runtimeToast.message);
      break;
  }
}

export function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const loadEngines = useEngineStore((s) => s.load);
  const applyEngineRuntimeUpdate = useEngineStore((s) => s.applyRuntimeUpdate);
  const scanHarnesses = useHarnessStore((s) => s.scan);
  const refreshAllThreads = useThreadStore((s) => s.refreshAllThreads);
  const refreshThreads = useThreadStore((s) => s.refreshThreads);
  const applyThreadUpdateLocal = useThreadStore((s) => s.applyThreadUpdateLocal);
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useUiStore((s) => s.closeCommandPalette);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);

  useEffect(() => {
    void loadWorkspaces();
    void loadEngines();
    void scanHarnesses();
  }, [loadWorkspaces, loadEngines, scanHarnesses]);

  useEffect(() => {
    void refreshAllThreads(workspaces.map((workspace) => workspace.id));
  }, [workspaces, refreshAllThreads]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenThreadUpdated(async ({ workspaceId, thread }) => {
      if (thread) {
        const applied = applyThreadUpdateLocal(thread);
        const activeThreadId = useThreadStore.getState().activeThreadId;
        if (thread.id === activeThreadId && isCodexSyncRequired(thread)) {
          try {
            const syncedThread = await ipc.syncThreadFromEngine(thread.id);
            if (useThreadStore.getState().applyThreadUpdateLocal(syncedThread)) {
              return;
            }
          } catch (error) {
            console.warn(`Failed to sync active Codex thread ${thread.id}:`, error);
          }
          void refreshThreads(workspaceId);
          return;
        }
        if (applied) {
          return;
        }
      }
      void refreshThreads(workspaceId);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [applyThreadUpdateLocal, refreshThreads]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenEngineRuntimeUpdated((event) => {
      applyEngineRuntimeUpdate(event);
      showRuntimeToast(event.toast);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [applyEngineRuntimeUpdate]);

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
  // Cmd+Alt+F (focus mode) is intercepted before Cmd+F so it wins even in editors.
  // F11 toggles native window fullscreen independently from focus mode.
  // Cmd+E (editor toggle) has no native menu item — JS-only.
  // Cmd+S always prevents the browser save-page dialog.
  // Cmd+W is handled solely via the native menu "close-window" action.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F11") {
        e.preventDefault();
        fireShortcut("toggle-fullscreen", () => {
          void toggleWindowFullscreen();
        });
        return;
      }

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

      if (key === "f" && e.altKey && !e.shiftKey) {
        e.preventDefault();
        fireShortcut("toggle-focus-mode", () => useUiStore.getState().toggleFocusMode());
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
              const fileState = useFileStore.getState();
              const activeTabId = fileState.activeTabId;
              if (activeTabId) {
                const activeTab = fileState.tabs.find((tab) => tab.id === activeTabId);
                const editorId =
                  activeTab?.renderMode === "git-diff-editor"
                    ? `${activeTabId}:git-modified`
                    : activeTabId;
                const view = getActiveEditorView(editorId);
                if (view) openSearchPanel(view);
              }
            }
            return;
          }
          // Cmd+Shift+F — search-focused command palette
          e.preventDefault();
          fireShortcut("toggle-search", () =>
            useUiStore.getState().openCommandPalette({ variant: "search", initialQuery: "?" })
          );
          break;
        }
        case "h": {
          if (e.shiftKey) return;
          // Cmd+H — editor find & replace (only in editor mode)
          const wsIdH = useWorkspaceStore.getState().activeWorkspaceId;
          const wsHState = wsIdH ? useTerminalStore.getState().workspaces[wsIdH] : undefined;
          if (wsHState?.layoutMode !== "editor") return;
          e.preventDefault();
          const fileState = useFileStore.getState();
          const activeTabIdH = fileState.activeTabId;
          if (activeTabIdH) {
            const activeTab = fileState.tabs.find((tab) => tab.id === activeTabIdH);
            const editorId =
              activeTab?.renderMode === "git-diff-editor"
                ? `${activeTabIdH}:git-modified`
                : activeTabIdH;
            const view = getActiveEditorView(editorId);
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
        case "i":
          if (!e.shiftKey) return;
          e.preventDefault();
          fireShortcut("toggle-broadcast", () => {
            const wsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (!wsId) return;
            const ws = useTerminalStore.getState().workspaces[wsId];
            if (!ws || (ws.layoutMode !== "split" && ws.layoutMode !== "terminal")) return;
            const activeGroupId = ws.activeGroupId;
            if (!activeGroupId) return;
            const activeGroup = ws.groups.find((g) => g.id === activeGroupId);
            if (!activeGroup) return;
            const isBroadcastingActiveGroup = ws.broadcastGroupId === activeGroupId;
            if (!isBroadcastingActiveGroup && collectSessionIds(activeGroup.root).length < 2) return;
            useTerminalStore.getState().toggleBroadcast(wsId, activeGroupId);
          });
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
        case "p":
          if (e.shiftKey) return;
          e.preventDefault();
          fireShortcut("open-command-palette-files", () =>
            useUiStore.getState().openCommandPalette({ initialQuery: "%" })
          );
          break;
        case "k":
          e.preventDefault();
          if (e.shiftKey) {
            fireShortcut("open-command-palette-threads", () =>
              useUiStore.getState().openCommandPalette({ initialQuery: "@" })
            );
          } else {
            fireShortcut("toggle-command-palette", () =>
              useUiStore.getState().openCommandPalette()
            );
          }
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
        case "toggle-focus-mode":
          fireShortcut("toggle-focus-mode", () => useUiStore.getState().toggleFocusMode());
          break;
        case "toggle-fullscreen":
          fireShortcut("toggle-fullscreen", () => {
            void toggleWindowFullscreen();
          });
          break;
        case "toggle-search":
          fireShortcut("toggle-search", () =>
            useUiStore.getState().openCommandPalette({ variant: "search", initialQuery: "?" })
          );
          break;
        case "toggle-terminal":
          fireShortcut("toggle-terminal", () => {
            const wsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (wsId) void useTerminalStore.getState().cycleLayoutMode(wsId);
          });
          break;
        case "close-window": {
          void requestWindowClose();
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
      {isLinuxDesktop() && <LinuxWindowResizeHandles />}
      <ThreeColumnLayout />
      <CommandPalette open={commandPaletteOpen} onClose={closeCommandPalette} />
      <SetupWizard />
      <ToastContainer />
    </div>
  );
}
