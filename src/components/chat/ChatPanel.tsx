import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Square,
  Plus,
  GitBranch,
  MoreHorizontal,
  Loader2,
  Shield,
  Play,
  Monitor,
  Mic,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useEngineStore } from "../../stores/engineStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore } from "../../stores/gitStore";
import { ipc } from "../../lib/ipc";
import { MessageBlocks } from "./MessageBlocks";
import { Dropdown } from "../shared/Dropdown";
import type { ApprovalBlock, ApprovalResponse, TrustLevel } from "../../types";

interface ToolInputOption {
  label: string;
}

interface ToolInputQuestion {
  id: string;
  question: string;
  options: ToolInputOption[];
}

function readToolInputQuestions(details: Record<string, unknown>): ToolInputQuestion[] {
  const rawQuestions = details.questions;
  if (!Array.isArray(rawQuestions)) {
    return [];
  }

  const questions: ToolInputQuestion[] = [];
  for (const raw of rawQuestions) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }

    const questionObj = raw as Record<string, unknown>;
    const id = typeof questionObj.id === "string" ? questionObj.id : "";
    const question = typeof questionObj.question === "string" ? questionObj.question : "";
    if (!id || !question) {
      continue;
    }

    const options = Array.isArray(questionObj.options)
      ? questionObj.options
          .filter((option): option is ToolInputOption => {
            if (typeof option !== "object" || option === null) {
              return false;
            }
            const optionObj = option as Record<string, unknown>;
            return typeof optionObj.label === "string";
          })
          .map((option) => ({ label: option.label }))
      : [];
    if (!options.length) {
      continue;
    }

    questions.push({ id, question, options });
  }

  return questions;
}

