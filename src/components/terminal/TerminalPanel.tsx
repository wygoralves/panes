import { useCallback, useEffect, useMemo, useRef } from "react";
import { Folder, Plus, SquareTerminal, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { ipc, listenTerminalExit, listenTerminalOutput } from "../../lib/ipc";
import { useTerminalStore } from "../../stores/terminalStore";

interface TerminalPanelProps {
  workspaceId: string;
}

interface TerminalSize {
  cols: number;
  rows: number;
}

interface SessionTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  outputQueue: string[];
  flushInProgress: boolean;
  flushTimer?: ReturnType<typeof window.setTimeout>;
  fitTimer?: ReturnType<typeof window.setTimeout>;
  isAttached: boolean;
  lastResizeSent?: TerminalSize;
  debugSample: {
    chunks: number;
    chars: number;
    lastLogAt: number;
  };
  webglCleanup?: () => void;
  dispose: () => void;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const FIT_DEBOUNCE_MS = 80;
const OUTPUT_FLUSH_DELAY_MS = 16;
const OUTPUT_BATCH_CHAR_LIMIT = 65536;
const TERMINAL_DEBUG =
  import.meta.env.DEV && import.meta.env.VITE_TERMINAL_DEBUG === "1";

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

function logTerminalDebug(
  message: string,
  details?: Record<string, string | number | boolean | undefined>
) {
  if (!TERMINAL_DEBUG) {
    return;
  }
  if (details) {
    console.debug(`[terminal] ${message}`, details);
    return;
  }
  console.debug(`[terminal] ${message}`);
}

function setupWebglRenderer(
  cacheKey: string,
  terminal: Terminal
): (() => void) | null {
  if (typeof WebGL2RenderingContext === "undefined") {
    logTerminalDebug("webgl-unsupported", { cacheKey });
    return null;
  }
  try {
    const webglAddon = new WebglAddon();
    terminal.loadAddon(webglAddon);
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      logTerminalDebug("webgl-context-loss", { cacheKey });
    });
    logTerminalDebug("webgl-enabled", { cacheKey });
    return () => {
      contextLossDisposable.dispose();
      webglAddon.dispose();
    };
  } catch (error) {
    logTerminalDebug("webgl-disabled", {
      cacheKey,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function normalizeSize(cols: number, rows: number): TerminalSize {
  return {
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
  };
}

function sameSize(a?: TerminalSize, b?: TerminalSize): boolean {
  if (!a || !b) {
    return false;
  }
  return a.cols === b.cols && a.rows === b.rows;
}

function hasRenderableSize(container: HTMLElement): boolean {
  return container.offsetWidth > 0 && container.offsetHeight > 0;
}

function clearSessionTimers(session: SessionTerminal) {
  if (session.fitTimer !== undefined) {
    window.clearTimeout(session.fitTimer);
    session.fitTimer = undefined;
  }
  if (session.flushTimer !== undefined) {
    window.clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
  }
}

function sendResizeIfNeeded(
  workspaceId: string,
  sessionId: string,
  session: SessionTerminal,
  cols: number,
  rows: number
) {
  const next = normalizeSize(cols, rows);
  if (sameSize(session.lastResizeSent, next)) {
    return;
  }
  session.lastResizeSent = next;
  void ipc
    .terminalResize(workspaceId, sessionId, next.cols, next.rows)
    .catch(() => undefined);
}

function pullOutputBatch(outputQueue: string[]): string | null {
  if (outputQueue.length === 0) {
    return null;
  }

  let totalChars = 0;
  let take = 0;
  for (const chunk of outputQueue) {
    if (take > 0 && totalChars + chunk.length > OUTPUT_BATCH_CHAR_LIMIT) {
      break;
    }
    totalChars += chunk.length;
    take += 1;
    if (totalChars >= OUTPUT_BATCH_CHAR_LIMIT) {
      break;
    }
  }

  if (take === 0) {
    take = 1;
  }

  return outputQueue.splice(0, take).join("");
}

function flushOutputQueue(cacheKey: string) {
  const session = cachedTerminals.get(cacheKey);
  if (!session || session.flushInProgress) {
    return;
  }
  if (!session.isAttached) {
    return;
  }

  const payload = pullOutputBatch(session.outputQueue);
  if (!payload) {
    return;
  }

  session.flushInProgress = true;
  session.terminal.write(payload, () => {
    const latest = cachedTerminals.get(cacheKey);
    if (!latest) {
      return;
    }
    latest.flushInProgress = false;
    if (latest.outputQueue.length > 0) {
      scheduleOutputFlush(cacheKey, latest, 0);
    }
  });
}

function scheduleOutputFlush(
  cacheKey: string,
  session: SessionTerminal,
  delayMs: number = OUTPUT_FLUSH_DELAY_MS
) {
  if (session.flushTimer !== undefined) {
    return;
  }
  session.flushTimer = window.setTimeout(() => {
    const latest = cachedTerminals.get(cacheKey);
    if (!latest) {
      return;
    }
    latest.flushTimer = undefined;
    flushOutputQueue(cacheKey);
  }, delayMs);
}

function queueOutput(cacheKey: string, data: string) {
  const session = cachedTerminals.get(cacheKey);
  if (!session) {
    const current = pendingOutput.get(cacheKey) ?? [];
    current.push(data);
    pendingOutput.set(cacheKey, current);
    return;
  }

  session.outputQueue.push(data);

  session.debugSample.chunks += 1;
  session.debugSample.chars += data.length;
  const now = Date.now();
  if (TERMINAL_DEBUG && now - session.debugSample.lastLogAt >= 1000) {
    logTerminalDebug("output-sample", {
      queueDepth: session.outputQueue.length,
      chunks: session.debugSample.chunks,
      chars: session.debugSample.chars,
      attached: session.isAttached,
    });
    session.debugSample.lastLogAt = now;
    session.debugSample.chunks = 0;
    session.debugSample.chars = 0;
  }

  if (session.isAttached) {
    scheduleOutputFlush(cacheKey, session);
  }
}

function drainPendingOutput(cacheKey: string, session: SessionTerminal) {
  const buffered = pendingOutput.get(cacheKey);
  if (!buffered?.length) {
    return;
  }
  session.outputQueue.push(...buffered);
  pendingOutput.delete(cacheKey);
  if (session.isAttached) {
    scheduleOutputFlush(cacheKey, session, 0);
  }
}

function runTerminalFit(workspaceId: string, sessionId: string) {
  const cacheKey = terminalCacheKey(workspaceId, sessionId);
  const session = cachedTerminals.get(cacheKey);
  if (!session || !session.isAttached) {
    return;
  }

  const container = session.terminal.element?.parentElement;
  if (!(container instanceof HTMLElement) || !hasRenderableSize(container)) {
    return;
  }

  const before = normalizeSize(session.terminal.cols, session.terminal.rows);
  session.fitAddon.fit();
  const after = normalizeSize(session.terminal.cols, session.terminal.rows);
  if (!sameSize(before, after) && after.rows > 0) {
    session.terminal.refresh(0, after.rows - 1);
  }

  sendResizeIfNeeded(workspaceId, sessionId, session, after.cols, after.rows);

  if (session.outputQueue.length > 0) {
    scheduleOutputFlush(cacheKey, session, 0);
  }
}

function scheduleTerminalFit(
  workspaceId: string,
  sessionId: string,
  delayMs: number = FIT_DEBOUNCE_MS
) {
  const cacheKey = terminalCacheKey(workspaceId, sessionId);
  const session = cachedTerminals.get(cacheKey);
  if (!session) {
    return;
  }

  if (session.fitTimer !== undefined) {
    window.clearTimeout(session.fitTimer);
  }
  session.fitTimer = window.setTimeout(() => {
    const latest = cachedTerminals.get(cacheKey);
    if (!latest) {
      return;
    }
    latest.fitTimer = undefined;
    runTerminalFit(workspaceId, sessionId);
  }, delayMs);
}

function markWorkspaceTerminalsDetached(workspaceId: string) {
  const workspacePrefix = terminalWorkspacePrefix(workspaceId);
  for (const [cacheKey, session] of cachedTerminals) {
    if (!cacheKey.startsWith(workspacePrefix)) {
      continue;
    }
    session.isAttached = false;
    if (session.fitTimer !== undefined) {
      window.clearTimeout(session.fitTimer);
      session.fitTimer = undefined;
    }
    if (session.flushTimer !== undefined) {
      window.clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
  }
}

/** Permanently destroy a cached terminal (used when session is explicitly closed). */
function destroyCachedTerminal(workspaceId: string, sessionId: string) {
  const key = terminalCacheKey(workspaceId, sessionId);
  const cached = cachedTerminals.get(key);
  if (cached) {
    clearSessionTimers(cached);
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
      cached.isAttached = true;
      drainPendingOutput(cacheKey, cached);
      scheduleTerminalFit(workspaceId, sessionId, 0);
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
    const webglCleanup = setupWebglRenderer(cacheKey, terminal) ?? undefined;

    const writeDisposable = terminal.onData((data) => {
      void ipc.terminalWrite(workspaceId, sessionId, data).catch(() => undefined);
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const current = cachedTerminals.get(cacheKey);
      if (!current) {
        return;
      }
      sendResizeIfNeeded(workspaceId, sessionId, current, cols, rows);
    });

    let disposed = false;
    const entry: SessionTerminal = {
      terminal,
      fitAddon,
      outputQueue: [],
      flushInProgress: false,
      isAttached: true,
      debugSample: {
        chunks: 0,
        chars: 0,
        lastLogAt: Date.now(),
      },
      webglCleanup,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        clearSessionTimers(entry);
        entry.webglCleanup?.();
        entry.webglCleanup = undefined;
        writeDisposable.dispose();
        resizeDisposable.dispose();
        terminal.dispose();
      },
    };
    cachedTerminals.set(cacheKey, entry);
    drainPendingOutput(cacheKey, entry);
    scheduleTerminalFit(workspaceId, sessionId, 0);
  }, [workspaceId]);

  const fitActiveTerminal = useCallback(() => {
    if (!activeSessionId) {
      return;
    }
    scheduleTerminalFit(workspaceId, activeSessionId);
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
      queueOutput(cacheKey, event.data);
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

  // On unmount/workspace swap: mark cache entries detached but keep the session alive.
  useEffect(() => {
    return () => {
      markWorkspaceTerminalsDetached(workspaceId);
      containerRefs.current.clear();
    };
  }, [workspaceId]);

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
          <div className="terminal-empty-state animate-fade-in">
            <div className="terminal-empty-state-icon-box">
              <SquareTerminal size={20} opacity={0.5} />
            </div>
            <div>
              <p className="terminal-empty-state-title">
                {loading ? "Starting terminal..." : "No terminal session"}
              </p>
              {!loading && (
                <p className="terminal-empty-state-subtitle">
                  Open a new terminal to get started
                </p>
              )}
            </div>
            {!loading && (
              <button type="button" className="terminal-new-btn" onClick={spawnNewSession}>
                <Plus size={12} />
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
                    const cached = cachedTerminals.get(
                      terminalCacheKey(workspaceId, session.id)
                    );
                    if (cached) {
                      cached.isAttached = false;
                      if (cached.fitTimer !== undefined) {
                        window.clearTimeout(cached.fitTimer);
                        cached.fitTimer = undefined;
                      }
                    }
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
