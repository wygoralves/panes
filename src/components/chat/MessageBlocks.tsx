import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronRight,
  FileCode2,
  Terminal,
  Shield,
  Loader2,
  XCircle,
  Brain,
} from "lucide-react";
import type {
  ApprovalBlock,
  ApprovalResponse,
  ContentBlock,
  MessageStatus,
} from "../../types";
import { ToolInputQuestionnaire } from "./ToolInputQuestionnaire";
import {
  isRequestUserInputApproval,
  parseToolInputQuestions,
} from "./toolInputApproval";

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

function ActionStatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--success)", fontSize: 11, fontWeight: 500 }}>
        <CheckCircle2 size={12} />
        Done
      </span>
    );
  }
  if (status === "running") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--warning)", fontSize: 11, fontWeight: 500 }}>
        <Loader2 size={12} style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
        Running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--danger)", fontSize: 11, fontWeight: 500 }}>
        <XCircle size={12} />
        Error
      </span>
    );
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-3)", fontSize: 11 }}>
      <Circle size={12} />
      Pending
    </span>
  );
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

export function MessageBlocks({ blocks = [], status, onApproval }: Props) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {safeBlocks.map((rawBlock, index) => {
        if (!isBlockLike(rawBlock)) return null;
        const block = rawBlock as ContentBlock;

        /* ── Text ── */
        if (block.type === "text") {
          return (
            <div key={index} className="prose" style={{ fontSize: 13, padding: "4px 14px" }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {String(block.content ?? "")}
              </ReactMarkdown>
            </div>
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
              {/* Code header */}
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
                }}
              >
                <ChevronRight size={12} style={{ opacity: 0.5 }} />
                Diff ({String(block.scope ?? "turn")})
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "10px 14px",
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontFamily: '"JetBrains Mono", monospace',
                  whiteSpace: "pre-wrap",
                  overflow: "auto",
                  maxHeight: 300,
                }}
              >
                {String(block.diff ?? "")
                  .split("\n")
                  .map((line, li) => (
                    <span
                      key={li}
                      style={{
                        display: "block",
                        ...(line.startsWith("+") && !line.startsWith("+++")
                          ? { color: "#aff5b4", background: "rgba(46,160,67,0.1)" }
                          : line.startsWith("-") && !line.startsWith("---")
                            ? { color: "#ffdcd7", background: "rgba(248,81,73,0.1)" }
                            : {}),
                      }}
                    >
                      {line}
                    </span>
                  ))}
              </pre>
            </div>
          );
        }

        /* ── Action ── */
        if (block.type === "action") {
          const outputChunks = Array.isArray(block.outputChunks) ? block.outputChunks : [];
          const Icon = actionIcons[block.actionType] ?? Terminal;
          const isRunning = block.status === "running";
          const isError = block.status === "error";

          return (
            <div
              key={index}
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: isError
                  ? "rgba(248, 113, 113, 0.04)"
                  : isRunning
                    ? "rgba(251, 191, 36, 0.03)"
                    : "var(--bg-2)",
                overflow: "hidden",
                transition: "background var(--duration-normal) var(--ease-out)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                }}
              >
                <Icon size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>
                  {block.summary}
                </span>
                <ActionStatusBadge status={block.status} />
              </div>

              {outputChunks.length > 0 && (
                <pre
                  style={{
                    margin: 0,
                    padding: "8px 12px",
                    borderTop: "1px solid var(--border)",
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
                  {outputChunks.map((c) => String(c.content ?? "")).join("")}
                </pre>
              )}

              {block.result?.error && (
                <pre
                  style={{
                    margin: 0,
                    padding: "8px 12px",
                    borderTop: "1px solid rgba(248, 113, 113, 0.2)",
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
          );
        }

        /* ── Approval ── */
        if (block.type === "approval") {
          return <ApprovalCard key={index} block={block} onApproval={onApproval} />;
        }

        /* ── Thinking ── */
        if (block.type === "thinking") {
          return (
            <div
              key={index}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg-2)",
                fontSize: 12.5,
                color: "var(--text-2)",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <Brain size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--info)", opacity: 0.8 }} />
              <div className="prose" style={{ fontSize: 12.5, color: "var(--text-2)", minWidth: 0 }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {String(block.content ?? "")}
                </ReactMarkdown>
              </div>
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
