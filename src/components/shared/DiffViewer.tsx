import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { UnfoldVertical } from "lucide-react";
import {
  extractDiffFilename,
  LINE_CLASS,
  parseDiff,
  type ParsedLine,
} from "../../lib/parseDiff";
import type {
  DiffParseWorkerRequest,
  DiffParseWorkerResponse,
} from "../../workers/diffParser.types";

const DIFF_WORKER_THRESHOLD_CHARS = 12_000;
const DIFF_WORKER_IDLE_TERMINATE_MS = 30_000;
const DIFF_VIRTUALIZATION_THRESHOLD_LINES = 500;
const DIFF_VIEWPORT_FALLBACK_HEIGHT = 400;
const DIFF_OVERSCAN_PX = 240;
const DIFF_CONTENT_VERTICAL_PADDING = 4;
const DIFF_LINE_HEIGHT = 19;
const DIFF_HUNK_HEIGHT = 24;

export interface DiffParseResult {
  parsed: ParsedLine[];
  filename: string | null;
  adds: number;
  dels: number;
}

interface UseParsedDiffOptions {
  enabled?: boolean;
}

let diffWorkerInstance: Worker | null = null;
let diffWorkerRequestSeq = 0;
let diffWorkerIdleTimer: number | null = null;
const diffWorkerCallbacks = new Map<
  number,
  {
    resolve: (value: DiffParseResult) => void;
    reject: (reason?: unknown) => void;
  }
>();

function clearDiffWorkerIdleTimer() {
  if (diffWorkerIdleTimer === null) {
    return;
  }
  window.clearTimeout(diffWorkerIdleTimer);
  diffWorkerIdleTimer = null;
}

function scheduleDiffWorkerIdleTermination() {
  clearDiffWorkerIdleTimer();
  if (!diffWorkerInstance || diffWorkerCallbacks.size > 0) {
    return;
  }

  diffWorkerIdleTimer = window.setTimeout(() => {
    diffWorkerIdleTimer = null;
    if (!diffWorkerInstance || diffWorkerCallbacks.size > 0) {
      return;
    }
    diffWorkerInstance.terminate();
    diffWorkerInstance = null;
  }, DIFF_WORKER_IDLE_TERMINATE_MS);
}

function getDiffLineHeight(line: ParsedLine): number {
  return line.type === "hunk" ? DIFF_HUNK_HEIGHT : DIFF_LINE_HEIGHT;
}

/* ── Context folding: long unchanged runs collapse behind an explicit count ── */

const FOLD_MIN_RUN = 12;
const FOLD_EDGE_KEEP = 4;

type DiffDisplayRow =
  | { kind: "line"; line: ParsedLine; key: number }
  | { kind: "fold"; id: number; count: number };

function getDisplayRowHeight(row: DiffDisplayRow): number {
  return row.kind === "fold" ? DIFF_LINE_HEIGHT : getDiffLineHeight(row.line);
}

function buildDisplayRows(
  parsed: ParsedLine[],
  foldContext: boolean,
  expandedFolds: ReadonlySet<number>,
): DiffDisplayRow[] {
  if (!foldContext) {
    return parsed.map((line, index) => ({ kind: "line", line, key: index }));
  }

  const rows: DiffDisplayRow[] = [];
  let index = 0;
  while (index < parsed.length) {
    if (parsed[index].type !== "context") {
      rows.push({ kind: "line", line: parsed[index], key: index });
      index += 1;
      continue;
    }

    let runEnd = index;
    while (runEnd < parsed.length && parsed[runEnd].type === "context") {
      runEnd += 1;
    }
    const runLength = runEnd - index;
    if (runLength < FOLD_MIN_RUN) {
      for (let k = index; k < runEnd; k += 1) {
        rows.push({ kind: "line", line: parsed[k], key: k });
      }
      index = runEnd;
      continue;
    }

    const foldStart = index + FOLD_EDGE_KEEP;
    const foldEnd = runEnd - FOLD_EDGE_KEEP;
    for (let k = index; k < foldStart; k += 1) {
      rows.push({ kind: "line", line: parsed[k], key: k });
    }
    if (expandedFolds.has(foldStart)) {
      for (let k = foldStart; k < foldEnd; k += 1) {
        rows.push({ kind: "line", line: parsed[k], key: k });
      }
    } else {
      rows.push({ kind: "fold", id: foldStart, count: foldEnd - foldStart });
    }
    for (let k = foldEnd; k < runEnd; k += 1) {
      rows.push({ kind: "line", line: parsed[k], key: k });
    }
    index = runEnd;
  }
  return rows;
}

