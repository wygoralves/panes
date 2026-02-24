import { create } from "zustand";
import { ipc, listenThreadEvents } from "../lib/ipc";
import { recordPerfMetric } from "../lib/perfTelemetry";
import type {
  ApprovalResponse,
  ActionBlock,
  ApprovalBlock,
  ChatAttachment,
  ContentBlock,
  ContextUsage,
  Message,
  StreamEvent,
  ThreadStatus
} from "../types";

interface ChatState {
  threadId: string | null;
  messages: Message[];
  status: ThreadStatus;
  streaming: boolean;
  usageLimits: ContextUsage | null;
  error?: string;
  unlisten?: () => void;
  setActiveThread: (threadId: string | null) => Promise<void>;
  send: (
    message: string,
    options?: {
      threadIdOverride?: string;
      modelId?: string | null;
      engineId?: string | null;
      reasoningEffort?: string | null;
      attachments?: ChatAttachment[];
      planMode?: boolean;
    },
  ) => Promise<boolean>;
  cancel: () => Promise<void>;
  respondApproval: (approvalId: string, response: ApprovalResponse) => Promise<void>;
  hydrateActionOutput: (messageId: string, actionId: string) => Promise<void>;
}

let activeThreadBindSeq = 0;
const STREAM_EVENT_BATCH_WINDOW_MS = 16;
const MESSAGE_WINDOW_INITIAL_LIMIT = 120;
const MESSAGE_WINDOW_MAX_PAGES = 1000;
const MAX_FULLY_HYDRATED_MESSAGES = 80;
const ACTION_OUTPUT_MAX_CHARS = 180_000;
const ACTION_OUTPUT_TRIM_TARGET_CHARS = 120_000;
const ACTION_OUTPUT_MAX_CHUNKS = 240;
const pendingTurnMetaByThread = new Map<
  string,
  {
    turnEngineId?: string | null;
    turnModelId?: string | null;
    turnReasoningEffort?: string | null;
  }
>();
const inflightActionOutputHydration = new Map<string, Promise<void>>();

function resolveApprovalDecision(response: ApprovalResponse): ApprovalBlock["decision"] {
  if ("decision" in response && typeof response.decision === "string") {
    return String(response.decision) as ApprovalBlock["decision"];
  }
  return "custom";
}

function trimActionOutputChunks(
  chunks: ActionBlock["outputChunks"],
): {
  chunks: ActionBlock["outputChunks"];
  truncated: boolean;
} {
  if (chunks.length === 0) {
    return { chunks, truncated: false };
  }

  let nextChunks = chunks;
  let truncated = false;

  if (nextChunks.length > ACTION_OUTPUT_MAX_CHUNKS) {
    nextChunks = nextChunks.slice(nextChunks.length - ACTION_OUTPUT_MAX_CHUNKS);
    truncated = true;
  }

  let totalChars = 0;
  for (const chunk of nextChunks) {
    totalChars += chunk.content.length;
  }

  if (totalChars <= ACTION_OUTPUT_MAX_CHARS) {
    return { chunks: nextChunks, truncated };
  }

  truncated = true;
  let charsToTrim = totalChars - ACTION_OUTPUT_TRIM_TARGET_CHARS;
  const trimmedChunks = [...nextChunks];
  let startIndex = 0;

  while (charsToTrim > 0 && startIndex < trimmedChunks.length) {
    const currentChunk = trimmedChunks[startIndex];
    const currentLength = currentChunk.content.length;
    if (currentLength <= charsToTrim) {
      charsToTrim -= currentLength;
      startIndex += 1;
      continue;
    }
    trimmedChunks[startIndex] = {
      ...currentChunk,
      content: currentChunk.content.slice(charsToTrim),
    };
    charsToTrim = 0;
  }

  return {
    chunks: trimmedChunks.slice(startIndex),
    truncated,
  };
}

function patchActionBlock(
  blocks: ContentBlock[],
  actionId: string,
  updater: (block: ActionBlock) => ActionBlock,
): ContentBlock[] {
  const blockIndex = blocks.findIndex(
    (block) => block.type === "action" && block.actionId === actionId,
  );
  if (blockIndex < 0) {
    return blocks;
  }

  const current = blocks[blockIndex] as ActionBlock;
  const nextBlock = updater(current);
  if (nextBlock === current) {
    return blocks;
  }

  const nextBlocks = [...blocks];
  nextBlocks[blockIndex] = nextBlock;
  return nextBlocks;
}

