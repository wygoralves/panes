import React from "react";
import {
  Send,
  GitBranch,
  Brain,
  Shield,
  ChevronRight,
  ChevronDown,
  Check,
  Zap,
  Clock,
} from "lucide-react";
import {
  chatMessages,
  currentEngine,
  currentModel,
  contextUsagePercent,
  contextTokens,
  gitBranch,
  type MockMessage,
  type MockContentBlock,
} from "../data/mockData";

/* ── OpenAI Icon ── */

function OpenAiIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
    </svg>
  );
}

/* ── Syntax Highlight (static) ── */

function SyntaxHighlightedCode({ code, language }: { code: string; language?: string }) {
  // Static syntax coloring using span-based highlighting
  // Replicates highlight.js dark void theme colors
  const highlightLine = (line: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    // Comments
    if (remaining.trimStart().startsWith("//") || remaining.trimStart().startsWith("/*")) {
      return [<span key={0} style={{ color: "#484f58", fontStyle: "italic" }}>{line}</span>];
    }

    // Simple keyword-based coloring
    const keywords = /\b(import|from|export|function|const|let|var|return|if|else|new|await|async|void|type|interface|extends|implements)\b/g;
    const strings = /(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g;
    const types = /\b(string|number|boolean|null|undefined|true|false)\b/g;

    // For simplicity, just render as styled text
    parts.push(
      <span key={key++}>
        {line.split(/(\b(?:import|from|export|function|const|let|var|return|if|else|new|await|async|void|type|interface)\b)/).map((segment, i) => {
          if (/^(import|from|export|function|const|let|var|return|if|else|new|await|async|void|type|interface)$/.test(segment)) {
            return <span key={i} style={{ color: "#ff7b72" }}>{segment}</span>;
          }
          // String literals
          if (/^["'`]/.test(segment)) {
            return <span key={i} style={{ color: "#a5d6ff" }}>{segment}</span>;
          }
          return <span key={i}>{segment}</span>;
        })}
      </span>
    );

    return parts;
  };

  return (
    <pre
      style={{
        margin: "8px 0",
        padding: "10px 14px",
        borderRadius: "var(--radius-sm)",
        background: "var(--code-bg)",
        border: "1px solid var(--border)",
        overflowX: "auto",
      }}
    >
      <code
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: "12.5px",
          color: "#c9d1d9",
          lineHeight: 1.6,
        }}
      >
        {code.split("\n").map((line, i) => (
          <div key={i}>{highlightLine(line)}</div>
        ))}
      </code>
    </pre>
  );
}

/* ── Content Block Renderer ── */

