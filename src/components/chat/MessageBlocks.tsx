import { Suspense, lazy, memo, useMemo, useState } from "react";
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
} from "lucide-react";
import type {
  ActionBlock,
  ApprovalBlock,
  ApprovalResponse,
  ContentBlock,
  DiffBlock,
  MessageStatus,
  ThinkingBlock,
} from "../../types";
import { ToolInputQuestionnaire } from "./ToolInputQuestionnaire";
import {
  isRequestUserInputApproval,
  parseToolInputQuestions,
} from "./toolInputApproval";
import { parseDiff, extractDiffFilename, LINE_CLASS } from "../../lib/parseDiff";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

interface Props {
  blocks?: ContentBlock[];
  status?: MessageStatus;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
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
  const parsed = useMemo(() => parseDiff(raw), [raw]);
  const filename = useMemo(() => extractDiffFilename(raw), [raw]);

  const adds = parsed.filter((l) => l.type === "add").length;
  const dels = parsed.filter((l) => l.type === "del").length;

  return (
    <div>
      <div
        className="msg-block-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          size={11}
          className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
        />
        <FileDiff size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename ?? `diff (${String(block.scope ?? "turn")})`}
        </span>
        {(adds > 0 || dels > 0) && (
          <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono", monospace', display: "flex", gap: 5, flexShrink: 0 }}>
            {adds > 0 && <span style={{ color: "var(--success)" }}>+{adds}</span>}
            {dels > 0 && <span style={{ color: "var(--danger)" }}>-{dels}</span>}
          </span>
        )}
      </div>
      {expanded && (
        parsed.length > 0 ? (
          <div style={{
            overflow: "auto",
            maxHeight: 400,
            margin: "2px 12px 4px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--code-bg)",
          }}>
            <pre style={{ margin: 0, padding: "4px 0", width: "fit-content", minWidth: "100%" }}>
              {parsed.map((line, idx) => (
                <span key={idx} className={`git-diff-line ${LINE_CLASS[line.type]}`}>
                  <span className="git-diff-gutter">{line.gutter}</span>
                  <span className="git-diff-line-num">{line.lineNum}</span>
                  <span className="git-diff-line-content">{line.content}</span>
                </span>
              ))}
            </pre>
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
      <div
        className="msg-block-header"
        onClick={() => setExpanded((v) => !v)}
      >
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

function ActionBlockView({ block }: { block: ActionBlock }) {
  const outputChunks = Array.isArray(block.outputChunks) ? block.outputChunks : [];
  const outputText = useMemo(
    () => outputChunks.map((chunk) => String(chunk.content ?? "")).join(""),
    [outputChunks],
  );
  const Icon = actionIcons[block.actionType] ?? Terminal;
  const isRunning = block.status === "running";
  const isPending = block.status === "pending";
  const hasBody = outputChunks.length > 0 || Boolean(block.result?.error);
  const [expanded, setExpanded] = useState(isRunning || isPending);
  const canToggle = hasBody;

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

      {expanded && (outputChunks.length > 0 || block.result?.error) && (
        <div style={{
          margin: "2px 12px 4px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}>
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

          {block.result?.error && (
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                borderTop: outputChunks.length > 0 ? "1px solid rgba(248, 113, 113, 0.2)" : undefined,
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
  const toolInputQuestions = isToolInputRequest ? parseToolInputQuestions(details) : [];
  const showStructuredToolInput =
    isPending && isToolInputRequest && toolInputQuestions.length > 0;
  const proposedExecpolicyAmendment = Array.isArray(details.proposedExecpolicyAmendment)
    ? details.proposedExecpolicyAmendment.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];

  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [advancedJsonPayload, setAdvancedJsonPayload] = useState(() =>
    JSON.stringify({ decision: "accept" }, null, 2),
  );
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null);

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
    setShowAdvancedJson(false);
  }

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(251, 191, 36, 0.15)",
        background: "rgba(251, 191, 36, 0.04)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
        }}
      >
        <Shield
          size={16}
          style={{ color: "var(--warning)", flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
            {block.summary}
          </p>
          {isToolInputRequest && toolInputQuestions.length > 0 && (
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-2)" }}>
              {toolInputQuestions.length} question
              {toolInputQuestions.length > 1 ? "s" : ""} pending input.
            </p>
          )}
          {!isToolInputRequest && details && Object.keys(details).length > 0 && (
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-2)" }}>
              {JSON.stringify(details)}
            </p>
          )}
        </div>

        {isPending && !showStructuredToolInput && (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onApproval(block.approvalId, { decision: "accept" })}
              style={{ padding: "5px 12px", fontSize: 12, cursor: "pointer" }}
            >
              Apply
            </button>
            {proposedExecpolicyAmendment.length > 0 && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  onApproval(block.approvalId, {
                    acceptWithExecpolicyAmendment: {
                      execpolicy_amendment: proposedExecpolicyAmendment,
                    },
                  })
                }
                style={{ padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
              >
                Allow + policy
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                onApproval(block.approvalId, { decision: "accept_for_session" })
              }
              style={{ padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
            >
              Always
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onApproval(block.approvalId, { decision: "decline" })}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                color: "var(--danger)",
                cursor: "pointer",
              }}
            >
              Deny
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onApproval(block.approvalId, { decision: "cancel" })}
              style={{ padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        )}

        {!isPending && block.decision && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 99,
              background: decisionBackground,
              color: decisionColor,
              fontWeight: 500,
            }}
          >
            {decisionLabel}
          </span>
        )}
      </div>

      {showStructuredToolInput && (
        <div style={{ padding: "0 14px 12px" }}>
          <ToolInputQuestionnaire
            details={details}
            onSubmit={(response) => onApproval(block.approvalId, response)}
          />
        </div>
      )}

      {isPending && (
        <div style={{ padding: "0 14px 12px", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setShowAdvancedJson((current) => !current);
                setAdvancedJsonError(null);
              }}
              style={{ padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
            >
              {showAdvancedJson ? "Hide custom JSON" : "Custom JSON payload"}
            </button>
          </div>

          {showAdvancedJson && (
            <div
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--code-bg)",
                padding: "8px",
                display: "grid",
                gap: 8,
              }}
            >
              <textarea
                value={advancedJsonPayload}
                onChange={(event) => {
                  setAdvancedJsonPayload(event.target.value);
                  if (advancedJsonError) {
                    setAdvancedJsonError(null);
                  }
                }}
                rows={6}
                style={{
                  width: "100%",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "rgba(0,0,0,0.18)",
                  color: "var(--text-1)",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  padding: "8px 10px",
                  fontFamily: '"JetBrains Mono", monospace',
                  resize: "vertical",
                }}
              />
              {advancedJsonError && (
                <p style={{ margin: 0, fontSize: 11, color: "var(--danger)" }}>
                  {advancedJsonError}
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={submitAdvancedJsonPayload}
                  style={{ padding: "5px 12px", fontSize: 12, cursor: "pointer" }}
                >
                  Send custom payload
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

function MessageBlocksView({ blocks = [], status, onApproval }: Props) {
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
          return <ActionBlockView key={index} block={block} />;
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
    prev.onApproval === next.onApproval,
);
