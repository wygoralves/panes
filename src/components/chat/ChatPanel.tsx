import { FormEvent, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Send,
  Square,
  GitBranch,
  Brain,
  Shield,
  Monitor,
  SquareTerminal,
  MessageSquare,
  FilePen,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useEngineStore } from "../../stores/engineStore";
import { useThreadStore } from "../../stores/threadStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore } from "../../stores/gitStore";
import { useTerminalStore, type LayoutMode } from "../../stores/terminalStore";
import { ipc } from "../../lib/ipc";
import { recordPerfMetric } from "../../lib/perfTelemetry";
import { MessageBlocks } from "./MessageBlocks";
import { isRequestUserInputApproval, requiresCustomApprovalPayload } from "./toolInputApproval";
import { Dropdown } from "../shared/Dropdown";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import type { ApprovalBlock, ApprovalResponse, ContentBlock, Message, TrustLevel } from "../../types";

const MESSAGE_VIRTUALIZATION_THRESHOLD = 40;
const MESSAGE_ESTIMATED_ROW_HEIGHT = 220;
const MESSAGE_ROW_GAP = 16;
const MESSAGE_OVERSCAN_PX = 700;
const LazyTerminalPanel = lazy(() =>
  import("../terminal/TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);
const LazyFileEditorPanel = lazy(() =>
  import("../editor/FileEditorPanel").then((module) => ({
    default: module.FileEditorPanel,
  })),
);

interface MeasuredMessageRowProps {
  messageId: string;
  onHeightChange: (messageId: string, height: number) => void;
  children: ReactNode;
}

function MeasuredMessageRow({ messageId, onHeightChange, children }: MeasuredMessageRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return;
    }

    const publishHeight = () => {
      onHeightChange(messageId, element.getBoundingClientRect().height);
    };

    publishHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => publishHeight());
    observer.observe(element);
    return () => observer.disconnect();
  }, [messageId, onHeightChange]);

  return <div ref={rowRef}>{children}</div>;
}

const MODEL_TOKEN_LABELS: Record<string, string> = {
  gpt: "GPT",
  codex: "Codex",
  mini: "Mini",
  nano: "Nano",
};

const REASONING_EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

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

