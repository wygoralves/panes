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
import type { ContentBlock, MessageStatus } from "../../types";

interface Props {
  blocks?: ContentBlock[];
  status?: MessageStatus;
  onApproval: (
    approvalId: string,
    decision: "accept" | "accept_for_session" | "decline",
  ) => void;
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
            <div key={index} className="prose" style={{ fontSize: 13 }}>
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
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border)",
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
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border)",
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
                borderRadius: "var(--radius-md)",
                border: `1px solid ${
                  isError
                    ? "rgba(248, 113, 113, 0.25)"
                    : isRunning
                      ? "rgba(251, 191, 36, 0.2)"
                      : "var(--border)"
                }`,
                background: isError
                  ? "rgba(248, 113, 113, 0.04)"
                  : isRunning
                    ? "rgba(251, 191, 36, 0.03)"
                    : "var(--bg-2)",
                overflow: "hidden",
                transition: "border-color var(--duration-normal) var(--ease-out)",
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
            </div>
          );
        }

        /* ── Approval ── */
        if (block.type === "approval") {
          const isPending = block.status === "pending";
          return (
            <div
              key={index}
              style={{
                borderRadius: "var(--radius-md)",
                border: "1px solid rgba(251, 191, 36, 0.2)",
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
                  {block.details && Object.keys(block.details).length > 0 && (
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-2)" }}>
                      {JSON.stringify(block.details)}
                    </p>
                  )}
                </div>

                {isPending && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onApproval(block.approvalId, "accept")}
                      style={{ padding: "5px 12px", fontSize: 12, cursor: "pointer" }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onApproval(block.approvalId, "accept_for_session")}
                      style={{ padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
                    >
                      Always
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onApproval(block.approvalId, "decline")}
                      style={{ padding: "5px 10px", fontSize: 12, color: "var(--danger)", cursor: "pointer" }}
                    >
                      Deny
                    </button>
                  </div>
                )}

                {!isPending && block.decision && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 99,
                      background:
                        block.decision === "decline"
                          ? "rgba(248,113,113,0.12)"
                          : "rgba(52,211,153,0.12)",
                      color:
                        block.decision === "decline"
                          ? "var(--danger)"
                          : "var(--success)",
                      fontWeight: 500,
                    }}
                  >
                    {block.decision === "decline" ? "Denied" : "Approved"}
                  </span>
                )}
              </div>
            </div>
          );
        }

        /* ── Thinking ── */
        if (block.type === "thinking") {
          return (
            <div
              key={index}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                background: "rgba(167, 139, 250, 0.04)",
                border: "1px solid rgba(167, 139, 250, 0.1)",
                fontSize: 12.5,
                color: "var(--text-2)",
                fontStyle: "italic",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <Brain size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--accent-2)", opacity: 0.6 }} />
              {block.content}
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
                borderRadius: "var(--radius-md)",
                background: "rgba(248, 113, 113, 0.06)",
                border: "1px solid rgba(248, 113, 113, 0.2)",
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