function ensureAssistantMessage(messages: Message[], threadId: string): Message[] {
  const existing = messages[messages.length - 1];
  if (existing && existing.role === "assistant" && existing.status === "streaming") {
    return messages;
  }

  const pendingTurnMeta = pendingTurnMetaByThread.get(threadId);
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      threadId,
      role: "assistant",
      turnEngineId: pendingTurnMeta?.turnEngineId ?? null,
      turnModelId: pendingTurnMeta?.turnModelId ?? null,
      turnReasoningEffort: pendingTurnMeta?.turnReasoningEffort ?? null,
      status: "streaming",
      schemaVersion: 1,
      blocks: [],
      createdAt: new Date().toISOString(),
      hydration: "full",
      hasDeferredContent: false,
    }
  ];
}

function upsertBlock(blocks: ContentBlock[], block: ContentBlock): ContentBlock[] {
  if (block.type === "action") {
    const idx = blocks.findIndex(
      (b) => b.type === "action" && (b as ActionBlock).actionId === block.actionId
    );
    if (idx >= 0) {
      const next = [...blocks];
      next[idx] = block;
      return next;
    }
  }

  if (block.type === "approval") {
    const idx = blocks.findIndex(
      (b) => b.type === "approval" && (b as ApprovalBlock).approvalId === block.approvalId
    );
    if (idx >= 0) {
      const next = [...blocks];
      next[idx] = block;
      return next;
    }
  }

  return [...blocks, block];
}

function normalizeBlocks(blocks?: ContentBlock[]): ContentBlock[] | undefined {
  if (!Array.isArray(blocks)) {
    return blocks;
  }

  const normalized: ContentBlock[] = [];
  for (const block of blocks) {
    const last = normalized[normalized.length - 1];
    if (block.type === "text" && last?.type === "text") {
      normalized[normalized.length - 1] = {
        ...last,
        content: `${last.content}${block.content ?? ""}`
      };
      continue;
    }
    if (block.type === "thinking" && last?.type === "thinking") {
      normalized[normalized.length - 1] = {
        ...last,
        content: `${last.content}${block.content ?? ""}`
      };
      continue;
    }
    normalized.push(block);
  }

  return normalized;
}

function hasDeferredActionOutput(blocks?: ContentBlock[]): boolean {
  if (!Array.isArray(blocks)) {
    return false;
  }
  return blocks.some((block) => block.type === "action" && block.outputDeferred === true);
}

function markMessageAsFullyHydrated(message: Message): Message {
  const hasDeferredContent = hasDeferredActionOutput(message.blocks);
  if (message.hydration === "full" && message.hasDeferredContent === hasDeferredContent) {
    return message;
  }

  return {
    ...message,
    hydration: "full",
    hasDeferredContent,
  };
}

function summarizeActionBlockForMemory(block: ActionBlock): ActionBlock {
  const hasOutput =
    block.outputChunks.length > 0 ||
    (typeof block.result?.output === "string" && block.result.output.length > 0) ||
    block.outputDeferred === true;
  if (!hasOutput) {
    return block;
  }

  let nextResult = block.result;
  if (block.result && typeof block.result.output === "string") {
    nextResult = {
      ...block.result,
      output: undefined,
    };
  }

  if (
    block.outputDeferred === true &&
    block.outputDeferredLoaded === false &&
    block.outputChunks.length === 0 &&
    nextResult === block.result
  ) {
    return block;
  }

  return {
    ...block,
    outputChunks: [],
    outputDeferred: true,
    outputDeferredLoaded: false,
    result: nextResult,
  };
}

function summarizeMessageForMemory(message: Message): Message {
  const sourceBlocks = message.blocks;
  let nextBlocks = sourceBlocks;

  if (Array.isArray(sourceBlocks) && sourceBlocks.length > 0) {
    for (let index = 0; index < sourceBlocks.length; index += 1) {
      const block = sourceBlocks[index];
      if (block.type !== "action") {
        continue;
      }

      const summarizedBlock = summarizeActionBlockForMemory(block);
      if (summarizedBlock === block) {
        continue;
      }

      if (nextBlocks === sourceBlocks) {
        nextBlocks = [...sourceBlocks];
      }
      (nextBlocks as ContentBlock[])[index] = summarizedBlock;
    }
  }

  const hasDeferredContent = hasDeferredActionOutput(nextBlocks);
  if (
    nextBlocks === sourceBlocks &&
    message.hydration === "summary" &&
    message.hasDeferredContent === hasDeferredContent
  ) {
    return message;
  }

  return {
    ...message,
    hydration: "summary",
    hasDeferredContent,
    blocks: nextBlocks,
  };
}

