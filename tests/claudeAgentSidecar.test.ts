import { afterEach, describe, expect, it } from "vitest";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
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

  constructor(scenario: unknown) {
    this.child = spawn(process.execPath, [sidecarScriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_MODULE: mockSdkModulePath,
        CLAUDE_AGENT_SDK_MOCK_SCENARIO: JSON.stringify(scenario),
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

async function spawnHarness(scenario: unknown) {
  activeHarness = new SidecarHarness(scenario);
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

  it("rejects danger-full-access explicitly for Claude", async () => {
    const harness = await spawnHarness({ steps: [] });

    harness.send({
      id: "query-full-access",
      method: "query",
      params: {
        prompt: "invalid sandbox",
        cwd: repoRoot,
        sandboxMode: "danger-full-access",
      },
    });

    const errorEvent = await harness.waitFor(
      (event) => event.id === "query-full-access" && event.type === "error",
    );
    const completed = await harness.waitFor(
      (event) => event.id === "query-full-access" && event.type === "turn_completed",
    );

    expect(errorEvent.message).toContain("does not support sandboxMode=danger-full-access");
    expect(completed.status).toBe("failed");
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
        event.type === "action_completed" &&
        event.output === "stdout: ok",
    );

    expect(started?.actionId).toBeDefined();
    expect(outputDelta?.actionId).toBe(started?.actionId);
    expect(outputDelta?.stream).toBe("stdout");
    expect(completed?.actionId).toBe(started?.actionId);
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

  it("keeps approvals pending when Claude receives an invalid approval payload", async () => {
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

    expect(errorEvent.message).toContain("explicit decision field");
    await expect(
      harness.waitFor(
        (event) => event.id === "query-invalid-approval" && event.type === "turn_completed",
        250,
      ),
    ).rejects.toThrow("Timed out waiting for sidecar event");
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
    const firstCompletion = harness.events.find(
      (event) =>
        event.id === "query-interleaving" &&
        event.type === "action_completed" &&
        event.output === "first output",
    );
    const secondCompletion = harness.events.find(
      (event) =>
        event.id === "query-interleaving" &&
        event.type === "action_completed" &&
        event.output === "second output",
    );

    expect(firstCompletion?.actionId).toBe(firstStart?.actionId);
    expect(secondCompletion?.actionId).toBe(secondStart?.actionId);
    expect(firstCompletion?.actionId).not.toBe(secondStart?.actionId);
    expect(secondCompletion?.actionId).not.toBe(firstStart?.actionId);
  });
});