function renderDiffLine(line: ParsedLine, key: number | string) {
  return (
    <span key={key} className={`git-diff-line ${LINE_CLASS[line.type]}`}>
      <span className="git-diff-gutter">{line.gutter}</span>
      <span className="git-diff-line-num">{line.lineNum}</span>
      <span className="git-diff-line-content">{line.content}</span>
    </span>
  );
}

function parseDiffSync(raw: string): DiffParseResult {
  const parsed = parseDiff(raw);
  let adds = 0;
  let dels = 0;
  for (const line of parsed) {
    if (line.type === "add") {
      adds += 1;
      continue;
    }
    if (line.type === "del") {
      dels += 1;
    }
  }
  return {
    parsed,
    filename: extractDiffFilename(raw),
    adds,
    dels,
  };
}

function ensureDiffWorker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  if (!diffWorkerInstance) {
    clearDiffWorkerIdleTimer();
    diffWorkerInstance = new Worker(
      new URL("../../workers/diffParser.worker.ts", import.meta.url),
      { type: "module" },
    );
    diffWorkerInstance.onmessage = (
      event: MessageEvent<DiffParseWorkerResponse>,
    ) => {
      const payload = event.data;
      const callback = diffWorkerCallbacks.get(payload.id);
      if (!callback) {
        return;
      }
      diffWorkerCallbacks.delete(payload.id);
      callback.resolve({
        parsed: payload.parsed,
        filename: payload.filename,
        adds: payload.adds,
        dels: payload.dels,
      });
      scheduleDiffWorkerIdleTermination();
    };
    diffWorkerInstance.onerror = (error) => {
      clearDiffWorkerIdleTimer();
      for (const callback of diffWorkerCallbacks.values()) {
        callback.reject(error);
      }
      diffWorkerCallbacks.clear();
      diffWorkerInstance?.terminate();
      diffWorkerInstance = null;
    };
  }
  return diffWorkerInstance;
}

function parseDiffInWorker(raw: string): Promise<DiffParseResult> {
  const worker = ensureDiffWorker();
  if (!worker) {
    return Promise.resolve(parseDiffSync(raw));
  }
  clearDiffWorkerIdleTimer();
  return new Promise((resolve, reject) => {
    diffWorkerRequestSeq += 1;
    const requestId = diffWorkerRequestSeq;
    diffWorkerCallbacks.set(requestId, { resolve, reject });
    const payload: DiffParseWorkerRequest = {
      id: requestId,
      raw,
    };
    worker.postMessage(payload);
  });
}

export function useParsedDiff(raw: string, options: UseParsedDiffOptions = {}) {
  const enabled = options.enabled ?? true;
  const eagerParseResult = useMemo(
    () => (enabled && raw.length < DIFF_WORKER_THRESHOLD_CHARS ? parseDiffSync(raw) : null),
    [enabled, raw],
  );
  const workerEligible = enabled && eagerParseResult === null;
  const [workerState, setWorkerState] = useState<{
    raw: string | null;
    parseResult: DiffParseResult | null;
    loading: boolean;
    parseAttempted: boolean;
  }>({
    raw: null,
    parseResult: null,
    loading: false,
    parseAttempted: false,
  });

  useEffect(() => {
    if (!workerEligible) {
      return;
    }

    let disposed = false;
    setWorkerState({
      raw,
      parseResult: null,
      loading: true,
      parseAttempted: true,
    });
    parseDiffInWorker(raw)
      .then((nextResult) => {
        if (disposed) {
          return;
        }
        setWorkerState({
          raw,
          parseResult: nextResult,
          loading: false,
          parseAttempted: true,
        });
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        setWorkerState({
          raw,
          parseResult: parseDiffSync(raw),
          loading: false,
          parseAttempted: true,
        });
      });

    return () => {
      disposed = true;
    };
  }, [raw, workerEligible]);

  const activeWorkerState = enabled && workerState.raw === raw ? workerState : null;
  const parseResult = enabled ? eagerParseResult ?? activeWorkerState?.parseResult ?? null : null;
  const loading =
    enabled && !eagerParseResult ? activeWorkerState?.loading ?? false : false;
  const parseAttempted =
    enabled &&
    (Boolean(eagerParseResult) || Boolean(activeWorkerState?.parseAttempted));

  return {
    parseResult,
    loading,
    parseAttempted,
  };
}

