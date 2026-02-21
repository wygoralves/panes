# Codex Execution Policy Deep Dive (Panes)

Date: 2026-02-21  
Scope: Panes integration with `codex app-server` / Codex CLI execution policy, sandbox, and approvals.

## 1) Context and reported symptoms

User report:

- `trusted` was not behaving as expected.
- In `trusted`, Codex often failed to request approval and actions errored.
- In `ask-on-request`, repeated errors happened before eventual approval prompts.
- `restricted` had low confidence due to issues already seen in `trusted`.

## 2) Investigation method

This deep dive combined:

1. Static code inspection in Panes (`src-tauri` + frontend trust UI).
2. Runtime inspection of local Codex installation and protocol schema.
3. Controlled protocol probes against `codex app-server` to reproduce approval/sandbox behavior.

## 3) Environment and versions

- Codex CLI: `0.104.0`
- Platform observed in logs: macOS arm64
- Panes backend path: `src-tauri/src/engines/codex.rs`

## 4) Protocol facts confirmed

From local `codex --help`, app-server schema generation, and protocol probes:

- Approval policies supported:
  - `untrusted`
  - `on-failure` (deprecated)
  - `on-request`
  - `never`
- Sandbox mode (thread/start):
  - `read-only`
  - `workspace-write`
  - `danger-full-access`
- Sandbox policy (turn/start):
  - `workspaceWrite`
  - `readOnly`
  - `dangerFullAccess`
  - `externalSandbox`

Important note:

- `on-failure` is documented as deprecated and should not be the default interactive mode.

## 5) Panes implementation findings (pre-fix)

### Finding A: `trusted` mapped to deprecated `on-failure`

In `src-tauri/src/commands/chat.rs`:

- `TrustLevelDto::Trusted => "on-failure"`
- `TrustLevelDto::Standard => "on-request"`
- `TrustLevelDto::Restricted => "untrusted"`

Impact:

- `trusted` inherited deprecated semantics and reproduced error-heavy flows without reliable upfront approval requests.

### Finding B: network disabled for all trust levels

In `send_message` sandbox setup:

- `allow_network: false` for every trust level.

Impact:

- common operations (`curl`, package index access, installs, etc.) fail in all modes unless escalated, amplifying perceived policy breakage.

### Finding C: fallback path can force external sandbox mode

In `src-tauri/src/engines/codex.rs`:

- if local workspace sandbox probe fails, Panes may force:
  - thread sandbox mode: `danger-full-access`
  - turn sandbox policy: `externalSandbox`

This behavior is intentional for environments where local macOS sandboxing is denied, but it changes threat model and user expectations.

## 6) Runtime reproduction results

Using a direct app-server probe script (JSON-RPC, `thread/start` + `turn/start`) with prompt:

- `Use o shell e rode exatamente: curl -I https://example.com. Depois responda done.`

### Scenario matrix

1. `on-request` + `workspace-write` (+ `workspaceWrite` policy)
   - Approval requests: 1
   - Command executions: completed
   - Turn completed: yes
   - Result: expected interactive behavior

2. `on-failure` + `workspace-write` (+ `workspaceWrite` policy)
   - Approval requests: 0
   - Multiple command failures
   - Turn completion: timed out in probe
   - Result: reproduces "errors before useful escalation"

3. `on-failure` + `danger-full-access` (+ `externalSandbox`)
   - Approval requests: 0
   - Command succeeded
   - Turn completed: yes
   - Result: works by bypassing restrictive local sandbox path

4. `never` + `danger-full-access` (+ `dangerFullAccess`)
   - Approval requests: 0
   - Command succeeded
   - Turn completed: yes
   - Result: expected no-approval full-access behavior

Artifacts generated during deep dive:

- `/tmp/probe-on-request.json`
- `/tmp/probe-on-failure-workspace.json`
- `/tmp/probe-on-failure-external.json`
- `/tmp/probe-never-danger.json`

## 7) Root cause summary

Primary root causes:

1. `trusted` in Panes was mapped to deprecated `on-failure`.
2. Network was globally disabled, including `trusted`.

Combined effect:

- In practical command-heavy workflows, `trusted` behaved as high-friction and error-prone, matching user report.

## 8) Fix applied in this session

File updated: `src-tauri/src/commands/chat.rs`

Changes:

1. `trusted` approval mapping changed:
   - from `on-failure`
   - to `on-request`
2. Network policy split by trust level:
   - `trusted` -> `allow_network = true`
   - others remain restricted
3. Added helper:
   - `allow_network_for_trust_level(...)`

Validation:

- `cargo check` in `src-tauri` completed successfully.

## 9) Recommended policy model going forward

Suggested stable mapping for Panes presets:

1. `restricted`
   - `approvalPolicy: untrusted`
   - `sandbox: workspace-write`
   - `network: disabled`

2. `ask-on-request` (current "standard")
   - `approvalPolicy: on-request`
   - `sandbox: workspace-write`
   - `network: disabled`

3. `trusted`
   - `approvalPolicy: on-request`
   - `sandbox: workspace-write`
   - `network: enabled`

4. optional advanced mode: `full-access` (explicit risk gate)
   - `approvalPolicy: never`
   - `sandbox: danger-full-access`
   - only behind explicit confirmation UX

## 10) UI/UX recommendations

To close the gap long-term:

1. Keep execution policy control visible per repo and workspace.
2. Add "Advanced policy" panel showing raw effective values:
   - approval policy
   - thread sandbox mode
   - turn sandbox policy
   - network state
3. Add high-friction confirmation for full access presets.
4. Show current effective runtime policy in status bar/tooltips (not just trust label).
5. Surface when Panes auto-falls back to `externalSandbox` so user understands why behavior changed.

## 11) Open technical follow-ups

1. Evaluate if Panes should persist/sync Codex `projects.<path>.trust_level` config or keep trust model purely internal.
2. Add regression tests for trust-level-to-policy mapping.
3. Add integration test matrix for approval/sandbox combinations against app-server protocol.
4. Add telemetry/debug event for "approval requested vs command failed without approval" to detect regressions quickly.

## 12) Key references

- OpenAI Codex docs:
  - https://developers.openai.com/codex/security
  - https://developers.openai.com/codex/config-reference
- Codex repository docs:
  - https://github.com/openai/codex/blob/main/docs/security.md
  - https://github.com/openai/codex/blob/main/codex-rs/core/src/protocol.rs
- Local protocol evidence:
  - generated JSON schema via `codex app-server generate-json-schema`
  - generated TS types via `codex app-server generate-ts`

## 13) Addendum: Cross-check of pasted app-server doc excerpt

Additional issues found in the excerpt that can cause integration errors if copied literally:

1. Invalid `thread/start.sandbox` example value
   - Excerpt uses `"sandbox": "workspaceWrite"`.
   - For `thread/start`, valid values are sandbox *mode* enums: `"read-only"`, `"workspace-write"`, `"danger-full-access"`.
   - `workspaceWrite` is a `sandboxPolicy.type` variant (used in `turn/start`), not a `thread/start` mode value.

2. Invalid `turn/start.approvalPolicy` example value
   - Excerpt uses `"approvalPolicy": "unlessTrusted"`.
   - Valid values are: `"untrusted"`, `"on-failure"` (deprecated), `"on-request"`, `"never"`.
   - `unlessTrusted` is not accepted by the current protocol schema.

3. `on-failure` should not be used for interactive default behavior
   - The excerpt lists it as supported (true), but it is deprecated.
   - Practical behavior reproduced in probes: `on-failure + workspaceWrite` often degrades into repeated failed command attempts without useful approval flow.

4. Key shape distinction that must stay explicit in Panes docs/UI code
   - `thread/start` / `thread/resume`:
     - `sandbox` = mode enum (`workspace-write`, etc.)
   - `turn/start` / `command/exec`:
     - `sandboxPolicy` = object (`workspaceWrite`, `externalSandbox`, `readOnly`, `dangerFullAccess`)

5. What is already aligned in Panes
   - `initialize` uses `capabilities.experimentalApi = true`.
   - Modern approval requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) are handled.
   - `item/tool/requestUserInput` is mapped and rendered in the UI.