function applyHydrationWindow(messages: Message[]): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  const summarizeUntil = Math.max(0, messages.length - MAX_FULLY_HYDRATED_MESSAGES);
  let changed = false;
  const nextMessages = messages.map((message, index) => {
    const nextMessage =
      index < summarizeUntil
        ? summarizeMessageForMemory(message)
        : message.hydration === "summary"
          ? message
          : markMessageAsFullyHydrated(message);
    if (nextMessage !== message) {
      changed = true;
    }
    return nextMessage;
  });

  return changed ? nextMessages : messages;
}

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    const normalizedBlocks = normalizeBlocks(message.blocks);
    return markMessageAsFullyHydrated({
      ...message,
      content:
        message.role === "user" && normalizedBlocks && typeof message.content === "string"
          ? undefined
          : message.content,
      blocks: normalizedBlocks,
    });
  });
}

function toIsoTimestamp(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function mapUsageLimitsFromEvent(event: Extract<StreamEvent, { type: "UsageLimitsUpdated" }>): ContextUsage | null {
  const usage = event.usage ?? {};
  const currentTokensRaw = usage.current_tokens;
  const maxContextTokensRaw = usage.max_context_tokens;
  const contextPercentRaw = usage.context_window_percent;
  const fiveHourPercentRaw = usage.five_hour_percent;
  const weeklyPercentRaw = usage.weekly_percent;

  const currentTokens =
    typeof currentTokensRaw === "number" ? Math.max(0, Math.round(currentTokensRaw)) : null;
  const maxContextTokens =
    typeof maxContextTokensRaw === "number" ? Math.max(0, Math.round(maxContextTokensRaw)) : null;
  const hasContextMetrics = currentTokens !== null || maxContextTokens !== null;

  let contextPercent = typeof contextPercentRaw === "number" ? Math.round(contextPercentRaw) : null;
  if (contextPercent !== null && !Number.isFinite(contextPercent)) {
    contextPercent = null;
  }
  if (
    contextPercent === null &&
    currentTokens !== null &&
    maxContextTokens !== null &&
    maxContextTokens > 0
  ) {
    contextPercent = Math.round((currentTokens / maxContextTokens) * 100);
  }

  const hasAnyMetric =
    hasContextMetrics ||
    typeof contextPercentRaw === "number" ||
    typeof fiveHourPercentRaw === "number" ||
    typeof weeklyPercentRaw === "number";
  if (!hasAnyMetric) {
    return null;
  }

  // Codex reports `usedPercent`; UI shows remaining budget.
  const toRemainingPercent = (
    usedPercent: number | null | undefined,
  ): number | null => {
    if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
      return null;
    }
    const used = Math.max(0, Math.min(100, Math.round(usedPercent)));
    return 100 - used;
  };

  return {
    currentTokens,
    maxContextTokens,
    contextPercent:
      contextPercent === null ? null : Math.max(0, Math.min(100, contextPercent)),
    windowFiveHourPercent: toRemainingPercent(fiveHourPercentRaw),
    windowWeeklyPercent: toRemainingPercent(weeklyPercentRaw),
    windowFiveHourResetsAt: toIsoTimestamp(usage.five_hour_resets_at),
    windowWeeklyResetsAt: toIsoTimestamp(usage.weekly_resets_at),
  };
}