function formatModelName(modelName: string): string {
  return modelName
    .split("-")
    .filter(Boolean)
    .map((segment) => {
      const lowerSegment = segment.toLowerCase();
      const knownLabel = MODEL_TOKEN_LABELS[lowerSegment];
      if (knownLabel) {
        return knownLabel;
      }
      if (/^\d+(\.\d+)*$/.test(segment)) {
        return segment;
      }
      if (/^[a-z]?\d+(\.\d+)*$/i.test(segment)) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join("-");
}

function formatReasoningEffortLabel(effort?: string): string {
  if (!effort) {
    return "";
  }
  const knownLabel = REASONING_EFFORT_LABELS[effort.toLowerCase()];
  if (knownLabel) {
    return knownLabel;
  }
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function formatEngineModelLabel(
  engineName?: string,
  modelDisplayName?: string,
  reasoningEffort?: string,
): string {
  const modelLabel = modelDisplayName ? formatModelName(modelDisplayName) : "";
  const baseLabel = engineName && modelLabel
    ? `${engineName} - ${modelLabel}`
    : modelLabel || engineName || "Assistant";
  const effortLabel = formatReasoningEffortLabel(reasoningEffort);
  return effortLabel ? `${baseLabel} ${effortLabel}` : baseLabel;
}

function readThreadLastModelId(thread: {
  engineMetadata?: Record<string, unknown>;
}): string | null {
  const raw = thread.engineMetadata?.lastModelId;
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasVisibleContent(blocks?: ContentBlock[]): boolean {
  if (!blocks || blocks.length === 0) return false;
  return blocks.some((b) => {
    if (b.type === "text" || b.type === "thinking") return Boolean(b.content?.trim());
    return true;
  });
}

function parseMessageDate(raw?: string): Date | null {
  if (!raw) {
    return null;
  }

  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const normalized = sqliteUtcPattern.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatMessageTimestamp(raw?: string): string {
  const date = parseMessageDate(raw);
  if (!date) {
    return "";
  }

  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function estimateMessageOffset(
  messages: Message[],
  index: number,
  measuredHeights: Map<string, number>,
): number {
  let offset = 0;
  for (let current = 0; current < index; current += 1) {
    const currentMessageId = messages[current].id;
    const rowHeight =
      measuredHeights.get(currentMessageId) ?? MESSAGE_ESTIMATED_ROW_HEIGHT;
    offset += rowHeight + MESSAGE_ROW_GAP;
  }
  return offset;
}

interface MessageRowProps {
  message: Message;
  index: number;
  isHighlighted: boolean;
  assistantLabel: string;
  assistantIsCodex: boolean;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
}

function MessageRowView({
  message,
  index,
  isHighlighted,
  assistantLabel,
  assistantIsCodex,
  onApproval,
}: MessageRowProps) {
  const isUser = message.role === "user";
  const messageTimestamp = useMemo(
    () => formatMessageTimestamp(message.createdAt),
    [message.createdAt],
  );
  const userContent = useMemo(() => {
    if (message.content) {
      return message.content;
    }
    return (message.blocks ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("\n");
  }, [message.blocks, message.content]);
  const hasAssistantContent = !isUser && hasVisibleContent(message.blocks);

  return (
    <div
      data-message-id={message.id}
      className="animate-slide-up"
      style={{
        animationDelay: `${Math.min(index * 20, 200)}ms`,
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        maxWidth: "100%",
        borderRadius: "var(--radius-md)",
        outline: isHighlighted ? "2px solid rgba(14, 240, 195, 0.35)" : "none",
        boxShadow: isHighlighted
          ? "0 10px 28px rgba(14, 240, 195, 0.12)"
          : "none",
        transition:
          "outline-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out)",
      }}
    >
      {isUser ? (
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
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {userContent}
          </div>
          {messageTimestamp && (
            <span
              style={{
                fontSize: 10,
                color: "var(--text-3)",
                paddingRight: 4,
                marginTop: 4,
              }}
            >
              {messageTimestamp}
            </span>
          )}
        </>
      ) : hasAssistantContent ? (
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
                {assistantIsCodex && (
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
                )}
                <span>{assistantLabel}</span>
              </span>
            </div>
            <MessageBlocks
              blocks={message.blocks}
              status={message.status}
              onApproval={onApproval}
            />
          </div>
          {messageTimestamp && (
            <span
              style={{
                fontSize: 10,
                color: "var(--text-3)",
                marginTop: 4,
                paddingLeft: 4,
              }}
            >
              {messageTimestamp}
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}

const MessageRow = memo(
  MessageRowView,
  (prev, next) =>
    prev.message === next.message &&
    prev.index === next.index &&
    prev.isHighlighted === next.isHighlighted &&
    prev.assistantLabel === next.assistantLabel &&
    prev.assistantIsCodex === next.assistantIsCodex &&
    prev.onApproval === next.onApproval,
);

export function ChatPanel() {
  const renderStartedAtRef = useRef(performance.now());
  renderStartedAtRef.current = performance.now();

  const [input, setInput] = useState("");
  const [selectedEngineId, setSelectedEngineId] = useState("codex");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffort] = useState("medium");
  const [editingThreadTitle, setEditingThreadTitle] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
    null,
  );
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
  const messageFocusTarget = useUiStore((s) => s.messageFocusTarget);
  const clearMessageFocusTarget = useUiStore((s) => s.clearMessageFocusTarget);
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
    createThread,
    refreshThreads,
    threads,
    activeThreadId,
    setActiveThread: setActiveThreadInStore,
    setThreadReasoningEffortLocal,
    setThreadLastModelLocal,
    renameThread,
  } = useThreadStore();
  const gitStatus = useGitStore((s) => s.status);
  const terminalWorkspaceState = useTerminalStore((s) =>
    activeWorkspaceId ? s.workspaces[activeWorkspaceId] : undefined,
  );
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);
  const setTerminalPanelSize = useTerminalStore((s) => s.setPanelSize);
  const syncTerminalSessions = useTerminalStore((s) => s.syncSessions);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const effortSyncKeyRef = useRef<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const initialScrollThreadRef = useRef<string | null>(null);
  const messageHeightsRef = useRef<Map<string, number>>(new Map());
  const layoutVersionRafRef = useRef<number | null>(null);
  const [listLayoutVersion, setListLayoutVersion] = useState(0);
  const [viewportScrollTop, setViewportScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [autoScrollLocked, setAutoScrollLocked] = useState(false);
  const [workspaceOptInPrompt, setWorkspaceOptInPrompt] = useState<{
    repoNames: string;
    workspaceId: string;
    threadId: string;
    threadPaths: string[];
    text: string;
    engineId: string;
    modelId: string;
    effort: string | null;
  } | null>(null);

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

  const activeModels = useMemo(
    () => availableModels.filter((m) => !m.hidden),
    [availableModels],
  );

  const legacyModels = useMemo(
    () => availableModels.filter((m) => m.hidden),
    [availableModels],
  );

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
  const modelPickerLabel = useMemo(() => {
    return formatEngineModelLabel(selectedEngine?.name, selectedModel?.displayName);
  }, [selectedEngine?.name, selectedModel?.displayName]);

  const renderAssistantIdentity = useCallback((message: Message) => {
    const messageEngineId =
      typeof message.turnEngineId === "string" && message.turnEngineId.trim()
        ? message.turnEngineId.trim()
        : activeThread?.engineId ?? selectedEngineId;
    const engineInfo =
      engines.find((engine) => engine.id === messageEngineId) ?? selectedEngine ?? null;
    const messageModelId =
      typeof message.turnModelId === "string" && message.turnModelId.trim()
        ? message.turnModelId.trim()
        : activeThread?.modelId ?? selectedModel?.id ?? null;
    const modelDisplayName = messageModelId
      ? engineInfo?.models.find((model) => model.id === messageModelId)?.displayName ?? messageModelId
      : undefined;
    const messageReasoningEffort =
      typeof message.turnReasoningEffort === "string" && message.turnReasoningEffort.trim()
        ? message.turnReasoningEffort.trim()
        : undefined;

    return {
      label: formatEngineModelLabel(engineInfo?.name, modelDisplayName, messageReasoningEffort),
      isCodex: messageEngineId === "codex",
    };
  }, [activeThread?.engineId, activeThread?.modelId, engines, selectedEngine, selectedEngineId, selectedModel?.id]);

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

  const scheduleListLayoutVersionBump = useCallback(() => {
    if (layoutVersionRafRef.current !== null) {
      return;
    }
    layoutVersionRafRef.current = window.requestAnimationFrame(() => {
      layoutVersionRafRef.current = null;
      setListLayoutVersion((version) => version + 1);
    });
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) {
      void syncTerminalSessions(activeWorkspaceId);
    }
  }, [activeWorkspaceId, syncTerminalSessions]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    let rafId = 0;
    const updateScroll = () => {
      setViewportScrollTop(viewport.scrollTop);
      const nearBottom =
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 120;
      setAutoScrollLocked(!nearBottom);
    };
    const updateHeight = () => {
      setViewportHeight(viewport.clientHeight);
    };

    updateScroll();
    updateHeight();

    const onScroll = () => {
      if (rafId !== 0) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateScroll();
      });
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateHeight());
      resizeObserver.observe(viewport);
    } else {
      window.addEventListener("resize", updateHeight);
    }

    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", updateHeight);
      }
    };
  }, []);

  useEffect(() => {
    messageHeightsRef.current.clear();
    scheduleListLayoutVersionBump();
  }, [activeThread?.id, scheduleListLayoutVersionBump]);

  useEffect(() => {
    const existingIds = new Set(messages.map((message) => message.id));
    let changed = false;
    for (const messageId of messageHeightsRef.current.keys()) {
      if (!existingIds.has(messageId)) {
        messageHeightsRef.current.delete(messageId);
        changed = true;
      }
    }
    if (changed) {
      scheduleListLayoutVersionBump();
    }
  }, [messages, scheduleListLayoutVersionBump]);

  useEffect(() => {
    if (!editingThreadTitle) {
      setThreadTitleDraft(activeThread?.title ?? "");
    }
  }, [activeThread?.id, activeThread?.title, editingThreadTitle]);

  useEffect(() => {
    if (!editingThreadTitle) {
      return;
    }
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [editingThreadTitle]);

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
    const lastModelId =
      typeof activeThread.engineMetadata?.lastModelId === "string"
        ? activeThread.engineMetadata.lastModelId
        : null;
    const preferredModelId = lastModelId ?? activeThread.modelId;
    const preferredModelExists =
      threadEngine?.models.some((model) => model.id === preferredModelId) ?? false;
    const threadModelExists =
      threadEngine?.models.some((model) => model.id === activeThread.modelId) ?? false;
    if (preferredModelExists) {
      setSelectedModelId(preferredModelId);
    } else if (threadModelExists) {
      setSelectedModelId(activeThread.modelId);
    }
  }, [
    activeThread?.id,
    activeThread?.engineId,
    activeThread?.modelId,
    activeThread?.engineMetadata,
    engines,
    selectedEngineId,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      if (threadId !== null) {
        setActiveThreadInStore(null);
        void bindChatThread(null);
      }
      return;
    }

    const activeRepoScopeId = activeRepo?.id ?? null;
    const activeThreadInCurrentScope =
      activeThread &&
      activeThread.workspaceId === activeWorkspaceId &&
      activeThread.repoId === activeRepoScopeId;

    const targetThreadId = activeThreadInCurrentScope ? activeThread.id : null;
    if (targetThreadId === threadId) {
      return;
    }

    if (!activeThreadInCurrentScope) {
      setActiveThreadInStore(null);
    }
    void bindChatThread(targetThreadId);
  }, [
    activeWorkspaceId,
    activeRepo?.id,
    activeThread?.id,
    activeThread?.workspaceId,
    activeThread?.repoId,
    activeThread?.engineId,
    activeThread?.modelId,
    threadId,
    bindChatThread,
    setActiveThreadInStore,
  ]);

  const scrollViewportToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!threadId) {
      initialScrollThreadRef.current = null;
      setAutoScrollLocked(false);
      return;
    }

    if (messages.length === 0) {
      return;
    }

    if (initialScrollThreadRef.current === threadId) {
      return;
    }

    if (messageFocusTarget?.threadId === threadId) {
      return;
    }

    initialScrollThreadRef.current = threadId;

    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      scrollViewportToBottom("auto");
      raf2 = window.requestAnimationFrame(() => {
        scrollViewportToBottom("auto");
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2 !== 0) {
        window.cancelAnimationFrame(raf2);
      }
    };
  }, [threadId, messages.length, messageFocusTarget?.threadId, scrollViewportToBottom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!autoScrollLocked) {
      scrollViewportToBottom("smooth");
    }
  }, [messages, autoScrollLocked, scrollViewportToBottom]);

  useEffect(() => {
    if (!messageFocusTarget) {
      return;
    }
    if (messageFocusTarget.threadId !== threadId) {
      return;
    }

    const targetIndex = messages.findIndex(
      (message) => message.id === messageFocusTarget.messageId,
    );
    if (targetIndex < 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const targetMessageId = messages[targetIndex].id;
    const targetHeight =
      messageHeightsRef.current.get(targetMessageId) ??
      MESSAGE_ESTIMATED_ROW_HEIGHT;
    const targetTopOffset = estimateMessageOffset(
      messages,
      targetIndex,
      messageHeightsRef.current,
    );
    const centeredTop = Math.max(
      0,
      targetTopOffset - Math.max((viewport.clientHeight - targetHeight) / 2, 0),
    );

    viewport.scrollTo({ top: centeredTop, behavior: "smooth" });
    window.setTimeout(() => {
      const targetElement = viewport.querySelector<HTMLElement>(
        `[data-message-id="${targetMessageId}"]`,
      );
      if (targetElement) {
        targetElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 120);
    setHighlightedMessageId(targetMessageId);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === targetMessageId ? null : current,
      );
      highlightTimeoutRef.current = null;
    }, 2400);

    clearMessageFocusTarget();
  }, [clearMessageFocusTarget, messageFocusTarget, messages, threadId]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      if (layoutVersionRafRef.current !== null) {
        window.cancelAnimationFrame(layoutVersionRafRef.current);
        layoutVersionRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setHighlightedMessageId(null);
  }, [activeThread?.id]);

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

    const activeScopeRepoId = activeRepo?.id ?? null;
    const activeThreadInScope = activeThread
      ? activeThread.workspaceId === activeWorkspaceId &&
        activeThread.repoId === activeScopeRepoId
      : false;
    const activeThreadModelMatch = activeThread
      ? activeThread.modelId === selectedModelId ||
        readThreadLastModelId(activeThread) === selectedModelId
      : false;
    const activeThreadEngineMatch = activeThread
      ? activeThread.engineId === selectedEngineId
      : false;

    let targetThreadId =
      threadId &&
      activeThreadInScope &&
      activeThreadEngineMatch &&
      activeThreadModelMatch
        ? threadId
        : null;

    if (!targetThreadId) {
      const createdThreadId = await createThread({
        workspaceId: activeWorkspaceId,
        repoId: activeScopeRepoId,
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

    if (currentThread && currentThread.repoId === null && repos.length > 1) {
      const optIn = Boolean(currentThread.engineMetadata?.workspaceWriteOptIn);
      if (!optIn) {
        const repoNames = repos.map((repo) => repo.name).join(", ");
        setWorkspaceOptInPrompt({
          repoNames,
          workspaceId: activeWorkspaceId,
          threadId: targetThreadId,
          threadPaths: repos.map((repo) => repo.path),
          text: input.trim(),
          engineId: selectedEngineId,
          modelId: selectedModelId!,
          effort: selectedEngineId === "codex" ? selectedEffort : null,
        });
        return;
      }
    }

    const text = input.trim();
    setInput("");

    if (selectedEngineId === "codex" && selectedEffort) {
      await ipc.setThreadReasoningEffort(targetThreadId, selectedEffort, selectedModelId);
      setThreadReasoningEffortLocal(targetThreadId, selectedEffort);
    }
    setThreadLastModelLocal(targetThreadId, selectedModelId);

    await send(text, {
      threadIdOverride: targetThreadId,
      engineId: selectedEngineId,
      modelId: selectedModelId,
      reasoningEffort: selectedEngineId === "codex" ? selectedEffort : null,
    });
  }

  async function executeWorkspaceOptInSend() {
    const prompt = workspaceOptInPrompt;
    if (!prompt) return;
    setWorkspaceOptInPrompt(null);

    try {
      await ipc.confirmWorkspaceThread(prompt.threadId, prompt.threadPaths);

      setInput("");

      if (prompt.engineId === "codex" && prompt.effort) {
        await ipc.setThreadReasoningEffort(prompt.threadId, prompt.effort, prompt.modelId);
        setThreadReasoningEffortLocal(prompt.threadId, prompt.effort);
      }
      setThreadLastModelLocal(prompt.threadId, prompt.modelId);

      await send(prompt.text, {
        threadIdOverride: prompt.threadId,
        engineId: prompt.engineId,
        modelId: prompt.modelId,
        reasoningEffort: prompt.effort,
      });

      await refreshThreads(prompt.workspaceId);
    } catch {
      setInput(prompt.text);
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
    await ipc.setThreadReasoningEffort(targetThreadId, nextEffort, selectedModelId);
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

  function startThreadTitleEdit() {
    if (!activeThread) {
      return;
    }
    setThreadTitleDraft(activeThread.title ?? "");
    setEditingThreadTitle(true);
  }

  function cancelThreadTitleEdit() {
    setThreadTitleDraft(activeThread?.title ?? "");
    setEditingThreadTitle(false);
  }

  async function saveThreadTitleEdit() {
    if (!activeThread) {
      setEditingThreadTitle(false);
      return;
    }

    const normalized = threadTitleDraft.trim();
    if (!normalized) {
      cancelThreadTitleEdit();
      return;
    }

    if (normalized !== (activeThread.title ?? "")) {
      await renameThread(activeThread.id, normalized);
    }

    setEditingThreadTitle(false);
  }

  const onMessageRowHeightChange = useCallback(
    (messageId: string, height: number) => {
      const normalizedHeight = Math.max(56, Math.ceil(height));
      const previousHeight = messageHeightsRef.current.get(messageId);
      if (
        previousHeight !== undefined &&
        Math.abs(previousHeight - normalizedHeight) < 2
      ) {
        return;
      }

      messageHeightsRef.current.set(messageId, normalizedHeight);
      scheduleListLayoutVersionBump();
    },
    [scheduleListLayoutVersionBump],
  );

  const virtualizationEnabled =
    messages.length >= MESSAGE_VIRTUALIZATION_THRESHOLD;

  useEffect(() => {
    recordPerfMetric("chat.render.commit.ms", performance.now() - renderStartedAtRef.current, {
      threadId,
      messageCount: messages.length,
      virtualized: virtualizationEnabled,
      streaming,
    });
  }, [messages.length, streaming, threadId, virtualizationEnabled]);

  const handleApproval = useCallback(
    (approvalId: string, response: ApprovalResponse) => {
      void respondApproval(approvalId, response);
    },
    [respondApproval],
  );

  const assistantIdentityByMessageId = useMemo(() => {
    const identityByMessageId = new Map<string, { label: string; isCodex: boolean }>();
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }
      identityByMessageId.set(message.id, renderAssistantIdentity(message));
    }
    return identityByMessageId;
  }, [messages, renderAssistantIdentity]);

  const virtualizedLayout = useMemo(() => {
    if (!virtualizationEnabled || messages.length === 0) {
      return null;
    }

    const rowCount = messages.length;
    const offsets = new Array<number>(rowCount + 1);
    offsets[0] = 0;

    for (let index = 0; index < rowCount; index += 1) {
      const messageId = messages[index].id;
      const measuredHeight = messageHeightsRef.current.get(messageId);
      const rowHeight = measuredHeight ?? MESSAGE_ESTIMATED_ROW_HEIGHT;
      offsets[index + 1] =
        offsets[index] + rowHeight + (index < rowCount - 1 ? MESSAGE_ROW_GAP : 0);
    }

    return {
      offsets,
      rowCount,
    };
  }, [messages, virtualizationEnabled, listLayoutVersion]);

  const virtualWindow = useMemo(() => {
    if (!virtualizedLayout) {
      return null;
    }

    const { offsets, rowCount } = virtualizedLayout;

    const visibleStart = Math.max(0, viewportScrollTop - MESSAGE_OVERSCAN_PX);
    const visibleEnd =
      viewportScrollTop + viewportHeight + MESSAGE_OVERSCAN_PX;

    // Binary search: find first row whose bottom edge (offsets[i+1]) >= visibleStart
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

    // Binary search: find first row whose top edge (offsets[i]) > visibleEnd
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
      topSpacerHeight: offsets[startIndex],
      bottomSpacerHeight: offsets[rowCount] - offsets[endIndexExclusive],
    };
  }, [
    virtualizedLayout,
    viewportHeight,
    viewportScrollTop,
  ]);

  const streamingIndicator = streaming ? (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: "var(--text-3)",
        fontSize: 11.5,
        padding: "4px 12px",
      }}
    >
      <Brain
        size={12}
        className="thinking-icon-active"
        style={{ color: "var(--info)" }}
      />
      <span>Thinking&hellip;</span>
    </div>
  ) : null;

  const workspaceName = activeWorkspace?.name || activeWorkspace?.rootPath.split("/").pop() || "";

  // Compute total diff stats for header display
  const gitFiles = gitStatus?.files ?? [];
  const totalAdded = gitFiles.length;
  const layoutMode: LayoutMode = activeWorkspaceId
    ? (terminalWorkspaceState?.layoutMode ?? "chat")
    : "chat";
  const terminalPanelSize = activeWorkspaceId
    ? terminalWorkspaceState?.panelSize ?? 32
    : 32;

  const hasTerminalMountedRef = useRef(false);
  const hasEditorMountedRef = useRef(false);
  useEffect(() => {
    if ((layoutMode === "split" || layoutMode === "terminal") && activeWorkspaceId) {
      hasTerminalMountedRef.current = true;
    }
    if (layoutMode === "editor" && activeWorkspaceId) {
      hasEditorMountedRef.current = true;
    }
  }, [layoutMode, activeWorkspaceId]);

  const contentAreaRef = useRef<HTMLDivElement>(null);
  const terminalPanelSizeRef = useRef(terminalPanelSize);
  terminalPanelSizeRef.current = terminalPanelSize;
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = contentAreaRef.current;
    if (!container || !activeWorkspaceId) return;
    const startY = e.clientY;
    const containerHeight = container.getBoundingClientRect().height;
    const startTerminalPct = terminalPanelSizeRef.current;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaPct = (deltaY / containerHeight) * 100;
      const newSize = Math.max(15, Math.min(72, startTerminalPct - deltaPct));
      setTerminalPanelSize(activeWorkspaceId, newSize);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resizeCleanupRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    resizeCleanupRef.current = onUp;
  }, [activeWorkspaceId, setTerminalPanelSize]);

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
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          height: 74,
          padding: "8px 16px",
          paddingTop: 38,
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {/* Workspace badge + Thread title */}
        <div className="no-drag" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {workspaceName && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
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
          {editingThreadTitle && activeThread ? (
            <input
              ref={titleInputRef}
              value={threadTitleDraft}
              onChange={(event) => setThreadTitleDraft(event.target.value)}
              onBlur={cancelThreadTitleEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveThreadTitleEdit();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelThreadTitleEdit();
                }
              }}
              style={{
                minWidth: 120,
                width: "100%",
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-1)",
                background: "var(--bg-3)",
                border: "1px solid var(--border-active)",
                borderRadius: "var(--radius-sm)",
                padding: "4px 8px",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={startThreadTitleEdit}
              disabled={!activeThread}
              title={activeThread ? "Click to rename thread" : ""}
              style={{
                border: "none",
                background: "transparent",
                padding: "2px 6px",
                margin: 0,
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-1)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: activeThread ? "text" : "default",
                textAlign: "left",
                borderRadius: "var(--radius-sm)",
                transition: "background var(--duration-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                if (activeThread) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {activeThread?.title || "Panes"}
            </button>
          )}
        </div>

        {/* Right-side action buttons */}
        <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div className="layout-mode-switcher">
            <button
              type="button"
              title="Chat only"
              disabled={!activeWorkspaceId}
              onClick={() => activeWorkspaceId && void setLayoutMode(activeWorkspaceId, "chat")}
              className={`layout-mode-btn ${layoutMode === "chat" ? "active" : ""}`}
            >
              <MessageSquare size={12} />
            </button>
            <button
              type="button"
              title="Split view (Cmd+Shift+T)"
              disabled={!activeWorkspaceId}
              onClick={() => activeWorkspaceId && void setLayoutMode(activeWorkspaceId, "split")}
              className={`layout-mode-btn ${layoutMode === "split" ? "active" : ""}`}
            >
              <Monitor size={12} />
            </button>
            <button
              type="button"
              title="Terminal only"
              disabled={!activeWorkspaceId}
              onClick={() => activeWorkspaceId && void setLayoutMode(activeWorkspaceId, "terminal")}
              className={`layout-mode-btn ${layoutMode === "terminal" ? "active" : ""}`}
            >
              <SquareTerminal size={12} />
            </button>
            <button
              type="button"
              title="File editor (Cmd+E)"
              disabled={!activeWorkspaceId}
              onClick={() => activeWorkspaceId && void setLayoutMode(activeWorkspaceId, "editor")}
              className={`layout-mode-btn ${layoutMode === "editor" ? "active" : ""}`}
            >
              <FilePen size={12} />
            </button>
          </div>

          {/* Git stats badge */}
          {totalAdded > 0 && (
            <span
              style={{
                fontSize: 11,
                fontFamily: '"JetBrains Mono", monospace',
                color: "var(--warning)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 99,
                background: "rgba(251, 191, 36, 0.06)",
                border: "1px solid rgba(251, 191, 36, 0.15)",
              }}
            >
              <span style={{ color: "var(--warning)" }}>+{totalAdded}</span>
              <span style={{ color: "var(--text-3)" }}>files</span>
            </span>
          )}
        </div>
      </div>

      <div ref={contentAreaRef} className="chat-terminal-content">
        {/* Chat section */}
        <div
          className="chat-section"
          style={{
            flex: (layoutMode === "terminal" || layoutMode === "editor") ? "0 0 0px"
                 : layoutMode === "chat" ? "1 1 0px"
                 : `0 0 ${100 - terminalPanelSize}%`,
            overflow: "hidden",
            visibility: (layoutMode === "terminal" || layoutMode === "editor") ? "hidden" : "visible",
            display: "flex",
            flexDirection: "column",
          }}
        >
            {/* ── Messages ── */}
            <div
              ref={viewportRef}
              style={{
                position: "relative",
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
        ) : virtualizationEnabled && virtualWindow ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {virtualWindow.topSpacerHeight > 0 && (
              <div style={{ height: virtualWindow.topSpacerHeight }} />
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: MESSAGE_ROW_GAP }}>
              {messages
                .slice(virtualWindow.startIndex, virtualWindow.endIndexExclusive)
                .map((message, relativeIndex) => {
                  const absoluteIndex = virtualWindow.startIndex + relativeIndex;
                  const assistantIdentity = assistantIdentityByMessageId.get(message.id);
                  return (
                    <MeasuredMessageRow
                      key={message.id}
                      messageId={message.id}
                      onHeightChange={onMessageRowHeightChange}
                    >
                      <MessageRow
                        message={message}
                        index={absoluteIndex}
                        isHighlighted={message.id === highlightedMessageId}
                        assistantLabel={assistantIdentity?.label ?? ""}
                        assistantIsCodex={assistantIdentity?.isCodex ?? false}
                        onApproval={handleApproval}
                      />
                    </MeasuredMessageRow>
                  );
                })}
            </div>

            {virtualWindow.bottomSpacerHeight > 0 && (
              <div style={{ height: virtualWindow.bottomSpacerHeight }} />
            )}

            {streamingIndicator}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: MESSAGE_ROW_GAP }}>
            {messages.map((message, index) => {
              const assistantIdentity = assistantIdentityByMessageId.get(message.id);
              return (
                <MessageRow
                  key={message.id}
                  message={message}
                  index={index}
                  isHighlighted={message.id === highlightedMessageId}
                  assistantLabel={assistantIdentity?.label ?? ""}
                  assistantIsCodex={assistantIdentity?.isCodex ?? false}
                  onApproval={handleApproval}
                />
              );
            })}
            {streamingIndicator}
          </div>
        )}

        {autoScrollLocked && messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setAutoScrollLocked(false);
              scrollViewportToBottom("smooth");
            }}
            style={{
              position: "sticky",
              left: "100%",
              bottom: 10,
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-2)",
              color: "var(--text-2)",
              fontSize: 11.5,
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
              zIndex: 2,
            }}
          >
            Jump to latest
          </button>
        )}
            </div>

            {/* ── Input Area ── */}
            <div
              style={{
                padding: "8px 14px 10px",
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
            <div className="chat-approval-banner">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <Shield size={14} style={{ color: "var(--warning)" }} />
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--warning)" }}>
                  Pending approval
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
                    title="Set trusted policy for this repo (ask-on-request with network enabled)"
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
                    title="Set trusted policy for all repositories (ask-on-request with network enabled)"
                  >
                    Trust workspace
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pendingApprovals.slice(-3).map((approval) => {
                  const details = approval.details ?? {};
                  const isToolInputRequest = isRequestUserInputApproval(details);
                  const requiresCustomPayload = requiresCustomApprovalPayload(details);
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
                      className="chat-approval-row"
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
                        {isToolInputRequest || requiresCustomPayload ? (
                          <span
                            style={{
                              fontSize: 11.5,
                              color: "var(--text-3)",
                              maxWidth: 220,
                              textAlign: "right",
                            }}
                          >
                            {isToolInputRequest
                              ? "Respond in the approval card below."
                              : "This request requires custom JSON. Respond in the approval card below."}
                          </span>
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
                                className="btn-outline"
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
                                }}
                              >
                                Allow + policy
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() =>
                                void respondApproval(approval.approvalId, {
                                  decision: "accept_for_session",
                                })
                              }
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Allow session
                            </button>
                            <button
                              type="button"
                              className="btn-danger-ghost"
                              onClick={() =>
                                void respondApproval(approval.approvalId, {
                                  decision: "decline",
                                })
                              }
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Deny
                            </button>
                            <button
                              type="button"
                              className="btn-cancel-ghost"
                              onClick={() =>
                                void respondApproval(approval.approvalId, { decision: "cancel" })
                              }
                              style={{
                                padding: "5px 10px",
                                fontSize: 12,
                                cursor: "pointer",
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
          <div className="chat-input-box">
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
                lineHeight: 1.6,
                resize: "none",
                fontFamily: "inherit",
                caretColor: "var(--accent)",
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
              {/* Engine + Model selector */}
              <Dropdown
                value={selectedModelId ?? ""}
                onChange={(v) => setSelectedModelId(v || null)}
                disabled={availableModels.length === 0}
                title="Select model"
                selectedLabel={modelPickerLabel}
                selectedIcon={selectedEngineId === "codex" ? <OpenAiIcon size={12} /> : undefined}
                options={activeModels.map((model) => ({
                  value: model.id,
                  label: formatEngineModelLabel(selectedEngine?.name, model.displayName),
                  icon: selectedEngineId === "codex" ? <OpenAiIcon size={12} /> : undefined,
                }))}
                groups={legacyModels.length > 0 ? [{
                  label: "Legacy Models",
                  options: legacyModels.map((model) => ({
                    value: model.id,
                    label: formatEngineModelLabel(selectedEngine?.name, model.displayName),
                    icon: selectedEngineId === "codex" ? <OpenAiIcon size={12} /> : undefined,
                  })),
                }] : undefined}
              />

              {/* Reasoning effort */}
              {selectedEngineId === "codex" && supportedEfforts.length > 0 && (
                <Dropdown
                  value={selectedEffort}
                  onChange={(v) => void onReasoningEffortChange(v)}
                  title="Thinking budget"
                  options={supportedEfforts.map((option) => ({
                    value: option.reasoningEffort,
                    label: formatReasoningEffortLabel(option.reasoningEffort),
                  }))}
                />
              )}

              <div className="chat-toolbar-divider" />

              {/* Trust level dropdown */}
              {activeRepo && (
                <Dropdown
                  value={activeRepo.trustLevel}
                  onChange={(v) => void onRepoTrustLevelChange(v as TrustLevel)}
                  title="Execution policy"
                  options={[
                    { value: "trusted", label: "trusted (network on)" },
                    { value: "standard", label: "ask-on-request (network off)" },
                    { value: "restricted", label: "restricted (trusted cmds only)" },
                  ]}
                  triggerStyle={
                    activeRepo.trustLevel === "trusted"
                      ? {
                          background: "rgba(52, 211, 153, 0.12)",
                          color: "var(--success)",
                          border: "1px solid rgba(52, 211, 153, 0.25)",
                        }
                      : activeRepo.trustLevel === "restricted"
                        ? {
                            background: "rgba(248, 113, 113, 0.10)",
                            color: "var(--danger)",
                            border: "1px solid rgba(248, 113, 113, 0.2)",
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
                    { value: "trusted", label: "trusted (network on)" },
                    { value: "standard", label: "ask-on-request (network off)" },
                    { value: "restricted", label: "restricted (trusted cmds only)" },
                  ]}
                  triggerStyle={
                    workspaceTrustLevel === "trusted"
                      ? {
                          background: "rgba(52, 211, 153, 0.12)",
                          color: "var(--success)",
                          border: "1px solid rgba(52, 211, 153, 0.25)",
                        }
                      : workspaceTrustLevel === "restricted"
                        ? {
                            background: "rgba(248, 113, 113, 0.10)",
                            color: "var(--danger)",
                            border: "1px solid rgba(248, 113, 113, 0.2)",
                          }
                        : undefined
                  }
                />
              )}

              <div style={{ flex: 1 }} />

              {/* Stop / Send button */}
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
                    fontWeight: 600,
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
                        ? "var(--accent)"
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
                    boxShadow:
                      activeWorkspaceId && input.trim()
                        ? "var(--accent-glow)"
                        : "none",
                  }}
                >
                  <Send size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Bottom status bar */}
          <div className="chat-status-bar">
            {/* Local indicator */}
            <span className="chat-status-item">
              <Monitor size={11} />
              Local
            </span>

            {repos.length > 0 && (
              <>
                <span style={{ color: "var(--text-3)", opacity: 0.4 }}>&middot;</span>

                {/* Permissions */}
                <span
                  className="chat-status-item"
                  style={{
                    color: (activeRepo?.trustLevel ?? workspaceTrustLevel) === "trusted"
                      ? "var(--success)"
                      : (activeRepo?.trustLevel ?? workspaceTrustLevel) === "restricted"
                        ? "var(--danger)"
                        : undefined,
                  }}
                >
                  <Shield size={11} />
                  {(activeRepo?.trustLevel ?? workspaceTrustLevel) === "trusted"
                    ? "Trusted (network on)"
                    : (activeRepo?.trustLevel ?? workspaceTrustLevel) === "restricted"
                      ? "Restricted (trusted cmds only)"
                      : "Ask-on-request (network off)"}
                </span>
              </>
            )}

            <div style={{ flex: 1 }} />

            {/* Branch */}
            {gitStatus?.branch && (
              <span className="chat-status-branch">
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

        {/* Resize handle — split mode only */}
        {layoutMode === "split" && (
          <div className="layout-resize-handle-vertical" onMouseDown={handleResizeStart} />
        )}

        {/* Terminal section */}
        <div
          className="terminal-section"
          style={{
            flex: (layoutMode === "chat" || layoutMode === "editor") ? "0 0 0px"
                 : layoutMode === "terminal" ? "1 1 0px"
                 : `0 0 ${terminalPanelSize}%`,
            overflow: "hidden",
            visibility: (layoutMode === "chat" || layoutMode === "editor") ? "hidden" : "visible",
          }}
        >
          {hasTerminalMountedRef.current && activeWorkspaceId && (
            <div className="terminal-split-panel" style={{ height: "100%" }}>
              <Suspense
                fallback={
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      color: "var(--text-3)",
                    }}
                  >
                    Loading terminal...
                  </div>
                }
              >
                <LazyTerminalPanel workspaceId={activeWorkspaceId} />
              </Suspense>
            </div>
          )}
        </div>

        {/* Editor section */}
        <div
          style={{
            flex: layoutMode === "editor" ? "1 1 0px" : "0 0 0px",
            minHeight: 0,
            overflow: "hidden",
            visibility: layoutMode === "editor" ? "visible" : "hidden",
          }}
        >
          {hasEditorMountedRef.current && (
            <Suspense
              fallback={
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  Loading editor...
                </div>
              }
            >
              <LazyFileEditorPanel />
            </Suspense>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={workspaceOptInPrompt !== null}
        title="Enable multi-repo writes"
        message={
          workspaceOptInPrompt
            ? `This workspace thread can write to multiple repositories (${workspaceOptInPrompt.repoNames}). Continue?`
            : ""
        }
        confirmLabel="Continue"
        onConfirm={() => void executeWorkspaceOptInSend()}
        onCancel={() => setWorkspaceOptInPrompt(null)}
      />
    </div>
  );
}
