function parseScenario() {
  const raw = process.env.CLAUDE_AGENT_SDK_MOCK_SCENARIO;
  if (!raw) {
    return { steps: [] };
  }
  return JSON.parse(raw);
}

function clone(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function defaultResult(partial = {}) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    errors: [],
    session_id: "mock-session",
    ...clone(partial),
  };
}

async function runHooks(options, hookName, input) {
  const hookEntries = options?.hooks?.[hookName] ?? [];
  for (const entry of hookEntries) {
    for (const hook of entry?.hooks ?? []) {
      await hook(clone(input));
    }
  }
}

function isAsyncIterable(value) {
  return (
    value != null &&
    typeof value !== "string" &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

export function query({ prompt, options }) {
  const scenario = parseScenario();
  let closed = false;
  let interrupted = false;

  // Mirror the real SDK: a string prompt becomes one user message, an async
  // iterable is drained as messages arrive (the sidecar's steering path).
  const inputMessages = [];
  const inputWaiters = [];
  const wakeInputWaiters = () => {
    for (const wake of inputWaiters.splice(0)) {
      wake();
    }
  };
  if (typeof prompt === "string") {
    inputMessages.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
      parent_tool_use_id: null,
    });
  } else if (isAsyncIterable(prompt)) {
    (async () => {
      for await (const message of prompt) {
        inputMessages.push(clone(message));
        wakeInputWaiters();
      }
    })()
      .catch(() => {})
      .finally(wakeInputWaiters);
  }

  const waitForInput = (count) =>
    new Promise((resolve) => {
      const check = () => {
        if (inputMessages.length >= count || closed || interrupted) {
          resolve();
          return;
        }
        inputWaiters.push(check);
      };
      check();
    });

  const iterator = (async function* () {
    const observations = [];

    if (scenario.emitQueryOptions) {
      observations.push({
        type: "query_options",
        result: clone({
          permissionMode: options?.permissionMode,
          settings: options?.settings,
          allowedTools: options?.allowedTools,
          tools: options?.tools,
          settingSources: options?.settingSources,
          systemPrompt: options?.systemPrompt,
          todoToolsEnabled: options?.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS,
          sandbox: options?.sandbox,
          additionalDirectories: options?.additionalDirectories,
          forwardSubagentText: options?.forwardSubagentText,
        }),
      });
    }

    for (const step of scenario.steps ?? []) {
      if (closed || interrupted) {
        break;
      }

      if (step.type === "yield") {
        yield clone(step.message);
        continue;
      }

      if (step.type === "delay") {
        await new Promise((resolve) => setTimeout(resolve, step.durationMs ?? 0));
        continue;
      }

      if (step.type === "hook") {
        await runHooks(options, step.hook, step.input);
        continue;
      }

      if (step.type === "await_input") {
        await waitForInput(step.count ?? 1);
        continue;
      }

      if (step.type === "observe_input") {
        observations.push({
          type: "input_messages",
          result: clone(inputMessages),
        });
        continue;
      }

      if (step.type === "permission") {
        const permission = await options.canUseTool(
          step.toolName,
          clone(step.input ?? {}),
          {
            signal: new AbortController().signal,
            toolUseID: step.toolUseID ?? "mock-tool-use",
            ...clone(step.options ?? {}),
          },
        );
        observations.push({
          type: "permission_result",
          result: clone(permission),
        });
        continue;
      }
    }

    if (closed) {
      // A closed query is a killed CLI: nothing else reaches the consumer.
      return;
    }

    if (interrupted) {
      yield defaultResult({
        session_id: scenario.interruptedSessionId ?? scenario.sessionId ?? "mock-session",
        result: "",
      });
      return;
    }

    if (scenario.emitObservationResult) {
      yield defaultResult({
        result: JSON.stringify(observations),
        session_id: scenario.sessionId ?? "mock-session",
      });
    }
  })();

  iterator.close = () => {
    closed = true;
    wakeInputWaiters();
  };
  if (scenario.supportsInterrupt) {
    iterator.interrupt = async () => {
      interrupted = true;
      wakeInputWaiters();
      return { still_queued: [] };
    };
  }
  iterator.supportedModels = async () => clone(
    scenario.models ?? [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Default Claude model",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
    ],
  );

  return iterator;
}