function ContentBlockView({ block }: { block: MockContentBlock }) {
  if (block.type === "text") {
    return (
      <div className="prose" style={{ lineHeight: 1.65 }}>
        {/* Simple markdown-like rendering */}
        {block.content.split("\n").map((paragraph, i) => {
          // Inline code
          const rendered = paragraph.split(/(`[^`]+`)/).map((part, j) => {
            if (part.startsWith("`") && part.endsWith("`")) {
              return (
                <code
                  key={j}
                  style={{
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    fontSize: "0.88em",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "var(--bg-4)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {part.slice(1, -1)}
                </code>
              );
            }
            return <span key={j}>{part}</span>;
          });
          return <p key={i} style={{ margin: "0 0 8px" }}>{rendered}</p>;
        })}
      </div>
    );
  }

  if (block.type === "code") {
    return <SyntaxHighlightedCode code={block.content} language={block.language} />;
  }

  if (block.type === "action") {
    const statusColor =
      block.actionStatus === "done"
        ? "var(--success)"
        : block.actionStatus === "running"
          ? "var(--accent)"
          : "var(--text-3)";

    return (
      <div className="msg-block-header" style={{ marginBottom: 2 }}>
        <ChevronDown
          size={12}
          className="msg-block-chevron msg-block-chevron-open"
        />
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
          {block.actionLabel || "Action"}
        </span>
        <span
          style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 11,
            color: "var(--text-3)",
            flex: 1,
          }}
        >
          {block.filePath || block.content}
        </span>
        <Check size={12} style={{ color: statusColor, flexShrink: 0 }} />
      </div>
    );
  }

  if (block.type === "thinking") {
    return (
      <div className="msg-block-header" style={{ marginBottom: 4, opacity: 0.7 }}>
        <ChevronRight size={12} className="msg-block-chevron" />
        <Brain size={12} style={{ color: "var(--info)", flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Thinking...</span>
      </div>
    );
  }

  return null;
}

/* ── Message Row — 1:1 replica of ChatPanel.tsx MessageRowView ── */

function MessageRow({ message, index = 0 }: { message: MockMessage; index?: number }) {
  const isUser = message.role === "user";
  const userContent = message.content || message.blocks.filter(b => b.type === "text").map(b => b.content).join("\n");
  const assistantLabel = `${currentEngine} - ${currentModel}`;

  return (
    <div
      className="animate-slide-up"
      style={{
        animationDelay: `${Math.min(index * 20, 200)}ms`,
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        maxWidth: "100%",
        borderRadius: "var(--radius-md)",
      }}
    >
      {isUser ? (
        /* ── User message: right-aligned, 75% max, bg-3 ── */
        <>
          <div
            style={{
              maxWidth: "75%",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap" as const,
              wordBreak: "break-word" as const,
            }}
          >
            {userContent}
          </div>
          {message.createdAt && (
            <span
              style={{
                fontSize: 10,
                color: "var(--text-3)",
                paddingRight: 4,
                marginTop: 4,
              }}
            >
              {message.createdAt}
            </span>
          )}
        </>
      ) : (
        /* ── Assistant message: full-width, bg-2, engine header ── */
        <>
          <div
            style={{
              width: "100%",
              maxWidth: "100%",
              padding: "8px 4px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              overflow: "hidden",
            }}
          >
            {/* Engine label header */}
            <div
              style={{
                padding: "2px 14px 6px",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-3)",
                letterSpacing: "0.02em",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 12,
                    height: 12,
                  }}
                >
                  <OpenAiIcon size={11} />
                </span>
                <span>{assistantLabel}</span>
              </span>
            </div>

            {/* Content blocks */}
            <div style={{ padding: "0 10px" }}>
              {message.blocks.map((block, i) => (
                <ContentBlockView key={i} block={block} />
              ))}
            </div>
          </div>
          {message.createdAt && (
            <span
              style={{
                fontSize: 10,
                color: "var(--text-3)",
                marginTop: 4,
                paddingLeft: 4,
              }}
            >
              {message.createdAt}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/* ── Main ChatPanel Component ── */

export function PanesChatPanel({
  messages = chatMessages,
  showTerminal = false,
}: {
  messages?: MockMessage[];
  showTerminal?: boolean;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
        overflow: "hidden",
      }}
    >
      {/* ── Header (74px) ── */}
      <div
        style={{
          height: 74,
          padding: "8px 14px",
          paddingTop: 38,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {/* Model selector pill */}
        <div className="dropdown-trigger" style={{ gap: 5 }}>
          <span className="dropdown-trigger-icon">
            <OpenAiIcon size={11} />
          </span>
          <span className="dropdown-trigger-label">{currentModel}</span>
          <ChevronDown size={10} className="dropdown-chevron" />
        </div>

        {/* Reasoning effort */}
        <div className="dropdown-trigger" style={{ gap: 4 }}>
          <Zap size={10} style={{ opacity: 0.6 }} />
          <span className="dropdown-trigger-label">High</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Context usage */}
        <div className="chat-context-bar">
          <div className="chat-context-section">
            <Clock size={10} />
            <span>{contextTokens}</span>
          </div>
          <div className="chat-context-progress">
            <div
              className="chat-context-progress-fill"
              style={{ width: `${contextUsagePercent}%` }}
            />
          </div>
          <span className="chat-context-percent">{contextUsagePercent}%</span>
        </div>

        {/* Trust level */}
        <div className="dropdown-trigger">
          <Shield size={10} style={{ opacity: 0.6 }} />
          <span className="dropdown-trigger-label">Auto</span>
        </div>
      </div>

      {/* ── Messages area ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {messages.map((message, index) => (
          <MessageRow key={message.id} message={message} index={index} />
        ))}
      </div>

      {/* ── Input area ── */}
      <div style={{ padding: "0 16px 16px", flexShrink: 0 }}>
        {/* Status bar */}
        <div className="chat-status-bar" style={{ marginBottom: 8 }}>
          <div className="chat-status-branch">
            <GitBranch size={11} />
            <span>{gitBranch}</span>
          </div>
        </div>

        {/* Input box */}
        <div className="chat-input-box">
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              minHeight: 44,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                flex: 1,
                minHeight: 20,
                fontSize: 13,
                color: "var(--text-3)",
                lineHeight: 1.5,
              }}
            >
              Ask anything...
            </div>
            <button
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-4)",
                border: "none",
                color: "var(--text-3)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