function buildToolInputResponse(
  questions: ToolInputQuestion[],
  selectedQuestionId: string,
  selectedLabel: string
): ApprovalResponse {
  const answers: Record<string, { answers: string[] }> = {};

  for (const question of questions) {
    const chosen =
      question.id === selectedQuestionId
        ? selectedLabel
        : question.options[0]?.label ?? "";
    answers[question.id] = { answers: [chosen] };
  }

  return { answers };
}

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
  const {
    repos,
    activeRepoId,
    activeWorkspaceId,
    workspaces,
    setRepoTrustLevel,
    setAllReposTrustLevel
  } = useWorkspaceStore();
  const {
    ensureThreadForScope,
    refreshThreads,
    threads,
    activeThreadId,
    setActiveThread: setActiveThreadInStore,
    setThreadReasoningEffortLocal,
  } = useThreadStore();
  const gitStatus = useGitStore((s) => s.status);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const effortSyncKeyRef = useRef<string | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

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
  const workspaceTrustLevel: TrustLevel = useMemo(() => {
    if (!repos.length) {
      return "standard";
    }
    if (repos.some((repo) => repo.trustLevel === "restricted")) {
      return "restricted";
    }
    if (repos.every((repo) => repo.trustLevel === "trusted")) {
      return "trusted";
    }
    return "standard";
  }, [repos]);

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
      setThreadReasoningEffortLocal(targetThreadId, selectedEffort);
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

    setThreadReasoningEffortLocal(targetThreadId, nextEffort);
    await ipc.setThreadReasoningEffort(targetThreadId, nextEffort);
  }

  async function onRepoTrustLevelChange(nextTrustLevel: TrustLevel) {
    if (!activeRepo) {
      return;
    }

    await setRepoTrustLevel(activeRepo.id, nextTrustLevel);
  }

  async function onWorkspaceTrustLevelChange(nextTrustLevel: TrustLevel) {
    await setAllReposTrustLevel(nextTrustLevel);
  }

  const workspaceName = activeWorkspace?.name || activeWorkspace?.rootPath.split("/").pop() || "";

  // Compute total diff stats for header display
  const gitFiles = gitStatus?.files ?? [];
  const totalAdded = gitFiles.length;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
      }}
    >
      {/* ── Top Header Bar ── */}
      <div
        data-tauri-drag-region
        style={{
          padding: "8px 16px",
          paddingTop: 38,
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--border)",
          minHeight: 44,
        }}
      >
        {/* Thread title + workspace label */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeThread?.title || "Agent Workspace"}
          </span>
          {workspaceName && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                padding: "2px 8px",
                borderRadius: 99,
                background: "var(--bg-3)",
                border: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              {workspaceName}
            </span>
          )}
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 4, borderRadius: "var(--radius-sm)", cursor: "pointer" }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        {/* Right-side action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {streaming && (
            <button
              type="button"
              onClick={() => void cancel()}
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(248, 113, 113, 0.10)",
                color: "var(--danger)",
                border: "1px solid rgba(248, 113, 113, 0.2)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Square size={10} fill="currentColor" />
              Stop
            </button>
          )}

          {/* Trust level indicator */}
          {activeRepo && (
            <Dropdown
              value={activeRepo.trustLevel}
              onChange={(v) => void onRepoTrustLevelChange(v as TrustLevel)}
              title="Execution policy"
              options={[
                { value: "trusted", label: "trusted" },
                { value: "standard", label: "ask-on-request" },
                { value: "restricted", label: "restricted" },
              ]}
              triggerStyle={
                activeRepo.trustLevel === "trusted"
                  ? {
                      background: "rgba(52, 211, 153, 0.12)",
                      color: "var(--success)",
                      border: "1px solid rgba(52, 211, 153, 0.25)",
                    }
                  : undefined
              }
            />
          )}
          {!activeRepo && repos.length > 0 && (
            <Dropdown
              value={workspaceTrustLevel}
              onChange={(v) => void onWorkspaceTrustLevelChange(v as TrustLevel)}
              title="Workspace execution policy"
              options={[
                { value: "trusted", label: "trusted" },
                { value: "standard", label: "ask-on-request" },
                { value: "restricted", label: "restricted" },
              ]}
              triggerStyle={
                workspaceTrustLevel === "trusted"
                  ? {
                      background: "rgba(52, 211, 153, 0.12)",
                      color: "var(--success)",
                      border: "1px solid rgba(52, 211, 153, 0.25)",
                    }
                  : undefined
              }
            />
          )}

          {/* Git stats badge */}
          {totalAdded > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 99,
                background: "var(--bg-3)",
                border: "1px solid var(--border)",
              }}
            >
              <span style={{ color: "var(--success)" }}>+{totalAdded}</span>
              files
            </span>
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
                background: "var(--bg-3)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Send size={22} style={{ color: "var(--text-2)", opacity: 0.5 }} />
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
                    <div
                      style={{
                        maxWidth: "75%",
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--bg-3)",
                        border: "1px solid var(--border)",
                        fontSize: 13,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {message.content || (message.blocks ?? []).filter((b) => b.type === "text").map((b) => b.content).join("\n")}
                    </div>
                  ) : (
                    <div style={{ width: "100%", maxWidth: "100%" }}>
                      <MessageBlocks
                        blocks={message.blocks}
                        status={message.status}
                        onApproval={(approvalId, response) =>
                          void respondApproval(approvalId, response)
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {streaming && (
              <div
                className="animate-fade-in"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-2)",
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
          padding: "10px 16px 12px",
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
          {/* Pending approvals */}
          {pendingApprovals.length > 0 && (
            <div
              style={{
                borderRadius: "var(--radius-lg)",
                border: "1px solid rgba(251, 191, 36, 0.18)",
                background: "rgba(251, 191, 36, 0.04)",
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
                {activeRepo && activeRepo.trustLevel !== "trusted" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void onRepoTrustLevelChange("trusted")}
                    style={{
                      marginLeft: 8,
                      padding: "4px 8px",
                      fontSize: 11,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(52, 211, 153, 0.25)",
                      color: "var(--success)",
                      cursor: "pointer",
                    }}
                    title="Persist trust for this repo to reduce approval errors"
                  >
                    Trust repo
                  </button>
                )}
                {!activeRepo && repos.length > 0 && workspaceTrustLevel !== "trusted" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void onWorkspaceTrustLevelChange("trusted")}
                    style={{
                      marginLeft: 8,
                      padding: "4px 8px",
                      fontSize: 11,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(52, 211, 153, 0.25)",
                      color: "var(--success)",
                      cursor: "pointer",
                    }}
                    title="Persist trust for all repositories in this workspace"
                  >
                    Trust workspace
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pendingApprovals.slice(-3).map((approval) => {
                  const details = approval.details ?? {};
                  const serverMethod =
                    typeof details._serverMethod === "string"
                      ? details._serverMethod
                      : "";
                  const toolInputQuestions =
                    serverMethod === "item/tool/requestUserInput"
                      ? readToolInputQuestions(details)
                      : [];
                  const proposedExecpolicyAmendment = Array.isArray(
                    details.proposedExecpolicyAmendment
                  )
                    ? details.proposedExecpolicyAmendment.filter(
                        (entry): entry is string => typeof entry === "string"
                      )
                    : [];
                  const command =
                    typeof details.command === "string"
                      ? details.command
                      : undefined;
                  const reason =
                    typeof details.reason === "string"
                      ? details.reason
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
                        background: "rgba(0,0,0,0.25)",
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
                        {toolInputQuestions.length > 0 ? (
                          toolInputQuestions[0].options.map((option) => (
                            <button
                              key={option.label}
                              type="button"
                              className="btn-ghost"
                              onClick={() =>
                                void respondApproval(
                                  approval.approvalId,
                                  buildToolInputResponse(
                                    toolInputQuestions,
                                    toolInputQuestions[0].id,
                                    option.label
                                  )
                                )
                              }
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              {option.label}
                            </button>
                          ))
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() =>
                                void respondApproval(approval.approvalId, { decision: "accept" })
                              }
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Allow
                            </button>
                            {proposedExecpolicyAmendment.length > 0 && (
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() =>
                                  void respondApproval(approval.approvalId, {
                                    acceptWithExecpolicyAmendment: {
                                      execpolicy_amendment: proposedExecpolicyAmendment,
                                    },
                                  })
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
                                Allow + policy
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() =>
                                void respondApproval(approval.approvalId, {
                                  decision: "accept_for_session",
                                })
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
                              onClick={() =>
                                void respondApproval(approval.approvalId, {
                                  decision: "decline",
                                })
                              }
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
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() =>
                                void respondApproval(approval.approvalId, { decision: "cancel" })
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
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Input container */}
          <div
            style={{
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
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
              placeholder="Ask for follow-up changes"
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

            {/* Input toolbar with selectors */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 10px",
                gap: 6,
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
                <Plus size={14} />
              </button>

              {/* Engine + Model selector */}
              <Dropdown
                value={selectedModelId ?? ""}
                onChange={(v) => setSelectedModelId(v || null)}
                disabled={availableModels.length === 0}
                title="Select model"
                options={availableModels.map((model) => ({
                  value: model.id,
                  label: `${selectedEngine?.name ? `${selectedEngine.name} ` : ""}${model.displayName}${model.isDefault ? " (default)" : ""}`,
                }))}
              />

              {/* Reasoning effort */}
              {selectedEngineId === "codex" && supportedEfforts.length > 0 && (
                <Dropdown
                  value={selectedEffort}
                  onChange={(v) => void onReasoningEffortChange(v)}
                  title="Thinking budget"
                  options={supportedEfforts.map((option) => ({
                    value: option.reasoningEffort,
                    label:
                      option.reasoningEffort.charAt(0).toUpperCase() +
                      option.reasoningEffort.slice(1),
                  }))}
                />
              )}

              <div style={{ flex: 1 }} />

              {/* Mic button (placeholder) */}
              <button
                type="button"
                className="btn-ghost"
                style={{
                  padding: 5,
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                <Mic size={14} />
              </button>

              {/* Send button */}
              {streaming ? (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(248, 113, 113, 0.10)",
                    color: "var(--danger)",
                    border: "1px solid rgba(248, 113, 113, 0.2)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
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
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background:
                      activeWorkspaceId && input.trim()
                        ? "var(--text-1)"
                        : "var(--bg-4)",
                    color:
                      activeWorkspaceId && input.trim()
                        ? "var(--bg-0)"
                        : "var(--text-3)",
                    cursor: activeWorkspaceId && input.trim() ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all var(--duration-fast) var(--ease-out)",
                  }}
                >
                  <Send size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Bottom status bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 4px",
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            {/* Local indicator */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Monitor size={11} />
              Local
            </span>

            {/* Permissions */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Shield size={11} />
              {activeRepo?.trustLevel === "trusted"
                ? "Trusted"
                : activeRepo?.trustLevel === "restricted"
                  ? "Restricted"
                  : "Default permissions"}
            </span>

            <div style={{ flex: 1 }} />

            {/* Branch */}
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
              background: "rgba(248, 113, 113, 0.06)",
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