interface VirtualizedDiffBodyProps {
  parsed: ParsedLine[];
  fillAvailableHeight?: boolean;
  maxHeight?: number;
  style?: CSSProperties;
  foldContext?: boolean;
}

export function VirtualizedDiffBody({
  parsed,
  fillAvailableHeight = false,
  maxHeight = DIFF_VIEWPORT_FALLBACK_HEIGHT,
  style,
  foldContext = false,
}: VirtualizedDiffBodyProps) {
  const { t } = useTranslation("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(maxHeight);
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );

  useEffect(() => {
    setExpandedFolds(new Set<number>());
  }, [parsed]);

  const rows = useMemo(
    () => buildDisplayRows(parsed, foldContext, expandedFolds),
    [parsed, foldContext, expandedFolds],
  );

  const virtualizationEnabled =
    rows.length >= DIFF_VIRTUALIZATION_THRESHOLD_LINES;

  const offsets = useMemo(() => {
    const nextOffsets = new Array<number>(rows.length + 1);
    nextOffsets[0] = 0;
    for (let index = 0; index < rows.length; index += 1) {
      nextOffsets[index + 1] =
        nextOffsets[index] + getDisplayRowHeight(rows[index]);
    }
    return nextOffsets;
  }, [rows]);

  const renderRow = (row: DiffDisplayRow) => {
    if (row.kind === "fold") {
      return (
        <button
          key={`fold-${row.id}`}
          type="button"
          className="git-diff-fold"
          onClick={() =>
            setExpandedFolds((current) => {
              const next = new Set(current);
              next.add(row.id);
              return next;
            })
          }
        >
          <UnfoldVertical size={11} />
          {t("diff.unchangedLines", { count: row.count })}
        </button>
      );
    }
    return renderDiffLine(row.line, row.key);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let rafId = 0;
    const updateViewportHeight = () => {
      setViewportHeight(container.clientHeight || maxHeight);
    };
    const updateScroll = () => {
      setScrollTop(container.scrollTop);
    };
    const onScroll = () => {
      if (rafId !== 0) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateScroll();
      });
    };

    updateViewportHeight();
    updateScroll();
    container.addEventListener("scroll", onScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateViewportHeight());
      resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", updateViewportHeight);
    }

    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", updateViewportHeight);
      }
    };
  }, [maxHeight, parsed.length]);

  const virtualWindow = useMemo(() => {
    if (!virtualizationEnabled) {
      return null;
    }

    const rowCount = rows.length;
    const totalHeight = offsets[rowCount];
    const visibleStart = Math.max(0, scrollTop - DIFF_OVERSCAN_PX);
    const visibleEnd = scrollTop + viewportHeight + DIFF_OVERSCAN_PX;

    let lo = 0;
    let hi = rowCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid + 1] < visibleStart) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const startIndex = lo;

    lo = startIndex;
    hi = rowCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] <= visibleEnd) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    let endIndexExclusive = lo;
    if (endIndexExclusive <= startIndex) {
      endIndexExclusive = Math.min(rowCount, startIndex + 1);
    }

    return {
      startIndex,
      endIndexExclusive,
      totalHeight,
      topOffset: offsets[startIndex],
    };
  }, [offsets, rows, scrollTop, viewportHeight, virtualizationEnabled]);

  const viewportStyle: CSSProperties = fillAvailableHeight
    ? {
        overflow: "auto",
        flex: 1,
        minHeight: 0,
        ...style,
      }
    : {
        overflow: "auto",
        maxHeight,
        ...style,
      };

  if (!virtualizationEnabled || !virtualWindow) {
    return (
      <div ref={containerRef} style={viewportStyle}>
        <div
          style={{
            width: "fit-content",
            minWidth: "100%",
            padding: `${DIFF_CONTENT_VERTICAL_PADDING}px 0`,
          }}
        >
          {rows.map((row) => renderRow(row))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={viewportStyle}>
      <div
        style={{
          position: "relative",
          width: "fit-content",
          minWidth: "100%",
          height: virtualWindow.totalHeight + DIFF_CONTENT_VERTICAL_PADDING * 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: virtualWindow.topOffset + DIFF_CONTENT_VERTICAL_PADDING,
          }}
        >
          {rows
            .slice(virtualWindow.startIndex, virtualWindow.endIndexExclusive)
            .map((row) => renderRow(row))}
        </div>
      </div>
    </div>
  );
}
