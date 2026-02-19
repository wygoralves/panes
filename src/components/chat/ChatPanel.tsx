import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Square,
  Paperclip,
  GitBranch,
  MoreHorizontal,
  Loader2,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore } from "../../stores/gitStore";
import { MessageBlocks } from "./MessageBlocks";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const {
    messages,
    send,
    cancel,
    respondApproval,
    streaming,
    error,
    setActiveThread: bindChatThread,
    threadId,
  } = useChatStore();
  const { repos, activeRepoId, activeWorkspaceId } = useWorkspaceStore();
  const { ensureThreadForScope, threads, activeThreadId } = useThreadStore();
  const gitStatus = useGitStore((s) => s.status);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeRepo = useMemo(
    () => repos.find((r) => r.id === activeRepoId) ?? null,
    [repos, activeRepoId],
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      void bindChatThread(null);
      return;
    }
    void (async () => {
      const thread = await ensureThreadForScope({
        workspaceId: activeWorkspaceId,
        repoId: activeRepo?.id ?? null,
        engineId: "codex",
        modelId: "gpt-5-codex",
        title: activeRepo ? `${activeRepo.name} Chat` : "General",
      });
      await bindChatThread(thread);
    })();
  }, [activeWorkspaceId, activeRepo?.id, activeRepo?.name, ensureThreadForScope, bindChatThread]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const nearBottom = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 120;
    if (nearBottom) {
      vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        void cancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || !threadId) return;
    const text = input.trim();
    setInput("");
    await send(text);
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
      }}
    >
      {/* ── Top Action Bar ── */}
      <div
        className="drag-region"
        style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border)",
          minHeight: 46,
        }}
      >
        <div className="no-drag" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeThread?.title || "Agent Workspace"}
          </span>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 4, borderRadius: "var(--radius-sm)", cursor: "pointer" }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Engine badge */}
          <span
            style={{
              padding: "3px 8px",
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              background: "var(--accent-dim)",
              color: "var(--accent)",
              border: "1px solid var(--border-accent)",
            }}
          >
            {activeThread?.engineId ?? "codex"}
          </span>

          <span
            style={{
              padding: "3px 8px",
              borderRadius: 99,
              fontSize: 11,
              background: "rgba(255,255,255,0.04)",
              color: "var(--text-2)",
              border: "1px solid var(--border)",
            }}
          >
            {activeThread?.modelId ?? "gpt-5-codex"}
          </span>

        </div>
      </div>

      {/* ── Messages ── */}
      <div
        ref={viewportRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 24px",
        }}
      >
        {messages.length === 0 ? (
          <div
            className="animate-fade-in"
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              color: "var(--text-3)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "var(--radius-lg)",
                background: "var(--accent-dim)",
                border: "1px solid var(--border-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Send size={22} style={{ color: "var(--accent)", opacity: 0.7 }} />
            </div>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 500, color: "var(--text-2)" }}>
                Start a conversation
              </p>
              <p style={{ margin: 0, fontSize: 12.5 }}>
                Open a folder and send a message to begin
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.map((message, i) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className="animate-slide-up"
                  style={{
                    animationDelay: `${Math.min(i * 20, 200)}ms`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isUser ? "flex-end" : "flex-start",
                    maxWidth: "100%",
                  }}
                >
                  {isUser ? (
                    /* ── User Message Bubble ── */
                    <div
                      style={{
                        maxWidth: "75%",
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--bg-4)",
                        border: "1px solid var(--border-active)",
                        fontSize: 13,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {message.content || (message.blocks ?? []).filter((b) => b.type === "text").map((b) => b.content).join("\n")}
                    </div>
                  ) : (
                    /* ── Assistant Message ── */
                    <div style={{ width: "100%", maxWidth: "100%" }}>
                      <MessageBlocks
                        blocks={message.blocks}
                        status={message.status}
                        onApproval={(approvalId, decision) =>
                          void respondApproval(approvalId, {
                            decision,
                            engine: activeThread?.engineId ?? "codex",
                            model: activeThread?.modelId ?? "gpt-5-codex",
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Streaming indicator */}
            {streaming && (
              <div
                className="animate-fade-in"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--accent)",
                  fontSize: 12,
                  padding: "4px 0",
                }}
              >
                <Loader2 size={13} className="animate-pulse-soft" style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
                <span style={{ opacity: 0.8 }}>Thinking...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Input Area ── */}
      <div
        style={{
          padding: "12px 16px 14px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <form
          onSubmit={onSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Input container */}
          <div
            className="glass-subtle"
            style={{
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              transition: "border-color var(--duration-fast) var(--ease-out)",
            }}
          >
            <textarea
              ref={inputRef}
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void onSubmit(e);
                }
              }}
              placeholder="Ask the agent to inspect, edit, or run tasks..."
              disabled={!threadId}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "transparent",
                color: "var(--text-1)",
                fontSize: 13,
                lineHeight: 1.5,
                resize: "none",
                fontFamily: "inherit",
              }}
            />

            {/* Input toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 10px",
                gap: 4,
              }}
            >
              <button
                type="button"
                className="btn-ghost"
                style={{
                  padding: 5,
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                <Paperclip size={14} />
              </button>

              <div style={{ flex: 1 }} />

              {streaming ? (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(248, 113, 113, 0.12)",
                    color: "var(--danger)",
                    border: "1px solid rgba(248, 113, 113, 0.2)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    transition: "all var(--duration-fast) var(--ease-out)",
                  }}
                >
                  <Square size={11} fill="currentColor" />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!threadId || !input.trim()}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "var(--radius-sm)",
                    background:
                      threadId && input.trim()
                        ? "var(--accent)"
                        : "rgba(255,255,255,0.06)",
                    color:
                      threadId && input.trim()
                        ? "var(--bg-1)"
                        : "var(--text-3)",
                    cursor: threadId && input.trim() ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    fontWeight: 600,
                    transition: "all var(--duration-fast) var(--ease-out)",
                  }}
                >
                  <Send size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Bottom status bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 4px",
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)",
              }}
            >
              {activeThread?.engineId ?? "codex"}
            </span>

            <div style={{ flex: 1 }} />

            {gitStatus?.branch && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <GitBranch size={11} />
                {gitStatus.branch}
              </span>
            )}
          </div>
        </form>

        {error && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(248, 113, 113, 0.08)",
              border: "1px solid rgba(248, 113, 113, 0.15)",
              color: "var(--danger)",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
