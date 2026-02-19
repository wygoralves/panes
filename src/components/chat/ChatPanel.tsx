import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Square,
  Paperclip,
  GitBranch,
  MoreHorizontal,
  Loader2,
  Shield,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useEngineStore } from "../../stores/engineStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore } from "../../stores/gitStore";
import { ipc } from "../../lib/ipc";
import { MessageBlocks } from "./MessageBlocks";
import type { ApprovalBlock } from "../../types";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [selectedEngineId, setSelectedEngineId] = useState("codex");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffort] = useState("medium");
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
  const engines = useEngineStore((s) => s.engines);
  const { repos, activeRepoId, activeWorkspaceId } = useWorkspaceStore();
  const {
    ensureThreadForScope,
    refreshThreads,
    threads,
    activeThreadId,
    setActiveThread: setActiveThreadInStore,
  } = useThreadStore();
  const gitStatus = useGitStore((s) => s.status);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const effortSyncKeyRef = useRef<string | null>(null);

  const activeRepo = useMemo(
    () => repos.find((r) => r.id === activeRepoId) ?? null,
    [repos, activeRepoId],
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const selectedEngine = useMemo(
    () => engines.find((engine) => engine.id === selectedEngineId) ?? engines[0] ?? null,
    [engines, selectedEngineId],
  );

  const availableModels = useMemo(() => selectedEngine?.models ?? [], [selectedEngine]);

  const selectedModel = useMemo(
    () => availableModels.find((model) => model.id === selectedModelId) ?? availableModels[0] ?? null,
    [availableModels, selectedModelId],
  );

  const supportedEfforts = useMemo(
    () => selectedModel?.supportedReasoningEfforts ?? [],
    [selectedModel],
  );
  const activeThreadReasoningEffort =
    typeof activeThread?.engineMetadata?.reasoningEffort === "string"
      ? activeThread.engineMetadata.reasoningEffort
      : undefined;

  const pendingApprovals = useMemo<ApprovalBlock[]>(() => {
    const approvals: ApprovalBlock[] = [];
    const seen = new Set<string>();

    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const block of message.blocks ?? []) {
        if (block.type !== "approval") continue;
        if (block.status !== "pending") continue;
        if (seen.has(block.approvalId)) continue;
        seen.add(block.approvalId);
        approvals.push(block);
      }
    }

    return approvals;
  }, [messages]);

  useEffect(() => {
    if (!engines.length) {
      return;
    }
    if (!engines.some((engine) => engine.id === selectedEngineId)) {
      setSelectedEngineId(engines[0].id);
    }
  }, [engines, selectedEngineId]);

  useEffect(() => {
    if (!selectedModel) {
      setSelectedModelId(null);
      return;
    }
    if (selectedModelId !== selectedModel.id) {
      setSelectedModelId(selectedModel.id);
    }
  }, [selectedModel, selectedModelId]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    const syncKey = `${activeThread?.id ?? "none"}:${selectedModel.id}`;
    if (effortSyncKeyRef.current === syncKey) {
      return;
    }
    effortSyncKeyRef.current = syncKey;

    const effortFromThreadSupported = activeThreadReasoningEffort
      ? supportedEfforts.some((option) => option.reasoningEffort === activeThreadReasoningEffort)
      : false;
    const modelDefaultSupported = supportedEfforts.some(
      (option) => option.reasoningEffort === selectedModel.defaultReasoningEffort,
    );
    const fallbackEffort =
      supportedEfforts[0]?.reasoningEffort ?? selectedModel.defaultReasoningEffort;

    const nextEffort = effortFromThreadSupported
      ? activeThreadReasoningEffort!
      : modelDefaultSupported
        ? selectedModel.defaultReasoningEffort
        : fallbackEffort;

    if (nextEffort && selectedEffort !== nextEffort) {
      setSelectedEffort(nextEffort);
    }
  }, [
    activeThread?.id,
    activeThreadReasoningEffort,
    selectedModel?.id,
    selectedModel?.defaultReasoningEffort,
    selectedEffort,
    supportedEfforts,
  ]);

  useEffect(() => {
    if (!activeThread) {
      return;
    }
    if (activeThread.engineId !== selectedEngineId) {
      setSelectedEngineId(activeThread.engineId);
    }
    const threadEngine =
      engines.find((engine) => engine.id === activeThread.engineId) ?? null;
    const threadModelExists =
      threadEngine?.models.some((model) => model.id === activeThread.modelId) ?? false;
    if (threadModelExists) {
      setSelectedModelId(activeThread.modelId);
    }
  }, [activeThread?.id, activeThread?.engineId, activeThread?.modelId, engines, selectedEngineId]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      if (threadId !== null) {
        void bindChatThread(null);
      }
      return;
    }
    if (!selectedModelId) {
      return;
    }

    const matchedThread =
      threads.find(
        (thread) =>
          thread.workspaceId === activeWorkspaceId &&
          thread.repoId === (activeRepo?.id ?? null) &&
          thread.engineId === selectedEngineId &&
          thread.modelId === selectedModelId,
      ) ?? null;

    const targetThreadId = matchedThread?.id ?? null;
    if (targetThreadId === threadId) {
      return;
    }

    setActiveThreadInStore(targetThreadId);
    void bindChatThread(targetThreadId);
  }, [
    activeWorkspaceId,
    activeRepo?.id,
    threads,
    selectedEngineId,
    selectedModelId,
    threadId,
    bindChatThread,
    setActiveThreadInStore,
  ]);

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
    if (!input.trim() || !activeWorkspaceId || !selectedModelId || streaming) return;

    let targetThreadId = threadId;
    if (!targetThreadId) {
      const createdThreadId = await ensureThreadForScope({
        workspaceId: activeWorkspaceId,
        repoId: activeRepo?.id ?? null,
        engineId: selectedEngineId,
        modelId: selectedModelId,
        title: activeRepo ? `${activeRepo.name} Chat` : "Workspace Chat",
      });
      if (!createdThreadId) {
        return;
      }
      targetThreadId = createdThreadId;
      await bindChatThread(createdThreadId);
    }

    const currentThread =
      threads.find((thread) => thread.id === targetThreadId) ??
      useThreadStore.getState().threads.find((thread) => thread.id === targetThreadId) ??
      activeThread;

    let confirmedWorkspaceOptIn = false;
    if (currentThread && currentThread.repoId === null && repos.length > 1) {
      const optIn = Boolean(currentThread.engineMetadata?.workspaceWriteOptIn);
      if (!optIn) {
        const repoNames = repos.map((repo) => repo.name).join(", ");
        const confirmed = window.confirm(
          `This workspace thread can write to multiple repositories (${repoNames}). Continue?`
        );
        if (!confirmed) {
          return;
        }

        await ipc.confirmWorkspaceThread(currentThread.id, repos.map((repo) => repo.path));
        confirmedWorkspaceOptIn = true;
      }
    }

    const text = input.trim();
    setInput("");

    if (selectedEngineId === "codex" && selectedEffort) {
      await ipc.setThreadReasoningEffort(targetThreadId, selectedEffort);
    }

    await send(text, targetThreadId);

    if (confirmedWorkspaceOptIn) {
      await refreshThreads(activeWorkspaceId);
    }
  }

  async function onReasoningEffortChange(nextEffort: string) {
    setSelectedEffort(nextEffort);
    if (selectedEngineId !== "codex") {
      return;
    }

    const targetThreadId = threadId ?? activeThread?.id ?? null;
    if (!targetThreadId) {
      return;
    }

    await ipc.setThreadReasoningEffort(targetThreadId, nextEffort);
    if (activeWorkspaceId) {
      await refreshThreads(activeWorkspaceId);
    }
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
          <select
            value={selectedEngineId}
            onChange={(event) => {
              setSelectedEngineId(event.target.value);
              setSelectedModelId(null);
            }}
            style={{
              padding: "4px 8px",
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              background: "var(--accent-dim)",
              color: "var(--accent)",
              border: "1px solid var(--border-accent)",
              cursor: "pointer",
            }}
          >
            {(engines.length > 0 ? engines : [{ id: "codex", name: "Codex", models: [] }]).map((engine) => (
              <option key={engine.id} value={engine.id} style={{ color: "black" }}>
                {engine.name}
              </option>
            ))}
          </select>

          <select
            value={selectedModelId ?? ""}
            onChange={(event) => setSelectedModelId(event.target.value || null)}
            disabled={availableModels.length === 0}
            style={{
              padding: "4px 8px",
              borderRadius: 99,
              fontSize: 11,
              background: "rgba(255,255,255,0.04)",
              color: "var(--text-2)",
              border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id} style={{ color: "black" }}>
                {model.displayName}
                {model.isDefault ? " (default)" : ""}
                {model.hidden ? " (legacy)" : ""}
              </option>
            ))}
          </select>

          {selectedEngineId === "codex" && supportedEfforts.length > 0 && (
            <select
              value={selectedEffort}
              onChange={(event) => void onReasoningEffortChange(event.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 99,
                fontSize: 11,
                background: "rgba(255,255,255,0.04)",
                color: "var(--text-2)",
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
              title="Thinking budget"
            >
              {supportedEfforts.map((option) => (
                <option key={option.reasoningEffort} value={option.reasoningEffort} style={{ color: "black" }}>
                  thinking: {option.reasoningEffort}
                </option>
              ))}
            </select>
          )}

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
                            model: activeThread?.modelId ?? "gpt-5.3-codex",
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
          {pendingApprovals.length > 0 && (
            <div
              style={{
                borderRadius: "var(--radius-lg)",
                border: "1px solid rgba(251, 191, 36, 0.22)",
                background: "rgba(251, 191, 36, 0.05)",
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <Shield size={14} style={{ color: "var(--warning)" }} />
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                  Approval required
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  The engine is waiting for your decision.
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pendingApprovals.slice(-3).map((approval) => {
                  const command =
                    typeof approval.details?.command === "string"
                      ? approval.details.command
                      : undefined;
                  const reason =
                    typeof approval.details?.reason === "string"
                      ? approval.details.reason
                      : undefined;

                  return (
                    <div
                      key={approval.approvalId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: "var(--radius-md)",
                        background: "rgba(0,0,0,0.18)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "var(--text-1)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={approval.summary}
                        >
                          {approval.summary}
                        </div>
                        {(command || reason) && (
                          <div
                            style={{
                              marginTop: 2,
                              fontSize: 11,
                              color: "var(--text-2)",
                              fontFamily: '"JetBrains Mono", monospace',
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={command ?? reason}
                          >
                            {command ?? reason}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void respondApproval(approval.approvalId, { decision: "accept" })}
                          style={{
                            padding: "5px 10px",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void respondApproval(approval.approvalId, { decision: "accept_for_session" })
                          }
                          style={{
                            padding: "5px 10px",
                            fontSize: 12,
                            cursor: "pointer",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(0,0,0,0.1)",
                          }}
                        >
                          Allow session
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void respondApproval(approval.approvalId, { decision: "decline" })}
                          style={{
                            padding: "5px 10px",
                            fontSize: 12,
                            cursor: "pointer",
                            color: "var(--danger)",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid rgba(248, 113, 113, 0.22)",
                            background: "rgba(248, 113, 113, 0.06)",
                          }}
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                  if (streaming) {
                    return;
                  }
                  void onSubmit(e);
                }
              }}
              placeholder="Ask the agent to inspect, edit, or run tasks..."
              disabled={!activeWorkspaceId}
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
                  disabled={!activeWorkspaceId || !input.trim()}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "var(--radius-sm)",
                    background:
                      activeWorkspaceId && input.trim()
                        ? "var(--accent)"
                        : "rgba(255,255,255,0.06)",
                    color:
                      activeWorkspaceId && input.trim()
                        ? "var(--bg-1)"
                        : "var(--text-3)",
                    cursor: activeWorkspaceId && input.trim() ? "pointer" : "default",
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
