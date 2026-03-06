import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronRight,
  FileCode2,
  FileDiff,
  Terminal,
  Shield,
  Loader2,
  XCircle,
  Brain,
  FileText,
  Image,
  File,
} from "lucide-react";
import type {
  ActionBlock,
  ApprovalBlock,
  ApprovalResponse,
  AttachmentBlock,
  ContentBlock,
  DiffBlock,
  MessageStatus,
  ThinkingBlock,
} from "../../types";
import { ToolInputQuestionnaire } from "./ToolInputQuestionnaire";
import {
  buildDynamicToolCallResponse,
  defaultAdvancedApprovalPayload,
  isDynamicToolCallApproval,
  isRequestUserInputApproval,
  parseApprovalCommand,
  parseApprovalReason,
  parseDynamicToolCallArguments,
  parseDynamicToolCallName,
  parseProposedExecpolicyAmendment,
  parseProposedNetworkPolicyAmendments,
  parseToolInputQuestions,
  requiresCustomApprovalPayload,
} from "./toolInputApproval";
import {
  parseDiff,
  extractDiffFilename,
  LINE_CLASS,
  type ParsedLine,
} from "../../lib/parseDiff";
import type {
  DiffParseWorkerRequest,
  DiffParseWorkerResponse,
} from "../../workers/diffParser.types";

const MarkdownContent = lazy(() => import("./MarkdownContent"));
const DIFF_WORKER_THRESHOLD_CHARS = 12_000;
const DIFF_WORKER_IDLE_TERMINATE_MS = 30_000;
const DIFF_VIRTUALIZATION_THRESHOLD_LINES = 500;
const DIFF_VIEWPORT_MAX_HEIGHT = 400;
const DIFF_OVERSCAN_PX = 240;
const DIFF_CONTENT_VERTICAL_PADDING = 4;
const DIFF_LINE_HEIGHT = 19;
const DIFF_HUNK_HEIGHT = 24;