function applyStreamEvent(messages: Message[], event: StreamEvent, threadId: string): Message[] {
  if (event.type === "UsageLimitsUpdated") {
    return messages;
  }

  let next = ensureAssistantMessage(messages, threadId);
  const currentAssistant = next[next.length - 1];
  const assistant: Message = { ...currentAssistant };
  const existingBlocks = currentAssistant.blocks ?? [];
  assistant.blocks = existingBlocks;

  if (event.type === "TextDelta") {
    const blocks = assistant.blocks ?? [];
    const delta = String(event.content ?? "");
    if (!delta) {
      return next;
    }
    const last = blocks[blocks.length - 1];
    if (last?.type === "text") {
      assistant.blocks = [
        ...blocks.slice(0, -1),
        {
          ...last,
          content: `${last.content}${delta}`,
        },
      ];
    } else {
      assistant.blocks = [...blocks, { type: "text", content: delta }];
    }
  }

  if (event.type === "ThinkingDelta") {
    const blocks = assistant.blocks ?? [];
    const delta = String(event.content ?? "");
    if (!delta) {
      return next;
    }
    const last = blocks[blocks.length - 1];
    if (last?.type === "thinking") {
      assistant.blocks = [
        ...blocks.slice(0, -1),
        {
          ...last,
          content: `${last.content}${delta}`,
        },
      ];
    } else {
      assistant.blocks = [...blocks, { type: "thinking", content: delta }];
    }
  }

  if (event.type === "ActionStarted") {
    const blocks = assistant.blocks ?? [];
    assistant.blocks = upsertBlock(blocks, {
      type: "action",
      actionId: String(event.action_id),
      engineActionId: event.engine_action_id as string | undefined,
      actionType: String(event.action_type ?? "other") as ActionBlock["actionType"],
      summary: String(event.summary ?? ""),
      details: (event.details as Record<string, unknown>) ?? {},
      outputChunks: [],
      outputDeferred: false,
      outputDeferredLoaded: true,
      status: "running"
    });
  }

  if (event.type === "ActionOutputDelta") {
    const actionId = String(event.action_id ?? "");
    const stream = String(event.stream ?? "stdout") as "stdout" | "stderr";
    const content = String(event.content ?? "");
    if (actionId && content) {
      const blocks = assistant.blocks ?? [];
      assistant.blocks = patchActionBlock(blocks, actionId, (block) => {
        const details = (block.details ?? {}) as Record<string, unknown>;
        const previousChunk = block.outputChunks[block.outputChunks.length - 1];
        const mergedChunks =
          previousChunk && previousChunk.stream === stream
            ? [
                ...block.outputChunks.slice(0, -1),
                {
                  ...previousChunk,
                  content: `${previousChunk.content}${content}`,
                },
              ]
            : [
                ...block.outputChunks,
                {
                  stream,
                  content,
                },
              ];
        const { chunks: nextOutputChunks, truncated } = trimActionOutputChunks(mergedChunks);
        const shouldMarkTruncated =
          truncated &&
          !("outputTruncated" in details && details.outputTruncated === true);
        const nextDetails = shouldMarkTruncated
          ? {
              ...details,
              outputTruncated: true,
            }
          : details;

        if (nextOutputChunks === block.outputChunks && nextDetails === block.details) {
          return block;
        }

        return {
          ...block,
          outputChunks: nextOutputChunks,
          details: nextDetails,
          outputDeferred: false,
          outputDeferredLoaded: true,
        };
      });
    }
  }

  if (event.type === "ActionCompleted") {
    const blocks = assistant.blocks ?? [];
    const actionId = String(event.action_id ?? "");
    assistant.blocks = patchActionBlock(blocks, actionId, (block) => {
      const result = (event.result as Record<string, unknown> | undefined) ?? {};
      return {
        ...block,
        status: result.success ? "done" : "error",
        result: {
          success: Boolean(result.success),
          output: result.output as string | undefined,
          error: result.error as string | undefined,
          diff: result.diff as string | undefined,
          durationMs: Number(result.durationMs ?? result.duration_ms ?? 0)
        }
      };
    });
  }

  if (event.type === "ApprovalRequested") {
    const blocks = assistant.blocks ?? [];
    assistant.blocks = upsertBlock(blocks, {
      type: "approval",
      approvalId: String(event.approval_id),
      actionType: String(event.action_type ?? "other") as ApprovalBlock["actionType"],
      summary: String(event.summary ?? ""),
      details: (event.details as Record<string, unknown>) ?? {},
      status: "pending"
    });
  }

  if (event.type === "DiffUpdated") {
    const blocks = assistant.blocks ?? [];
    const scope = String(event.scope ?? "turn") as "turn" | "file" | "workspace";
    const diff = String(event.diff ?? "");

    let existingDiffIndex = -1;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.type === "diff" && block.scope === scope) {
        existingDiffIndex = index;
        break;
      }
    }

    if (existingDiffIndex >= 0) {
      const existingBlock = blocks[existingDiffIndex];
      if (existingBlock.type === "diff" && existingBlock.diff !== diff) {
        const nextBlocks = [...blocks];
        nextBlocks[existingDiffIndex] = {
          ...existingBlock,
          diff,
        };
        assistant.blocks = nextBlocks;
      }
    } else {
      assistant.blocks = [
        ...blocks,
        {
          type: "diff",
          diff,
          scope,
        },
      ];
    }
  }

  if (event.type === "Error") {
    const blocks = assistant.blocks ?? [];
    assistant.blocks = [...blocks, { type: "error", message: String(event.message ?? "Unknown error") }];
    if (!event.recoverable) {
      assistant.status = "error";
    }
  }

  if (event.type === "TurnCompleted") {
    const status = String(event.status ?? "completed");
    if (status === "failed") {
      assistant.status = "error";
    } else if (status === "interrupted") {
      assistant.status = "interrupted";
    } else {
      assistant.status = "completed";
    }
  }

  assistant.hydration = "full";
  assistant.hasDeferredContent = hasDeferredActionOutput(assistant.blocks);

  const blocksChanged = assistant.blocks !== existingBlocks;
  const statusChanged = assistant.status !== currentAssistant.status;
  const metadataChanged =
    assistant.turnEngineId !== currentAssistant.turnEngineId ||
    assistant.turnModelId !== currentAssistant.turnModelId ||
    assistant.turnReasoningEffort !== currentAssistant.turnReasoningEffort ||
    assistant.hydration !== currentAssistant.hydration ||
    assistant.hasDeferredContent !== currentAssistant.hasDeferredContent;

  if (!blocksChanged && !statusChanged && !metadataChanged) {
    return next;
  }

  next = [...next.slice(0, -1), assistant];
  return next;
}

