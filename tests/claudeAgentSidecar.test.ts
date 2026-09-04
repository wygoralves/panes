import { afterEach, describe, expect, it } from "vitest";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createInterface } from "node:readline";

type SidecarEvent = Record<string, unknown>;

const testFilePath = fileURLToPath(import.meta.url);
const testDir = path.dirname(testFilePath);
const repoRoot = path.resolve(testDir, "..");
const sidecarScriptPath = path.join(
  repoRoot,
  "src-tauri",
  "sidecar",
  "claude-agent-sdk-server.mjs",
);
const mockSdkModulePath = pathToFileURL(
  path.join(repoRoot, "tests", "fixtures", "claude-agent-sdk-mock.mjs"),
).href;

class SidecarHarness {
  readonly child: ChildProcessWithoutNullStreams;
  readonly events: SidecarEvent[] = [];

  private stderr = "";
  private waiters: Array<{
    predicate: (event: SidecarEvent) => boolean;
    resolve: (event: SidecarEvent) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(scenario: unknown, env: Record<string, string> = {}) {
    this.child = spawn(process.execPath, [sidecarScriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_MODULE: mockSdkModulePath,
        CLAUDE_AGENT_SDK_MOCK_SCENARIO: JSON.stringify(scenario),
        PANES_DISABLE_CLAUDE_USAGE_FETCH: "1",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    }).on("line", (line) => {
      const event = JSON.parse(line) as SidecarEvent;
      this.events.push(event);
      this.resolveWaiters(event);
    });

    createInterface({
      input: this.child.stderr,
      crlfDelay: Infinity,
    }).on("line", (line) => {
      this.stderr += `${line}\n`;
    });

    this.child.once("exit", (code, signal) => {
      const error = new Error(
        `Claude sidecar exited before the test finished (code=${code}, signal=${signal}). stderr:\n${this.stderr}`,
      );
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  }

  send(payload: Record<string, unknown>) {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  waitFor(
    predicate: (event: SidecarEvent) => boolean,
    timeoutMs = 5_000,
  ): Promise<SidecarEvent> {
    const existing = this.events.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(
          new Error(
            `Timed out waiting for sidecar event.\nCaptured events:\n${JSON.stringify(this.events, null, 2)}\nStderr:\n${this.stderr}`,
          ),
        );
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve,
        reject,
        timer,
      });
    });
  }

  async close() {
    if (this.child.exitCode != null || this.child.killed) {
      return;
    }

    this.child.kill();
    await new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      setTimeout(resolve, 1_000);
    });
  }

  private resolveWaiters(event: SidecarEvent) {
    const remainingWaiters = [];
    for (const waiter of this.waiters) {
      if (!waiter.predicate(event)) {
        remainingWaiters.push(waiter);
        continue;
      }

      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
    this.waiters = remainingWaiters;
  }
}

function makeSuccessResult(
  partial: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1,
    result: "",
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    session_id: "mock-session",
    ...partial,
  };
}

function makeErrorResult(
  partial: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    errors: ["Claude query failed."],
    session_id: "mock-session",
    ...partial,
  };
}

let activeHarness: SidecarHarness | null = null;

async function spawnHarness(scenario: unknown, env: Record<string, string> = {}) {
  activeHarness = new SidecarHarness(scenario, env);
  await activeHarness.waitFor((event) => event.type === "ready");
  return activeHarness;
}

afterEach(async () => {
  await activeHarness?.close();
  activeHarness = null;
});

function parseObservationResults(harness: SidecarHarness, queryId: string) {
  const textEvent = harness.events.find(
    (event) => event.id === queryId && event.type === "text_delta",
  );
  return JSON.parse(String(textEvent?.content ?? "[]")) as Array<{
    type: string;
    result: Record<string, unknown>;
  }>;
}

