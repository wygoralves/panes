import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Folder, Pencil, Plus, Rows2, SquareTerminal, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { ipc, listenTerminalExit, listenTerminalOutput } from "../../lib/ipc";
import { useTerminalStore, collectSessionIds } from "../../stores/terminalStore";
import type { SplitNode, SplitContainer as SplitContainerType } from "../../types";

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

// ── Split pane components ───────────────────────────────────────────

interface SplitPaneViewProps {
  node: SplitNode;
  workspaceId: string;
  groupId: string;
  focusedSessionId: string | null;
  containerRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onFocus: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRatioChange: (containerId: string, ratio: number) => void;
  ensureTerminal: (sessionId: string) => void;
  showCloseButton: boolean;
}

function SplitPaneView({
  node,
  workspaceId,
  groupId,
  focusedSessionId,
  containerRefs,
  onFocus,
  onClose,
  onRatioChange,
  ensureTerminal,
  showCloseButton,
}: SplitPaneViewProps) {
  if (node.type === "leaf") {
    const isFocused = node.sessionId === focusedSessionId;
    return (
      <div
        className={`terminal-leaf-pane${isFocused ? " terminal-leaf-pane-focused" : ""}`}
        onMouseDown={() => onFocus(node.sessionId)}
      >
        <div
          ref={(el) => {
            if (!el) {
              containerRefs.current.delete(node.sessionId);
              const cached = cachedTerminals.get(
                terminalCacheKey(workspaceId, node.sessionId)
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
            containerRefs.current.set(node.sessionId, el);
            ensureTerminal(node.sessionId);
          }}
          className="terminal-viewport"
          style={{ position: "absolute", inset: 0 }}
        />
        {showCloseButton && (
          <button
            type="button"
            className="terminal-pane-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose(node.sessionId);
            }}
            title="Close pane"
          >
            <X size={10} />
          </button>
        )}
      </div>
    );
  }

  return (
    <SplitContainerView
      container={node}
      workspaceId={workspaceId}
      groupId={groupId}
      focusedSessionId={focusedSessionId}
      containerRefs={containerRefs}
      onFocus={onFocus}
      onClose={onClose}
      onRatioChange={onRatioChange}
      ensureTerminal={ensureTerminal}
    />
  );
}

interface SplitContainerViewProps {
  container: SplitContainerType;
  workspaceId: string;
  groupId: string;
  focusedSessionId: string | null;
  containerRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onFocus: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRatioChange: (containerId: string, ratio: number) => void;
  ensureTerminal: (sessionId: string) => void;
}

