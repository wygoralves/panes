import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContentBlock } from "../../types";

interface Props {
  blocks?: ContentBlock[];
  onApproval: (approvalId: string, decision: "accept" | "accept_for_session" | "decline") => void;
}

export function MessageBlocks({ blocks = [], onApproval }: Props) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {blocks.map((block, index) => {
        if (block.type === "text") {
          return (
            <div key={index} className="surface" style={{ padding: 12 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
            </div>
          );
        }

        if (block.type === "code") {
          return (
            <div key={index} className="surface" style={{ padding: 12, background: "var(--code-bg)" }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-soft)" }}>{block.language}</p>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{block.content}</pre>
            </div>
          );
        }

        if (block.type === "diff") {
          return (
            <div key={index} className="surface" style={{ padding: 12, background: "#101a11" }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-soft)" }}>
                Diff ({block.scope})
              </p>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{block.diff}</pre>
            </div>
          );
        }

        if (block.type === "action") {
          return (
            <div
              key={index}
              className={`surface ${block.status === "running" ? "action-running" : ""} ${
                block.status === "error" ? "action-error" : ""
              }`}
              style={{ padding: 12 }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>
                {block.actionType}: {block.summary}
              </p>
              <p style={{ margin: "4px 0", fontSize: 12, color: "var(--text-soft)" }}>
                status: {block.status}
              </p>
              {block.outputChunks.length > 0 && (
                <pre style={{ margin: 0, maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap" }}>
                  {block.outputChunks.map((chunk) => chunk.content).join("")}
                </pre>
              )}
            </div>
          );
        }

        if (block.type === "approval") {
          return (
            <div key={index} className="surface" style={{ padding: 12, borderColor: "#ffd166" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{block.summary}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" onClick={() => onApproval(block.approvalId, "accept")}>Allow</button>
                <button
                  type="button"
                  onClick={() => onApproval(block.approvalId, "accept_for_session")}
                >
                  Allow Session
                </button>
                <button type="button" onClick={() => onApproval(block.approvalId, "decline")}>Deny</button>
              </div>
            </div>
          );
        }

        if (block.type === "thinking") {
          return (
            <div key={index} className="surface" style={{ padding: 12, opacity: 0.8 }}>
              <em>{block.content}</em>
            </div>
          );
        }

        if (block.type === "error") {
          return (
            <div key={index} className="surface" style={{ padding: 12, borderColor: "var(--danger)" }}>
              {block.message}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