export const useChatStore = create<ChatState>((set, get) => ({
  threadId: null,
  messages: [],
  status: "idle",
  streaming: false,
  usageLimits: null,
  setActiveThread: async (threadId) => {
    const currentThreadId = get().threadId;
    const currentUnlisten = get().unlisten;
    if (threadId && threadId === currentThreadId && currentUnlisten) {
      return;
    }

    activeThreadBindSeq += 1;
    const bindSeq = activeThreadBindSeq;

    const current = currentUnlisten;
    if (current) {
      current();
    }

    if (!threadId) {
      if (bindSeq !== activeThreadBindSeq) {
        return;
      }

      set({
        threadId: null,
        messages: [],
        streaming: false,
        status: "idle",
        usageLimits: null,
        unlisten: undefined,
      });
      return;
    }

    try {
      const messageWindow = await ipc.getThreadMessagesWindow(
        threadId,
        null,
        MESSAGE_WINDOW_INITIAL_LIMIT,
      );
      let messages = normalizeMessages(messageWindow.messages);
      let cursor = messageWindow.nextCursor;
      let loadedPages = 1;
      while (cursor && loadedPages < MESSAGE_WINDOW_MAX_PAGES) {
        if (bindSeq !== activeThreadBindSeq) {
          return;
        }
        const olderWindow = await ipc.getThreadMessagesWindow(
          threadId,
          cursor,
          MESSAGE_WINDOW_INITIAL_LIMIT,
        );
        const olderMessages = normalizeMessages(olderWindow.messages).map((message) =>
          summarizeMessageForMemory(message),
        );
        messages = [...olderMessages, ...messages];
        cursor = olderWindow.nextCursor;
        loadedPages += 1;
      }
      messages = applyHydrationWindow(messages);
      if (bindSeq !== activeThreadBindSeq) {
        return;
      }

      const queuedStreamEvents: StreamEvent[] = [];
      let streamFlushTimer: number | null = null;
      let streamFlushInProgress = false;
      let eventRateWindowStartedAt = performance.now();
      let eventRateWindowCount = 0;

      const emitEventRateMetric = (now: number) => {
        const elapsedMs = now - eventRateWindowStartedAt;
        if (elapsedMs <= 0 || eventRateWindowCount <= 0) {
          eventRateWindowStartedAt = now;
          eventRateWindowCount = 0;
          return;
        }
        const eventsPerSecond = (eventRateWindowCount * 1000) / elapsedMs;
        recordPerfMetric("chat.stream.events_per_sec", eventsPerSecond, {
          threadId,
          events: eventRateWindowCount,
          windowMs: elapsedMs,
        });
        eventRateWindowStartedAt = now;
        eventRateWindowCount = 0;
      };

      const flushQueuedStreamEvents = () => {
        if (streamFlushInProgress) {
          return;
        }
        if (streamFlushTimer !== null) {
          window.clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        if (queuedStreamEvents.length === 0) {
          return;
        }

        streamFlushInProgress = true;
        const batch = queuedStreamEvents.splice(0, queuedStreamEvents.length);
        const flushStartedAt = performance.now();
        set((state) => {
          if (bindSeq !== activeThreadBindSeq || state.threadId !== threadId) {
            return state;
          }

          let nextMessages = state.messages;
          let nextStreaming = state.streaming;
          let nextUsageLimits = state.usageLimits;
          for (const queuedEvent of batch) {
            if (queuedEvent.type === "UsageLimitsUpdated") {
              nextUsageLimits = mapUsageLimitsFromEvent(queuedEvent);
              continue;
            }
            if (queuedEvent.type === "TurnCompleted") {
              pendingTurnMetaByThread.delete(threadId);
            }
            nextMessages = applyStreamEvent(nextMessages, queuedEvent, state.threadId);
            nextStreaming = queuedEvent.type !== "TurnCompleted";
          }
          nextMessages = applyHydrationWindow(nextMessages);

          if (
            nextMessages === state.messages &&
            nextStreaming === state.streaming &&
            nextUsageLimits === state.usageLimits
          ) {
            return state;
          }

          return {
            ...state,
            messages: nextMessages,
            streaming: nextStreaming,
            usageLimits: nextUsageLimits,
          };
        });
        streamFlushInProgress = false;
        recordPerfMetric("chat.stream.flush.ms", performance.now() - flushStartedAt, {
          threadId,
          batchSize: batch.length,
        });

        if (queuedStreamEvents.length > 0) {
          scheduleStreamFlush();
        }
      };

      const scheduleStreamFlush = () => {
        if (streamFlushTimer !== null) {
          return;
        }
        streamFlushTimer = window.setTimeout(() => {
          streamFlushTimer = null;
          flushQueuedStreamEvents();
        }, STREAM_EVENT_BATCH_WINDOW_MS);
      };

      const unlistenStream = await listenThreadEvents(threadId, (event) => {
        if (bindSeq !== activeThreadBindSeq) {
          return;
        }
        queuedStreamEvents.push(event);
        eventRateWindowCount += 1;
        const now = performance.now();
        if (now - eventRateWindowStartedAt >= 1000) {
          emitEventRateMetric(now);
        }
        if (event.type === "TurnCompleted") {
          flushQueuedStreamEvents();
          emitEventRateMetric(performance.now());
          return;
        }
        scheduleStreamFlush();
      });

      const unlisten = () => {
        if (streamFlushTimer !== null) {
          window.clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        queuedStreamEvents.length = 0;
        emitEventRateMetric(performance.now());
        unlistenStream();
      };

      if (bindSeq !== activeThreadBindSeq) {
        unlisten();
        return;
      }

      set({
        threadId,
        messages,
        unlisten,
        error: undefined,
        streaming: false,
        status: "idle",
        usageLimits: null,
      });
    } catch (error) {
      if (bindSeq !== activeThreadBindSeq) {
        return;
      }
      set({ threadId, messages: [], usageLimits: null, error: String(error) });
    }
  },
  send: async (message, options) => {
    const state = get();
    if (state.streaming) {
      set({ error: "A turn is already in progress for this thread." });
      return false;
    }

    const threadId = options?.threadIdOverride ?? state.threadId;
    if (!threadId) {
      set({ error: "No active thread selected" });
      return false;
    }
    pendingTurnMetaByThread.set(threadId, {
      turnEngineId: options?.engineId ?? null,
      turnModelId: options?.modelId ?? null,
      turnReasoningEffort: options?.reasoningEffort ?? null,
    });

    const attachments = options?.attachments ?? [];
    const planMode = options?.planMode ?? false;
    const displayContent = message;

    const userBlocks: ContentBlock[] = [];
    if (attachments.length > 0) {
      for (const attachment of attachments) {
        userBlocks.push({
          type: "attachment",
          fileName: attachment.fileName,
          filePath: attachment.filePath,
          sizeBytes: attachment.sizeBytes,
          mimeType: attachment.mimeType,
        });
      }
    }
    userBlocks.push({ type: "text", content: displayContent, planMode: planMode || undefined });

    const userMessage: Message = {
      id: crypto.randomUUID(),
      threadId,
      role: "user",
      content: displayContent,
      blocks: userBlocks,
      status: "completed",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      hydration: "full",
      hasDeferredContent: false,
    };

    set((state) => ({
      messages: applyHydrationWindow([...state.messages, userMessage]),
      status: "streaming",
      streaming: true,
      error: undefined
    }));

    try {
      await ipc.sendMessage(
        threadId,
        message,
        options?.modelId ?? null,
        attachments.length > 0 ? attachments : null,
        planMode,
      );
      return true;
    } catch (error) {
      pendingTurnMetaByThread.delete(threadId);
      set({ status: "error", streaming: false, error: String(error) });
      return false;
    }
  },
  cancel: async () => {
    const threadId = get().threadId;
    if (!threadId) {
      return;
    }

    try {
      await ipc.cancelTurn(threadId);
      pendingTurnMetaByThread.delete(threadId);
      set({ status: "idle", streaming: false });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  respondApproval: async (approvalId, response) => {
    const threadId = get().threadId;
    if (!threadId) {
      set({ error: "No active thread selected" });
      return;
    }

    await ipc.respondApproval(threadId, approvalId, response);
    const decision = resolveApprovalDecision(response);
    set((state) => {
      for (let messageIndex = 0; messageIndex < state.messages.length; messageIndex += 1) {
        const message = state.messages[messageIndex];
        const blocks = message.blocks;
        if (!blocks || blocks.length === 0) {
          continue;
        }

        const approvalIndex = blocks.findIndex(
          (block) => block.type === "approval" && block.approvalId === approvalId,
        );
        if (approvalIndex < 0) {
          continue;
        }

        const approvalBlock = blocks[approvalIndex] as ApprovalBlock;
        if (approvalBlock.status === "answered" && approvalBlock.decision === decision) {
          return state;
        }

        const nextBlocks = [...blocks];
        nextBlocks[approvalIndex] = {
          ...approvalBlock,
          status: "answered",
          decision,
        };

        const nextMessages = [...state.messages];
        nextMessages[messageIndex] = {
          ...message,
          blocks: nextBlocks,
        };

        return {
          ...state,
          messages: nextMessages,
        };
      }

      return state;
    });
  },
  hydrateActionOutput: async (messageId, actionId) => {
    const requestKey = `${messageId}::${actionId}`;
    const existingRequest = inflightActionOutputHydration.get(requestKey);
    if (existingRequest) {
      await existingRequest;
      return;
    }

    const request = (async () => {
      const payload = await ipc.getActionOutput(messageId, actionId);
      if (!payload.found) {
        throw new Error("Action output not found.");
      }

      const normalizedChunks: ActionBlock["outputChunks"] = payload.outputChunks.map((chunk) => ({
        stream: chunk.stream === "stderr" ? "stderr" : "stdout",
        content: String(chunk.content ?? ""),
      }));
      const { chunks: trimmedChunks, truncated: trimmedByFrontend } =
        trimActionOutputChunks(normalizedChunks);

      set((state) => {
        const messageIndex = state.messages.findIndex((message) => message.id === messageId);
        if (messageIndex < 0) {
          return state;
        }

        const message = state.messages[messageIndex];
        const blocks = message.blocks;
        if (!blocks || blocks.length === 0) {
          return state;
        }

        const nextBlocks = patchActionBlock(blocks, actionId, (block) => {
          if (
            block.outputDeferred !== true &&
            block.outputDeferredLoaded === true &&
            block.outputChunks.length > 0
          ) {
            return block;
          }

          const details = (block.details ?? {}) as Record<string, unknown>;
          const shouldMarkTruncated =
            (payload.truncated || trimmedByFrontend) &&
            !("outputTruncated" in details && details.outputTruncated === true);
          const nextDetails = shouldMarkTruncated
            ? {
                ...details,
                outputTruncated: true,
              }
            : details;

          return {
            ...block,
            details: nextDetails,
            outputChunks: trimmedChunks,
            outputDeferred: false,
            outputDeferredLoaded: true,
          };
        });

        if (nextBlocks === blocks) {
          return state;
        }

        const nextMessages = [...state.messages];
        nextMessages[messageIndex] = {
          ...message,
          blocks: nextBlocks,
          hasDeferredContent: hasDeferredActionOutput(nextBlocks),
        };

        return {
          ...state,
          messages: nextMessages,
        };
      });
    })();

    inflightActionOutputHydration.set(requestKey, request);
    try {
      await request;
    } finally {
      inflightActionOutputHydration.delete(requestKey);
    }
  },
}));
