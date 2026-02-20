import { create } from "zustand";
import { ipc, listenThreadEvents } from "../lib/ipc";
import type {
  ApprovalResponse,
  ActionBlock,
  ApprovalBlock,
  ContentBlock,
  Message,
  StreamEvent,
  ThreadStatus
} from "../types";

interface ChatState {
  threadId: string | null;
  messages: Message[];
  status: ThreadStatus;
  streaming: boolean;
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
    },
  ) => Promise<void>;
  cancel: () => Promise<void>;
  respondApproval: (approvalId: string, response: ApprovalResponse) => Promise<void>;
}

let activeThreadBindSeq = 0;
const STREAM_EVENT_BATCH_WINDOW_MS = 16;
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
      createdAt: new Date().toISOString()
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

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    blocks: normalizeBlocks(message.blocks)
  }));
}

function applyStreamEvent(messages: Message[], event: StreamEvent, threadId: string): Message[] {
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
    assistant.blocks = [
      ...blocks,
      {
        type: "diff",
        diff: String(event.diff ?? ""),
        scope: String(event.scope ?? "turn") as "turn" | "file" | "workspace"
      }
    ];
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

  const blocksChanged = assistant.blocks !== existingBlocks;
  const statusChanged = assistant.status !== currentAssistant.status;
  const metadataChanged =
    assistant.turnEngineId !== currentAssistant.turnEngineId ||
    assistant.turnModelId !== currentAssistant.turnModelId ||
    assistant.turnReasoningEffort !== currentAssistant.turnReasoningEffort;

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

      set({ threadId: null, messages: [], streaming: false, status: "idle", unlisten: undefined });
      return;
    }

    try {
      const messages = normalizeMessages(await ipc.getThreadMessages(threadId));
      if (bindSeq !== activeThreadBindSeq) {
        return;
      }

      const queuedStreamEvents: StreamEvent[] = [];
      let streamFlushTimer: number | null = null;
      let streamFlushInProgress = false;

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
        set((state) => {
          if (bindSeq !== activeThreadBindSeq || state.threadId !== threadId) {
            return state;
          }

          let nextMessages = state.messages;
          let nextStreaming = state.streaming;
          for (const queuedEvent of batch) {
            if (queuedEvent.type === "TurnCompleted") {
              pendingTurnMetaByThread.delete(threadId);
            }
            nextMessages = applyStreamEvent(nextMessages, queuedEvent, state.threadId);
            nextStreaming = queuedEvent.type !== "TurnCompleted";
          }

          if (nextMessages === state.messages && nextStreaming === state.streaming) {
            return state;
          }

          return {
            ...state,
            messages: nextMessages,
            streaming: nextStreaming,
          };
        });
        streamFlushInProgress = false;

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
        if (event.type === "TurnCompleted") {
          flushQueuedStreamEvents();
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
        unlistenStream();
      };

      if (bindSeq !== activeThreadBindSeq) {
        unlisten();
        return;
      }

      set({ threadId, messages, unlisten, error: undefined, streaming: false, status: "idle" });
    } catch (error) {
      if (bindSeq !== activeThreadBindSeq) {
        return;
      }
      set({ threadId, messages: [], error: String(error) });
    }
  },
  send: async (message, options) => {
    const state = get();
    if (state.streaming) {
      set({ error: "A turn is already in progress for this thread." });
      return;
    }

    const threadId = options?.threadIdOverride ?? state.threadId;
    if (!threadId) {
      set({ error: "No active thread selected" });
      return;
    }
    pendingTurnMetaByThread.set(threadId, {
      turnEngineId: options?.engineId ?? null,
      turnModelId: options?.modelId ?? null,
      turnReasoningEffort: options?.reasoningEffort ?? null,
    });

    const userMessage: Message = {
      id: crypto.randomUUID(),
      threadId,
      role: "user",
      content: message,
      blocks: [{ type: "text", content: message }],
      status: "completed",
      schemaVersion: 1,
      createdAt: new Date().toISOString()
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      status: "streaming",
      streaming: true,
      error: undefined
    }));

    try {
      await ipc.sendMessage(threadId, message, options?.modelId ?? null);
    } catch (error) {
      pendingTurnMetaByThread.delete(threadId);
      set({ status: "error", streaming: false, error: String(error) });
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
  }
}));