interface DiffParseResult {
  parsed: ParsedLine[];
  filename: string | null;
  adds: number;
  dels: number;
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
    diffWorkerInstance.onmessage = (event: MessageEvent<DiffParseWorkerResponse>) => {
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

function VirtualizedDiffBody({ parsed }: { parsed: ParsedLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DIFF_VIEWPORT_MAX_HEIGHT);

  const virtualizationEnabled = parsed.length >= DIFF_VIRTUALIZATION_THRESHOLD_LINES;

  const offsets = useMemo(() => {
    const nextOffsets = new Array<number>(parsed.length + 1);
    nextOffsets[0] = 0;
    for (let index = 0; index < parsed.length; index += 1) {
      nextOffsets[index + 1] = nextOffsets[index] + getDiffLineHeight(parsed[index]);
    }
    return nextOffsets;
  }, [parsed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let rafId = 0;
    const updateViewportHeight = () => {
      setViewportHeight(container.clientHeight || DIFF_VIEWPORT_MAX_HEIGHT);
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
  }, [parsed.length]);

  const virtualWindow = useMemo(() => {
    if (!virtualizationEnabled) {
      return null;
    }

    const rowCount = parsed.length;
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
  }, [offsets, parsed, scrollTop, viewportHeight, virtualizationEnabled]);

  if (!virtualizationEnabled || !virtualWindow) {
    return (
      <div ref={containerRef} style={{ overflow: "auto", maxHeight: DIFF_VIEWPORT_MAX_HEIGHT }}>
        <div
          style={{
            width: "fit-content",
            minWidth: "100%",
            padding: `${DIFF_CONTENT_VERTICAL_PADDING}px 0`,
          }}
        >
          {parsed.map((line, index) => renderDiffLine(line, index))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ overflow: "auto", maxHeight: DIFF_VIEWPORT_MAX_HEIGHT }}>
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
          {parsed
            .slice(virtualWindow.startIndex, virtualWindow.endIndexExclusive)
            .map((line, relativeIndex) => {
              const absoluteIndex = virtualWindow.startIndex + relativeIndex;
              return renderDiffLine(line, absoluteIndex);
            })}
        </div>
      </div>
    </div>
  );
}

interface Props {
  blocks?: ContentBlock[];
  status?: MessageStatus;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
  onLoadActionOutput?: (actionId: string) => Promise<void>;
}

function isBlockLike(value: unknown): value is { type: string } {
  return typeof value === "object" && value !== null && "type" in value;
}

const actionIcons: Record<string, typeof Terminal> = {
  command: Terminal,
  file_write: FileCode2,
  file_edit: FileCode2,
  file_read: FileCode2,
  file_delete: FileCode2,
};

/* ── Diff Block ── */

function MessageDiffBlock({ block, defaultExpanded }: { block: DiffBlock; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const raw = String(block.diff ?? "");
  const fallbackFilename = useMemo(() => extractDiffFilename(raw), [raw]);
  const [parseResult, setParseResult] = useState<DiffParseResult | null>(
    defaultExpanded && raw.length < DIFF_WORKER_THRESHOLD_CHARS
      ? parseDiffSync(raw)
      : null,
  );
  const [loadingParse, setLoadingParse] = useState(false);
  const [parseAttempted, setParseAttempted] = useState(Boolean(parseResult));
  const didInitializeRawRef = useRef(false);

  useEffect(() => {
    if (!expanded || parseAttempted) {
      return;
    }
    setParseAttempted(true);

    if (raw.length < DIFF_WORKER_THRESHOLD_CHARS) {
      setParseResult(parseDiffSync(raw));
      setLoadingParse(false);
      return;
    }

    let disposed = false;
    setLoadingParse(true);
    parseDiffInWorker(raw)
      .then((nextResult) => {
        if (disposed) {
          return;
        }
        setParseResult(nextResult);
        setLoadingParse(false);
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        setParseResult(parseDiffSync(raw));
        setLoadingParse(false);
      });

    return () => {
      disposed = true;
    };
  }, [expanded, parseAttempted, raw]);

  useEffect(() => {
    if (!didInitializeRawRef.current) {
      didInitializeRawRef.current = true;
      return;
    }
    setParseResult(null);
    setLoadingParse(false);
    setParseAttempted(false);
  }, [raw]);

  const filename = parseResult?.filename ?? fallbackFilename;
  const adds = parseResult?.adds ?? 0;
  const dels = parseResult?.dels ?? 0;

  return (
    <div>
      <div className="msg-block-header" onClick={() => setExpanded((v) => !v)}>
        <ChevronRight
          size={11}
          className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
        />
        <FileDiff size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename ?? `diff (${String(block.scope ?? "turn")})`}
        </span>
        {loadingParse && (
          <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
            Parsing...
          </span>
        )}
        {(adds > 0 || dels > 0) && (
          <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono", monospace', display: "flex", gap: 5, flexShrink: 0 }}>
            {adds > 0 && <span style={{ color: "var(--success)" }}>+{adds}</span>}
            {dels > 0 && <span style={{ color: "var(--danger)" }}>-{dels}</span>}
          </span>
        )}
      </div>
      {expanded && (
        !parseResult && (loadingParse || !parseAttempted) ? (
          <div style={{ padding: "4px 14px", fontSize: 11.5, color: "var(--text-3)" }}>
            Parsing diff...
          </div>
        ) : parseResult && parseResult.parsed.length > 0 ? (
          <div style={{
            margin: "2px 12px 4px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--code-bg)",
          }}>
            <VirtualizedDiffBody parsed={parseResult.parsed} />
          </div>
        ) : (
          <div style={{ padding: "4px 14px", fontSize: 11.5, color: "var(--text-3)" }}>
            No changes
          </div>
        )
      )}
    </div>
  );
}

/* ── Thinking Block ── */

function ThinkingBlockView({ block, isStreaming }: { block: ThinkingBlock; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const content = String(block.content ?? "");

  return (
    <div>
      <div className="msg-block-header" onClick={() => setExpanded((v) => !v)}>
        <ChevronRight
          size={11}
          className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
        />
        <Brain
          size={12}
          className={isStreaming ? "thinking-icon-active" : undefined}
          style={isStreaming ? { color: "var(--info)", flexShrink: 0 } : { color: "var(--info)", opacity: 0.45, flexShrink: 0 }}
        />
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
          Thinking{isStreaming ? "\u2026" : ""}
        </span>
      </div>
      {expanded && (
        isStreaming ? (
          <pre
            style={{
              margin: 0,
              fontSize: 12.5,
              color: "var(--text-2)",
              padding: "2px 12px 8px 30px",
              minWidth: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
            }}
          >
            {content}
          </pre>
        ) : (
          <Suspense
            fallback={
              <pre
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  padding: "2px 12px 8px 30px",
                  minWidth: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                }}
              >
                {content}
              </pre>
            }
          >
            <MarkdownContent
              content={content}
              className="prose"
              style={{
                fontSize: 12.5,
                color: "var(--text-2)",
                padding: "2px 12px 8px 30px",
                minWidth: 0,
              }}
            />
          </Suspense>
        )
      )}
    </div>
  );
}

/* ── Action Block ── */

function ActionStatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--success)", fontSize: 10, opacity: 0.7 }}>
        <CheckCircle2 size={11} />
        Done
      </span>
    );
  }
  if (status === "running") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--warning)", fontSize: 10, fontWeight: 500 }}>
        <Loader2 size={11} style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
        Running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--danger)", fontSize: 10 }}>
        <XCircle size={11} />
        Error
      </span>
    );
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-3)", fontSize: 10 }}>
      <Circle size={11} />
      Pending
    </span>
  );
}

