import { FormEvent, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  Plus,
  X,
  FileText,
  Image,
  File,
  ListChecks,
  Clock,
  Zap,
} from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useEngineStore } from "../../stores/engineStore";
import { useThreadStore } from "../../stores/threadStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore } from "../../stores/gitStore";
import { useTerminalStore, type LayoutMode } from "../../stores/terminalStore";
import { toast } from "../../stores/toastStore";
import { ipc } from "../../lib/ipc";
import { recordPerfMetric } from "../../lib/perfTelemetry";
import { MessageBlocks } from "./MessageBlocks";
import { isRequestUserInputApproval, requiresCustomApprovalPayload } from "./toolInputApproval";
import { Dropdown } from "../shared/Dropdown";
import { ModelPicker } from "./ModelPicker";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { handleDragMouseDown, handleDragDoubleClick } from "../../lib/windowDrag";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { ApprovalBlock, ApprovalResponse, ChatAttachment, ContentBlock, Message, TrustLevel } from "../../types";

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
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "svg",
]);
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "css",
  "html",
  "yaml",
  "yml",
  "toml",
  "xml",
  "sql",
  "sh",
  "csv",
]);
const CODEX_ATTACHMENT_EXTENSIONS = Array.from(
  new Set([...IMAGE_ATTACHMENT_EXTENSIONS, ...TEXT_ATTACHMENT_EXTENSIONS]),
);
const CLAUDE_TEXT_ATTACHMENT_EXTENSIONS = Array.from(
  new Set([...TEXT_ATTACHMENT_EXTENSIONS, "svg"]),
);
const CLAUDE_IMAGE_ATTACHMENT_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const CLAUDE_ATTACHMENT_EXTENSIONS = Array.from(
  new Set([...CLAUDE_TEXT_ATTACHMENT_EXTENSIONS, ...CLAUDE_IMAGE_ATTACHMENT_EXTENSIONS]),
);
const ENGINE_PREWARM_THROTTLE_MS = 30_000;
const lastPrewarmAttemptAtByEngine = new Map<string, number>();
const inflightPrewarmByEngine = new Map<string, Promise<void>>();

function scheduleIdleTask(callback: () => void): () => void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => callback(), { timeout: 600 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = window.setTimeout(callback, 120);
  return () => window.clearTimeout(timeoutId);
}

function prewarmEngineTransport(engineId: string): Promise<void> {
  const now = Date.now();
  const lastAttemptAt = lastPrewarmAttemptAtByEngine.get(engineId) ?? 0;
  if (now - lastAttemptAt < ENGINE_PREWARM_THROTTLE_MS) {
    return Promise.resolve();
  }

  const existingTask = inflightPrewarmByEngine.get(engineId);
  if (existingTask) {
    return existingTask;
  }

  lastPrewarmAttemptAtByEngine.set(engineId, now);
  const task = ipc.prewarmEngine(engineId)
    .catch(() => {
      // Ignore prewarm failures; engine health/setup surfaces the actionable state.
    })
    .finally(() => {
      inflightPrewarmByEngine.delete(engineId);
    });
  inflightPrewarmByEngine.set(engineId, task);
  return task;
}

interface AttachmentFilterConfig {
  supportedExtensions: string[];
  textExtensions: string[];
  imageExtensions: string[];
  title: string;
  warningMessage: string;
}

function getAttachmentFilterConfig(engineId: string): AttachmentFilterConfig | null {
  switch (engineId) {
    case "codex":
      return {
        supportedExtensions: CODEX_ATTACHMENT_EXTENSIONS,
        textExtensions: [...TEXT_ATTACHMENT_EXTENSIONS],
        imageExtensions: [...IMAGE_ATTACHMENT_EXTENSIONS],
        title: "Attach files (images and text)",
        warningMessage: "Only image and text attachments are supported for Codex turns.",
      };
    case "claude":
      return {
        supportedExtensions: CLAUDE_ATTACHMENT_EXTENSIONS,
        textExtensions: CLAUDE_TEXT_ATTACHMENT_EXTENSIONS,
        imageExtensions: CLAUDE_IMAGE_ATTACHMENT_EXTENSIONS,
        title: "Attach files (text, SVG, and supported images)",
        warningMessage: "Only text files (including SVG) and PNG/JPEG/GIF/WEBP images are supported for Claude turns.",
      };
    default:
      return null;
  }
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

function encodeModelOptionValue(engineId: string, modelId: string): string {
  return JSON.stringify([engineId, modelId]);
}

function decodeModelOptionValue(value: string): { engineId: string; modelId: string } | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { engineId: parsed[0], modelId: parsed[1] };
    }
  } catch {
    // Ignore malformed legacy values.
  }

  return null;
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
  assistantEngineId: string;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
  onLoadActionOutput: (messageId: string, actionId: string) => Promise<void>;
}

