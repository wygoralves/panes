# Panes Testing Guide

This document describes the frontend testing setup for the Panes project. It is written for LLM coding agents and contributors who need to understand, modify, or extend the test suite.

## Quick Reference

```bash
pnpm test          # Run all tests (vitest run)
pnpm typecheck     # TypeScript type-checking (tsc --noEmit)
```

## Framework

- **Test runner:** [Vitest](https://vitest.dev/) v3.2.4
- **Config:** Integrated with Vite via `vite.config.ts` (no separate vitest config file)
- **Test location:** All tests live in `/tests/` at the project root
- **Naming convention:** `<moduleName>.test.ts`

## Architecture: What We Test

Panes is a Tauri v2 desktop app. The Rust backend communicates with the React frontend via IPC. The test suite covers **frontend-only pure logic** — functions that can run in Node without a browser, Tauri runtime, or backend.

We do **not** test:

- React components (no DOM rendering, no `@testing-library/react`)
- Tauri IPC calls (the `ipc` module is not mocked or tested)
- Zustand store actions that call IPC (e.g., `openTerminal`, `send`)
- Rust backend code (tested separately via `cargo test` in `src-tauri/`)

We **do** test:

- Pure helper functions extracted from stores and modules
- State transformation logic (stream event handling, block normalization)
- Data parsing (diffs, markdown, approval payloads)
- Store behavior for simple synchronous stores (e.g., `uiStore`, `toastStore`)

## Test File Inventory

| File | Module Under Test | Tests | What It Covers |
|------|------------------|-------|----------------|
| `chatStore.test.ts` | `src/stores/chatStore.ts` | 63 | Stream event handling, message normalization, action block patching, output trimming, approval decisions, timestamp conversion, usage limits mapping |
| `terminalStore.test.ts` | `src/stores/terminalStore.ts` | 23 | Split tree operations (collect IDs, replace/remove leaves, update ratios), focus session resolution |
| `threadStore.test.ts` | `src/stores/threadStore.ts` | 23 | Thread merging, flattening, reasoning effort metadata, model matching |
| `toastStore.test.ts` | `src/stores/toastStore.ts` | 12 | Toast add/dismiss lifecycle, variant defaults, max toast limit, convenience helpers |
| `uiStore.test.ts` | `src/stores/uiStore.ts` | 9 | Sidebar/git panel toggles, pin persistence, search state, active view, focus targets |
| `toolInputApproval.test.ts` | `src/components/chat/toolInputApproval.ts` | 28 | Server method normalization, approval type detection, question parsing, selection defaults, response building |
| `parseDiff.test.ts` | `src/lib/parseDiff.ts` | 20 | Diff line parsing, hunk extraction, line numbering, filename extraction, metadata skipping |
| `perfTelemetry.test.ts` | `src/lib/perfTelemetry.ts` | 9 | Metric recording, snapshot computation (avg, p95, max), budget warnings, clearing |
| `markdownParserCore.test.ts` | `src/workers/markdownParserCore.ts` | 41 | Code fence tokenization (open/close/nesting), markdown-to-HTML rendering, XSS sanitization, GFM features |

**Total: 9 test files, 228 tests**

## Pattern: Testing Internal Functions

Most stores export their pure logic via an `*Internals` object to keep implementation details private from production consumers while making them testable.

```ts
// In the store file (e.g., chatStore.ts)
export const chatStoreInternals = {
  resolveApprovalDecision,
  trimActionOutputChunks,
  applyStreamEvent,
  toIsoTimestamp,
  mapUsageLimitsFromEvent,
  // ... other pure helpers
};

// In the test file
import { chatStoreInternals } from "../src/stores/chatStore";
const { applyStreamEvent, toIsoTimestamp } = chatStoreInternals;
```

Current internals exports:

| Store | Export Name | Functions |
|-------|-----------|-----------|
| `chatStore` | `chatStoreInternals` | `resolveApprovalDecision`, `trimActionOutputChunks`, `patchActionBlock`, `ensureAssistantMessage`, `upsertBlock`, `normalizeBlocks`, `normalizeMessages`, `applyStreamEvent`, `toIsoTimestamp`, `mapUsageLimitsFromEvent` |
| `terminalStore` | `terminalStoreInternals` | `collectSessionIds`, `replaceLeafInTree`, `removeLeafFromTree`, `updateRatioInTree`, `nextFocusedSessionId` |
| `threadStore` | `threadStoreInternals` | `mergeWorkspaceThreads`, `flattenThreadsByWorkspace`, `applyThreadReasoningEffort`, `applyThreadLastModel`, `readThreadLastModelId`, `threadMatchesRequestedModel` |
| `markdownParserCore` | `markdownParserCoreInternals` | `parseFenceOpening`, `isFenceClosing`, `splitLinesWithEndings`, `tokenizeFences` |

When adding new pure functions to a store, add them to the corresponding `*Internals` export and write tests.

## Pattern: Testing Zustand Stores Directly

For simple synchronous stores (`uiStore`, `toastStore`), we test the Zustand store directly:

```ts
import { useToastStore } from "../src/stores/toastStore";

beforeEach(() => {
  useToastStore.setState({ toasts: [] }); // Reset between tests
});

it("adds a toast", () => {
  useToastStore.getState().addToast({ variant: "info", message: "hi" });
  expect(useToastStore.getState().toasts).toHaveLength(1);
});
```

## Pattern: Handling Browser Globals

Some modules reference `localStorage` at module scope. Stub globals **before** the dynamic import:

```ts
import { vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

// Dynamic import AFTER the global is available
const { useUiStore } = await import("../src/stores/uiStore");
```

Use a regular `import` for modules that don't read globals at the top level (most modules).

## Pattern: Test Helpers

Each test file defines local factory functions to reduce boilerplate:

```ts
function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    threadId: "thread-1",
    role: "assistant",
    status: "streaming",
    schemaVersion: 1,
    blocks: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
```

These are intentionally local to each test file — not shared — to keep each file self-contained.

## Writing New Tests

### When to add tests

Add tests when you:

1. Add a new pure function to a store or utility module
2. Change the behavior of an existing tested function
3. Fix a bug (write a regression test first)

### Checklist for a new test file

1. Create `tests/<moduleName>.test.ts`
2. Import from vitest: `import { describe, expect, it } from "vitest"`
3. Import the functions under test
4. Write `describe` blocks grouped by function name
5. Cover: happy path, edge cases (empty input, null, boundaries), error conditions
6. Run `pnpm test` to verify
7. Run `pnpm typecheck` to verify types

### Checklist for adding tests to an existing file

1. If the function is not yet exported for testing, add it to the module's `*Internals` export
2. Destructure it in the test file's import block
3. Add a new `describe` block (or `it` block within an existing describe)
4. Run tests

## Type Definitions

Test files import types from `src/types.ts`. Key types used in tests:

- `Message`, `ContentBlock`, `ActionBlock`, `ApprovalBlock` — chat message structures
- `StreamEvent` and its variants (`TextDeltaEvent`, `UsageLimitsUpdatedEvent`, etc.) — streaming events
- `Thread` — thread metadata
- `SplitNode`, `SplitLeaf`, `SplitContainer`, `TerminalGroup` — terminal split tree
- `ContextUsage` — usage limit metrics

## Modules Without Test Coverage

The following exported modules currently lack dedicated test files. They primarily contain Tauri IPC calls or React components, which are harder to unit test without mocking:

- `src/lib/ipc.ts` — IPC wrapper (50+ methods, all call Tauri invoke/listen)
- `src/stores/workspaceStore.ts` — Workspace CRUD (all methods call IPC)
- `src/stores/engineStore.ts` — Engine discovery (calls IPC)
- `src/stores/gitStore.ts` — Git operations (calls IPC)
- `src/stores/fileStore.ts` — File tabs (simple state, could be tested)
- `src/stores/setupStore.ts` — Onboarding flow
- `src/stores/harnessStore.ts` — Harness scanning (calls IPC)
- All React components in `src/components/`
