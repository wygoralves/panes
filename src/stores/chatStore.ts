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
  threadId: string;
  messages: Message[];
  status: ThreadStatus;
  streaming: boolean;
  error?: string;
  unlisten?: () => void;
  bootstrap: () => Promise<void>;
  connectStream: () => Promise<void>;
  send: (message: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondApproval: (approvalId: string, response: Record<string, unknown>) => Promise<void>;
}

const DEFAULT_THREAD_ID = "demo-thread";

function ensureAssistantMessage(messages: Message[]): Message[] {
  const existing = messages[messages.length - 1];
  if (existing && existing.role === "assistant" && existing.status === "streaming") {
    return messages;
  }

  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      threadId: DEFAULT_THREAD_ID,
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

function applyStreamEvent(messages: Message[], event: StreamEvent): Message[] {
  let next = ensureAssistantMessage(messages);
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
          durationMs: Number(result.durationMs ?? 0)
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
  threadId: DEFAULT_THREAD_ID,
  messages: [],
  status: "idle",
  streaming: false,
  bootstrap: async () => {
    try {
      const messages = await ipc.getThreadMessages(DEFAULT_THREAD_ID);
      set({ messages });
    } catch {
      set({ messages: [] });
    }
  },
  connectStream: async () => {
    const current = get().unlisten;
    if (current) {
      current();
    }

    const unlisten = await listenThreadEvents(get().threadId, (event) => {
      set((state) => ({
        messages: applyStreamEvent(state.messages, event),
        streaming: event.type !== "TurnCompleted"
      }));
    });

    set({ unlisten });
  },
  send: async (message) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      threadId: get().threadId,
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
      await ipc.sendMessage(get().threadId, message);
    } catch (error) {
      set({ status: "error", streaming: false, error: String(error) });
    }
  },
  cancel: async () => {
    try {
      await ipc.cancelTurn(get().threadId);
      set({ status: "idle", streaming: false });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  respondApproval: async (approvalId, response) => {
    await ipc.respondApproval(get().threadId, approvalId, response);
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
