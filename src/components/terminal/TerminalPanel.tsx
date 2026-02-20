import { useCallback, useEffect, useMemo, useRef } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
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

  const terminalsRef = useRef<Map<string, SessionTerminal>>(new Map());
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingOutputRef = useRef<Map<string, string[]>>(new Map());

  const ensureTerminal = useCallback((sessionId: string) => {
    if (terminalsRef.current.has(sessionId)) {
      return;
    }

    const container = containerRefs.current.get(sessionId);
    if (!container) {
      return;
    }

    const terminal = new Terminal({
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

    const queued = pendingOutputRef.current.get(sessionId);
    if (queued?.length) {
      for (const chunk of queued) {
        terminal.write(chunk);
      }
      pendingOutputRef.current.delete(sessionId);
    }

    terminalsRef.current.set(sessionId, {
      terminal,
      fitAddon,
      dispose: () => {
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
    const active = terminalsRef.current.get(activeSessionId);
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

    const sessionIds = new Set(sessions.map((session) => session.id));
    for (const [sessionId, entry] of terminalsRef.current.entries()) {
      if (sessionIds.has(sessionId)) {
        continue;
      }
      entry.dispose();
      terminalsRef.current.delete(sessionId);
      pendingOutputRef.current.delete(sessionId);
      containerRefs.current.delete(sessionId);
    }
  }, [sessions, ensureTerminal]);

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
      const entry = terminalsRef.current.get(event.sessionId);
      if (entry) {
        entry.terminal.write(event.data);
        return;
      }

      const current = pendingOutputRef.current.get(event.sessionId) ?? [];
      current.push(event.data);
      pendingOutputRef.current.set(event.sessionId, current);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlistenOutput = fn;
    });

    void listenTerminalExit(workspaceId, (event) => {
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

  useEffect(() => {
    return () => {
      for (const entry of terminalsRef.current.values()) {
        entry.dispose();
      }
      terminalsRef.current.clear();
      containerRefs.current.clear();
      pendingOutputRef.current.clear();
    };
  }, []);

  const activeTerminal = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const spawnNewSession = useCallback(() => {
    const active = activeSessionId
      ? terminalsRef.current.get(activeSessionId)
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
                <span
                  role="button"
                  tabIndex={0}
                  className="terminal-tab-close"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeSession(workspaceId, session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    void closeSession(workspaceId, session.id);
                  }}
                >
                  <X size={11} />
                </span>
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
            <p>{loading ? "Starting terminal..." : "No terminal session"}</p>
            {!loading && (
              <button type="button" className="btn-outline" onClick={spawnNewSession}>
                New Terminal
              </button>
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
            {activeTerminal.cwd}
          </div>
        )}
      </div>
    </div>
  );
}
