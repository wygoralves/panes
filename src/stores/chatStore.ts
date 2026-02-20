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
const pendingTurnMetaByThread = new Map<
  string,
  {
    turnEngineId?: string | null;
    turnModelId?: string | null;
    turnReasoningEffort?: string | null;
  }
>();

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
  const assistant = next[next.length - 1];
  const blocks = assistant.blocks ?? [];

  if (event.type === "TextDelta") {
    const delta = String(event.content ?? "");
    const last = blocks[blocks.length - 1];
    if (last?.type === "text") {
      last.content += delta;
      assistant.blocks = [...blocks.slice(0, -1), last];
    } else {
      assistant.blocks = [...blocks, { type: "text", content: delta }];
    }
  }

  if (event.type === "ThinkingDelta") {
    const delta = String(event.content ?? "");
    const last = blocks[blocks.length - 1];
    if (last?.type === "thinking") {
      last.content += delta;
      assistant.blocks = [...blocks.slice(0, -1), last];
    } else {
      assistant.blocks = [...blocks, { type: "thinking", content: delta }];
    }
  }

  if (event.type === "ActionStarted") {
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
    assistant.blocks = blocks.map((b) => {
      if (b.type !== "action" || b.actionId !== actionId) {
        return b;
      }
      return {
        ...b,
        outputChunks: [
          ...b.outputChunks,
          {
            stream: String(event.stream ?? "stdout") as "stdout" | "stderr",
            content: String(event.content ?? "")
          }
        ]
      };
    });
  }

  if (event.type === "ActionCompleted") {
    const actionId = String(event.action_id ?? "");
    assistant.blocks = blocks.map((b) => {
      if (b.type !== "action" || b.actionId !== actionId) {
        return b;
      }
      const result = (event.result as Record<string, unknown> | undefined) ?? {};
      return {
        ...b,
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

  next = [...next.slice(0, -1), { ...assistant }];
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

      const unlisten = await listenThreadEvents(threadId, (event) => {
        if (event.type === "TurnCompleted") {
          pendingTurnMetaByThread.delete(threadId);
        }
        if (bindSeq !== activeThreadBindSeq) {
          return;
        }

        set((state) => {
          if (state.threadId !== threadId) {
            return state;
          }

          return {
            ...state,
            messages: applyStreamEvent(state.messages, event, state.threadId),
            streaming: event.type !== "TurnCompleted"
          };
        });
      });

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
    set((state) => ({
      messages: state.messages.map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => {
          if (block.type !== "approval" || block.approvalId !== approvalId) {
            return block;
          }
          return {
            ...block,
            status: "answered",
            decision:
              "decision" in response && typeof response.decision === "string"
                ? (String(response.decision) as ApprovalBlock["decision"])
                : "custom"
          };
        })
      }))
    }));
  }
}));