describe("claude-agent-sdk-server sidecar", () => {
  it("discovers the model catalog from the selected Claude runtime", async () => {
    const harness = await spawnHarness(
      {
        models: [
          {
            value: "claude-fable-5[1m]",
            resolvedModel: "claude-fable-5",
            displayName: "Fable",
            description: "Fable 5",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
        ],
      },
      { PANES_CLAUDE_CODE_EXECUTABLE: "/tmp/claude-current" },
    );

    harness.send({
      id: "models-current",
      method: "list_models",
      params: { cwd: repoRoot },
    });

    const event = await harness.waitFor(
      (candidate) => candidate.id === "models-current" && candidate.type === "models",
    );

    expect(event).toMatchObject({
      runtimeSource: "system",
      runtimeExecutable: "/tmp/claude-current",
      models: [
        {
          value: "claude-fable-5[1m]",
          displayName: "Fable",
          supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        },
      ],
    });
  });

  it("denies Write in read-only mode even when writableRoots are present", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Write",
          input: { file_path: path.join(repoRoot, "allowed.txt") },
          toolUseID: "write-read-only",
        },
      ],
      emitObservationResult: true,
      sessionId: "session-read-only",
    });

    harness.send({
      id: "query-read-only",
      method: "query",
      params: {
        prompt: "attempt write",
        cwd: repoRoot,
        sandboxMode: "read-only",
        writableRoots: [repoRoot],
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-read-only" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-read-only");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.result.behavior).toBe("deny");
    expect(observations[0]?.result.message).toBe("File writes are disabled for this Claude thread.");
  });

  it("workspace-write allows approved roots and denies paths outside them", async () => {
    const outsidePath = path.join(path.dirname(repoRoot), "outside.txt");
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Write",
          input: { file_path: path.join(repoRoot, "inside.txt") },
          toolUseID: "write-inside",
        },
        {
          type: "permission",
          toolName: "Write",
          input: { file_path: outsidePath },
          toolUseID: "write-outside",
        },
      ],
      emitObservationResult: true,
      sessionId: "session-workspace-write",
    });

    harness.send({
      id: "query-workspace-write",
      method: "query",
      params: {
        prompt: "attempt writes",
        cwd: repoRoot,
        approvalPolicy: "trusted",
        sandboxMode: "workspace-write",
        writableRoots: [repoRoot],
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-workspace-write" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-workspace-write");
    expect(observations).toHaveLength(2);
    expect(observations[0]?.result.behavior).toBe("allow");
    expect(observations[1]?.result.behavior).toBe("deny");
    expect(observations[1]?.result.message).toBe(
      "This file path is outside the approved writable roots for the thread.",
    );
  });

  it("defaults workspace-write roots to cwd when writableRoots are omitted", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Write",
          input: { file_path: path.join(repoRoot, "inside-default-root.txt") },
          toolUseID: "write-default-root",
        },
      ],
      emitObservationResult: true,
      sessionId: "session-default-root",
    });

    harness.send({
      id: "query-default-root",
      method: "query",
      params: {
        prompt: "attempt write",
        cwd: repoRoot,
        approvalPolicy: "trusted",
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-default-root" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-default-root");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.result.behavior).toBe("allow");
  });

  it("uses interactive default permission mode for non-plan queries", async () => {
    const harness = await spawnHarness({
      steps: [],
      emitObservationResult: true,
      emitQueryOptions: true,
      sessionId: "session-permission-mode",
    });

    harness.send({
      id: "query-permission-mode",
      method: "query",
      params: {
        prompt: "inspect options",
        cwd: repoRoot,
      },
    });

    await harness.waitFor(
      (event) =>
        event.id === "query-permission-mode" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-permission-mode");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.type).toBe("query_options");
    expect(observations[0]?.result.permissionMode).toBe("default");
    // Bare tool names in `allowedTools` auto-approve and shadow canUseTool, so
    // the sidecar must not forward them to the SDK.
    expect(observations[0]?.result.allowedTools).toBeUndefined();
    expect(observations[0]?.result.tools).toBeUndefined();
    expect(observations[0]?.result.settingSources).toBeUndefined();
    expect(observations[0]?.result.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
    });
    expect(observations[0]?.result.todoToolsEnabled).toBe("1");
    expect(observations[0]?.result.settings).toEqual({
      permissions: {
        defaultMode: "default",
        disableBypassPermissionsMode: "disable",
      },
    });
  });

  it("skips a task update for an id it never saw created", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "init",
            session_id: "session-unknown-task",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "TaskUpdate",
            tool_input: { taskId: "404", status: "in_progress" },
            tool_use_id: "task-update-unknown",
            tool_response: { success: true },
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({ session_id: "session-unknown-task" }),
        },
      ],
    });

    harness.send({
      id: "query-unknown-task",
      method: "query",
      params: { prompt: "update a phantom task", cwd: repoRoot },
    });

    await harness.waitFor(
      (event) => event.id === "query-unknown-task" && event.type === "turn_completed",
    );

    expect(
      harness.events.filter(
        (event) =>
          event.id === "query-unknown-task" && event.type === "task_list_updated",
      ),
    ).toHaveLength(0);
  });

  it("keeps an explicit allowlist exactly as the caller sent it", async () => {
    const harness = await spawnHarness({
      steps: [],
      emitObservationResult: true,
      emitQueryOptions: true,
      sessionId: "session-explicit-allowlist",
    });

    harness.send({
      id: "query-explicit-allowlist",
      method: "query",
      params: {
        prompt: "inspect options",
        cwd: repoRoot,
        allowedTools: ["Read", "Grep"],
      },
    });

    await harness.waitFor(
      (event) =>
        event.id === "query-explicit-allowlist" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-explicit-allowlist");
    expect(observations[0]?.result.allowedTools).toBeUndefined();
    expect(observations[0]?.result.tools).toEqual(["Read", "Grep"]);
  });

  it("runs danger-full-access without the OS sandbox and without a writable-root fence", async () => {
    const outsidePath = path.join(path.dirname(repoRoot), "outside-full-access.txt");
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Write",
          input: { file_path: outsidePath },
          toolUseID: "write-full-access",
        },
      ],
      emitObservationResult: true,
      emitQueryOptions: true,
      sessionId: "session-full-access",
    });

    harness.send({
      id: "query-full-access",
      method: "query",
      params: {
        prompt: "write anywhere",
        cwd: repoRoot,
        approvalPolicy: "trusted",
        allowNetwork: true,
        sandboxMode: "danger-full-access",
        writableRoots: [repoRoot],
      },
    });

    const completed = await harness.waitFor(
      (event) => event.id === "query-full-access" && event.type === "turn_completed",
    );
    expect(completed.status).toBe("completed");

    const observations = parseObservationResults(harness, "query-full-access");
    expect(observations).toHaveLength(2);
    expect(observations[0]?.type).toBe("query_options");
    expect(observations[0]?.result.sandbox).toEqual({ enabled: false });
    expect(observations[0]?.result.forwardSubagentText).toBe(true);
    expect(observations[1]?.type).toBe("permission_result");
    expect(observations[1]?.result).toEqual({ behavior: "allow" });
  });

  it("still denies writes in read-only mode when full access is not requested", async () => {
    const harness = await spawnHarness({
      steps: [],
      emitObservationResult: true,
      emitQueryOptions: true,
      sessionId: "session-sandboxed",
    });

    harness.send({
      id: "query-sandboxed",
      method: "query",
      params: {
        prompt: "inspect sandbox",
        cwd: repoRoot,
        sandboxMode: "workspace-write",
        writableRoots: [repoRoot],
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-sandboxed" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-sandboxed");
    expect(observations[0]?.result.sandbox).toMatchObject({
      enabled: true,
      filesystem: { allowWrite: [repoRoot] },
      network: { allowedDomains: [] },
    });
  });

  it("marks terminal SDK errors as failed turns", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "init",
            session_id: "session-error",
          },
        },
        {
          type: "yield",
          message: makeErrorResult({
            session_id: "session-error",
            errors: ["tool execution exploded", "budget exceeded"],
          }),
        },
      ],
    });

    harness.send({
      id: "query-error",
      method: "query",
      params: {
        prompt: "run failing scenario",
        cwd: repoRoot,
      },
    });

    const completed = await harness.waitFor(
      (event) => event.id === "query-error" && event.type === "turn_completed",
    );
    const errorEvent = harness.events.find(
      (event) => event.id === "query-error" && event.type === "error",
    );

    expect(errorEvent?.message).toBe("tool execution exploded\nbudget exceeded");
    expect(completed.status).toBe("failed");
    expect(completed.sessionId).toBe("session-error");
  });

  it("surfaces assistant errors, status notices, rate limits, and token usage", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "init",
            session_id: "session-events",
          },
        },
        {
          type: "yield",
          message: {
            type: "assistant",
            error: "authentication_failed",
            session_id: "session-events",
          },
        },
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "status",
            status: "compacting",
            session_id: "session-events",
          },
        },
        {
          type: "yield",
          message: {
            type: "rate_limit_event",
            session_id: "session-events",
            rate_limit_info: {
              rateLimitType: "five_hour",
              utilization: 0.87,
              resetsAt: 1_740_000_000,
            },
          },
        },
        {
          type: "yield",
          message: {
            type: "stream_event",
            session_id: "session-events",
            event: {
              type: "message_start",
              message: {
                usage: {
                  input_tokens: 11,
                  output_tokens: 2,
                },
              },
            },
          },
        },
        {
          type: "yield",
          message: {
            type: "stream_event",
            session_id: "session-events",
            event: {
              type: "message_delta",
              delta: {
                stop_reason: "end_turn",
              },
              usage: {
                output_tokens: 7,
              },
            },
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({
            session_id: "session-events",
            usage: {
              input_tokens: 11,
              output_tokens: 7,
            },
          }),
        },
      ],
    });

    harness.send({
      id: "query-events",
      method: "query",
      params: {
        prompt: "surface events",
        cwd: repoRoot,
      },
    });

    const completed = await harness.waitFor(
      (event) => event.id === "query-events" && event.type === "turn_completed",
    );
    const errorEvent = harness.events.find(
      (event) => event.id === "query-events" && event.type === "error",
    );
    const noticeEvent = harness.events.find(
      (event) => event.id === "query-events" && event.type === "notice",
    );
    const usageEvent = harness.events.find(
      (event) => event.id === "query-events" && event.type === "usage_limits_updated",
    );

    expect(errorEvent).toMatchObject({
      message: "Claude authentication failed. Sign in again or refresh your credentials.",
      errorType: "authentication_failed",
      isAuthError: true,
      recoverable: false,
    });
    expect(noticeEvent).toMatchObject({
      kind: "claude_status",
      title: "Claude status",
      message: "Claude is compacting context.",
    });
    expect(usageEvent).toMatchObject({
      usage: {
        fiveHourPercent: 87,
        fiveHourResetsAt: 1_740_000_000,
      },
    });
    expect(completed).toMatchObject({
      status: "failed",
      sessionId: "session-events",
      tokenUsage: {
        input: 11,
        output: 7,
      },
      stopReason: "end_turn",
    });
  });

  it("keeps the Fable weekly limit separate and reports Fable context", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: {
            type: "rate_limit_event",
            rate_limit_info: {
              rateLimitType: "seven_day",
              utilization: 0.25,
              resetsAt: 1_740_000_000,
            },
          },
        },
        {
          type: "yield",
          message: {
            type: "rate_limit_event",
            rate_limit_info: {
              rateLimitType: "seven_day_overage_included",
              utilization: 0.4,
              resetsAt: 1_740_100_000,
            },
          },
        },
        {
          type: "yield",
          message: {
            type: "stream_event",
            event: {
              type: "message_start",
              message: {
                usage: {
                  input_tokens: 25_000,
                  cache_creation_input_tokens: 5_000,
                  cache_read_input_tokens: 20_000,
                  output_tokens: 0,
                },
              },
            },
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({
            session_id: "session-fable-usage",
            usage: { input_tokens: 25_000, output_tokens: 10 },
          }),
        },
      ],
    });

    harness.send({
      id: "query-fable-usage",
      method: "query",
      params: {
        prompt: "surface Fable usage",
        cwd: repoRoot,
        model: "claude-fable-5[1m]",
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-fable-usage" && event.type === "turn_completed",
    );

    const usageEvents = harness.events.filter(
      (event) => event.id === "query-fable-usage" && event.type === "usage_limits_updated",
    );
    expect(usageEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          usage: expect.objectContaining({
            weeklyPercent: 25,
            fableWeeklyPercent: null,
          }),
        }),
        expect.objectContaining({
          usage: expect.objectContaining({
            weeklyPercent: null,
            fableWeeklyPercent: 40,
            fableWeeklyResetsAt: 1_740_100_000,
          }),
        }),
        expect.objectContaining({
          usage: expect.objectContaining({ contextWindowPercent: 95 }),
        }),
      ]),
    );
  });

  it("loads current Claude usage including the scoped Fable weekly limit", async () => {
    let authorizationHeader = "";
    const usageServer = createServer((request, response) => {
      authorizationHeader = String(request.headers.authorization || "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          five_hour: {
            utilization: 12,
            resets_at: "2026-07-12T07:30:00Z",
          },
          seven_day: {
            utilization: 46,
            resets_at: "2026-07-13T12:00:00Z",
          },
          limits: [
            {
              kind: "weekly_scoped",
              percent: 76,
              resets_at: "2026-07-13T12:00:00Z",
              scope: { model: { display_name: "Fable" } },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => usageServer.listen(0, "127.0.0.1", resolve));
    const address = usageServer.address() as AddressInfo;

    try {
      const harness = await spawnHarness(
        { steps: [] },
        {
          CLAUDE_CODE_OAUTH_TOKEN: "test-oauth-token",
          PANES_DISABLE_CLAUDE_USAGE_FETCH: "0",
          PANES_CLAUDE_USAGE_URL: `http://127.0.0.1:${address.port}/api/oauth/usage`,
        },
      );

      harness.send({
        id: "current-usage",
        method: "get_usage_limits",
      });

      const usageEvent = await harness.waitFor(
        (event) =>
          event.id === "current-usage" &&
          event.type === "usage_limits_updated" &&
          (event.usage as Record<string, unknown>)?.fableWeeklyPercent === 76,
      );

      expect(authorizationHeader).toBe("Bearer test-oauth-token");
      expect(usageEvent).toMatchObject({
        usage: {
          fiveHourPercent: 12,
          weeklyPercent: 46,
          fableWeeklyPercent: 76,
          fableWeeklyResetsAt: 1_783_944_000,
        },
      });
    } finally {
      await activeHarness?.close();
      await new Promise<void>((resolve, reject) =>
        usageServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("uses tool_response and emits action output deltas", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "printf ok" },
            tool_use_id: "tool-1",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "printf ok" },
            tool_use_id: "tool-1",
            tool_response: "stdout: ok",
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({ session_id: "session-tool-output" }),
        },
      ],
    });

    harness.send({
      id: "query-tool-output",
      method: "query",
      params: {
        prompt: "run tool output scenario",
        cwd: repoRoot,
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-tool-output" && event.type === "turn_completed",
    );

    const started = harness.events.find(
      (event) =>
        event.id === "query-tool-output" &&
        event.type === "action_started" &&
        (event.details as Record<string, unknown> | undefined)?.command === "printf ok",
    );
    const outputDelta = harness.events.find(
      (event) =>
        event.id === "query-tool-output" &&
        event.type === "action_output_delta" &&
        event.content === "stdout: ok",
    );
    const completed = harness.events.find(
      (event) =>
        event.id === "query-tool-output" &&
        event.type === "action_completed",
    );

    expect(started?.actionId).toBeDefined();
    expect(outputDelta?.actionId).toBe(started?.actionId);
    expect(outputDelta?.stream).toBe("stdout");
    expect(completed?.actionId).toBe(started?.actionId);
    expect(completed?.output).toBe("stdout: ok");
  });

  it("emits Claude task snapshots without generic action cards", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "init",
            session_id: "session-tasks",
          },
        },
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "TaskCreate",
            tool_input: {
              subject: "Inspect the sidebar",
              description: "Review the existing thread navigation.",
              activeForm: "Inspecting the sidebar",
            },
            tool_use_id: "task-create-1",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "TaskCreate",
            tool_input: {
              subject: "Inspect the sidebar",
              description: "Review the existing thread navigation.",
              activeForm: "Inspecting the sidebar",
            },
            tool_use_id: "task-create-1",
            tool_response: "Task #1 created successfully: Inspect the sidebar",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "TaskUpdate",
            tool_input: { taskId: "1", status: "in_progress" },
            tool_use_id: "task-update-1",
            tool_response: { success: true },
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({ session_id: "session-tasks" }),
        },
      ],
    });

    harness.send({
      id: "query-tasks",
      method: "query",
      params: { prompt: "work through the task", cwd: repoRoot },
    });

    await harness.waitFor(
      (event) => event.id === "query-tasks" && event.type === "turn_completed",
    );

    const taskEvents = harness.events.filter(
      (event) => event.id === "query-tasks" && event.type === "task_list_updated",
    );
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents[0]?.tasks).toEqual([
      expect.objectContaining({
        id: "1",
        title: "Inspect the sidebar",
        status: "pending",
        activeForm: "Inspecting the sidebar",
      }),
    ]);
    expect(taskEvents[1]?.tasks).toEqual([
      expect.objectContaining({ id: "1", status: "in_progress" }),
    ]);
    expect(
      harness.events.some(
        (event) => event.id === "query-tasks" && event.type === "action_started",
      ),
    ).toBe(false);
  });

  it("streams long tool output in chunks without truncation", async () => {
    const longOutput = "x".repeat(10_500);
    const harness = await spawnHarness({
      steps: [
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "python - <<'PY'" },
            tool_use_id: "tool-long-output",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "python - <<'PY'" },
            tool_use_id: "tool-long-output",
            tool_response: longOutput,
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({ session_id: "session-long-output" }),
        },
      ],
    });

    harness.send({
      id: "query-long-output",
      method: "query",
      params: {
        prompt: "stream long output",
        cwd: repoRoot,
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-long-output" && event.type === "turn_completed",
    );

    const chunks = harness.events.filter(
      (event) =>
        event.id === "query-long-output" && event.type === "action_output_delta",
    );
    const completed = harness.events.find(
      (event) =>
        event.id === "query-long-output" && event.type === "action_completed",
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((event) => String(event.content ?? "")).join("")).toBe(longOutput);
    expect(completed?.output).toBe(longOutput);
  });

  it("returns updatedPermissions for accept_for_session approvals", async () => {
    const suggestions = [
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "npm test" }],
        behavior: "allow",
        destination: "session",
      },
    ];
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "permission-tool-1",
          options: { suggestions },
        },
      ],
      emitObservationResult: true,
      sessionId: "session-approval",
    });

    harness.send({
      id: "query-approval",
      method: "query",
      params: {
        prompt: "request approval",
        cwd: repoRoot,
        approvalPolicy: "untrusted",
      },
    });

    const approvalEvent = await harness.waitFor(
      (event) => event.id === "query-approval" && event.type === "approval_requested",
    );
    harness.send({
      method: "approval_response",
      params: {
        approvalId: approvalEvent.approvalId,
        response: { decision: "accept_for_session" },
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-approval" && event.type === "turn_completed",
    );

    const textEvent = harness.events.find(
      (event) => event.id === "query-approval" && event.type === "text_delta",
    );
    const observations = JSON.parse(String(textEvent?.content ?? "[]")) as Array<{
      type: string;
      result: Record<string, unknown>;
    }>;

    expect(observations).toHaveLength(1);
    expect(observations[0]?.type).toBe("permission_result");
    expect(observations[0]?.result.behavior).toBe("allow");
    expect(observations[0]?.result.updatedPermissions).toEqual(suggestions);
  });

  it("routes AskUserQuestion approvals through updatedInput answers", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "AskUserQuestion",
          input: {
            questions: [
              {
                id: "stack",
                header: "Stack",
                question: "Which package manager should we use?",
                options: [
                  { label: "pnpm", description: "Recommended" },
                  { label: "npm", description: "Fallback" },
                ],
                multiSelect: false,
              },
            ],
          },
          toolUseID: "ask-user-question-1",
        },
      ],
      emitObservationResult: true,
      sessionId: "session-ask-user-question",
    });

    harness.send({
      id: "query-ask-user-question",
      method: "query",
      params: {
        prompt: "ask the user a question",
        cwd: repoRoot,
      },
    });

    const approvalEvent = await harness.waitFor(
      (event) =>
        event.id === "query-ask-user-question" &&
        event.type === "approval_requested",
    );
    expect(approvalEvent.details).toEqual({
      _serverMethod: "item/tool/requestuserinput",
      questions: [
        {
          id: "stack",
          header: "Stack",
          question: "Which package manager should we use?",
          options: [
            { label: "pnpm", description: "Recommended" },
            { label: "npm", description: "Fallback" },
          ],
          multiSelect: false,
        },
      ],
    });

    harness.send({
      method: "approval_response",
      params: {
        approvalId: approvalEvent.approvalId,
        response: {
          answers: {
            stack: {
              answers: ["pnpm"],
            },
          },
        },
      },
    });

    await harness.waitFor(
      (event) =>
        event.id === "query-ask-user-question" && event.type === "turn_completed",
    );

    const observations = parseObservationResults(harness, "query-ask-user-question");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.result).toEqual({
      behavior: "allow",
      updatedInput: {
        questions: [
          {
            id: "stack",
            header: "Stack",
            question: "Which package manager should we use?",
            options: [
              { label: "pnpm", description: "Recommended" },
              { label: "npm", description: "Fallback" },
            ],
            multiSelect: false,
          },
        ],
        answers: {
          "Which package manager should we use?": "pnpm",
        },
      },
    });
  });

  it("denies malformed approval payloads instead of hanging the query", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "permission-invalid-approval",
        },
      ],
      emitObservationResult: true,
      sessionId: "session-invalid-approval",
    });

    harness.send({
      id: "query-invalid-approval",
      method: "query",
      params: {
        prompt: "request approval",
        cwd: repoRoot,
        approvalPolicy: "restricted",
      },
    });

    const approvalEvent = await harness.waitFor(
      (event) => event.id === "query-invalid-approval" && event.type === "approval_requested",
    );
    harness.send({
      method: "approval_response",
      params: {
        approvalId: approvalEvent.approvalId,
        response: {},
      },
    });

    const errorEvent = await harness.waitFor(
      (event) => event.id === "query-invalid-approval" && event.type === "error",
    );
    const completed = await harness.waitFor(
      (event) => event.id === "query-invalid-approval" && event.type === "turn_completed",
    );

    expect(errorEvent.message).toContain("explicit decision field");
    expect(completed.status).toBe("completed");

    const observations = parseObservationResults(harness, "query-invalid-approval");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.result).toEqual({
      behavior: "deny",
      message: "Claude approval response was invalid and was denied.",
    });
  });

  it("emits synthetic action completion when a prestarted tool is denied", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "npm publish" },
            tool_use_id: "tool-denied",
          },
        },
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm publish" },
          toolUseID: "tool-denied",
        },
      ],
      sessionId: "session-denied-tool",
    });

    harness.send({
      id: "query-denied-tool",
      method: "query",
      params: {
        prompt: "deny the tool",
        cwd: repoRoot,
        approvalPolicy: "restricted",
      },
    });

    const approvalEvent = await harness.waitFor(
      (event) =>
        event.id === "query-denied-tool" && event.type === "approval_requested",
    );
    const started = await harness.waitFor(
      (event) =>
        event.id === "query-denied-tool" && event.type === "action_started",
    );

    harness.send({
      method: "approval_response",
      params: {
        approvalId: approvalEvent.approvalId,
        response: { decision: "decline" },
      },
    });

    const completed = await harness.waitFor(
      (event) =>
        event.id === "query-denied-tool" && event.type === "action_completed",
    );

    expect(completed).toMatchObject({
      actionId: started.actionId,
      success: false,
      error: "Tool usage denied by the user.",
    });
  });

  it("emits interrupted turn completion before exiting on SIGTERM", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "tool-sigterm",
        },
      ],
      sessionId: "session-sigterm",
    });

    harness.send({
      id: "query-sigterm",
      method: "query",
      params: {
        prompt: "wait for approval",
        cwd: repoRoot,
        approvalPolicy: "restricted",
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-sigterm" && event.type === "approval_requested",
    );

    harness.child.kill("SIGTERM");

    const completed = await harness.waitFor(
      (event) => event.id === "query-sigterm" && event.type === "turn_completed",
    );

    expect(completed.status).toBe("interrupted");
  });

  it("matches tool completions by tool_use_id when hooks interleave", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "echo first" },
            tool_use_id: "tool-first",
          },
        },
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "echo second" },
            tool_use_id: "tool-second",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "echo first" },
            tool_use_id: "tool-first",
            tool_response: "first output",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "Bash",
            tool_input: { command: "echo second" },
            tool_use_id: "tool-second",
            tool_response: "second output",
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({ session_id: "session-interleaving" }),
        },
      ],
    });

    harness.send({
      id: "query-interleaving",
      method: "query",
      params: {
        prompt: "run interleaved hooks",
        cwd: repoRoot,
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-interleaving" && event.type === "turn_completed",
    );

    const firstStart = harness.events.find(
      (event) =>
        event.id === "query-interleaving" &&
        event.type === "action_started" &&
        (event.details as Record<string, unknown> | undefined)?.command === "echo first",
    );
    const secondStart = harness.events.find(
      (event) =>
        event.id === "query-interleaving" &&
        event.type === "action_started" &&
        (event.details as Record<string, unknown> | undefined)?.command === "echo second",
    );
    const completions = harness.events.filter(
      (event) =>
        event.id === "query-interleaving" && event.type === "action_completed",
    );
    const firstCompletion = completions[0];
    const secondCompletion = completions[1];

    expect(firstCompletion?.actionId).toBe(firstStart?.actionId);
    expect(secondCompletion?.actionId).toBe(secondStart?.actionId);
    expect(firstCompletion?.actionId).not.toBe(secondStart?.actionId);
    expect(secondCompletion?.actionId).not.toBe(firstStart?.actionId);
  });

  it("steers a running turn by pushing a next-priority user message", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "init",
            session_id: "session-steer",
          },
        },
        { type: "await_input", count: 2 },
        { type: "observe_input" },
      ],
      emitObservationResult: true,
      sessionId: "session-steer",
    });

    harness.send({
      id: "query-steer",
      method: "query",
      params: { prompt: "start the work", cwd: repoRoot },
    });

    await harness.waitFor(
      (event) => event.id === "query-steer" && event.type === "session_init",
    );

    harness.send({
      id: "steer-1",
      method: "steer",
      params: { requestId: "query-steer", prompt: "also update the docs" },
    });

    const steered = await harness.waitFor((event) => event.id === "steer-1");
    expect(steered).toMatchObject({ type: "steer_result", ok: true });

    const completed = await harness.waitFor(
      (event) => event.id === "query-steer" && event.type === "turn_completed",
    );
    expect(completed.status).toBe("completed");

    const observations = parseObservationResults(harness, "query-steer");
    const inputs = observations.find((entry) => entry.type === "input_messages")
      ?.result as unknown as Array<Record<string, unknown>>;
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text: "start the work" }] },
    });
    expect(inputs[0]).not.toHaveProperty("priority");
    expect(inputs[1]).toMatchObject({
      type: "user",
      parent_tool_use_id: null,
      priority: "next",
      message: { role: "user", content: [{ type: "text", text: "also update the docs" }] },
    });
    expect(typeof inputs[1]?.uuid).toBe("string");
  });

  it("rejects a steer for a request that is not running", async () => {
    const harness = await spawnHarness({ steps: [] });

    harness.send({
      id: "steer-missing",
      method: "steer",
      params: { requestId: "query-nope", prompt: "hello" },
    });

    const errorEvent = await harness.waitFor((event) => event.id === "steer-missing");
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.message).toContain("No active Claude query for request query-nope");
  });

  it("attributes subagent tool calls and text to the Task call that spawned them", async () => {
    const taskInput = {
      description: "Explore the repo",
      prompt: "Find the entry point",
      subagent_type: "Explore",
      name: "scout",
    };
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: { type: "system", subtype: "init", session_id: "session-subagents" },
        },
        {
          type: "hook",
          hook: "PreToolUse",
          input: { tool_name: "Task", tool_input: taskInput, tool_use_id: "toolu_task_1" },
        },
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "task_started",
            task_id: "agent-1",
            tool_use_id: "toolu_task_1",
            description: "Explore the repo",
            subagent_type: "Explore",
            task_type: "local_agent",
            session_id: "session-subagents",
          },
        },
        {
          type: "hook",
          hook: "SubagentStart",
          input: { agent_id: "agent-1", agent_type: "Explore" },
        },
        {
          type: "hook",
          hook: "PreToolUse",
          input: {
            tool_name: "Read",
            tool_input: { file_path: "src/main.rs" },
            tool_use_id: "toolu_read_1",
            agent_id: "agent-1",
            agent_type: "Explore",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "Read",
            tool_input: { file_path: "src/main.rs" },
            tool_use_id: "toolu_read_1",
            tool_response: "fn main() {}",
            agent_id: "agent-1",
            agent_type: "Explore",
          },
        },
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "task_progress",
            task_id: "agent-1",
            tool_use_id: "toolu_task_1",
            description: "Explore the repo",
            summary: "Reading src/main.rs",
            usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 },
            session_id: "session-subagents",
          },
        },
        {
          type: "yield",
          message: {
            type: "assistant",
            parent_tool_use_id: "toolu_task_1",
            message: {
              id: "msg_sub_1",
              role: "assistant",
              content: [
                { type: "thinking", thinking: "Looking at main" },
                { type: "text", text: "The entry point is src/main.rs" },
              ],
            },
            session_id: "session-subagents",
          },
        },
        {
          type: "hook",
          hook: "SubagentStop",
          input: {
            agent_id: "agent-1",
            agent_type: "Explore",
            last_assistant_message: "The entry point is src/main.rs",
          },
        },
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "task_updated",
            task_id: "agent-1",
            patch: { status: "completed" },
            session_id: "session-subagents",
          },
        },
        {
          type: "hook",
          hook: "PostToolUse",
          input: {
            tool_name: "Task",
            tool_input: taskInput,
            tool_use_id: "toolu_task_1",
            tool_response: "The entry point is src/main.rs",
          },
        },
      ],
      emitObservationResult: true,
      sessionId: "session-subagents",
    });

    harness.send({
      id: "query-subagents",
      method: "query",
      params: { prompt: "explore", cwd: repoRoot },
    });

    const started = await harness.waitFor(
      (event) => event.id === "query-subagents" && event.type === "subagent_started",
    );

    await harness.waitFor(
      (event) => event.id === "query-subagents" && event.type === "turn_completed",
    );

    const events = harness.events.filter((event) => event.id === "query-subagents");
    const taskAction = events.find(
      (event) => event.type === "action_started" && event.toolName === "Task",
    );
    const readAction = events.find(
      (event) => event.type === "action_started" && event.toolName === "Read",
    );
    expect(taskAction).toBeDefined();
    expect(taskAction).not.toHaveProperty("agentId");
    expect(taskAction?.summary).toBe("Task: Explore the repo");
    expect(readAction).toMatchObject({ agentId: "toolu_task_1" });

    expect(started).toMatchObject({
      agentId: "toolu_task_1",
      agentType: "Explore",
      description: "Explore the repo",
      parentActionId: taskAction?.actionId,
      parentAgentId: null,
    });
    expect(
      events.find((event) => event.type === "subagent_progress"),
    ).toMatchObject({ agentId: "toolu_task_1", message: "Reading src/main.rs" });
    expect(
      events.find((event) => event.type === "subagent_thinking_delta"),
    ).toMatchObject({ agentId: "toolu_task_1", content: "Looking at main" });
    expect(
      events.find((event) => event.type === "subagent_text_delta"),
    ).toMatchObject({ agentId: "toolu_task_1", content: "The entry point is src/main.rs" });

    const completions = events.filter((event) => event.type === "subagent_completed");
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      agentId: "toolu_task_1",
      status: "completed",
      summary: "The entry point is src/main.rs",
    });
  });

  it("closes out subagents that never report completion when the turn ends", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: { type: "system", subtype: "init", session_id: "session-open-subagent" },
        },
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "task_started",
            task_id: "agent-2",
            tool_use_id: "toolu_task_2",
            description: "Review the diff",
            subagent_type: "code-reviewer",
            task_type: "local_agent",
            session_id: "session-open-subagent",
          },
        },
        {
          type: "yield",
          message: {
            type: "system",
            subtype: "task_started",
            task_id: "bash-1",
            tool_use_id: "toolu_bash_1",
            description: "pnpm test",
            task_type: "local_bash",
            session_id: "session-open-subagent",
          },
        },
        {
          type: "yield",
          message: makeSuccessResult({ session_id: "session-open-subagent" }),
        },
      ],
    });

    harness.send({
      id: "query-open-subagent",
      method: "query",
      params: { prompt: "review", cwd: repoRoot },
    });

    const completed = await harness.waitFor(
      (event) => event.id === "query-open-subagent" && event.type === "turn_completed",
    );

    const events = harness.events.filter((event) => event.id === "query-open-subagent");
    const started = events.filter((event) => event.type === "subagent_started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ agentId: "toolu_task_2", parentActionId: null });
    const closed = events.filter((event) => event.type === "subagent_completed");
    expect(closed).toEqual([
      expect.objectContaining({ agentId: "toolu_task_2", status: "completed", summary: null }),
    ]);
    expect(events.indexOf(closed[0]!)).toBeLessThan(events.indexOf(completed));
  });

  it("interrupts the running query on cancel and keeps the interrupted session", async () => {
    const harness = await spawnHarness({
      supportsInterrupt: true,
      interruptedSessionId: "session-after-interrupt",
      steps: [
        {
          type: "yield",
          message: { type: "system", subtype: "init", session_id: "session-cancel" },
        },
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "tool-cancel",
        },
      ],
      sessionId: "session-cancel",
    });

    harness.send({
      id: "query-cancel",
      method: "query",
      params: { prompt: "wait for approval", cwd: repoRoot, approvalPolicy: "restricted" },
    });

    await harness.waitFor(
      (event) => event.id === "query-cancel" && event.type === "approval_requested",
    );
    harness.send({ method: "cancel", params: { requestId: "query-cancel" } });

    const completed = await harness.waitFor(
      (event) => event.id === "query-cancel" && event.type === "turn_completed",
    );
    expect(completed).toMatchObject({
      status: "interrupted",
      sessionId: "session-after-interrupt",
    });
    expect(
      harness.events.some(
        (event) => event.id === "query-cancel" && event.type === "text_delta",
      ),
    ).toBe(false);
  });

  it("acknowledges a cancel only once the interrupted query has stopped", async () => {
    const harness = await spawnHarness({
      supportsInterrupt: true,
      interruptedSessionId: "session-cancel-ack",
      steps: [
        {
          type: "yield",
          message: { type: "system", subtype: "init", session_id: "session-cancel-ack" },
        },
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "tool-cancel-ack",
        },
      ],
      sessionId: "session-cancel-ack",
    });

    harness.send({
      id: "query-cancel-ack",
      method: "query",
      params: { prompt: "wait for approval", cwd: repoRoot, approvalPolicy: "restricted" },
    });

    await harness.waitFor(
      (event) => event.id === "query-cancel-ack" && event.type === "approval_requested",
    );
    harness.send({
      id: "cancel-ack-1",
      method: "cancel",
      params: { requestId: "query-cancel-ack" },
    });

    const ack = await harness.waitFor(
      (event) => event.id === "cancel-ack-1" && event.type === "cancel_result",
    );
    expect(ack).toMatchObject({
      ok: true,
      requestId: "query-cancel-ack",
      closed: false,
    });

    const completedIndex = harness.events.findIndex(
      (event) => event.id === "query-cancel-ack" && event.type === "turn_completed",
    );
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    // The acknowledgement is the last word: the query had already yielded its
    // final result when it landed.
    expect(harness.events.indexOf(ack)).toBeGreaterThan(completedIndex);
  });

  it("acknowledges a cancel for a turn that already finished", async () => {
    const harness = await spawnHarness({ steps: [] });

    harness.send({
      id: "cancel-unknown",
      method: "cancel",
      params: { requestId: "query-gone" },
    });

    const ack = await harness.waitFor((event) => event.id === "cancel-unknown");
    expect(ack).toMatchObject({
      type: "cancel_result",
      ok: true,
      requestId: "query-gone",
      closed: false,
    });
  });

  it("closes a query that ignores the interrupt once the cancel grace expires", async () => {
    const harness = await spawnHarness(
      {
        steps: [
          {
            type: "yield",
            message: { type: "system", subtype: "init", session_id: "session-grace" },
          },
          { type: "delay", durationMs: 4_000 },
        ],
        sessionId: "session-grace",
      },
      { PANES_CLAUDE_CANCEL_GRACE_MS: "200" },
    );

    harness.send({
      id: "query-grace",
      method: "query",
      params: { prompt: "run a long tool", cwd: repoRoot, approvalPolicy: "trusted" },
    });

    await harness.waitFor(
      (event) => event.id === "query-grace" && event.type === "session_init",
    );
    harness.send({
      id: "cancel-grace",
      method: "cancel",
      params: { requestId: "query-grace" },
    });

    const ack = await harness.waitFor(
      (event) => event.id === "cancel-grace" && event.type === "cancel_result",
    );
    // The query never answered the interrupt, so the sidecar closed it and
    // reported the request as over anyway.
    expect(ack).toMatchObject({ ok: true, requestId: "query-grace", closed: true });
    expect(
      harness.events.some(
        (event) => event.id === "query-grace" && event.type === "turn_completed",
      ),
    ).toBe(false);
  });

  it("holds the next turn on a session until the canceled query has stopped", async () => {
    const harness = await spawnHarness({
      supportsInterrupt: true,
      interruptedSessionId: "session-serialized",
      steps: [
        {
          type: "yield",
          message: { type: "system", subtype: "init", session_id: "session-serialized" },
        },
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "tool-serialized",
        },
      ],
      sessionId: "session-serialized",
    });

    harness.send({
      id: "query-first",
      method: "query",
      params: {
        prompt: "start the work",
        cwd: repoRoot,
        approvalPolicy: "restricted",
        sessionId: "session-serialized",
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-first" && event.type === "approval_requested",
    );
    harness.send({
      id: "cancel-first",
      method: "cancel",
      params: { requestId: "query-first" },
    });
    harness.send({
      id: "query-second",
      method: "query",
      params: {
        prompt: "start the replacement",
        cwd: repoRoot,
        approvalPolicy: "restricted",
        sessionId: "session-serialized",
      },
    });

    const ack = await harness.waitFor(
      (event) => event.id === "cancel-first" && event.type === "cancel_result",
    );
    const secondInit = await harness.waitFor(
      (event) => event.id === "query-second" && event.type === "session_init",
    );

    // The replacement turn only reached the CLI after the canceled one stopped.
    expect(harness.events.indexOf(secondInit)).toBeGreaterThan(
      harness.events.indexOf(ack),
    );
  });

  it("answers steer requests the canceled turn never delivered", async () => {
    const harness = await spawnHarness(
      {
        steps: [
          {
            type: "yield",
            message: { type: "system", subtype: "init", session_id: "session-queued-steer" },
          },
          { type: "delay", durationMs: 4_000 },
        ],
        sessionId: "session-queued-steer",
      },
      { PANES_CLAUDE_CANCEL_GRACE_MS: "700" },
    );

    harness.send({
      id: "query-blocking",
      method: "query",
      params: {
        prompt: "run a long tool",
        cwd: repoRoot,
        approvalPolicy: "trusted",
        sessionId: "session-queued-steer",
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-blocking" && event.type === "session_init",
    );
    // The first query cannot be interrupted, so the next turn queues behind it.
    harness.send({
      id: "cancel-blocking",
      method: "cancel",
      params: { requestId: "query-blocking" },
    });
    harness.send({
      id: "query-waiting",
      method: "query",
      params: {
        prompt: "start the replacement",
        cwd: repoRoot,
        approvalPolicy: "trusted",
        sessionId: "session-queued-steer",
      },
    });

    await harness.waitFor(
      (event) => event.id === "query-waiting" && event.type === "turn_started",
    );
    harness.send({
      id: "steer-waiting",
      method: "steer",
      params: { requestId: "query-waiting", prompt: "also update the docs" },
    });
    await harness.waitFor(
      (event) => event.id === "steer-waiting" && event.type === "steer_result",
    );

    harness.send({
      id: "cancel-waiting",
      method: "cancel",
      params: { requestId: "query-waiting" },
    });

    const steerError = await harness.waitFor(
      (event) => event.id === "steer-waiting" && event.type === "error",
    );
    expect(String(steerError.message)).toContain(
      "was canceled before this message was delivered",
    );

    const completed = await harness.waitFor(
      (event) => event.id === "query-waiting" && event.type === "turn_completed",
    );
    expect(completed.status).toBe("interrupted");
    await harness.waitFor(
      (event) => event.id === "cancel-waiting" && event.type === "cancel_result",
    );
  });

  it("keeps network access on under danger-full-access and denies WebFetch otherwise", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "permission",
          toolName: "WebFetch",
          input: { url: "https://example.com" },
          toolUseID: "fetch-network",
        },
      ],
      emitObservationResult: true,
      emitQueryOptions: true,
      sessionId: "session-network",
    });

    harness.send({
      id: "query-full-access-network",
      method: "query",
      params: {
        prompt: "fetch a page",
        cwd: repoRoot,
        approvalPolicy: "trusted",
        allowNetwork: false,
        sandboxMode: "danger-full-access",
        writableRoots: [repoRoot],
      },
    });

    const started = await harness.waitFor(
      (event) => event.id === "query-full-access-network" && event.type === "turn_started",
    );
    expect(started).toMatchObject({
      sandboxMode: "danger-full-access",
      allowNetwork: true,
    });

    const notice = await harness.waitFor(
      (event) =>
        event.id === "query-full-access-network" &&
        event.type === "notice" &&
        event.kind === "claude_network_policy",
    );
    expect(String(notice.message)).toContain("network");

    await harness.waitFor(
      (event) =>
        event.id === "query-full-access-network" && event.type === "turn_completed",
    );

    const fullAccess = parseObservationResults(harness, "query-full-access-network");
    // Full access has no OS sandbox, so WebFetch is not denied on its own.
    expect(fullAccess[1]?.type).toBe("permission_result");
    expect(fullAccess[1]?.result).toEqual({ behavior: "allow" });

    harness.send({
      id: "query-sandboxed-network",
      method: "query",
      params: {
        prompt: "fetch a page",
        cwd: repoRoot,
        approvalPolicy: "trusted",
        allowNetwork: false,
        sandboxMode: "workspace-write",
        writableRoots: [repoRoot],
      },
    });

    const sandboxedStarted = await harness.waitFor(
      (event) => event.id === "query-sandboxed-network" && event.type === "turn_started",
    );
    expect(sandboxedStarted).toMatchObject({ allowNetwork: false });

    await harness.waitFor(
      (event) => event.id === "query-sandboxed-network" && event.type === "turn_completed",
    );

    const sandboxed = parseObservationResults(harness, "query-sandboxed-network");
    expect(sandboxed[1]?.result).toMatchObject({
      behavior: "deny",
      message: "Network access is disabled for this repository.",
    });
    expect(
      harness.events.some(
        (event) =>
          event.id === "query-sandboxed-network" &&
          event.type === "notice" &&
          event.kind === "claude_network_policy",
      ),
    ).toBe(false);
  });

  it("falls back to closing the query when the runtime cannot interrupt", async () => {
    const harness = await spawnHarness({
      steps: [
        {
          type: "yield",
          message: { type: "system", subtype: "init", session_id: "session-close" },
        },
        {
          type: "permission",
          toolName: "Bash",
          input: { command: "npm test" },
          toolUseID: "tool-close",
        },
      ],
      sessionId: "session-close",
    });

    harness.send({
      id: "query-close",
      method: "query",
      params: { prompt: "wait for approval", cwd: repoRoot, approvalPolicy: "restricted" },
    });

    await harness.waitFor(
      (event) => event.id === "query-close" && event.type === "approval_requested",
    );
    harness.send({ method: "cancel", params: { requestId: "query-close" } });

    const completed = await harness.waitFor(
      (event) => event.id === "query-close" && event.type === "turn_completed",
    );
    expect(completed).toMatchObject({ status: "interrupted", sessionId: "session-close" });
  });
});
