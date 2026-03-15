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

export function query({ options }) {
  const scenario = parseScenario();
  let closed = false;

  const iterator = (async function* () {
    const observations = [];

    if (scenario.emitQueryOptions) {
      observations.push({
        type: "query_options",
        result: clone({
          permissionMode: options?.permissionMode,
          settings: options?.settings,
        }),
      });
    }

    for (const step of scenario.steps ?? []) {
      if (closed) {
        break;
      }

      if (step.type === "yield") {
        yield clone(step.message);
        continue;
      }

      if (step.type === "hook") {
        await runHooks(options, step.hook, step.input);
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

    if (scenario.emitObservationResult) {
      yield defaultResult({
        result: JSON.stringify(observations),
        session_id: scenario.sessionId ?? "mock-session",
      });
    }
  })();

  iterator.close = () => {
    closed = true;
  };

  return iterator;
}