function MessageRowView({
  message,
  index,
  isHighlighted,
  assistantLabel,
  assistantEngineId,
  onApproval,
  onLoadActionOutput,
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
  const userAttachments = useMemo(
    () => (message.blocks ?? []).filter((b) => b.type === "attachment"),
    [message.blocks],
  );
  const userPlanMode = useMemo(
    () =>
      (message.blocks ?? []).some(
        (block) => block.type === "text" && Boolean(block.planMode),
      ),
    [message.blocks],
  );
  const hasAssistantContent = !isUser && hasVisibleContent(message.blocks);
  const showAssistantShell = !isUser && (hasAssistantContent || message.status === "streaming");

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
              background: "rgba(14, 240, 195, 0.06)",
              border: "1px solid rgba(14, 240, 195, 0.10)",
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {userAttachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {userAttachments.map((block, i) => {
                  if (block.type !== "attachment") return null;
                  const mime = block.mimeType ?? "";
                  const AttachIcon = mime.startsWith("image/")
                    ? Image
                    : mime.startsWith("text/") || mime.includes("json")
                      ? FileText
                      : File;
                  return (
                    <span key={i} className="chat-attachment-chip">
                      <AttachIcon size={10} />
                      <span className="chat-attachment-chip-name" style={{ fontSize: 10 }}>
                        {block.fileName}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
            {userPlanMode && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 6, fontSize: 10, color: "var(--text-3)" }}>
                <ListChecks size={10} />
                <span>Plan mode</span>
              </div>
            )}
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
      ) : showAssistantShell ? (
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
                {assistantEngineId && getHarnessIcon(assistantEngineId, 11)}
                <span>{assistantLabel}</span>
              </span>
            </div>
            {hasAssistantContent ? (
              <MessageBlocks
                blocks={message.blocks}
                status={message.status}
                onApproval={onApproval}
                onLoadActionOutput={(actionId) => onLoadActionOutput(message.id, actionId)}
              />
            ) : (
              <div
                style={{
                  padding: "8px 14px 12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                <Brain
                  size={12}
                  className="thinking-icon-active"
                  style={{ color: "var(--info)" }}
                />
                <span>Thinking</span>
                <span className="chat-streaming-dots">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
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
    prev.assistantEngineId === next.assistantEngineId &&
    prev.onApproval === next.onApproval &&
    prev.onLoadActionOutput === next.onLoadActionOutput,
);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentIcon(mimeType?: string) {
  if (!mimeType) return File;
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("typescript"))
    return FileText;
  return File;
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

function fileNameFromPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath.split("\\").pop() ?? filePath;
}

function isSupportedAttachmentName(fileName: string, supportedExtensions: ReadonlySet<string>): boolean {
  const extension = getFileExtension(fileName);
  return supportedExtensions.has(extension);
}

function guessMimeType(fileName: string): string | undefined {
  const ext = getFileExtension(fileName);
  const mimeMap: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    js: "text/javascript",
    ts: "text/typescript",
    tsx: "text/typescript",
    jsx: "text/javascript",
    py: "text/x-python",
    rs: "text/x-rust",
    go: "text/x-go",
    css: "text/css",
    html: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    yaml: "text/yaml",
    yml: "text/yaml",
    toml: "text/toml",
    xml: "text/xml",
    sql: "text/x-sql",
    sh: "text/x-shellscript",
    csv: "text/csv",
  };
  return mimeMap[ext];
}

function formatResetTime(isoDate: string | null): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "now";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ${diffMin % 60}m`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ${diffHr % 24}h`;
}

function formatUsagePercent(percent: number | null): string {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return "--";
  }
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function usagePercentToWidth(percent: number | null): string {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return "0%";
  }
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

export function ChatPanel() {
  const renderStartedAtRef = useRef(performance.now());
  renderStartedAtRef.current = performance.now();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isFileDropOver, setIsFileDropOver] = useState(false);
  const [planMode, setPlanMode] = useState(false);
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
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    send,
    cancel,
    respondApproval,
    hydrateActionOutput,
    streaming,
    usageLimits,
    error,
    setActiveThread: bindChatThread,
    threadId,
  } = useChatStore();
  const messageFocusTarget = useUiStore((s) => s.messageFocusTarget);
  const clearMessageFocusTarget = useUiStore((s) => s.clearMessageFocusTarget);
  const showSidebar = useUiStore((s) => s.showSidebar);
  const engines = useEngineStore((s) => s.engines);
  const health = useEngineStore((s) => s.health);
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
  const chatSectionRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const effortSyncKeyRef = useRef<string | null>(null);
  const manuallyOverrodeThreadSelectionRef = useRef(false);
  const lastSyncedThreadIdRef = useRef<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const prependLoadInFlightRef = useRef(false);
  const threadActivatedAtRef = useRef(0);
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
    attachments: ChatAttachment[];
    planMode: boolean;
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

  // All models from other engines, grouped by engine name
  const otherEngineGroups = useMemo(() => {
    return engines
      .filter((e) => e.id !== selectedEngineId)
      .map((engine) => ({
        label: engine.name,
        options: engine.models
          .filter((m) => !m.hidden)
          .map((model) => ({
            value: encodeModelOptionValue(engine.id, model.id),
            label: formatEngineModelLabel(engine.name, model.displayName),
          })),
      }))
      .filter((g) => g.options.length > 0);
  }, [engines, selectedEngineId]);

  const selectedModel = useMemo(
    () => availableModels.find((model) => model.id === selectedModelId) ?? availableModels[0] ?? null,
    [availableModels, selectedModelId],
  );

  const supportedEfforts = useMemo(
    () => selectedModel?.supportedReasoningEfforts ?? [],
    [selectedModel],
  );
  const selectedReasoningEffort = useMemo(
    () => supportedEfforts.some((option) => option.reasoningEffort === selectedEffort)
      ? selectedEffort
      : null,
    [selectedEffort, supportedEfforts],
  );
  const activeThreadReasoningEffort =
    typeof activeThread?.engineMetadata?.reasoningEffort === "string"
      ? activeThread.engineMetadata.reasoningEffort
      : undefined;
  const modelPickerLabel = useMemo(() => {
    return formatEngineModelLabel(selectedEngine?.name, selectedModel?.displayName);
  }, [selectedEngine?.name, selectedModel?.displayName]);
  const selectedModelOptionValue = useMemo(() => {
    if (!selectedEngineId || !selectedModelId) {
      return "";
    }
    return encodeModelOptionValue(selectedEngineId, selectedModelId);
  }, [selectedEngineId, selectedModelId]);

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
      engineId: messageEngineId,
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

  const appendAttachmentsFromPaths = useCallback((paths: string[]) => {
    if (!activeWorkspaceId || paths.length === 0) {
      return;
    }

    let nextAttachments: ChatAttachment[] = [];
    for (const rawPath of paths) {
      const normalizedPath = rawPath.trim();
      if (!normalizedPath) {
        continue;
      }
      const fileName = fileNameFromPath(normalizedPath);
      nextAttachments.push({
        id: crypto.randomUUID(),
        fileName,
        filePath: normalizedPath,
        sizeBytes: 0,
        mimeType: guessMimeType(fileName),
      });
    }

    const attachmentFilterConfig = getAttachmentFilterConfig(selectedEngineId);
    if (attachmentFilterConfig) {
      const supportedExtensions = new Set(attachmentFilterConfig.supportedExtensions);
      const supportedAttachments = nextAttachments.filter((attachment) =>
        isSupportedAttachmentName(attachment.fileName, supportedExtensions),
      );
      const skippedCount = nextAttachments.length - supportedAttachments.length;
      if (skippedCount > 0) {
        toast.warning(attachmentFilterConfig.warningMessage);
      }
      nextAttachments = supportedAttachments;
    }

    if (nextAttachments.length === 0) {
      return;
    }

    setAttachments((prev) => {
      const knownPaths = new Set(prev.map((attachment) => attachment.filePath));
      const merged = [...prev];
      for (const attachment of nextAttachments) {
        if (knownPaths.has(attachment.filePath)) {
          continue;
        }
        knownPaths.add(attachment.filePath);
        merged.push(attachment);
      }
      return merged;
    });
  }, [activeWorkspaceId, selectedEngineId]);

  useEffect(() => {
    const attachmentFilterConfig = getAttachmentFilterConfig(selectedEngineId);
    if (!attachmentFilterConfig) {
      return;
    }

    const supportedExtensions = new Set(attachmentFilterConfig.supportedExtensions);
    setAttachments((prev) => {
      const supportedAttachments = prev.filter((attachment) =>
        isSupportedAttachmentName(attachment.fileName, supportedExtensions),
      );
      if (supportedAttachments.length === prev.length) {
        return prev;
      }
      toast.warning(attachmentFilterConfig.warningMessage);
      return supportedAttachments;
    });
  }, [selectedEngineId]);

  const isDropPositionInsideChatSection = useCallback((x: number, y: number): boolean => {
    const container = chatSectionRef.current;
    if (!container) {
      return false;
    }
    const rect = container.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

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
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const bindDropListener = async () => {
      try {
        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          if (disposed) {
            return;
          }

          if (!activeWorkspaceId) {
            setIsFileDropOver(false);
            return;
          }

          if (event.payload.type === "leave") {
            setIsFileDropOver(false);
            return;
          }

          const scale = window.devicePixelRatio || 1;
          const logicalX = event.payload.position.x / scale;
          const logicalY = event.payload.position.y / scale;
          const isInsideDropArea = isDropPositionInsideChatSection(logicalX, logicalY);

          if (event.payload.type === "drop") {
            setIsFileDropOver(false);
            if (!isInsideDropArea || event.payload.paths.length === 0) {
              return;
            }
            appendAttachmentsFromPaths(event.payload.paths);
            return;
          }

          setIsFileDropOver(isInsideDropArea);
        });
      } catch (error) {
        console.debug("drag-drop listener unavailable", error);
      }
    };

    void bindDropListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    activeWorkspaceId,
    appendAttachmentsFromPaths,
    isDropPositionInsideChatSection,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setIsFileDropOver(false);
    }
  }, [activeWorkspaceId]);

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
    if (!activeWorkspaceId || engines.length === 0) {
      return;
    }

    const engineIds = new Set<string>();
    if (selectedEngineId) {
      engineIds.add(selectedEngineId);
    }
    if (activeThread?.engineId) {
      engineIds.add(activeThread.engineId);
    }

    const cancelers = Array.from(engineIds)
      .filter((engineId) => engines.some((engine) => engine.id === engineId))
      .map((engineId) =>
        scheduleIdleTask(() => {
          void prewarmEngineTransport(engineId);
        }),
      );

    return () => {
      cancelers.forEach((cancel) => cancel());
    };
  }, [activeWorkspaceId, activeThread?.engineId, engines, selectedEngineId]);

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
      lastSyncedThreadIdRef.current = null;
      manuallyOverrodeThreadSelectionRef.current = false;
      return;
    }
    const threadChanged = lastSyncedThreadIdRef.current !== activeThread.id;
    if (!threadChanged && manuallyOverrodeThreadSelectionRef.current) {
      return;
    }
    lastSyncedThreadIdRef.current = activeThread.id;
    manuallyOverrodeThreadSelectionRef.current = false;
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

    const activeThreadInCurrentWorkspace =
      activeThread &&
      activeThread.workspaceId === activeWorkspaceId;

    const targetThreadId = activeThreadInCurrentWorkspace ? activeThread.id : null;
    if (targetThreadId === threadId) {
      return;
    }

    if (!activeThreadInCurrentWorkspace) {
      setActiveThreadInStore(null);
    }
    void bindChatThread(targetThreadId);
  }, [
    activeWorkspaceId,
    activeThread?.id,
    activeThread?.workspaceId,
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
    threadActivatedAtRef.current = performance.now();
    prependLoadInFlightRef.current = false;
  }, [threadId]);

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
    const viewport = viewportRef.current;
    if (!viewport || !threadId || !hasOlderMessages || loadingOlderMessages) {
      return;
    }
    if (performance.now() - threadActivatedAtRef.current < 700) {
      return;
    }
    if (viewportScrollTop > 80 || prependLoadInFlightRef.current) {
      return;
    }

    prependLoadInFlightRef.current = true;
    const previousScrollHeight = viewport.scrollHeight;
    void loadOlderMessages()
      .then(() => {
        window.requestAnimationFrame(() => {
          const latestViewport = viewportRef.current;
          if (!latestViewport) {
            return;
          }
          const nextScrollHeight = latestViewport.scrollHeight;
          const delta = nextScrollHeight - previousScrollHeight;
          if (delta > 0) {
            latestViewport.scrollTop = latestViewport.scrollTop + delta;
          }
        });
      })
      .finally(() => {
        prependLoadInFlightRef.current = false;
      });
  }, [
    hasOlderMessages,
    loadOlderMessages,
    loadingOlderMessages,
    threadId,
    viewportScrollTop,
  ]);

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
      if (hasOlderMessages && !loadingOlderMessages && !prependLoadInFlightRef.current) {
        prependLoadInFlightRef.current = true;
        void loadOlderMessages().finally(() => {
          prependLoadInFlightRef.current = false;
        });
      }
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
  }, [
    clearMessageFocusTarget,
    hasOlderMessages,
    loadOlderMessages,
    loadingOlderMessages,
    messageFocusTarget,
    messages,
    threadId,
  ]);

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
          attachments: [...attachments],
          planMode,
          engineId: selectedEngineId,
          modelId: selectedModelId!,
          effort: selectedReasoningEffort,
        });
        return;
      }
    }

    const text = input.trim();
    const currentAttachments = [...attachments];

    if (selectedReasoningEffort) {
      await ipc.setThreadReasoningEffort(targetThreadId, selectedReasoningEffort, selectedModelId);
      setThreadReasoningEffortLocal(targetThreadId, selectedReasoningEffort);
    }
    setThreadLastModelLocal(targetThreadId, selectedModelId);

    const sent = await send(text, {
      threadIdOverride: targetThreadId,
      engineId: selectedEngineId,
      modelId: selectedModelId,
      reasoningEffort: selectedReasoningEffort,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      planMode,
    });
    if (sent) {
      setInput("");
      setAttachments([]);
    }
  }

  async function executeWorkspaceOptInSend() {
    const prompt = workspaceOptInPrompt;
    if (!prompt) return;
    setWorkspaceOptInPrompt(null);

    try {
      await ipc.confirmWorkspaceThread(prompt.threadId, prompt.threadPaths);

      if (prompt.effort) {
        await ipc.setThreadReasoningEffort(prompt.threadId, prompt.effort, prompt.modelId);
        setThreadReasoningEffortLocal(prompt.threadId, prompt.effort);
      }
      setThreadLastModelLocal(prompt.threadId, prompt.modelId);

      const sent = await send(prompt.text, {
        threadIdOverride: prompt.threadId,
        engineId: prompt.engineId,
        modelId: prompt.modelId,
        reasoningEffort: prompt.effort,
        attachments: prompt.attachments.length > 0 ? prompt.attachments : undefined,
        planMode: prompt.planMode,
      });
      if (!sent) {
        setInput(prompt.text);
        setAttachments(prompt.attachments);
        return;
      }

      setInput("");
      setAttachments([]);

      await refreshThreads(prompt.workspaceId);
    } catch {
      setInput(prompt.text);
      setAttachments(prompt.attachments);
    }
  }

  async function onReasoningEffortChange(nextEffort: string) {
    setSelectedEffort(nextEffort);
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

  async function handleAddAttachment() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const attachmentFilterConfig = getAttachmentFilterConfig(selectedEngineId);
      const selected = await open({
        multiple: true,
        title: attachmentFilterConfig?.title ?? "Attach files",
        filters: attachmentFilterConfig
          ? [
              {
                name: "Supported files",
                extensions: attachmentFilterConfig.supportedExtensions,
              },
              {
                name: "Images",
                extensions: attachmentFilterConfig.imageExtensions,
              },
              {
                name: "Text files",
                extensions: attachmentFilterConfig.textExtensions,
              },
            ]
          : undefined,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      appendAttachmentsFromPaths(paths);
    } catch {
      // User cancelled or dialog failed
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
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

  const handleLoadActionOutput = useCallback(
    (messageId: string, actionId: string) => hydrateActionOutput(messageId, actionId),
    [hydrateActionOutput],
  );

  const assistantIdentityByMessageId = useMemo(() => {
    const identityByMessageId = new Map<string, { label: string; engineId: string }>();
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
  // Set refs during render (not in an effect) so the conditional mount below
  // sees the updated value in the same render pass that triggers it.
  if ((layoutMode === "split" || layoutMode === "terminal") && activeWorkspaceId) {
    hasTerminalMountedRef.current = true;
  }
  if (layoutMode === "editor" && activeWorkspaceId) {
    hasEditorMountedRef.current = true;
  }

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
        background: "var(--content-bg)",
      }}
    >
      {/* ── Top Header Bar ── */}
      <div
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          height: 46,
          padding: "0 16px",
          paddingLeft: showSidebar ? 16 : 80,
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {/* Breadcrumb: workspace / thread title / +N files */}
        <div className="no-drag" style={{ flex: 1, display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}>
          {workspaceName && (
            <>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {workspaceName}
              </span>
              <span style={{ fontSize: 12, color: "var(--border)", margin: "0 6px", flexShrink: 0 }}>/</span>
            </>
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
              {activeThread?.title || (
                layoutMode === "terminal" ? "Terminal"
                : layoutMode === "editor" ? "File Editor"
                : layoutMode === "split" ? "New Chat"
                : "New Chat"
              )}
            </button>
          )}
          {totalAdded > 0 && (
            <>
              <span style={{ fontSize: 12, color: "var(--border)", margin: "0 6px", flexShrink: 0 }}>/</span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: '"JetBrains Mono", monospace',
                  color: "var(--warning)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                +{totalAdded} files
              </span>
            </>
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
        </div>
      </div>

      <div ref={contentAreaRef} className="chat-terminal-content">
        {/* Chat section */}
        <div
          ref={chatSectionRef}
          className="chat-section"
          style={{
            flex: (layoutMode === "terminal" || layoutMode === "editor") ? "0 0 0px"
                 : layoutMode === "chat" ? "1 1 0px"
                 : `0 0 ${100 - terminalPanelSize}%`,
            position: "relative",
            overflow: "hidden",
            visibility: (layoutMode === "terminal" || layoutMode === "editor") ? "hidden" : "visible",
            display: "flex",
            flexDirection: "column",
            outline: isFileDropOver ? "2px dashed rgba(96, 165, 250, 0.7)" : "none",
            outlineOffset: isFileDropOver ? "-8px" : undefined,
          }}
        >
            {isFileDropOver && (
              <div
                style={{
                  position: "absolute",
                  inset: 12,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(96, 165, 250, 0.45)",
                  background: "rgba(96, 165, 250, 0.08)",
                  color: "var(--text-1)",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 5,
                }}
              >
                Drop files to attach
              </div>
            )}
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
                        assistantEngineId={assistantIdentity?.engineId ?? ""}
                        onApproval={handleApproval}
                        onLoadActionOutput={handleLoadActionOutput}
                      />
                    </MeasuredMessageRow>
                  );
                })}
            </div>

            {virtualWindow.bottomSpacerHeight > 0 && (
              <div style={{ height: virtualWindow.bottomSpacerHeight }} />
            )}
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
                  assistantEngineId={assistantIdentity?.engineId ?? ""}
                  onApproval={handleApproval}
                  onLoadActionOutput={handleLoadActionOutput}
                />
              );
            })}
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
              border: streaming ? "1px solid rgba(96, 165, 250, 0.25)" : "1px solid var(--border)",
              background: streaming ? "rgba(96, 165, 250, 0.08)" : "var(--bg-2)",
              color: streaming ? "var(--info)" : "var(--text-2)",
              fontSize: 11.5,
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
              zIndex: 2,
            }}
          >
            {streaming && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--info)",
                  animation: "pulse-soft 1.5s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
            )}
            {streaming ? "New activity" : "Jump to latest"}
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
              <div className="approval-header">
                <span className="approval-header-icon">
                  <Shield size={11} />
                </span>
                <span className="approval-header-title">
                  Approval required
                </span>
                <span className="approval-header-spacer" />
                {activeRepo && activeRepo.trustLevel !== "trusted" && (
                  <button
                    type="button"
                    className="approval-trust-btn"
                    onClick={() => void onRepoTrustLevelChange("trusted")}
                    title="Set trusted policy for this repo (on-request approvals, network requested enabled)"
                  >
                    Trust repo
                  </button>
                )}
                {!activeRepo && repos.length > 0 && workspaceTrustLevel !== "trusted" && (
                  <button
                    type="button"
                    className="approval-trust-btn"
                    onClick={() => void onWorkspaceTrustLevelChange("trusted")}
                    title="Set trusted policy for all repositories (on-request approvals, network requested enabled)"
                  >
                    Trust workspace
                  </button>
                )}
              </div>

              <div className="approval-rows">
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
                      <div className="approval-row-info">
                        <div
                          className="approval-row-summary"
                          title={approval.summary}
                        >
                          {approval.summary}
                        </div>
                        {(command || reason) && (
                          <div
                            className="approval-row-detail"
                            title={command ?? reason}
                          >
                            {command ?? reason}
                          </div>
                        )}
                      </div>

                      <div className="approval-actions">
                        {isToolInputRequest || requiresCustomPayload ? (
                          <span className="approval-row-hint">
                            {isToolInputRequest
                              ? "Respond in the approval card below."
                              : "This request requires custom JSON. Respond in the approval card below."}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="approval-btn approval-btn-cancel"
                              onClick={() =>
                                void respondApproval(approval.approvalId, { decision: "cancel" })
                              }
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="approval-btn approval-btn-deny"
                              onClick={() =>
                                void respondApproval(approval.approvalId, {
                                  decision: "decline",
                                })
                              }
                            >
                              Deny
                            </button>
                            <span className="approval-actions-gap" />
                            <button
                              type="button"
                              className="approval-btn approval-btn-session"
                              onClick={() =>
                                void respondApproval(approval.approvalId, {
                                  decision: "accept_for_session",
                                })
                              }
                            >
                              Allow session
                            </button>
                            {proposedExecpolicyAmendment.length > 0 && (
                              <button
                                type="button"
                                className="approval-btn approval-btn-session"
                                onClick={() =>
                                  void respondApproval(approval.approvalId, {
                                    acceptWithExecpolicyAmendment: {
                                      execpolicy_amendment: proposedExecpolicyAmendment,
                                    },
                                  })
                                }
                              >
                                Allow + policy
                              </button>
                            )}
                            <button
                              type="button"
                              className="approval-btn approval-btn-allow"
                              onClick={() =>
                                void respondApproval(approval.approvalId, { decision: "accept" })
                              }
                            >
                              Allow
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
          <div className={`chat-input-box ${planMode ? "chat-input-box-plan" : ""}`}>
            {/* Plan mode indicator banner */}
            {planMode && (
              <div className="chat-plan-mode-banner">
                <ListChecks size={12} />
                <span>Plan Mode — The agent will plan before executing</span>
              </div>
            )}

            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div className="chat-attachments-bar">
                {attachments.map((attachment) => {
                  const IconComponent = getAttachmentIcon(attachment.mimeType);
                  return (
                    <div key={attachment.id} className="chat-attachment-chip">
                      <IconComponent size={12} />
                      <span className="chat-attachment-chip-name">{attachment.fileName}</span>
                      {attachment.sizeBytes > 0 && (
                        <span className="chat-attachment-chip-size">
                          {formatFileSize(attachment.sizeBytes)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="chat-attachment-chip-remove"
                        onClick={() => removeAttachment(attachment.id)}
                        title="Remove attachment"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

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
                if (e.shiftKey && e.key === "Tab") {
                  e.preventDefault();
                  if (activeWorkspaceId) {
                    setPlanMode((prev) => !prev);
                  }
                }
              }}
              placeholder={planMode ? "Describe what you want to plan..." : "Ask for follow-up changes"}
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
                caretColor: planMode ? "var(--accent-2)" : "var(--accent)",
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
              {/* Attach file button */}
              <button
                type="button"
                className="chat-toolbar-btn"
                onClick={() => void handleAddAttachment()}
                disabled={!activeWorkspaceId}
                title="Attach files"
              >
                <Plus size={12} />
                {attachments.length > 0 && (
                  <span className="chat-toolbar-badge">{attachments.length}</span>
                )}
              </button>

              {/* Plan mode toggle */}
              <button
                type="button"
                className={`chat-toolbar-btn chat-toolbar-btn-bordered ${planMode ? "chat-toolbar-btn-active" : ""}`}
                onClick={() => setPlanMode((prev) => !prev)}
                disabled={!activeWorkspaceId}
                title={planMode ? "Disable plan mode (Shift+Tab)" : "Enable plan mode (Shift+Tab)"}
              >
                <ListChecks size={12} />
                <span style={{ fontSize: 11 }}>Plan</span>
              </button>

              <div className="chat-toolbar-divider" />

              {/* Engine + Model + Effort selector */}
              <ModelPicker
                engines={engines}
                health={health}
                selectedEngineId={selectedEngineId}
                selectedModelId={selectedModelId ?? selectedModel?.id ?? ""}
                selectedEffort={selectedEffort}
                onEngineModelChange={(engineId, modelId) => {
                  manuallyOverrodeThreadSelectionRef.current = true;
                  if (engineId !== selectedEngineId) setSelectedEngineId(engineId);
                  setSelectedModelId(modelId);
                }}
                onEffortChange={(effort) => void onReasoningEffortChange(effort)}
                disabled={availableModels.length === 0}
              />

              <div className="chat-toolbar-divider" />

              {/* Trust level dropdown */}
              {activeRepo && (
                <Dropdown
                  value={activeRepo.trustLevel}
                  onChange={(v) => void onRepoTrustLevelChange(v as TrustLevel)}
                  title="Execution policy"
                  options={[
                    { value: "trusted", label: "trusted (on-request, net requested on)" },
                    { value: "standard", label: "standard (on-request, net requested off)" },
                    { value: "restricted", label: "restricted (untrusted: safe cmds only)" },
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
                    { value: "trusted", label: "trusted (on-request, net requested on)" },
                    { value: "standard", label: "standard (on-request, net requested off)" },
                    { value: "restricted", label: "restricted (untrusted: safe cmds only)" },
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

          {/* Bottom status bar with context usage */}
          <div className="chat-status-bar">
            {messages.length > 0 && selectedEngineId === "codex" && (
              usageLimits ? (
                <>
                  <div className="chat-context-section">
                    <Zap size={10} />
                    <span>Context</span>
                    <div className="chat-context-progress">
                      <div
                        className="chat-context-progress-fill"
                        style={{ width: usagePercentToWidth(usageLimits.contextPercent) }}
                      />
                    </div>
                    <span className="chat-context-percent">
                      {formatUsagePercent(usageLimits.contextPercent)}
                    </span>
                  </div>

                  <span className="chat-context-divider">&middot;</span>

                  <div className="chat-context-section">
                    <Clock size={10} />
                    <span>5h left</span>
                    <div className="chat-context-progress">
                      <div
                        className="chat-context-progress-fill chat-context-progress-fill-5h"
                        style={{ width: usagePercentToWidth(usageLimits.windowFiveHourPercent) }}
                      />
                    </div>
                    <span className="chat-context-percent">
                      {formatUsagePercent(usageLimits.windowFiveHourPercent)}
                    </span>
                    {usageLimits.windowFiveHourResetsAt && (
                      <span className="chat-context-reset">
                        resets {formatResetTime(usageLimits.windowFiveHourResetsAt)}
                      </span>
                    )}
                  </div>

                  <span className="chat-context-divider">&middot;</span>

                  <div className="chat-context-section">
                    <Clock size={10} />
                    <span>Weekly left</span>
                    <div className="chat-context-progress">
                      <div
                        className="chat-context-progress-fill chat-context-progress-fill-weekly"
                        style={{ width: usagePercentToWidth(usageLimits.windowWeeklyPercent) }}
                      />
                    </div>
                    <span className="chat-context-percent">
                      {formatUsagePercent(usageLimits.windowWeeklyPercent)}
                    </span>
                    {usageLimits.windowWeeklyResetsAt && (
                      <span className="chat-context-reset">
                        resets {formatResetTime(usageLimits.windowWeeklyResetsAt)}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="chat-context-section">
                  <Clock size={10} />
                  <span>Usage limits unavailable from server</span>
                </div>
              )
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
