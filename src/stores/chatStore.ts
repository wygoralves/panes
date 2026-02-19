import { create } from "zustand";
import { ipc, listenThreadEvents } from "../lib/ipc";
import type {
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
  send: (message: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondApproval: (approvalId: string, response: Record<string, unknown>) => Promise<void>;
}

let activeThreadBindSeq = 0;

function ensureAssistantMessage(messages: Message[], threadId: string): Message[] {
  const existing = messages[messages.length - 1];
  if (existing && existing.role === "assistant" && existing.status === "streaming") {
    return messages;
  }

  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      threadId,
      role: "assistant",
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
    assistant.blocks = [...blocks, { type: "thinking", content: String(event.content ?? "") }];
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
    assistant.status = "error";
  }

  if (event.type === "TurnCompleted") {
    assistant.status = "completed";
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
    activeThreadBindSeq += 1;
    const bindSeq = activeThreadBindSeq;

    const current = get().unlisten;
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
      const messages = await ipc.getThreadMessages(threadId);
      if (bindSeq !== activeThreadBindSeq) {
        return;
      }

      const unlisten = await listenThreadEvents(threadId, (event) => {
        if (bindSeq !== activeThreadBindSeq) {
          return;
        }

        set((state) => ({
          messages:
            state.threadId === threadId
              ? applyStreamEvent(state.messages, event, state.threadId)
              : state.messages,
          streaming: event.type !== "TurnCompleted"
        }));
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
  send: async (message) => {
    const threadId = get().threadId;
    if (!threadId) {
      set({ error: "No active thread selected" });
      return;
    }

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
      await ipc.sendMessage(threadId, message);
    } catch (error) {
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
            decision: String(response.decision ?? "custom") as ApprovalBlock["decision"]
          };
        })
      }))
    }));
  }
}));