function SplitContainerView({
  container,
  workspaceId,
  groupId,
  focusedSessionId,
  containerRefs,
  onFocus,
  onClose,
  onRatioChange,
  ensureTerminal,
}: SplitContainerViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => dragCleanupRef.current?.();
  }, []);

  const isVertical = container.direction === "vertical";
  const handleClass = isVertical
    ? "terminal-split-handle-v"
    : "terminal-split-handle-h";
  const flexDir = isVertical ? "row" : "column";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dimension = isVertical ? rect.width : rect.height;
      const start = isVertical ? rect.left : rect.top;
      const sessionIds = collectSessionIds(container);

      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        const pos = isVertical ? moveEvent.clientX : moveEvent.clientY;
        const newRatio = (pos - start) / dimension;
        onRatioChange(container.id, newRatio);
      };
      const cleanup = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", cleanup);
        document.body.style.userSelect = "";
        dragCleanupRef.current = null;
        for (const id of sessionIds) {
          scheduleTerminalFit(workspaceId, id, 0);
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", cleanup);
      dragCleanupRef.current = cleanup;
    },
    [container.id, isVertical, onRatioChange, workspaceId],
  );

  const firstPct = `${container.ratio * 100}%`;
  const secondPct = `${(1 - container.ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className="terminal-split-container"
      style={{ flexDirection: flexDir }}
    >
      <div style={{ flex: `0 0 calc(${firstPct} - 2px)`, minWidth: 0, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <SplitPaneView
          node={container.children[0]}
          workspaceId={workspaceId}
          groupId={groupId}
          focusedSessionId={focusedSessionId}
          containerRefs={containerRefs}
          onFocus={onFocus}
          onClose={onClose}
          onRatioChange={onRatioChange}
          ensureTerminal={ensureTerminal}
          showCloseButton
        />
      </div>
      <div className={handleClass} onMouseDown={handleMouseDown} />
      <div style={{ flex: `0 0 calc(${secondPct} - 2px)`, minWidth: 0, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <SplitPaneView
          node={container.children[1]}
          workspaceId={workspaceId}
          groupId={groupId}
          focusedSessionId={focusedSessionId}
          containerRefs={containerRefs}
          onFocus={onFocus}
          onClose={onClose}
          onRatioChange={onRatioChange}
          ensureTerminal={ensureTerminal}
          showCloseButton
        />
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

export function TerminalPanel({ workspaceId }: TerminalPanelProps) {
  const workspaceState = useTerminalStore((state) => state.workspaces[workspaceId]);
  const sessions = workspaceState?.sessions ?? [];
  const loading = workspaceState?.loading ?? false;
  const error = workspaceState?.error;
  const groups = workspaceState?.groups ?? [];
  const activeGroupId = workspaceState?.activeGroupId ?? null;
  const focusedSessionId = workspaceState?.focusedSessionId ?? null;

  const createSession = useTerminalStore((state) => state.createSession);
  const closeSession = useTerminalStore((state) => state.closeSession);
  const handleSessionExit = useTerminalStore((state) => state.handleSessionExit);
  const syncSessions = useTerminalStore((state) => state.syncSessions);
  const splitSession = useTerminalStore((state) => state.splitSession);
  const setFocusedSession = useTerminalStore((state) => state.setFocusedSession);
  const setActiveGroup = useTerminalStore((state) => state.setActiveGroup);
  const updateGroupRatio = useTerminalStore((state) => state.updateGroupRatio);
  const renameGroup = useTerminalStore((state) => state.renameGroup);
  const reorderGroups = useTerminalStore((state) => state.reorderGroups);

  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Only one tab can be renamed at a time, so a single ref is safe despite being inside .map()
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const dragStateRef = useRef<{ groupId: string; startX: number; started: boolean; el: HTMLElement } | null>(null);
  const suppressClickRef = useRef(false);
  const tabsListRef = useRef<HTMLDivElement>(null);

  const [ctxMenu, setCtxMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renamingGroupId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingGroupId]);

  useEffect(() => {
    if (renamingGroupId && !groups.some((g) => g.id === renamingGroupId)) {
      setRenamingGroupId(null);
    }
  }, [groups, renamingGroupId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleClose = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ctxMenuRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("keydown", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("keydown", handleClose);
    };
  }, [ctxMenu]);

  const commitRename = useCallback(
    (groupId: string) => {
      const trimmed = renameValue.trim();
      if (trimmed) {
        renameGroup(workspaceId, groupId, trimmed);
      }
      setRenamingGroupId(null);
    },
    [renameValue, renameGroup, workspaceId],
  );

  const cancelRename = useCallback(() => {
    setRenamingGroupId(null);
  }, []);

  const startRenameFromMenu = useCallback((groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setCtxMenu(null);
    setRenamingGroupId(groupId);
    setRenameValue(group.name);
  }, [groups]);

  const closeGroupFromMenu = useCallback((groupId: string) => {
    setCtxMenu(null);
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    for (const id of collectSessionIds(group.root)) {
      void closeSession(workspaceId, id);
    }
  }, [groups, closeSession, workspaceId]);

  const handleTabPointerDown = useCallback((e: React.PointerEvent, groupId: string) => {
    if (renamingGroupId || groups.length <= 1 || e.button !== 0) return;
    const tabEl = e.currentTarget as HTMLElement;
    dragStateRef.current = { groupId, startX: e.clientX, started: false, el: tabEl };

    const onMove = (me: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      if (!ds.started) {
        if (Math.abs(me.clientX - ds.startX) < 5) return;
        ds.started = true;
        suppressClickRef.current = true;
        setDraggingGroupId(groupId);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }

      // Tab follows cursor via direct DOM transform (bypasses React for 60fps)
      const dx = me.clientX - ds.startX;
      ds.el.style.transform = `translateX(${dx}px)`;

      // Check for swap with neighboring tabs
      const listEl = tabsListRef.current;
      if (!listEl) return;
      const tabs = Array.from(listEl.children) as HTMLElement[];
      const currentGroups = useTerminalStore.getState().workspaces[workspaceId]?.groups ?? [];
      const curIdx = currentGroups.findIndex((g) => g.id === groupId);
      if (curIdx === -1) return;
      for (let i = 0; i < tabs.length; i++) {
        if (i === curIdx) continue;
        const rect = tabs[i].getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (i < curIdx && me.clientX < mid) {
          // Swapping left — natural position shifts left by swapped tab width
          ds.startX -= rect.width;
          reorderGroups(workspaceId, curIdx, i);
          break;
        }
        if (i > curIdx && me.clientX > mid) {
          // Swapping right — natural position shifts right by swapped tab width
          ds.startX += rect.width;
          reorderGroups(workspaceId, curIdx, i);
          break;
        }
      }
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const ds = dragStateRef.current;
      if (ds?.started) {
        ds.el.style.transform = "";
        setDraggingGroupId(null);
        requestAnimationFrame(() => { suppressClickRef.current = false; });
      }
      dragStateRef.current = null;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [renamingGroupId, groups.length, workspaceId, reorderGroups]);

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
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if ((event.metaKey || event.ctrlKey) && event.key === "Backspace") {
        void ipc.terminalWrite(workspaceId, sessionId, "\x15").catch(() => undefined);
        return false;
      }
      const k = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (k === "d" || k === "t")) return false;
      return true;
    });
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

  // Fit all sessions in the active group — reads store at call time to stay
  // stable across group tree mutations (e.g. ratio drag) and avoid
  // ResizeObserver churn.
  const fitActiveGroup = useCallback(() => {
    const state = useTerminalStore.getState().workspaces[workspaceId];
    const gid = state?.activeGroupId;
    if (!gid) return;
    const group = state?.groups.find((g) => g.id === gid);
    if (!group) return;
    for (const id of collectSessionIds(group.root)) {
      scheduleTerminalFit(workspaceId, id);
    }
  }, [workspaceId]);

  useEffect(() => {
    void syncSessions(workspaceId);
  }, [workspaceId, syncSessions]);

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

  // Fit when active group changes
  useEffect(() => {
    fitActiveGroup();
  }, [activeGroupId, sessions.length, fitActiveGroup]);

  useEffect(() => {
    function onWindowResize() {
      fitActiveGroup();
    }

    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [fitActiveGroup]);

  // ResizeObserver: observe all containers in the active group.
  // Re-subscribes when activeGroupId or sessions.length changes (new
  // tab or split/close adds/removes panes) but NOT on ratio changes.
  useEffect(() => {
    if (!activeGroupId || typeof ResizeObserver === "undefined") {
      return;
    }
    const state = useTerminalStore.getState().workspaces[workspaceId];
    const group = state?.groups.find((g) => g.id === activeGroupId);
    if (!group) return;

    const ids = collectSessionIds(group.root);
    const containers: HTMLDivElement[] = [];
    for (const id of ids) {
      const el = containerRefs.current.get(id);
      if (el) containers.push(el);
    }

    if (containers.length === 0) return;

    const observer = new ResizeObserver(() => fitActiveGroup());
    for (const el of containers) {
      observer.observe(el);
    }

    return () => observer.disconnect();
    // sessions.length triggers re-subscribe when panes are added/removed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, sessions.length, workspaceId, fitActiveGroup]);

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

  const focusedTerminal = useMemo(
    () => sessions.find((session) => session.id === focusedSessionId) ?? null,
    [focusedSessionId, sessions],
  );

  const spawnNewSession = useCallback(() => {
    const active = focusedSessionId
      ? cachedTerminals.get(terminalCacheKey(workspaceId, focusedSessionId))
      : undefined;
    const cols = active?.terminal.cols ?? DEFAULT_COLS;
    const rows = active?.terminal.rows ?? DEFAULT_ROWS;
    void createSession(workspaceId, cols, rows);
  }, [focusedSessionId, createSession, workspaceId]);

  const handleSplit = useCallback(
    (direction: "horizontal" | "vertical") => {
      if (!focusedSessionId) return;
      const active = cachedTerminals.get(
        terminalCacheKey(workspaceId, focusedSessionId),
      );
      const cols = active?.terminal.cols ?? DEFAULT_COLS;
      const rows = active?.terminal.rows ?? DEFAULT_ROWS;
      void splitSession(workspaceId, focusedSessionId, direction, cols, rows);
    },
    [focusedSessionId, splitSession, workspaceId],
  );

  return (
    <div className="terminal-panel-root">
      <div className="terminal-tabs-bar">
        <div className="terminal-tabs-list" ref={tabsListRef}>
          {groups.map((group) => {
            const isActive = group.id === activeGroupId;
            const groupSessionIds = collectSessionIds(group.root);
            return (
              <button
                key={group.id}
                type="button"
                className={`terminal-tab${isActive ? " terminal-tab-active" : ""}${draggingGroupId === group.id ? " terminal-tab-dragging" : ""}`}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  setActiveGroup(workspaceId, group.id);
                }}
                onPointerDown={(e) => handleTabPointerDown(e, group.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ groupId: group.id, x: e.clientX, y: e.clientY });
                }}
              >
                <SquareTerminal size={12} />
                {renamingGroupId === group.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="terminal-tab-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(group.id); }
                      if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                    }}
                    onBlur={() => commitRename(group.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="terminal-tab-label"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingGroupId(group.id);
                      setRenameValue(group.name);
                    }}
                  >
                    {group.name}
                  </span>
                )}
                {groupSessionIds.length > 1 && (
                  <span className="terminal-tab-badge">{groupSessionIds.length}</span>
                )}
                <button
                  type="button"
                  className="terminal-tab-close"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    for (const id of groupSessionIds) {
                      void closeSession(workspaceId, id);
                    }
                  }}
                >
                  <X size={10} />
                </button>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            className="terminal-add-btn"
            onClick={spawnNewSession}
            title="New terminal"
          >
            <Plus size={13} />
          </button>
          {focusedSessionId && (
            <>
              <button
                type="button"
                className="terminal-add-btn"
                onClick={() => handleSplit("vertical")}
                title="Split right"
              >
                <Columns2 size={13} />
              </button>
              <button
                type="button"
                className="terminal-add-btn"
                onClick={() => handleSplit("horizontal")}
                title="Split down"
              >
                <Rows2 size={13} />
              </button>
            </>
          )}
        </div>
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
            {groups.map((group) => (
              <div
                key={group.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: group.id === activeGroupId ? "flex" : "none",
                }}
              >
                <SplitPaneView
                  node={group.root}
                  workspaceId={workspaceId}
                  groupId={group.id}
                  focusedSessionId={focusedSessionId}
                  containerRefs={containerRefs}
                  onFocus={(id) => setFocusedSession(workspaceId, id)}
                  onClose={(id) => void closeSession(workspaceId, id)}
                  onRatioChange={(containerId, ratio) =>
                    updateGroupRatio(workspaceId, group.id, containerId, ratio)
                  }
                  ensureTerminal={ensureTerminal}
                  showCloseButton={group.root.type === "split"}
                />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="terminal-error-banner">
            {error}
          </div>
        )}
        {focusedTerminal && (
          <div className="terminal-meta-bar" title={focusedTerminal.cwd}>
            <Folder size={10} style={{ opacity: 0.5, flexShrink: 0 }} />
            <span className="terminal-meta-bar-path">{focusedTerminal.cwd}</span>
          </div>
        )}
      </div>

      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          className="dropdown-menu"
          style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            type="button"
            className="dropdown-item"
            onClick={() => startRenameFromMenu(ctxMenu.groupId)}
          >
            <Pencil size={12} />
            Rename
          </button>
          <button
            type="button"
            className="dropdown-item"
            onClick={() => closeGroupFromMenu(ctxMenu.groupId)}
          >
            <Trash2 size={12} />
            Close
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
