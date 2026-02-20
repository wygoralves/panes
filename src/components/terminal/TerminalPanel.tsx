import { useCallback, useEffect, useMemo, useRef } from "react";
import { Folder, Plus, SquareTerminal, X } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Unicode11Addon } from "xterm-addon-unicode11";
import "xterm/css/xterm.css";
import { ipc, listenTerminalExit, listenTerminalOutput } from "../../lib/ipc";
import { useTerminalStore } from "../../stores/terminalStore";

interface TerminalPanelProps {
  workspaceId: string;
}

interface SessionTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  dispose: () => void;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;

// Module-level cache — xterm instances survive component mount/unmount cycles.
// This is what preserves terminal scrollback when switching workspaces.
const cachedTerminals = new Map<string, SessionTerminal>();
const pendingOutput = new Map<string, string[]>();

function terminalCacheKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}::${sessionId}`;
}

function terminalWorkspacePrefix(workspaceId: string): string {
  return `${workspaceId}::`;
}

/** Permanently destroy a cached terminal (used when session is explicitly closed). */
function destroyCachedTerminal(workspaceId: string, sessionId: string) {
  const key = terminalCacheKey(workspaceId, sessionId);
  const cached = cachedTerminals.get(key);
  if (cached) {
    cached.dispose();
    cachedTerminals.delete(key);
  }
  pendingOutput.delete(key);
}

export function TerminalPanel({ workspaceId }: TerminalPanelProps) {
  const workspaceState = useTerminalStore((state) => state.workspaces[workspaceId]);
  const sessions = workspaceState?.sessions ?? [];
  const activeSessionId = workspaceState?.activeSessionId ?? null;
  const loading = workspaceState?.loading ?? false;
  const error = workspaceState?.error;
  const createSession = useTerminalStore((state) => state.createSession);
  const closeSession = useTerminalStore((state) => state.closeSession);
  const setActiveSession = useTerminalStore((state) => state.setActiveSession);
  const handleSessionExit = useTerminalStore((state) => state.handleSessionExit);
  const syncSessions = useTerminalStore((state) => state.syncSessions);

  // Component-level refs — only track DOM containers (reset on mount/unmount).
  // Terminal instances live in the module-level cachedTerminals map.
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const ensureTerminal = useCallback((sessionId: string) => {
    const container = containerRefs.current.get(sessionId);
    if (!container) {
      return;
    }
    const cacheKey = terminalCacheKey(workspaceId, sessionId);

    // Check module-level cache first — re-attach if the instance already exists
    const cached = cachedTerminals.get(cacheKey);
    if (cached) {
      const el = cached.terminal.element;
      if (el && el.parentElement !== container) {
        // Move xterm DOM element to the new container (preserves scrollback)
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        container.appendChild(el);
      }
      // Re-fit and force a full redraw — the canvas goes stale when detached from the DOM
      cached.fitAddon.fit();
      cached.terminal.refresh(0, cached.terminal.rows - 1);
      void ipc
        .terminalResize(workspaceId, sessionId, cached.terminal.cols, cached.terminal.rows)
        .catch(() => undefined);
      // Drain any output buffered while unmounted
      const queued = pendingOutput.get(cacheKey);
      if (queued?.length) {
        for (const chunk of queued) {
          cached.terminal.write(chunk);
        }
        pendingOutput.delete(cacheKey);
      }
      return;
    }

    // No cached instance — create a fresh terminal
    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5000,
      theme: {
        background: "#050505",
        foreground: "#f5f5f5",
        selectionBackground: "rgba(14, 240, 195, 0.28)",
        cursor: "#0ef0c3",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = "11";

    terminal.open(container);

    fitAddon.fit();
    void ipc
      .terminalResize(workspaceId, sessionId, terminal.cols, terminal.rows)
      .catch(() => undefined);

    const writeDisposable = terminal.onData((data) => {
      void ipc.terminalWrite(workspaceId, sessionId, data).catch(() => undefined);
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void ipc.terminalResize(workspaceId, sessionId, cols, rows).catch(() => undefined);
    });

    // Drain any output that arrived before the terminal was created
    const queued = pendingOutput.get(cacheKey);
    if (queued?.length) {
      for (const chunk of queued) {
        terminal.write(chunk);
      }
      pendingOutput.delete(cacheKey);
    }

    let disposed = false;
    cachedTerminals.set(cacheKey, {
      terminal,
      fitAddon,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        writeDisposable.dispose();
        resizeDisposable.dispose();
        terminal.dispose();
      },
    });
  }, [workspaceId]);

  const fitActiveTerminal = useCallback(() => {
    if (!activeSessionId) {
      return;
    }
    const active = cachedTerminals.get(terminalCacheKey(workspaceId, activeSessionId));
    if (!active) {
      return;
    }
    active.fitAddon.fit();
    void ipc
      .terminalResize(workspaceId, activeSessionId, active.terminal.cols, active.terminal.rows)
      .catch(() => undefined);
  }, [activeSessionId, workspaceId]);

  useEffect(() => {
    void syncSessions(workspaceId);
  }, [workspaceId, syncSessions]);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSession(workspaceId, sessions[sessions.length - 1].id);
    }
  }, [activeSessionId, sessions, setActiveSession, workspaceId]);

  useEffect(() => {
    for (const session of sessions) {
      ensureTerminal(session.id);
    }

    // Dispose terminals for sessions that no longer exist (explicitly closed)
    const sessionIds = new Set(sessions.map((session) => session.id));
    const workspacePrefix = terminalWorkspacePrefix(workspaceId);
    for (const cacheKey of cachedTerminals.keys()) {
      if (!cacheKey.startsWith(workspacePrefix)) {
        continue;
      }
      const sessionId = cacheKey.slice(workspacePrefix.length);
      if (!sessionIds.has(sessionId)) {
        destroyCachedTerminal(workspaceId, sessionId);
      }
    }
  }, [sessions, ensureTerminal, workspaceId]);

  useEffect(() => {
    fitActiveTerminal();
  }, [activeSessionId, sessions.length, fitActiveTerminal]);

  useEffect(() => {
    function onWindowResize() {
      fitActiveTerminal();
    }

    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [fitActiveTerminal]);

  useEffect(() => {
    if (!activeSessionId || typeof ResizeObserver === "undefined") {
      return;
    }
    const activeContainer = containerRefs.current.get(activeSessionId);
    if (!activeContainer) {
      return;
    }

    const observer = new ResizeObserver(() => fitActiveTerminal());
    observer.observe(activeContainer);

    return () => observer.disconnect();
  }, [activeSessionId, fitActiveTerminal]);

  useEffect(() => {
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let disposed = false;

    void listenTerminalOutput(workspaceId, (event) => {
      const cacheKey = terminalCacheKey(workspaceId, event.sessionId);
      const entry = cachedTerminals.get(cacheKey);
      if (entry) {
        entry.terminal.write(event.data);
        return;
      }

      // Buffer output — the terminal may not be created yet
      const current = pendingOutput.get(cacheKey) ?? [];
      current.push(event.data);
      pendingOutput.set(cacheKey, current);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlistenOutput = fn;
    });

    void listenTerminalExit(workspaceId, (event) => {
      destroyCachedTerminal(workspaceId, event.sessionId);
      handleSessionExit(workspaceId, event.sessionId);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlistenExit = fn;
    });

    return () => {
      disposed = true;
      if (unlistenOutput) {
        unlistenOutput();
      }
      if (unlistenExit) {
        unlistenExit();
      }
    };
  }, [handleSessionExit, workspaceId]);

  // On unmount: only clear DOM refs. Do NOT dispose terminals — they live in the module cache.
  useEffect(() => {
    return () => {
      containerRefs.current.clear();
    };
  }, []);

  const activeTerminal = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const spawnNewSession = useCallback(() => {
    const active = activeSessionId
      ? cachedTerminals.get(terminalCacheKey(workspaceId, activeSessionId))
      : undefined;
    const cols = active?.terminal.cols ?? DEFAULT_COLS;
    const rows = active?.terminal.rows ?? DEFAULT_ROWS;
    void createSession(workspaceId, cols, rows);
  }, [activeSessionId, createSession, workspaceId]);

  return (
    <div className="terminal-panel-root">
      <div className="terminal-tabs-bar">
        <div className="terminal-tabs-list">
          {sessions.map((session, index) => {
            const isActive = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                className={`terminal-tab ${isActive ? "terminal-tab-active" : ""}`}
                onClick={() => setActiveSession(workspaceId, session.id)}
                title={session.cwd}
              >
                <SquareTerminal size={12} />
                <span className="terminal-tab-label">Terminal {index + 1}</span>
                <button
                  type="button"
                  className="terminal-tab-close"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeSession(workspaceId, session.id);
                  }}
                >
                  <X size={10} />
                </button>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="terminal-add-btn"
          onClick={spawnNewSession}
          title="New terminal"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="terminal-body">
        {sessions.length === 0 ? (
          <div className="terminal-empty-state">
            <SquareTerminal size={36} style={{ opacity: 0.18 }} />
            <span className="terminal-empty-state-title">
              {loading ? "Starting terminal..." : "No terminal session"}
            </span>
            {!loading && (
              <>
                <span className="terminal-empty-state-subtitle">
                  Open a new terminal to get started
                </span>
                <button type="button" className="btn-outline" onClick={spawnNewSession} style={{ marginTop: 4 }}>
                  New Terminal
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="terminal-viewport-stack">
            {sessions.map((session) => (
              <div
                key={session.id}
                ref={(node) => {
                  if (!node) {
                    containerRefs.current.delete(session.id);
                    return;
                  }
                  containerRefs.current.set(session.id, node);
                  ensureTerminal(session.id);
                }}
                className="terminal-viewport"
                style={{ display: session.id === activeSessionId ? "block" : "none" }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="terminal-error-banner">
            {error}
          </div>
        )}
        {activeTerminal && (
          <div className="terminal-meta-bar" title={activeTerminal.cwd}>
            <Folder size={10} style={{ opacity: 0.5, flexShrink: 0 }} />
            <span className="terminal-meta-bar-path">{activeTerminal.cwd}</span>
          </div>
        )}
      </div>
    </div>
  );
}
