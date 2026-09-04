import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalResponse,
  ChatProviderUsage,
  ContentBlock,
  StreamEvent,
  TextBlock,
  ThinkingBlock,
} from "../types";

const mockIpc = vi.hoisted(() => ({
  cancelTurn: vi.fn(),
  sendMessage: vi.fn(),
  steerMessage: vi.fn(),
  getThreadMessagesWindow: vi.fn(),
  getChatProviderUsage: vi.fn(),
  getActionOutput: vi.fn(),
  respondApproval: vi.fn(),
  syncThreadFromEngine: vi.fn(),
}));

const mockListenThreadEvents = vi.hoisted(() => vi.fn());
const mockRecordPerfMetric = vi.hoisted(() => vi.fn());

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
  listenThreadEvents: mockListenThreadEvents,
}));

vi.mock("../lib/perfTelemetry", () => ({
  recordPerfMetric: mockRecordPerfMetric,
}));

import { useChatStore } from "./chatStore";
import { useChatQueueStore } from "./chatQueueStore";
import { useThreadStore } from "./threadStore";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("chatStore send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpc.getThreadMessagesWindow.mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    mockIpc.getChatProviderUsage.mockResolvedValue([]);
    mockIpc.getActionOutput.mockResolvedValue({
      found: true,
      outputChunks: [],
      truncated: false,
    });
    mockIpc.steerMessage.mockResolvedValue(undefined);
    mockIpc.syncThreadFromEngine.mockResolvedValue({
      id: "thread-1",
      workspaceId: "workspace-1",
      repoId: null,
      engineId: "codex",
      modelId: "gpt-5.3-codex",
      engineThreadId: "engine-thread-1",
      engineMetadata: {
        codexSyncRequired: false,
      },
      title: "Thread 1",
      status: "idle",
      messageCount: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });
    mockListenThreadEvents.mockResolvedValue(() => {});
    useThreadStore.setState({
      threads: [],
      threadsByWorkspace: {},
      archivedThreadsByWorkspace: {},
      activeThreadId: null,
      loading: false,
      error: undefined,
    });
    useChatStore.setState({
      threadId: "thread-1",
      messages: [],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "idle",
      streaming: false,
      usageLimits: null,
      usageLimitsLoading: false,
      error: undefined,
      unlisten: undefined,
    });
  });

  it("adds an assistant placeholder immediately while the turn request is in flight", async () => {
    const pendingRequest = deferred<string>();
    mockIpc.sendMessage.mockReturnValueOnce(pendingRequest.promise);

    const sendPromise = useChatStore.getState().send("hello", {
      engineId: "codex",
      modelId: "gpt-5.3-codex",
      reasoningEffort: "high",
    });

    const state = useChatStore.getState();
    expect(state.streaming).toBe(true);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      status: "completed",
    });
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      status: "streaming",
      turnEngineId: "codex",
      turnModelId: "gpt-5.3-codex",
      turnReasoningEffort: "high",
    });

    pendingRequest.resolve("assistant-message-id");
    await expect(sendPromise).resolves.toBe(true);
  });

  it("removes the optimistic turn if the turn request fails", async () => {
    mockIpc.sendMessage.mockRejectedValueOnce(new Error("send failed"));

    await expect(useChatStore.getState().send("hello")).resolves.toBe(false);

    const state = useChatStore.getState();
    expect(state.streaming).toBe(false);
    expect(state.status).toBe("error");
    expect(state.messages).toEqual([]);
  });

  it("routes streamed content to the matching optimistic assistant via clientTurnId", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", {
        engineId: "codex",
        modelId: "gpt-5.3-codex",
      }),
    ).resolves.toBe(true);

    const optimisticAssistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant" && message.clientTurnId);
    expect(optimisticAssistant?.clientTurnId).toBeTruthy();
    expect(streamHandler).not.toBeNull();
    const emitStreamEvent = streamHandler!;

    useChatStore.setState((state) => ({
      ...state,
      messages: [
        ...state.messages,
        {
          id: "assistant-other",
          threadId: "thread-1",
          role: "assistant",
          clientTurnId: "client-turn-other",
          status: "streaming",
          schemaVersion: 1,
          blocks: [],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
    }));

    emitStreamEvent({
      type: "TurnStarted",
      client_turn_id: optimisticAssistant?.clientTurnId ?? null,
    });
    emitStreamEvent({
      type: "TextDelta",
      content: "matched content",
    });

    await vi.advanceTimersByTimeAsync(20);

    const state = useChatStore.getState();
    const matchedAssistant = state.messages.find((message) => message.id === optimisticAssistant?.id);
    const trailingAssistant = state.messages.find((message) => message.id === "assistant-other");

    expect(matchedAssistant?.blocks).toEqual([{ type: "text", content: "matched content" }]);
    expect(trailingAssistant?.blocks ?? []).toEqual([]);
    expect(mockRecordPerfMetric).toHaveBeenCalledWith(
      "chat.turn.first_text.ms",
      expect.any(Number),
      expect.objectContaining({
        threadId: "thread-1",
        clientTurnId: optimisticAssistant?.clientTurnId,
      }),
    );

    vi.useRealTimers();
  });

  it("closes a worker's thought when that worker moves on, not when another producer speaks", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", { engineId: "codex" }),
    ).resolves.toBe(true);

    expect(streamHandler).not.toBeNull();
    const emitStreamEvent = streamHandler!;

    function workerThought(): ThinkingBlock | null {
      const assistant = useChatStore
        .getState()
        .messages.find((message) => message.role === "assistant");
      return (
        (assistant?.blocks ?? []).find(
          (block): block is ThinkingBlock => block.type === "thinking" && block.agentId === "w1",
        ) ?? null
      );
    }

    emitStreamEvent({ type: "SubagentThinkingDelta", agent_id: "w1", content: "plan" });
    emitStreamEvent({ type: "SubagentThinkingDelta", agent_id: "w1", content: " it" });
    await vi.advanceTimersByTimeAsync(20);

    // Its own second delta must not close the block it is still writing.
    expect(workerThought()).toMatchObject({ content: "plan it", agentId: "w1" });
    expect(workerThought()?.durationMs).toBeUndefined();

    emitStreamEvent({ type: "TextDelta", content: "the main agent talks" });
    await vi.advanceTimersByTimeAsync(20);

    expect(workerThought()?.durationMs).toBeUndefined();

    emitStreamEvent({ type: "SubagentTextDelta", agent_id: "w1", content: "here is what I found" });
    await vi.advanceTimersByTimeAsync(20);

    expect(workerThought()?.durationMs).toEqual(expect.any(Number));

    vi.useRealTimers();
  });

  async function startStreamingTurn(): Promise<(event: StreamEvent) => void> {
    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", { engineId: "codex" }),
    ).resolves.toBe(true);

    expect(streamHandler).not.toBeNull();
    return streamHandler!;
  }

  function assistantBlocks(): ContentBlock[] {
    const assistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant");
    return assistant?.blocks ?? [];
  }

  it("keeps the main agent's sentence in one block when subagent output interleaves", async () => {
    vi.useFakeTimers();

    const emitStreamEvent = await startStreamingTurn();

    emitStreamEvent({ type: "TextDelta", content: "Three new subagents " });
    emitStreamEvent({
      type: "SubagentStarted",
      agent_id: "w1",
      description: "frontend tests",
    });
    emitStreamEvent({ type: "SubagentTextDelta", agent_id: "w1", content: "reading files" });
    emitStreamEvent({ type: "TextDelta", content: "are currently running." });
    await vi.advanceTimersByTimeAsync(20);

    const blocks = assistantBlocks();
    const mainText = blocks.filter(
      (block): block is TextBlock => block.type === "text" && !block.agentId,
    );
    expect(mainText).toHaveLength(1);
    expect(mainText[0].content).toBe("Three new subagents are currently running.");

    vi.useRealTimers();
  });

  it("keeps a worker's text in one block when another worker interleaves", async () => {
    vi.useFakeTimers();

    const emitStreamEvent = await startStreamingTurn();

    emitStreamEvent({ type: "SubagentTextDelta", agent_id: "w1", content: "part one " });
    emitStreamEvent({ type: "SubagentTextDelta", agent_id: "w2", content: "other worker" });
    emitStreamEvent({ type: "SubagentTextDelta", agent_id: "w1", content: "part two" });
    await vi.advanceTimersByTimeAsync(20);

    const texts = assistantBlocks().filter((block): block is TextBlock => block.type === "text");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ agentId: "w1", content: "part one part two" });
    expect(texts[1]).toMatchObject({ agentId: "w2", content: "other worker" });

    vi.useRealTimers();
  });

  it("starts a new main text block once the engine opens the next message item", async () => {
    vi.useFakeTimers();

    const emitStreamEvent = await startStreamingTurn();

    emitStreamEvent({ type: "TextDelta", content: "first message" });
    emitStreamEvent({ type: "SubagentStarted", agent_id: "w1", description: "worker" });
    emitStreamEvent({ type: "TextItemStarted" });
    emitStreamEvent({ type: "TextDelta", content: "second message" });
    await vi.advanceTimersByTimeAsync(20);

    const texts = assistantBlocks().filter((block): block is TextBlock => block.type === "text");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ content: "first message", closed: true });
    expect(texts[1]).toMatchObject({ content: "second message" });
    expect(texts[1].closed).toBeUndefined();

    vi.useRealTimers();
  });

  it("still splits the main text when the main agent's own action lands between deltas", async () => {
    vi.useFakeTimers();

    const emitStreamEvent = await startStreamingTurn();

    emitStreamEvent({ type: "TextDelta", content: "before" });
    emitStreamEvent({
      type: "ActionStarted",
      action_id: "action-1",
      action_type: "command",
      summary: "run tests",
      details: {},
    });
    emitStreamEvent({ type: "TextDelta", content: "after" });
    await vi.advanceTimersByTimeAsync(20);

    const texts = assistantBlocks().filter((block): block is TextBlock => block.type === "text");
    expect(texts.map((block) => block.content)).toEqual(["before", "after"]);

    vi.useRealTimers();
  });

  it("never appends streamed text to a steer echo", async () => {
    vi.useFakeTimers();

    const emitStreamEvent = await startStreamingTurn();

    useChatStore.setState((state) => ({
      ...state,
      messages: state.messages.map((message) =>
        message.role === "assistant"
          ? { ...message, blocks: [{ type: "text", content: "steer me", isSteer: true }] }
          : message,
      ),
    }));

    emitStreamEvent({ type: "TextDelta", content: "reply" });
    await vi.advanceTimersByTimeAsync(20);

    const texts = assistantBlocks().filter((block): block is TextBlock => block.type === "text");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ content: "steer me", isSteer: true });
    expect(texts[1]).toMatchObject({ content: "reply" });
    expect(texts[1].isSteer).toBeUndefined();

    vi.useRealTimers();
  });

  it("rejoins a stored turn that was split one block per delta", async () => {
    vi.useFakeTimers();

    mockListenThreadEvents.mockImplementationOnce(async () => () => {});

    // The blocks a real Codex turn left in the database while the main agent
    // wrote a sentence and spawned workers at the same time.
    const action = (agentId: string, actionId: string) => ({
      type: "action" as const,
      actionId,
      actionType: "command" as const,
      summary: "run",
      details: {},
      outputChunks: [],
      status: "completed" as const,
      agentId,
    });
    const worker = (agentId: string) => ({
      type: "subagent" as const,
      agentId,
      description: agentId,
      status: "done" as const,
    });

    mockIpc.getThreadMessagesWindow.mockResolvedValueOnce({
      messages: [
        {
          id: "assistant-stored",
          threadId: "thread-1",
          role: "assistant",
          status: "completed",
          schemaVersion: 1,
          blocks: [
            { type: "text", content: "Testing the subagent status flow now." },
            worker("w1"),
            { type: "text", content: "I'm running", agentId: "w1" },
            worker("w2"),
            { type: "text", content: " the typecheck.", agentId: "w1" },
            action("w1", "action-w1"),
            { type: "text", content: "I'm checking", agentId: "w2" },
            worker("w3"),
            action("w2", "action-w2"),
            { type: "text", content: "I'm running the Rust", agentId: "w3" },
            { type: "text", content: "Test confirmed. Three new subagents" },
            { type: "text", content: " compile check.", agentId: "w3" },
            { type: "text", content: " are currently" },
            { type: "text", content: " I'll report.", agentId: "w3" },
            { type: "text", content: " running:\n\n-" },
            { type: "text", content: " `" },
            { type: "text", content: "frontend_tests`\n- `vitest_smoke`" },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      nextCursor: null,
    });

    await useChatStore.getState().setActiveThread("thread-1");
    await vi.advanceTimersByTimeAsync(20);

    const blocks = assistantBlocks();
    const texts = blocks.filter((block): block is TextBlock => block.type === "text");

    expect(texts).toHaveLength(6);
    expect(texts.map((block) => block.agentId ?? null)).toEqual([
      null,
      "w1",
      "w1",
      "w2",
      "w3",
      null,
    ]);
    // The first sentence stays on its own: the worker announced right after it
    // is the only message boundary this stored data carries.
    expect(texts[0].content).toBe("Testing the subagent status flow now.");
    // A subagent announcement between the worker's two deltas keeps them apart.
    expect(texts[1].content).toBe("I'm running");
    expect(texts[2].content).toBe(" the typecheck.");
    expect(texts[3].content).toBe("I'm checking");
    expect(texts[4].content).toBe("I'm running the Rust compile check. I'll report.");
    // The main agent's message is whole again, so its markdown list parses.
    expect(texts[5].content).toBe(
      "Test confirmed. Three new subagents are currently running:\n\n- `frontend_tests`\n- `vitest_smoke`",
    );
    expect(blocks[blocks.length - 1]).toBe(texts[5]);

    vi.useRealTimers();
  });

  it("updates the assistant model label and inserts a reroute notice when the model is rerouted", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", {
        engineId: "codex",
        modelId: "gpt-5.1-codex-mini",
      }),
    ).resolves.toBe(true);

    const optimisticAssistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant" && message.clientTurnId);
    expect(streamHandler).not.toBeNull();

    streamHandler!({
      type: "ModelRerouted",
      from_model: "gpt-5.1-codex-mini",
      to_model: "gpt-5.3-codex",
      reason: "highRiskCyberActivity",
    });

    await vi.advanceTimersByTimeAsync(20);

    const reroutedAssistant = useChatStore
      .getState()
      .messages.find((message) => message.id === optimisticAssistant?.id);
    expect(reroutedAssistant?.turnModelId).toBe("gpt-5.3-codex");
    expect(mockRecordPerfMetric).toHaveBeenCalledWith(
      "chat.turn.first_content.ms",
      expect.any(Number),
      expect.objectContaining({
        threadId: "thread-1",
        modelId: "gpt-5.3-codex",
      }),
    );
    expect(reroutedAssistant?.blocks).toEqual([
      {
        type: "notice",
        kind: "model_rerouted",
        level: "info",
        title: "Model rerouted",
        message: "Switched from gpt-5.1-codex-mini to gpt-5.3-codex (highRiskCyberActivity).",
      },
    ]);

    vi.useRealTimers();
  });

  it("stores generic notice events as notice blocks", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", {
        engineId: "codex",
        modelId: "gpt-5.3-codex",
      }),
    ).resolves.toBe(true);

    streamHandler!({
      type: "Notice",
      kind: "deprecation_notice",
      level: "warning",
      title: "Deprecation notice",
      message: "Use the newer approval API.",
    });

    await vi.advanceTimersByTimeAsync(20);

    const assistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant" && message.blocks?.length);
    expect(assistant?.blocks).toEqual([
      {
        type: "notice",
        kind: "deprecation_notice",
        level: "warning",
        title: "Deprecation notice",
        message: "Use the newer approval API.",
      },
    ]);

    vi.useRealTimers();
  });

  it("replaces task snapshots by engine source and removes empty lists", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");
    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await useChatStore.getState().send("handle the tasks", { engineId: "codex" });

    streamHandler!({
      type: "TaskListUpdated",
      source: "codex",
      explanation: "Apply the requested UI changes.",
      tasks: [
        {
          id: "codex-plan-0",
          title: "Inspect the UI",
          status: "in_progress",
          activeForm: null,
          description: null,
          owner: null,
          blockedBy: [],
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(20);

    const assistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant" && message.blocks?.length);
    expect(assistant?.blocks?.[0]).toMatchObject({
      type: "taskList",
      source: "codex",
      explanation: "Apply the requested UI changes.",
      tasks: [{ title: "Inspect the UI", status: "in_progress" }],
    });

    streamHandler!({
      type: "TaskListUpdated",
      source: "codex",
      explanation: null,
      tasks: [],
    });
    await vi.advanceTimersByTimeAsync(20);
    const clearedAssistant = useChatStore
      .getState()
      .messages.find((message) => message.id === assistant?.id);
    expect(clearedAssistant?.blocks).toEqual([]);

    vi.useRealTimers();
  });

  it("derives context usage from current context tokens instead of cumulative totals", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    expect(streamHandler).not.toBeNull();
    streamHandler!({
      type: "UsageLimitsUpdated",
      usage: {
        current_tokens: 30000,
        max_context_tokens: 200000,
        context_window_percent: 45,
        five_hour_percent: 17,
        weekly_percent: 42,
      },
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(useChatStore.getState().usageLimits).toEqual({
      currentTokens: 30000,
      maxContextTokens: 200000,
      contextPercent: 90,
      windowFiveHourPercent: 83,
      windowWeeklyPercent: 58,
      windowFableWeeklyPercent: null,
      windowOpusWeeklyPercent: null,
      windowSonnetWeeklyPercent: null,
      windowFiveHourResetsAt: null,
      windowWeeklyResetsAt: null,
      windowFableWeeklyResetsAt: null,
      windowOpusWeeklyResetsAt: null,
      windowSonnetWeeklyResetsAt: null,
    });

    vi.useRealTimers();
  });

  it("merges generic and model-specific Claude usage windows", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    streamHandler!({
      type: "UsageLimitsUpdated",
      usage: { five_hour_percent: 10, five_hour_resets_at: 1_740_000_000 },
    });
    streamHandler!({
      type: "UsageLimitsUpdated",
      usage: { weekly_percent: 20, weekly_resets_at: 1_740_100_000 },
    });
    streamHandler!({
      type: "UsageLimitsUpdated",
      usage: {
        fable_weekly_percent: 35,
        fable_weekly_resets_at: 1_740_200_000,
      },
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(useChatStore.getState().usageLimits).toMatchObject({
      windowFiveHourPercent: 90,
      windowWeeklyPercent: 80,
      windowFableWeeklyPercent: 65,
      windowFiveHourResetsAt: "2025-02-19T21:20:00.000Z",
      windowWeeklyResetsAt: "2025-02-21T01:06:40.000Z",
      windowFableWeeklyResetsAt: "2025-02-22T04:53:20.000Z",
    });

    vi.useRealTimers();
  });

  it("refreshes provider limits when binding a restored conversation", async () => {
    const usageRequest = deferred<ChatProviderUsage[]>();
    mockIpc.getChatProviderUsage.mockReturnValueOnce(usageRequest.promise);
    mockIpc.getThreadMessagesWindow.mockResolvedValueOnce({
      messages: [
        {
          id: "user-restored",
          threadId: "thread-1",
          role: "user",
          content: "continue the work",
          blocks: [{ type: "text", content: "continue the work" }],
          schemaVersion: 1,
          status: "completed",
          tokenUsage: null,
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });
    useThreadStore.setState({
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          repoId: null,
          engineId: "claude",
          modelId: "fable",
          engineThreadId: "engine-thread-1",
          engineMetadata: {},
          title: "Restored thread",
          status: "idle",
          messageCount: 1,
          totalTokens: 0,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          settledAt: null,
        },
      ],
    });

    await useChatStore.getState().setActiveThread("thread-1");

    expect(useChatStore.getState()).toMatchObject({
      usageLimits: null,
      usageLimitsLoading: true,
    });

    usageRequest.resolve([
      {
        engineId: "claude",
        name: "Claude",
        available: true,
        windows: [
          { kind: "five_hour", usedPercent: 20, resetsAt: 1_740_000_000 },
          { kind: "weekly", usedPercent: 35, resetsAt: 1_740_100_000 },
          { kind: "fable_weekly", usedPercent: 45, resetsAt: 1_740_200_000 },
        ],
      },
    ]);

    await vi.waitFor(() => {
      expect(useChatStore.getState().usageLimitsLoading).toBe(false);
    });
    expect(useChatStore.getState().usageLimits).toMatchObject({
      contextPercent: null,
      windowFiveHourPercent: 80,
      windowWeeklyPercent: 65,
      windowFableWeeklyPercent: 55,
      windowFiveHourResetsAt: "2025-02-19T21:20:00.000Z",
    });
  });

  it("rejoins each producer's stored text without mixing producers", async () => {
    mockIpc.getThreadMessagesWindow.mockResolvedValueOnce({
      messages: [
        {
          id: "assistant-workers",
          threadId: "thread-1",
          role: "assistant",
          blocks: [
            { type: "text", content: "Main " },
            { type: "text", content: "one ", agentId: "w1" },
            { type: "text", content: "two", agentId: "w1" },
            { type: "thinking", content: "hmm", agentId: "w2" },
            { type: "thinking", content: "more", agentId: "w1" },
            { type: "text", content: "text" },
          ],
          schemaVersion: 1,
          status: "completed",
          tokenUsage: null,
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });

    await useChatStore.getState().setActiveThread("thread-1");

    const message = useChatStore
      .getState()
      .messages.find((entry) => entry.id === "assistant-workers");
    // The main agent's two text blocks rejoin across the workers' output; each
    // worker keeps its own, and text never lands in another producer's block.
    expect(message?.blocks).toEqual([
      { type: "text", content: "Main text" },
      { type: "text", content: "one two", agentId: "w1" },
      { type: "thinking", content: "hmm", agentId: "w2" },
      { type: "thinking", content: "more", agentId: "w1" },
    ]);
  });

  it("preserves stdin action output chunks from streamed events", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", {
        engineId: "codex",
        modelId: "gpt-5.3-codex",
      }),
    ).resolves.toBe(true);

    expect(streamHandler).not.toBeNull();
    streamHandler!({
      type: "ActionStarted",
      action_id: "action-stdin",
      engine_action_id: "cmd-stdin",
      action_type: "command",
      summary: "pnpm test",
      details: {},
    });
    streamHandler!({
      type: "ActionOutputDelta",
      action_id: "action-stdin",
      stream: "stdin",
      content: "pnpm test\n",
    });

    await vi.advanceTimersByTimeAsync(20);

    const assistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant" && message.blocks?.length);
    expect(assistant?.blocks).toEqual([
      {
        type: "action",
        actionId: "action-stdin",
        engineActionId: "cmd-stdin",
        actionType: "command",
        summary: "pnpm test",
        details: {},
        outputChunks: [
          {
            stream: "stdin",
            content: "pnpm test\n",
          },
        ],
        outputDeferred: false,
        outputDeferredLoaded: true,
        startedAt: expect.any(Number),
        status: "running",
      },
    ]);

    vi.useRealTimers();
  });

  it("collapses existing duplicate diff blocks for same-scope stream updates", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-diff",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          content: "",
          blocks: [
            { type: "diff", diff: "old diff 1", scope: "turn" },
            { type: "text", content: "kept" },
            { type: "diff", diff: "old diff 2", scope: "turn" },
            {
              type: "action",
              actionId: "action-1",
              engineActionId: "cmd-1",
              actionType: "command",
              summary: "pnpm test",
              details: {},
              outputChunks: [],
              status: "done",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      status: "streaming",
      streaming: true,
    });

    expect(streamHandler).not.toBeNull();
    streamHandler!({
      type: "DiffUpdated",
      diff: "new diff",
      scope: "turn",
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(useChatStore.getState().messages[0]?.blocks).toEqual([
      { type: "text", content: "kept" },
      { type: "diff", diff: "new diff", scope: "turn" },
      {
        type: "action",
        actionId: "action-1",
        engineActionId: "cmd-1",
        actionType: "command",
        summary: "pnpm test",
        details: {},
        outputChunks: [],
        status: "done",
      },
    ]);

    vi.useRealTimers();
  });

  it("marks approvals as answered when the runtime resolves them externally", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    mockIpc.getThreadMessagesWindow.mockResolvedValueOnce({
      messages: [
        {
          id: "assistant-approval",
          threadId: "thread-1",
          role: "assistant",
          status: "completed",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-runtime-1",
              actionType: "command",
              summary: "Run command",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      nextCursor: null,
    });

    await useChatStore.getState().setActiveThread("thread-1");

    expect(streamHandler).not.toBeNull();
    streamHandler!({
      type: "ApprovalResolved",
      approval_id: "approval-runtime-1",
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(useChatStore.getState().messages[0]?.blocks).toEqual([
      {
        type: "approval",
        approvalId: "approval-runtime-1",
        actionType: "command",
        summary: "Run command",
        details: {},
        status: "answered",
      },
    ]);

    vi.useRealTimers();
  });

  it("preserves stdin chunks when hydrating deferred action output", async () => {
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-action",
          threadId: "thread-1",
          role: "assistant",
          status: "completed",
          schemaVersion: 1,
          blocks: [
            {
              type: "action",
              actionId: "action-hydrate",
              engineActionId: "cmd-hydrate",
              actionType: "command",
              summary: "pnpm test",
              details: {},
              outputChunks: [],
              outputDeferred: true,
              outputDeferredLoaded: false,
              status: "done",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: true,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "idle",
      streaming: false,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });
    mockIpc.getActionOutput.mockResolvedValueOnce({
      found: true,
      outputChunks: [
        {
          stream: "stdin",
          content: "pnpm test\n",
        },
      ],
      truncated: false,
    });

    await useChatStore.getState().hydrateActionOutput("assistant-action", "action-hydrate");

    expect(useChatStore.getState().messages[0]?.blocks).toEqual([
      {
        type: "action",
        actionId: "action-hydrate",
        engineActionId: "cmd-hydrate",
        actionType: "command",
        summary: "pnpm test",
        details: {},
        outputChunks: [
          {
            stream: "stdin",
            content: "pnpm test\n",
          },
        ],
        outputDeferred: false,
        outputDeferredLoaded: true,
        status: "done",
      },
    ]);
  });

  it("infers accept_for_session for permission approval responses", async () => {
    mockIpc.respondApproval.mockResolvedValueOnce(undefined);
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-approval",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-1",
              actionType: "other",
              summary: "Codex requested network access",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "streaming",
      streaming: true,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });

    await useChatStore.getState().respondApproval("approval-1", {
      permissions: {
        network: {
          enabled: true,
        },
      },
      scope: "session",
    });

    expect(mockIpc.respondApproval).toHaveBeenCalledWith("thread-1", "approval-1", {
      permissions: {
        network: {
          enabled: true,
        },
      },
      scope: "session",
    });
    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      {
        type: "approval",
        approvalId: "approval-1",
        actionType: "other",
        summary: "Codex requested network access",
        details: {},
        status: "answered",
        decision: "accept_for_session",
      },
    ]);
  });

  it("treats 'none' permission values as a decline", async () => {
    mockIpc.respondApproval.mockResolvedValueOnce(undefined);
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-approval-none",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-none",
              actionType: "other",
              summary: "Network access",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "streaming",
      streaming: true,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });

    await useChatStore.getState().respondApproval("approval-none", {
      permissions: {
        network: "none",
      },
      scope: "turn",
    });

    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      {
        type: "approval",
        approvalId: "approval-none",
        actionType: "other",
        summary: "Network access",
        details: {},
        status: "answered",
        decision: "decline",
      },
    ]);
  });

  it("infers MCP elicitation decisions from action responses", async () => {
    mockIpc.respondApproval.mockResolvedValueOnce(undefined);
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-approval-2",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-2",
              actionType: "other",
              summary: "docs requested input",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "streaming",
      streaming: true,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });

    await useChatStore.getState().respondApproval("approval-2", {
      action: "decline",
    });

    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      {
        type: "approval",
        approvalId: "approval-2",
        actionType: "other",
        summary: "docs requested input",
        details: {},
        status: "answered",
        decision: "decline",
      },
    ]);
  });

  it("stores only the latest MCP progress message on the matching action block", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    mockIpc.sendMessage.mockResolvedValueOnce("assistant-message-id");
    await expect(
      useChatStore.getState().send("hello", {
        engineId: "codex",
        modelId: "gpt-5.3-codex",
      }),
    ).resolves.toBe(true);

    expect(streamHandler).not.toBeNull();
    streamHandler!({
      type: "ActionStarted",
      action_id: "action-1",
      engine_action_id: "item-1",
      action_type: "other",
      summary: "search_docs",
      details: {},
    });
    streamHandler!({
      type: "ActionProgressUpdated",
      action_id: "action-1",
      message: "Connecting",
    });
    streamHandler!({
      type: "ActionProgressUpdated",
      action_id: "action-1",
      message: "Fetching results",
    });

    await vi.advanceTimersByTimeAsync(20);

    const assistant = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant" && message.blocks?.length);
    expect(assistant?.blocks).toEqual([
      {
        type: "action",
        actionId: "action-1",
        engineActionId: "item-1",
        actionType: "other",
        summary: "search_docs",
        details: {
          progressKind: "mcp",
          progressMessage: "Fetching results",
        },
        outputChunks: [],
        outputDeferred: false,
        outputDeferredLoaded: true,
        startedAt: expect.any(Number),
        status: "running",
      },
    ]);

    vi.useRealTimers();
  });

  it("adds a steer block to the active assistant while steering an active turn", async () => {
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "streaming",
      streaming: true,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });

    await expect(
      useChatStore.getState().steer("follow up", {
        inputItems: [{ type: "mention", name: "Docs", path: "app://docs" }],
      }),
    ).resolves.toBe(true);

    expect(mockIpc.steerMessage).toHaveBeenCalledWith(
      "thread-1",
      "follow up",
      null,
      [{ type: "mention", name: "Docs", path: "app://docs" }],
      false,
    );
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      role: "assistant",
      blocks: [
        {
          type: "steer",
          content: "follow up",
          mentions: [{ type: "mention", name: "Docs", path: "app://docs" }],
        },
      ],
    });
  });

  it("rolls back the optimistic steer block when the steer request fails", async () => {
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "streaming",
      streaming: true,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });
    mockIpc.steerMessage.mockRejectedValueOnce(new Error("steer failed"));

    await expect(useChatStore.getState().steer("follow up")).resolves.toBe(false);

    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        blocks: [],
      }),
    ]);
    expect(useChatStore.getState().error).toContain("steer failed");
  });

  it("folds persisted steer messages into the preceding completed assistant when binding", async () => {
    mockIpc.getThreadMessagesWindow.mockResolvedValueOnce({
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          content: null,
          blocks: [{ type: "text", content: "Working on it" }],
          turnEngineId: "codex",
          turnModelId: "gpt-5.3-codex",
          turnReasoningEffort: "medium",
          schemaVersion: 1,
          status: "completed",
          tokenUsage: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: "steer-user-1",
          threadId: "thread-1",
          role: "user",
          content: "focus on the failing test",
          blocks: [{ type: "text", content: "focus on the failing test", isSteer: true }],
          turnEngineId: "codex",
          turnModelId: "gpt-5.3-codex",
          turnReasoningEffort: "medium",
          schemaVersion: 1,
          status: "completed",
          tokenUsage: null,
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });

    await useChatStore.getState().setActiveThread("thread-1");

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      role: "assistant",
      status: "completed",
      blocks: [
        {
          type: "text",
          content: "Working on it",
        },
        {
          type: "steer",
          steerId: "steer-user-1",
          content: "focus on the failing test",
        },
      ],
    });
  });

  it("keeps regular user turns intact when loading older history", async () => {
    mockIpc.getThreadMessagesWindow
      .mockResolvedValueOnce({
        messages: [
          {
            id: "assistant-latest",
            threadId: "thread-1",
            role: "assistant",
            content: null,
            blocks: [{ type: "text", content: "Latest reply" }],
            turnEngineId: "codex",
            turnModelId: "gpt-5.3-codex",
            turnReasoningEffort: "medium",
            schemaVersion: 1,
            status: "completed",
            tokenUsage: null,
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: {
          createdAt: "2026-03-13T00:00:00.000Z",
          id: "cursor-1",
          rowId: 1,
        },
      })
      .mockResolvedValueOnce({
        messages: [
          {
            id: "assistant-earlier",
            threadId: "thread-1",
            role: "assistant",
            content: null,
            blocks: [{ type: "text", content: "Earlier reply" }],
            turnEngineId: "codex",
            turnModelId: "gpt-5.3-codex",
            turnReasoningEffort: "medium",
            schemaVersion: 1,
            status: "completed",
            tokenUsage: null,
            createdAt: new Date().toISOString(),
          },
          {
            id: "user-regular",
            threadId: "thread-1",
            role: "user",
            content: "A normal next turn",
            blocks: [{ type: "text", content: "A normal next turn" }],
            turnEngineId: "codex",
            turnModelId: "gpt-5.3-codex",
            turnReasoningEffort: "medium",
            schemaVersion: 1,
            status: "completed",
            tokenUsage: null,
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      });

    await useChatStore.getState().setActiveThread("thread-1");
    await useChatStore.getState().loadOlderMessages();

    expect(useChatStore.getState().messages).toHaveLength(3);
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      "assistant-earlier",
      "user-regular",
      "assistant-latest",
    ]);
  });

  it.each([
    { status: "streaming" as const, expectedStreaming: true },
    { status: "awaiting_approval" as const, expectedStreaming: true },
  ])(
    "preserves the bound thread runtime status when loading a $status thread",
    async ({ status, expectedStreaming }) => {
      const thread = {
        id: "thread-1",
        workspaceId: "workspace-1",
        repoId: null,
        engineId: "codex" as const,
        modelId: "gpt-5.3-codex",
        engineThreadId: "engine-thread-1",
        engineMetadata: {
          codexSyncRequired: false,
        },
        title: "Thread 1",
        status,
        messageCount: 0,
        totalTokens: 0,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        settledAt: null,
      };

      useThreadStore.setState({
        threads: [thread],
        threadsByWorkspace: {
          "workspace-1": [thread],
        },
        archivedThreadsByWorkspace: {},
        activeThreadId: "thread-1",
        loading: false,
        error: undefined,
      });

      await useChatStore.getState().setActiveThread("thread-1");

      expect(useChatStore.getState()).toMatchObject({
        status,
        streaming: expectedStreaming,
      });
    },
  );

  it("does not let a late bind replace an active optimistic turn", async () => {
    const existingUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    mockListenThreadEvents.mockImplementationOnce(async () => {
      useChatStore.setState({
        threadId: "thread-1",
        messages: [
          {
            id: "optimistic-user",
            threadId: "thread-1",
            role: "user",
            status: "completed",
            schemaVersion: 1,
            blocks: [{ type: "text", content: "hello" }],
            createdAt: new Date().toISOString(),
            hydration: "full",
            hasDeferredContent: false,
          },
          {
            id: "optimistic-assistant",
            threadId: "thread-1",
            role: "assistant",
            status: "streaming",
            schemaVersion: 1,
            blocks: [],
            createdAt: new Date().toISOString(),
            hydration: "full",
            hasDeferredContent: false,
          },
        ],
        status: "streaming",
        streaming: true,
        unlisten: existingUnlisten,
      });
      return lateUnlisten;
    });

    await useChatStore.getState().setActiveThread("thread-1");

    const state = useChatStore.getState();
    expect(state.streaming).toBe(true);
    expect(state.status).toBe("streaming");
    expect(state.messages.map((message) => message.id)).toEqual([
      "optimistic-user",
      "optimistic-assistant",
    ]);
    expect(lateUnlisten).toHaveBeenCalledTimes(1);
    expect(existingUnlisten).not.toHaveBeenCalled();
  });

  it("marks the thread as awaiting approval while a streamed approval is pending", async () => {
    vi.useFakeTimers();

    let streamHandler: ((event: StreamEvent) => void) | null = null;
    mockListenThreadEvents.mockImplementationOnce(async (_threadId, onEvent) => {
      streamHandler = onEvent;
      return () => {};
    });

    await useChatStore.getState().setActiveThread("thread-1");

    streamHandler!({
      type: "ApprovalRequested",
      approval_id: "approval-runtime-2",
      action_type: "command",
      summary: "Run command",
      details: {},
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(useChatStore.getState()).toMatchObject({
      status: "awaiting_approval",
      streaming: true,
    });

    vi.useRealTimers();
  });

  it("syncs dirty Codex thread metadata before binding the message window", async () => {
    const thread = {
      id: "thread-1",
      workspaceId: "workspace-1",
      repoId: null,
      engineId: "codex" as const,
      modelId: "gpt-5.3-codex",
      engineThreadId: "engine-thread-1",
      engineMetadata: {
        codexSyncRequired: true,
      },
      title: "Thread 1",
      status: "idle" as const,
      messageCount: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      settledAt: null,
    };

    useThreadStore.setState({
      threads: [thread],
      threadsByWorkspace: {
        "workspace-1": [thread],
      },
      archivedThreadsByWorkspace: {},
      activeThreadId: "thread-1",
      loading: false,
      error: undefined,
    });

    await useChatStore.getState().setActiveThread("thread-1");

    expect(mockIpc.syncThreadFromEngine).toHaveBeenCalledWith("thread-1");
    expect(mockIpc.getThreadMessagesWindow).toHaveBeenCalledWith("thread-1", null, 80);
  });

  it("normalizes deny approvals to decline in optimistic state", async () => {
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          status: "completed",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-1",
              actionType: "command",
              summary: "Run command",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "awaiting_approval",
      streaming: false,
      usageLimits: null,
      error: undefined,
      unlisten: undefined,
    });

    await useChatStore
      .getState()
      .respondApproval("approval-1", { decision: "deny" } as ApprovalResponse);

    expect(mockIpc.respondApproval).toHaveBeenCalledWith("thread-1", "approval-1", {
      decision: "deny",
    });
    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      {
        type: "approval",
        approvalId: "approval-1",
        actionType: "command",
        summary: "Run command",
        details: {},
        status: "answered",
        decision: "decline",
      },
    ]);
  });

  it("returns failure and rolls back when an approval response is rejected", async () => {
    mockIpc.respondApproval.mockRejectedValueOnce(new Error("approval failed"));
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          status: "completed",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-1",
              actionType: "command",
              summary: "Run command",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      error: undefined,
    });

    const accepted = await useChatStore
      .getState()
      .respondApproval("approval-1", { decision: "accept" }, "thread-1");

    expect(accepted).toBe(false);
    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      { approvalId: "approval-1", status: "pending" },
    ]);
    expect(useChatStore.getState().error).toContain("approval failed");
  });

  it("preserves concurrent message updates when an approval response is rejected", async () => {
    const response = deferred<void>();
    mockIpc.respondApproval.mockReturnValueOnce(response.promise);
    useChatStore.setState({
      threadId: "thread-1",
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [
            {
              type: "approval",
              approvalId: "approval-1",
              actionType: "command",
              summary: "Run command",
              details: {},
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
      error: undefined,
    });

    const pendingResponse = useChatStore
      .getState()
      .respondApproval("approval-1", { decision: "accept" }, "thread-1");

    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      { approvalId: "approval-1", status: "answered" },
    ]);

    useChatStore.setState((state) => ({
      messages: [
        ...state.messages,
        {
          id: "assistant-2",
          threadId: "thread-1",
          role: "assistant",
          status: "streaming",
          schemaVersion: 1,
          blocks: [{ type: "text", content: "Still working" }],
          createdAt: new Date().toISOString(),
          hydration: "full",
          hasDeferredContent: false,
        },
      ],
    }));
    response.reject(new Error("approval failed"));

    await expect(pendingResponse).resolves.toBe(false);
    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState().messages[0]?.blocks).toMatchObject([
      { approvalId: "approval-1", status: "pending" },
    ]);
    expect(useChatStore.getState().messages[1]?.blocks).toMatchObject([
      { type: "text", content: "Still working" },
    ]);
  });

  it("targets an explicit thread without mutating another visible transcript", async () => {
    mockIpc.respondApproval.mockResolvedValueOnce(undefined);
    const visibleMessages = [
      {
        id: "assistant-2",
        threadId: "thread-2",
        role: "assistant" as const,
        status: "completed" as const,
        schemaVersion: 1,
        blocks: [],
        createdAt: new Date().toISOString(),
        hydration: "full" as const,
        hasDeferredContent: false,
      },
    ];
    useChatStore.setState({
      threadId: "thread-2",
      messages: visibleMessages,
      error: undefined,
    });

    const accepted = await useChatStore
      .getState()
      .respondApproval("approval-1", { decision: "accept" }, "thread-1");

    expect(accepted).toBe(true);
    expect(mockIpc.respondApproval).toHaveBeenCalledWith("thread-1", "approval-1", {
      decision: "accept",
    });
    expect(useChatStore.getState().messages).toBe(visibleMessages);
  });

});