function ActionBlockView({
  block,
  onLoadDeferredOutput,
}: {
  block: ActionBlock;
  onLoadDeferredOutput?: () => Promise<void>;
}) {
  const outputChunks = Array.isArray(block.outputChunks) ? block.outputChunks : [];
  const outputDeferred = block.outputDeferred === true;
  const outputText = useMemo(
    () => {
      if (outputChunks.length === 0) {
        return "";
      }
      if (outputChunks.length === 1) {
        const firstContent = outputChunks[0].content;
        return typeof firstContent === "string" ? firstContent : String(firstContent ?? "");
      }
      return outputChunks.map((chunk) => String(chunk.content ?? "")).join("");
    },
    [outputChunks],
  );
  const Icon = actionIcons[block.actionType] ?? Terminal;
  const isRunning = block.status === "running";
  const isPending = block.status === "pending";
  const hasBody = outputChunks.length > 0 || Boolean(block.result?.error) || outputDeferred;
  const actionDetails = (block.details ?? {}) as Record<string, unknown>;
  const outputTruncated =
    "outputTruncated" in actionDetails && actionDetails.outputTruncated === true;
  const [expanded, setExpanded] = useState(isRunning || isPending);
  const [loadingDeferredOutput, setLoadingDeferredOutput] = useState(false);
  const [deferredOutputError, setDeferredOutputError] = useState<string | null>(null);
  const deferredOutputRequestedRef = useRef(false);
  const canToggle = hasBody;

  const requestDeferredOutput = useCallback(() => {
    if (!onLoadDeferredOutput || deferredOutputRequestedRef.current) {
      return;
    }

    deferredOutputRequestedRef.current = true;
    setLoadingDeferredOutput(true);
    setDeferredOutputError(null);
    onLoadDeferredOutput()
      .catch((error) => {
        deferredOutputRequestedRef.current = false;
        setDeferredOutputError(String(error));
      })
      .finally(() => {
        setLoadingDeferredOutput(false);
      });
  }, [onLoadDeferredOutput]);

  useEffect(() => {
    if (!expanded || !outputDeferred || outputChunks.length > 0) {
      return;
    }
    requestDeferredOutput();
  }, [expanded, outputDeferred, outputChunks.length, requestDeferredOutput]);

  useEffect(() => {
    if (!outputDeferred || outputChunks.length > 0) {
      deferredOutputRequestedRef.current = false;
    }
  }, [outputDeferred, outputChunks.length]);

  return (
    <div>
      <div
        className={canToggle ? "msg-block-header" : undefined}
        style={canToggle ? undefined : { display: "flex", alignItems: "center", gap: 6, padding: "3px 12px" }}
        onClick={canToggle ? () => setExpanded((v) => !v) : undefined}
      >
        {canToggle && (
          <ChevronRight
            size={11}
            className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
          />
        )}
        <Icon size={12} style={{ color: "var(--text-3)", flexShrink: 0, opacity: 0.7 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {block.summary}
        </span>
        <ActionStatusBadge status={block.status} />
      </div>

      {expanded && (outputChunks.length > 0 || block.result?.error || outputDeferred) && (
        <div style={{
          margin: "2px 12px 4px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}>
          {outputDeferred && outputChunks.length === 0 && (
            <div
              style={{
                margin: 0,
                padding: "8px 12px",
                background: "var(--code-bg)",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "var(--text-3)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {loadingDeferredOutput && (
                  <Loader2 size={12} style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
                )}
                {loadingDeferredOutput
                  ? "Loading full action output..."
                  : deferredOutputError
                    ? "Failed to load action output."
                    : "Loading action output..."}
              </span>
              {!loadingDeferredOutput && deferredOutputError && onLoadDeferredOutput && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deferredOutputRequestedRef.current = false;
                    requestDeferredOutput();
                  }}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-xs)",
                    padding: "3px 8px",
                    background: "var(--bg-2)",
                    color: "var(--text-2)",
                    fontSize: 10.5,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {outputChunks.length > 0 && (
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                background: "var(--code-bg)",
                fontSize: 11.5,
                lineHeight: 1.5,
                fontFamily: '"JetBrains Mono", monospace',
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: 160,
                color: "var(--text-2)",
              }}
            >
              {outputText}
            </pre>
          )}

          {outputTruncated && (
            <div
              style={{
                margin: 0,
                padding: "5px 12px",
                borderTop: outputChunks.length > 0 ? "1px solid var(--border)" : undefined,
                background: "rgba(148, 163, 184, 0.06)",
                fontSize: 10.5,
                color: "var(--text-3)",
              }}
            >
              Showing latest action output only (older chunks truncated for performance).
            </div>
          )}

          {block.result?.error && (
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                borderTop:
                  outputChunks.length > 0 || outputTruncated
                    ? "1px solid rgba(248, 113, 113, 0.2)"
                    : undefined,
                background: "rgba(248, 113, 113, 0.06)",
                fontSize: 11.5,
                lineHeight: 1.5,
                fontFamily: '"JetBrains Mono", monospace',
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: 120,
                color: "var(--danger)",
              }}
            >
              {String(block.result.error)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Approval Card ── */

const APPROVAL_INTERNAL_KEYS = new Set([
  "_serverMethod",
  "threadId",
  "thread_id",
  "turnId",
  "turn_id",
  "itemId",
  "item_id",
  "proposedExecpolicyAmendment",
  "proposed_execpolicy_amendment",
  "proposedNetworkPolicyAmendments",
  "proposed_network_policy_amendments",
  "networkApprovalContext",
  "network_approval_context",
  "questions",
  "command",
  "reason",
  "commandActions",
  "callId",
  "call_id",
  "arguments",
  "tool",
  "name",
]);

function extractApprovalDetails(details: Record<string, unknown>) {
  const command = parseApprovalCommand(details);
  const reason = parseApprovalReason(details);
  const commandActions = Array.isArray(details.commandActions) ? details.commandActions : [];
  const commandActionCount = commandActions.length;
  const remainingDetails: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (!APPROVAL_INTERNAL_KEYS.has(k)) remainingDetails[k] = v;
  }
  const hasRemainingDetails = Object.keys(remainingDetails).length > 0;
  return { command, reason, commandActionCount, remainingDetails, hasRemainingDetails };
}

function ApprovalCard({
  block,
  onApproval,
}: {
  block: ApprovalBlock;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
}) {
  const isPending = block.status === "pending";
  const details = block.details ?? {};
  const isToolInputRequest = isRequestUserInputApproval(details);
  const isDynamicToolCall = isDynamicToolCallApproval(details);
  const requiresCustomPayload = requiresCustomApprovalPayload(details);
  const toolInputQuestions = isToolInputRequest ? parseToolInputQuestions(details) : [];
  const showStructuredToolInput =
    isPending && isToolInputRequest && toolInputQuestions.length > 0;
  const proposedExecpolicyAmendment = parseProposedExecpolicyAmendment(details);
  const proposedNetworkPolicyAmendments = parseProposedNetworkPolicyAmendments(details);
  const dynamicToolName = parseDynamicToolCallName(details);
  const dynamicToolArguments = parseDynamicToolCallArguments(details);

  const { command, reason, commandActionCount, remainingDetails, hasRemainingDetails } =
    extractApprovalDetails(details);

  const defaultAdvancedPayload = useMemo(
    () => JSON.stringify(defaultAdvancedApprovalPayload(details), null, 2),
    [details],
  );
  const [advancedJsonPayload, setAdvancedJsonPayload] = useState(defaultAdvancedPayload);
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null);
  const [showRemainingDetails, setShowRemainingDetails] = useState(false);
  const [dynamicToolSuccess, setDynamicToolSuccess] = useState(true);
  const [dynamicToolText, setDynamicToolText] = useState("");
  const [dynamicToolImageUrl, setDynamicToolImageUrl] = useState("");

  useEffect(() => {
    setAdvancedJsonPayload(defaultAdvancedPayload);
  }, [defaultAdvancedPayload, block.approvalId]);

  useEffect(() => {
    setDynamicToolSuccess(true);
    setDynamicToolText("");
    setDynamicToolImageUrl("");
  }, [block.approvalId]);

  let decisionLabel = "Answered";
  if (block.decision === "decline") {
    decisionLabel = "Denied";
  } else if (block.decision === "cancel") {
    decisionLabel = "Canceled";
  } else if (block.decision === "accept" || block.decision === "accept_for_session") {
    decisionLabel = "Approved";
  }

  let decisionBackground = "rgba(148,163,184,0.12)";
  let decisionColor = "var(--text-2)";
  if (block.decision === "decline" || block.decision === "cancel") {
    decisionBackground = "rgba(248,113,113,0.12)";
    decisionColor = "var(--danger)";
  } else if (block.decision === "accept" || block.decision === "accept_for_session") {
    decisionBackground = "rgba(52,211,153,0.12)";
    decisionColor = "var(--success)";
  }

  function submitAdvancedJsonPayload() {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(advancedJsonPayload);
    } catch (error) {
      setAdvancedJsonError(`Invalid JSON: ${String(error)}`);
      return;
    }

    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      setAdvancedJsonError("Payload must be a JSON object.");
      return;
    }

    setAdvancedJsonError(null);
    onApproval(block.approvalId, parsedPayload as ApprovalResponse);
  }

  function submitDynamicToolResponse() {
    onApproval(
      block.approvalId,
      buildDynamicToolCallResponse(dynamicToolText, dynamicToolSuccess, dynamicToolImageUrl),
    );
  }

  return (
    <div className="acard">
      {/* Header */}
      <div className="acard-header">
        <Shield size={12} className="acard-header-icon" />
        <span className="acard-summary">{block.summary}</span>
        <span className="acard-type">{block.actionType}</span>
        {!isPending && block.decision && (
          <span
            className="acard-decision"
            style={{ background: decisionBackground, color: decisionColor }}
          >
            {decisionLabel}
          </span>
        )}
      </div>

      {/* Details */}
      {!isToolInputRequest && (command || reason || commandActionCount > 0 || hasRemainingDetails) && (
        <div className="acard-details">
          {command && (
            <pre className="acard-command">{command}</pre>
          )}
          {!command && reason && (
            <p className="acard-reason">{reason}</p>
          )}
          {commandActionCount > 0 && (
            <p className="acard-meta">
              {commandActionCount} action{commandActionCount > 1 ? "s" : ""} in this request
            </p>
          )}
          {proposedExecpolicyAmendment.length > 0 && (
            <p className="acard-meta">
              Exec policy amendment available for {proposedExecpolicyAmendment.join(" ")}
            </p>
          )}
          {proposedNetworkPolicyAmendments.length > 0 && (
            <p className="acard-meta">
              Network amendment available for{" "}
              {proposedNetworkPolicyAmendments
                .map((amendment) => `${amendment.action} ${amendment.host}`)
                .join(", ")}
            </p>
          )}
          {isDynamicToolCall && dynamicToolName && (
            <p className="acard-meta">Dynamic tool: {dynamicToolName}</p>
          )}
          {hasRemainingDetails && (
            <div className="acard-remaining">
              <button
                type="button"
                className="acard-toggle"
                onClick={() => setShowRemainingDetails((v) => !v)}
              >
                {showRemainingDetails ? "Hide details" : "Show details"}
              </button>
              {showRemainingDetails && (
                <pre className="acard-remaining-pre">
                  {JSON.stringify(remainingDetails, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tool input questions */}
      {isToolInputRequest && toolInputQuestions.length > 0 && (
        <div className="acard-section">
          <p className="acard-reason">
            {toolInputQuestions.length} question
            {toolInputQuestions.length > 1 ? "s" : ""} pending input.
          </p>
        </div>
      )}

      {showStructuredToolInput && (
        <div className="acard-section">
          <ToolInputQuestionnaire
            details={details}
            onSubmit={(response) => onApproval(block.approvalId, response)}
          />
        </div>
      )}

      {isPending && isDynamicToolCall && (
        <div className="acard-section">
          <div className="acard-advanced" style={{ gap: 10 }}>
            <p className="acard-reason">
              Respond to the dynamic tool call without hand-writing JSON.
            </p>
            {dynamicToolArguments && (
              <pre className="acard-remaining-pre">
                {JSON.stringify(dynamicToolArguments, null, 2)}
              </pre>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`approval-btn ${dynamicToolSuccess ? "approval-btn-allow" : "approval-btn-deny"}`}
                onClick={() => setDynamicToolSuccess((current) => !current)}
              >
                {dynamicToolSuccess ? "Success" : "Failure"}
              </button>
            </div>
            <textarea
              className="acard-textarea"
              value={dynamicToolText}
              onChange={(event) => setDynamicToolText(event.target.value)}
              rows={4}
              placeholder="Tool response text (optional)"
            />
            <input
              className="acard-textarea"
              value={dynamicToolImageUrl}
              onChange={(event) => setDynamicToolImageUrl(event.target.value)}
              placeholder="Image URL (optional)"
            />
            <div className="acard-advanced-footer">
              <button
                type="button"
                className="approval-btn approval-btn-allow"
                onClick={submitDynamicToolResponse}
              >
                Send tool response
              </button>
            </div>
          </div>
        </div>
      )}

      {isPending && requiresCustomPayload && !showStructuredToolInput && (
        <div className="acard-section">
          <p className="acard-reason">
            This request supports a structured response form below. Advanced JSON is still
            available for edge cases.
          </p>
        </div>
      )}

      {/* Standard approval — no inline buttons; the approval banner handles it */}

      {/* Advanced JSON — only for custom payload requests */}
      {isPending && requiresCustomPayload && (
        <div className="acard-section">
          <div className="acard-advanced">
            <textarea
              className="acard-textarea"
              value={advancedJsonPayload}
              onChange={(event) => {
                setAdvancedJsonPayload(event.target.value);
                if (advancedJsonError) {
                  setAdvancedJsonError(null);
                }
              }}
              rows={6}
            />
            {advancedJsonError && (
              <p className="acard-error">{advancedJsonError}</p>
            )}
            <div className="acard-advanced-footer">
              <button
                type="button"
                className="approval-btn approval-btn-allow"
                onClick={submitAdvancedJsonPayload}
              >
                Send payload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

function MessageBlocksView({ blocks = [], status, onApproval, onLoadActionOutput }: Props) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];

  const lastDiffIndex = useMemo(() => {
    for (let i = safeBlocks.length - 1; i >= 0; i--) {
      const b = safeBlocks[i];
      if (isBlockLike(b) && b.type === "diff") return i;
    }
    return -1;
  }, [safeBlocks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {safeBlocks.map((rawBlock, index) => {
        if (!isBlockLike(rawBlock)) return null;
        const block = rawBlock as ContentBlock;

        /* ── Text ── */
        if (block.type === "text") {
          const textContent = String(block.content ?? "");
          const isLastBlock = index === safeBlocks.length - 1;
          const isStreamingText = status === "streaming" && isLastBlock;

          if (isStreamingText) {
            return (
              <div
                key={index}
                style={{
                  fontSize: 13,
                  padding: "4px 14px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {textContent}
              </div>
            );
          }

          return (
            <Suspense
              key={index}
              fallback={
                <div
                  style={{
                    fontSize: 13,
                    padding: "4px 14px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {textContent}
                </div>
              }
            >
              <MarkdownContent
                content={textContent}
                className="prose"
                style={{ fontSize: 13, padding: "4px 14px" }}
              />
            </Suspense>
          );
        }

        /* ── Code ── */
        if (block.type === "code") {
          const lang = String(block.language ?? "text");
          return (
            <div
              key={index}
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                overflow: "hidden",
                background: "var(--code-bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  color: "var(--text-3)",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <FileCode2 size={12} style={{ opacity: 0.5 }} />
                {block.filename || lang}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  fontFamily: '"JetBrains Mono", monospace',
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflow: "auto",
                  maxHeight: 400,
                }}
              >
                <code className={`language-${lang}`}>{String(block.content ?? "")}</code>
              </pre>
            </div>
          );
        }

        /* ── Diff ── */
        if (block.type === "diff") {
          return <MessageDiffBlock key={index} block={block} defaultExpanded={index === lastDiffIndex} />;
        }

        /* ── Action ── */
        if (block.type === "action") {
          return (
            <ActionBlockView
              key={block.actionId}
              block={block}
              onLoadDeferredOutput={
                onLoadActionOutput ? () => onLoadActionOutput(block.actionId) : undefined
              }
            />
          );
        }

        /* ── Approval ── */
        if (block.type === "approval") {
          return <ApprovalCard key={index} block={block} onApproval={onApproval} />;
        }

        /* ── Thinking ── */
        if (block.type === "thinking") {
          const isLastBlock = index === safeBlocks.length - 1;
          const thinkingActive = status === "streaming" && isLastBlock;
          return <ThinkingBlockView key={index} block={block} isStreaming={thinkingActive} />;
        }

        /* ── Attachment ── */
        if (block.type === "attachment") {
          const attachmentBlock = block as AttachmentBlock;
          const mime = attachmentBlock.mimeType ?? "";
          const AttachIcon = mime.startsWith("image/")
            ? Image
            : mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript")
              ? FileText
              : File;
          return (
            <div
              key={index}
              className="chat-attachment-chip"
              style={{ margin: "2px 12px", display: "inline-flex" }}
            >
              <AttachIcon size={12} />
              <span className="chat-attachment-chip-name">{attachmentBlock.fileName}</span>
            </div>
          );
        }

        /* ── Error ── */
        if (block.type === "error") {
          return (
            <div
              key={index}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(248, 113, 113, 0.15)",
                background: "rgba(248, 113, 113, 0.06)",
                color: "var(--danger)",
                fontSize: 13,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              {block.message}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export const MessageBlocks = memo(
  MessageBlocksView,
  (prev, next) =>
    prev.blocks === next.blocks &&
    prev.status === next.status &&
    prev.onApproval === next.onApproval &&
    prev.onLoadActionOutput === next.onLoadActionOutput,
);