describe("chatStore drainQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpc.sendMessage.mockResolvedValue("assistant-message-id");
    mockIpc.cancelTurn.mockResolvedValue(undefined);
    mockListenThreadEvents.mockResolvedValue(() => {});
    useChatQueueStore.setState({ queuesByThread: {} });
    useChatStore.setState({
      threadId: "thread-1",
      messages: [],
      olderCursor: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      olderLoadBlockedUntil: 0,
      status: "idle",
      streaming: false,
      usageLimits: null,
      usageLimitsLoading: false,
      error: undefined,
      unlisten: undefined,
    });
  });

  function queue(threadId: string, text: string) {
    return useChatQueueStore.getState().enqueue({ threadId, text });
  }

  it("sends the next queued message when the turn completed", async () => {
    queue("thread-1", "queued one");

    await useChatStore.getState().drainQueue("thread-1", "completed");

    expect(mockIpc.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockIpc.sendMessage.mock.calls[0]?.[1]).toBe("queued one");
    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toBeUndefined();
  });

  it("leaves the queue alone when the turn was interrupted", async () => {
    queue("thread-1", "queued one");

    await useChatStore.getState().drainQueue("thread-1", "interrupted");

    expect(mockIpc.sendMessage).not.toHaveBeenCalled();
    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(1);
  });

  it("leaves the queue alone when the turn failed", async () => {
    queue("thread-1", "queued one");

    await useChatStore.getState().drainQueue("thread-1", "failed");

    expect(mockIpc.sendMessage).not.toHaveBeenCalled();
    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(1);
  });

  it("drains when asked without a turn status", async () => {
    queue("thread-1", "queued one");

    await useChatStore.getState().drainQueue("thread-1");

    expect(mockIpc.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockIpc.sendMessage.mock.calls[0]?.[1]).toBe("queued one");
  });

  it("waits while the visible thread is still streaming", async () => {
    queue("thread-1", "queued one");
    useChatStore.setState({ streaming: true });

    await useChatStore.getState().drainQueue("thread-1", "completed");

    expect(mockIpc.sendMessage).not.toHaveBeenCalled();
    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(1);
  });

  it("requeues a background message when the send fails", async () => {
    useChatStore.setState({ threadId: "thread-2" });
    queue("thread-1", "queued one");
    mockIpc.sendMessage.mockRejectedValueOnce(new Error("engine is down"));

    await useChatStore.getState().drainQueue("thread-1", "completed");

    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(1);
  });

  it("drops a background message whose thread is gone", async () => {
    useChatStore.setState({ threadId: "thread-2" });
    queue("thread-1", "queued one");
    mockIpc.sendMessage.mockRejectedValueOnce(new Error("thread not found: thread-1"));

    await useChatStore.getState().drainQueue("thread-1", "completed");

    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toBeUndefined();
  });

  it("clears the queue when the user stops the turn", async () => {
    queue("thread-1", "queued one");
    queue("thread-1", "queued two");
    useChatStore.setState({ streaming: true, status: "streaming" });

    await useChatStore.getState().cancel();

    expect(mockIpc.cancelTurn).toHaveBeenCalledWith("thread-1");
    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toBeUndefined();
  });

  it("keeps the queue when the cancel request fails", async () => {
    queue("thread-1", "queued one");
    mockIpc.cancelTurn.mockRejectedValueOnce(new Error("cancel failed"));

    await useChatStore.getState().cancel();

    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(1);
  });
});
