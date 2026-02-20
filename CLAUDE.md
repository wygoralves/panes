# CLAUDE.md

## Project Vision

**Panes** (previously Agent Workspace) is an open-source desktop application that serves as a complete cockpit for AI-assisted coding. It wraps a rich UI around git operations and terminal-based coding agents, giving developers a single pane of glass to orchestrate, review, and approve everything their AI agents do across multiple repositories.

The core thesis: coding agents are powerful but their CLI interfaces are limiting. Developers need a unified workspace that combines real-time chat with agents, native git awareness (status, diff, stage, commit), multi-repo management, action approval flows, and full audit trails — all in a fast native desktop app.

### Goals

- Be the definitive open-source UI for coding agents (engine-agnostic)
- Native multi-repo awareness — open a folder, auto-detect nested git repos, manage trust levels
- Real-time streaming chat with structured content blocks (text, thinking, actions, diffs, approvals)
- Full git integration as a first-class citizen, not an afterthought
- Auditable persistence — every message, action, and approval is stored in SQLite
- Security-first — sandbox policies, trust levels per repo, explicit user approval for sensitive operations

### Non-Goals

- Being an IDE or code editor (use alongside your editor of choice)
- Implementing AI models directly — Panes orchestrates external engines
- Cloud/SaaS — this is a local-first desktop app

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Tauri v2 (Rust backend, webview frontend) |
| Frontend | React 19 + TypeScript 5.5 + Vite 6 |
| Styling | Tailwind CSS 4 |
| State management | Zustand 5 |
| Markdown rendering | micromark + highlight.js (Web Worker) with react-markdown fallback for small content |
| Diff visualization | diff2html + custom `parseDiff` utility (Web Worker for large diffs) |
| Icons | lucide-react |
| Layout | react-resizable-panels (three-column) |
| Terminal | @xterm/xterm 6 + WebGL addon + portable-pty (Rust PTY) |
| Database | SQLite (rusqlite, bundled) with FTS5 for search |
| Git | git2 (libgit2) for reads + CLI subprocess for writes |
| File watching | notify (debounced fs watcher) |
| Async runtime | tokio (full features) |
| HTTP | reqwest (for future direct API calls) |
| Config | TOML (~/.agent-workspace/config.toml) |
| Testing | vitest (frontend) |
| Package manager | pnpm |

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      Frontend (React)                         │
│  ┌──────────┐  ┌────────────────────┐  ┌──────────┐         │
│  │ Sidebar  │  │     ChatPanel      │  │ GitPanel │         │
│  │(workspaces│  │(messages,streaming)│  │(changes, │         │
│  │ threads, │  │  ┌──────────────┐  │  │branches, │         │
│  │ pin/fly) │  │  │TerminalPanel │  │  │commits,  │         │
│  │          │  │  │ (xterm.js)   │  │  │stash)    │         │
│  └────┬─────┘  │  └──────────────┘  │  └────┬─────┘         │
│       │        └─────────┬──────────┘       │                │
│       │    ┌─────────────┤                  │                │
│  ┌────┴────┴─────────────┴──────────────────┴─────┐          │
│  │   Zustand Stores + IPC bridge + Web Workers    │          │
│  └─────────────────┬──────────────────────────────┘          │
├────────────────────┼─────────────────────────────────────────┤
│                Tauri IPC boundary                             │
├────────────────────┼─────────────────────────────────────────┤
│                    │    Backend (Rust)                         │
│  ┌─────────────────┴──────────────────────┐                  │
│  │            commands/* (IPC handlers)     │                  │
│  └──┬──────────┬──────────┬──────┬──────┬─┘                  │
│     │          │          │      │      │                     │
│  ┌──┴───┐  ┌──┴───┐  ┌──┴──┐  ┌┴────┐ ┌┴────────┐          │
│  │engines│  │ db/* │  │git/*│  │term-│ │ config  │          │
│  │  /*   │  │SQLite│  │git2 │  │inal │ │  TOML   │          │
│  └──┬────┘  └──────┘  └─────┘  │ PTY │ └─────────┘          │
│     │                           └─────┘                       │
│  ┌──┴──────────────────────┐                                  │
│  │ External Engine Process │                                  │
│  │ (codex app-server, etc) │                                  │
│  └─────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User sends a message** → `chatStore.send()` → IPC `send_message` command
2. **Backend** persists user message, starts engine turn, streams events via `Engine` trait
3. **Engine events** are coalesced in the backend (merging up to 8 KB of consecutive TextDelta/ThinkingDelta/ActionOutputDelta) before emission
4. **Coalesced events** flow through `EngineEvent` → serialized to frontend via Tauri event channel `stream-event-{thread_id}`
5. **Frontend** batches events with a 16ms window, then applies them incrementally to the live message via `applyStreamEvent()` in chatStore
6. **Heavy rendering** (markdown >1KB, diffs >12K chars) is offloaded to Web Workers to keep the UI thread responsive
7. **Actions/approvals** are persisted to DB for auditability
8. **Git changes** detected by filesystem watcher → `git-repo-changed` event → frontend refreshes git panel
9. **Terminal I/O** flows via PTY process ↔ Tauri events (`terminal-output-{workspaceId}`, `terminal-exit-{workspaceId}`) ↔ xterm.js

## Directory Structure

```
src/                              # Frontend
├── App.tsx                       # Root: layout, keyboard shortcuts, event listeners
├── main.tsx                      # React entry point
├── types.ts                      # Shared TypeScript types (Workspace, Thread, Message, ContentBlock, Git, Terminal, etc.)
├── globals.css                   # Global styles + Tailwind + design tokens (component-scoped CSS classes)
├── lib/
│   ├── ipc.ts                    # All Tauri invoke() calls, typed. Single source of truth for IPC.
│   ├── parseDiff.ts              # Unified diff parser → ParsedLine[] for rendering
│   ├── perfTelemetry.ts          # In-process perf metrics (flush time, event rate, render, markdown, git)
│   └── windowDrag.ts             # Tauri window drag/maximize helpers for header bars
├── workers/
│   ├── diffParser.types.ts       # Types for diff parser Web Worker protocol
│   ├── diffParser.worker.ts      # Off-thread diff parsing (used for diffs >12K chars)
│   ├── markdownParser.types.ts   # Types for markdown parser Web Worker protocol
│   ├── markdownParser.worker.ts  # Off-thread markdown→HTML rendering
│   └── markdownParserCore.ts     # Markdown rendering core (micromark + gfm + highlight.js + sanitization)
├── stores/
│   ├── chatStore.ts              # Chat state, streaming, event batching (16ms), action output truncation
│   ├── threadStore.ts            # Thread CRUD, active thread, last-active persistence (localStorage)
│   ├── workspaceStore.ts         # Workspace + repo management, multi-repo git selection
│   ├── gitStore.ts               # Full git state: status, diff, branches, commits, stashes, fetch/pull/push
│   ├── engineStore.ts            # Engine listing + health checks
│   ├── terminalStore.ts          # Per-workspace terminal sessions, panel state, session lifecycle
│   └── uiStore.ts                # UI toggles: sidebar pin, git panel, search, setup wizard, message focus
└── components/
    ├── layout/
    │   └── ThreeColumnLayout.tsx  # Resizable three-column shell (sidebar pinned/unpinned modes)
    ├── sidebar/
    │   └── Sidebar.tsx            # Pin/unpin modes, collapsed rail, project list, thread list, archive, settings
    ├── chat/
    │   ├── ChatPanel.tsx          # Virtualized messages, input, model/reasoning/trust pickers, approval banner, terminal split
    │   ├── MessageBlocks.tsx      # Renders ContentBlock[] (text, code, diff, action, approval, thinking, error)
    │   ├── MarkdownContent.tsx    # Async markdown renderer with LRU cache + Web Worker offload
    │   ├── SearchModal.tsx        # Global FTS search (Cmd+Shift+F) with keyboard navigation
    │   ├── toolInputApproval.ts   # Logic for parsing structured tool input approval payloads
    │   └── ToolInputQuestionnaire.tsx  # Structured questionnaire UI for tool input approvals
    ├── git/
    │   ├── GitPanel.tsx           # Git panel shell: view selector, multi-repo picker, actions menu
    │   ├── GitChangesView.tsx     # Staged/unstaged file tree, inline diff preview, commit form
    │   ├── GitBranchesView.tsx    # Branch list (local/remote), create/rename/delete, checkout
    │   ├── GitCommitsView.tsx     # Paginated commit history
    │   └── GitStashView.tsx       # Stash list with apply/pop actions
    ├── terminal/
    │   └── TerminalPanel.tsx      # xterm.js terminal with WebGL, multi-session tabs, persistent instances
    ├── shared/
    │   ├── Dropdown.tsx           # Portal-based dropdown with grouped sub-menus, icons, viewport-aware positioning
    │   └── AppErrorBoundary.tsx   # Top-level React error boundary
    └── onboarding/
        ├── EngineHealthBanner.tsx  # Warning banner when Codex engine is unavailable
        └── EngineSetupWizard.tsx   # Step-by-step setup wizard (Codex CLI, sandbox, ready)

src-tauri/                        # Backend (Rust)
├── Cargo.toml
├── tauri.conf.json               # Tauri window config, bundle targets, CSP
└── src/
    ├── main.rs                   # Binary entry point
    ├── lib.rs                    # App bootstrap: plugins, state init, command registration, crash recovery
    ├── models.rs                 # All DTOs: Workspace, Thread, Message, Git (branches, commits, stashes), Terminal
    ├── state.rs                  # AppState (db + engines + config + terminals + git_watchers) + TurnManager
    ├── commands/
    │   ├── mod.rs                # Module declarations
    │   ├── chat.rs               # send_message, cancel_turn, respond_to_approval, search — event coalescing, auto-title
    │   ├── threads.rs            # list/create/confirm/archive/restore/delete threads, reasoning effort
    │   ├── workspace.rs          # workspace CRUD, repo trust levels, git repo selection management
    │   ├── git.rs                # Full git: status, diff, stage, commit, branches, commits, stashes, fetch/pull/push
    │   ├── engines.rs            # list_engines, engine_health
    │   └── terminal.rs           # Terminal session lifecycle: create, write, resize, close, list
    ├── engines/
    │   ├── mod.rs                # Engine trait + EngineManager + thread preview/rename
    │   ├── events.rs             # EngineEvent enum (unified event model for all engines)
    │   ├── codex.rs              # CodexEngine: app-server lifecycle, sandbox probe, model discovery, backoff
    │   ├── codex_transport.rs    # JSONL stdin/stdout process transport + reconnect
    │   ├── codex_protocol.rs     # JSON-RPC-like message types for codex protocol
    │   ├── codex_event_mapper.rs # Maps codex-specific events → EngineEvent
    │   ├── claude_sidecar.rs     # ClaudeSidecarEngine (scaffold, not active)
    │   └── api_direct.rs         # Placeholder for direct API engine
    ├── db/
    │   ├── mod.rs                # Database init + migration runner (base SQL + 4 additive migrations)
    │   ├── workspaces.rs         # Workspace CRUD + git repo selection config
    │   ├── threads.rs            # Thread CRUD + reconcile_runtime_state (crash recovery)
    │   ├── messages.rs           # Message persistence + FTS search + audit fields + answered approvals
    │   ├── repos.rs              # Repo CRUD + active repo toggle + batch active repo set
    │   ├── actions.rs            # Action + approval persistence
    │   └── migrations/
    │       └── 001_initial.sql   # Base schema: workspaces, repos, threads, messages, actions, approvals, FTS
    ├── git/
    │   ├── mod.rs                # Module declarations
    │   ├── repo.rs               # Full git ops: status, diff, stage, commit, branches, commits, stashes, fetch/pull/push
    │   ├── watcher.rs            # Filesystem watcher with debounced git-repo-changed events
    │   ├── multi_repo.rs         # Scans directory tree for nested .git repos
    │   └── cli_fallback.rs       # Subprocess git commands for write operations + commit log parsing
    ├── config/
    │   ├── mod.rs                # Module declaration
    │   └── app_config.rs         # TOML config: GeneralConfig, UiConfig, DebugConfig (action output limits)
    ├── terminal/
    │   └── mod.rs                # PTY terminal manager (portable-pty): session spawn, I/O streaming, lifecycle
    └── sidecars/
        └── claude_agent/         # TypeScript Node.js sidecar scaffold (JSONL protocol, stub handler)
            ├── package.json
            └── src/
                ├── main.ts       # JSONL stdin/stdout entry point
                ├── protocol.ts   # SidecarRequest/Response/Notify types
                └── runner.ts     # Stub request handler (SDK integration pending)
```

## Key Concepts

### Engines

Engines are external AI coding agents that Panes orchestrates. The `Engine` trait defines the contract:

- `info()` — engine metadata + available models
- `is_available()` — check if the engine binary exists on PATH
- `health()` — version + availability status
- `send_message()` — start a turn, receive a stream of `EngineEvent`s
- `interrupt()` — cancel an in-progress turn
- `respond_to_approval()` — answer a pending approval request
- `read_thread_preview()` — ask engine for a thread title preview (auto-titling)
- `set_thread_name()` — sync thread rename back to the engine

Currently implemented:
- **Codex** (`codex app-server`) — fully operational via JSONL stdin/stdout protocol, with sandbox probe, runtime model discovery, and bounded exponential backoff on transport restart (max 3 attempts, 250ms base, 2s cap)
- **Claude sidecar** — scaffold with TypeScript Node.js sidecar under `sidecars/claude_agent/` (JSONL protocol defined, stub handler, SDK integration pending)
- **Direct API** — empty placeholder

### EngineEvent (Unified Event Model)

All engines emit the same event types regardless of their native protocol:

| Event | Purpose |
|-------|---------|
| `TurnStarted` | Turn begins |
| `TurnCompleted` | Turn ends (with token usage) |
| `TextDelta` | Incremental text content |
| `ThinkingDelta` | Incremental thinking/reasoning content |
| `ActionStarted` | Agent began an action (file edit, command, etc.) |
| `ActionOutputDelta` | Streaming stdout/stderr from action |
| `ActionCompleted` | Action finished with result |
| `DiffUpdated` | Code diff changed |
| `ApprovalRequested` | Agent needs user approval to proceed |
| `Error` | Something went wrong (recoverable flag) |

### Event Coalescing & Batching

Events are optimized at two levels:

1. **Backend coalescing** — `try_coalesce_stream_events` in `commands/chat.rs` merges up to 8 KB of consecutive `TextDelta`, `ThinkingDelta`, or `ActionOutputDelta` events into single emissions, reducing IPC overhead
2. **Frontend batching** — `chatStore` collects events in a 16ms window before flushing to state, reducing React re-renders during fast streaming

### ContentBlocks (Frontend)

Messages on the frontend are rendered as arrays of typed `ContentBlock`:

- `text` — markdown text (small: react-markdown on main thread; large: Web Worker with LRU cache)
- `code` — raw code blocks with language label
- `thinking` — reasoning trace (collapsible, streaming raw / completed markdown)
- `action` — tool/command execution with streaming output (truncated at 180K chars / 240 chunks)
- `diff` — code diff visualization (virtualized for >500 lines, Web Worker for >12K chars)
- `approval` — quick actions, structured tool input questionnaire, and custom JSON payload mode
- `error` — error display

### Terminal Integration

Panes includes a fully integrated terminal built on native PTY:

- **Backend** (`terminal/mod.rs`) uses `portable-pty` to spawn shell sessions (`$SHELL -i` on macOS/Linux, `%COMSPEC%` on Windows) scoped per workspace
- **Frontend** (`TerminalPanel.tsx`) uses `@xterm/xterm` with WebGL rendering (canvas fallback), `FitAddon`, `Unicode11Addon`
- **Session persistence** — xterm instances are cached in a module-level `Map` and survive React mount/unmount cycles and workspace switches
- **Multi-tab** — multiple terminal sessions per workspace with tab bar management
- **I/O streaming** — PTY output flows via dedicated OS reader threads → Tauri events → xterm write batches (65K char limit per batch)
- **Resizable split** — terminal panel is a resizable split within ChatPanel (15–65% range, default 32%)

### Web Workers

Heavy parsing is offloaded to Web Workers to keep the UI responsive:

- **Markdown Worker** — renders markdown >1KB using `micromark` + `highlight.js` off-thread; results cached in a 280-entry LRU cache (FNV-1a hash keys)
- **Diff Worker** — parses unified diffs >12K chars off-thread; idle-terminates after 30s of inactivity

### Performance Telemetry

`lib/perfTelemetry.ts` tracks six metrics at runtime:

| Metric | Description |
|--------|-------------|
| `chat.stream.flush.ms` | Time to flush batched events to Zustand state |
| `chat.stream.events_per_sec` | Streaming event throughput |
| `chat.render.commit.ms` | React commit time for message renders |
| `chat.markdown.worker.ms` | Markdown Web Worker round-trip time |
| `git.refresh.ms` | Git status refresh time |
| `git.file_diff.ms` | Individual file diff load time |

Metrics are exposed via `window.__panesPerf` for dev console inspection. Budget violations are console-warned with 8s cooldown.

### Trust Levels

Each repository has a trust level that controls the approval policy:

- **trusted** — agent acts freely, approval only on failure
- **standard** — approval required for sensitive operations (default)
- **restricted** — approval required for everything

### Workspaces vs Repos vs Threads

- **Workspace** = a root folder the user opened. May contain multiple git repos. Has a `git_repo_selection_configured` flag for multi-repo selection state.
- **Repo** = a git repository detected inside the workspace (via `.git` scanning). Has an `is_active` flag to control visibility in the git panel.
- **Thread** = a conversation. Scoped to either a single repo or the whole workspace. Bound to one engine + model. Empty threads (no messages) are hidden from the sidebar.

## Development

### Prerequisites

- Rust toolchain (stable)
- Node.js 20+
- pnpm 9+
- Tauri v2 prerequisites for your OS (see https://v2.tauri.app/start/prerequisites/)
- `codex` CLI on PATH (for the Codex engine to work)

### Commands

```bash
pnpm install                 # Install frontend deps
pnpm tauri:dev               # Run in dev mode (hot reload frontend + Rust backend)
pnpm tauri:build             # Production build

pnpm dev                     # Frontend-only dev server (no Tauri backend)
pnpm build                   # Frontend-only build
pnpm typecheck               # TypeScript type checking (tsc --noEmit)
```

For Rust-only checks:

```bash
cd src-tauri
cargo check                  # Type check Rust code
cargo fmt                    # Format Rust code
cargo clippy                 # Lint Rust code
```

### Runtime Paths

| Path | Purpose |
|------|---------|
| `~/.agent-workspace/config.toml` | App configuration (theme, default engine, UI sizes) |
| `~/.agent-workspace/workspaces.db` | SQLite database (all persistent state) |

## Conventions

### Rust Backend

- **commands/** are thin IPC handlers. No business logic — validate input, call db/engine/git, return DTO. Exception: `chat.rs` contains event coalescing and turn orchestration logic due to complexity.
- **engines/** own all interaction with external agent processes. Always normalize to `EngineEvent`.
- **db/** is plain SQLite functions per entity. Base schema in `db/migrations/001_initial.sql`; additive columns are applied programmatically in `db/mod.rs` (not in separate SQL files).
- **git/** is self-contained and engine-independent. Uses git2 for reads, CLI subprocess for writes.
- **terminal/** manages PTY lifecycle. Sessions are scoped per workspace. Reader runs on dedicated OS threads (not tokio tasks).
- DTOs use `#[serde(rename_all = "camelCase")]` for frontend compatibility.
- Errors use `anyhow::Context` for meaningful context chains.
- Blocking operations (git2, SQLite, PTY spawn) are wrapped in `tokio::task::spawn_blocking`.
- Crash recovery: `reconcile_runtime_state` runs at startup to mark interrupted messages and reconcile thread statuses.

### Frontend

- Zustand stores are the single source of truth. Components read from stores.
- `lib/ipc.ts` is the only file that calls `invoke()`. All IPC is typed and centralized.
- Streaming events arrive on `stream-event-{thread_id}` Tauri event channels.
- `chatStore.applyStreamEvent()` accumulates events into the live message in-place (no re-fetch). Events are batched in a 16ms window before flushing to state.
- Components render typed `ContentBlock[]` — never raw engine payloads.
- **Web Workers** for heavy parsing: markdown (>1KB) and diffs (>12K chars) are parsed off-thread. Workers are lazy-created and idle-terminated.
- **Module-level caches** with TTL: `gitStore` uses 1s TTL for status, 1.2s for diffs, with in-flight deduplication and revision counters for invalidation. `MarkdownContent` uses a 280-entry LRU cache.
- **Virtualization**: message list uses binary-search virtualization at 40+ messages with `ResizeObserver`-measured row heights. Diff rendering virtualizes at >500 lines.
- **Terminal instances** are cached in a module-level `Map<sessionId, SessionTerminal>` outside React lifecycle to preserve scrollback across mount/unmount.
- Window drag: use `lib/windowDrag.ts` helpers (`handleDragMouseDown`, `handleDragDoubleClick`) on header elements.
- Custom dropdowns: use `shared/Dropdown.tsx` (supports grouped sub-menus, icons, viewport-aware positioning).
- Sidebar supports pinned (inline panel) and unpinned (collapsed rail + flyout) modes.
- Keyboard shortcuts: `Cmd+B` (sidebar), `Cmd+Shift+B` (git panel), `Cmd+Shift+F` (search).
- Last-active workspace and thread are persisted to `localStorage` for session continuity.
- Performance telemetry: use `recordPerfMetric()` from `lib/perfTelemetry.ts` when adding new measurable operations.

### General

- TypeScript strict mode, no unnecessary `any`.
- No secrets in code, logs, or database.
- No new dependencies without real justification.
- Comments only for non-obvious decisions, not obvious code.
- Small, cohesive changes per module. Don't mix unrelated changes.

## Database Schema

SQLite at `~/.agent-workspace/workspaces.db`. Base migration: `001_initial.sql` + 4 additive migrations applied programmatically in `db/mod.rs`.

**Tables:** `workspaces`, `repos`, `threads`, `messages`, `actions`, `approvals`, `engine_event_logs`, `messages_fts` (FTS5 virtual table).

**Additive columns** (applied at startup, not in SQL files):
- `workspaces.archived_at` — soft-delete timestamp
- `workspaces.git_repo_selection_configured` — whether user has configured which repos are active
- `threads.archived_at` — soft-delete timestamp
- `threads.engine_capabilities_json` — cached engine capabilities for the thread
- `messages.stream_seq` — ordering sequence for streamed events
- `messages.turn_engine_id`, `messages.turn_model_id`, `messages.turn_reasoning_effort` — audit trail for which engine/model/effort produced each message
- `actions.truncated` — flag for truncated action output

Key relationships:
- `repos.workspace_id` → `workspaces.id` (CASCADE DELETE)
- `threads.workspace_id` → `workspaces.id` (CASCADE DELETE)
- `threads.repo_id` → `repos.id` (SET NULL on delete)
- `messages.thread_id` → `threads.id` (CASCADE DELETE)
- FTS triggers keep `messages_fts` in sync with `messages`

## Current State (Pre-MVP)

Core architecture is established. Significant functionality has been built but expect continued changes.

**Working:**
- Full Codex engine integration (JSONL protocol, approval flows, model picker, reasoning effort, sandbox probe, runtime model discovery)
- Workspace/repo/thread/message persistence with SQLite
- Thread selection, creation by scope + engine + model, auto-titling
- Streaming chat with structured content blocks + event coalescing + frontend batching
- Chat autoscroll lock with explicit "jump to latest" behavior
- Message virtualization for long threads (binary-search, ResizeObserver-measured rows)
- Diff rendering virtualization (>500 lines) + Web Worker parsing (>12K chars)
- Markdown rendering with Web Worker offload (>1KB) + 280-entry LRU cache
- Git panel: status, diff, stage/unstage, commit, filesystem watcher
- Git branches: list (local/remote), create, rename, delete, checkout
- Git operations: fetch, pull, push with ahead/behind tracking
- Git commit history: paginated log viewer
- Git stash: list, apply, pop
- Multi-repo management: per-workspace repo selection, bulk active/inactive toggle
- Git file tree protections for large repos (scan limits/timeout) plus paginated API
- Codex transport reconnect/restart with bounded exponential backoff
- Three-column resizable layout with sidebar pin/unpin (inline vs collapsed rail + flyout)
- Terminal integration: native PTY, xterm.js with WebGL, multi-session tabs, persistent across navigations
- Global message search (FTS5) with keyboard navigation and message focus/highlight
- Trust levels + workspace write opt-in
- Engine setup wizard (step-by-step: CLI detection, sandbox preflight, ready state)
- Crash recovery (reconcile interrupted messages and thread states on startup)
- Performance telemetry (6 metrics, dev console inspection via `window.__panesPerf`)
- Session persistence (last workspace, last thread per workspace via localStorage)

**Scaffold/Stub:**
- Claude sidecar engine (trait implemented, TypeScript sidecar project under `sidecars/claude_agent/`, returns stub)
- Direct API engine (empty placeholder)
- Attachment button (UI only)

**Not Started:**
- Automated tests (vitest configured but zero test coverage)
- CI/CD pipeline
- Release builds / distribution

## IPC Command Reference

All commands are invoked from the frontend via `lib/ipc.ts` → `@tauri-apps/api invoke()`.

### Workspace
- `open_workspace(path, scanDepth?)` — open folder, optionally control nested repo scan depth
- `list_workspaces()` — list all workspaces
- `list_archived_workspaces()` — list archived workspaces
- `get_repos(workspaceId)` — list repos in workspace
- `archive_workspace(workspaceId)` — archive workspace (soft delete behavior)
- `restore_workspace(workspaceId)` — restore archived workspace
- `delete_workspace(workspaceId)` — delete workspace + cascade
- `set_repo_trust_level(repoId, trustLevel)` — change trust level
- `set_repo_git_active(repoId, isActive)` — toggle individual repo active flag
- `set_workspace_git_active_repos(workspaceId, repoIds)` — atomically set which repos are active
- `has_workspace_git_selection(workspaceId)` — check if git repo selection is configured

### Threads
- `list_threads(workspaceId)` — list active threads (excludes empty threads)
- `list_archived_threads(workspaceId)` — list archived threads
- `create_thread(workspaceId, repoId?, engineId, modelId, title)` — create new thread
- `rename_thread(threadId, title)` — rename thread
- `confirm_workspace_thread(threadId, writableRoots)` — opt-in to workspace-wide writes
- `set_thread_reasoning_effort(threadId, reasoningEffort, modelId?)` — set reasoning level
- `archive_thread(threadId)` — archive thread (soft delete behavior)
- `restore_thread(threadId)` — restore archived thread
- `delete_thread(threadId)` — delete thread + cascade

### Chat
- `send_message(threadId, message, modelId?)` — send user message, start agent turn
- `cancel_turn(threadId)` — interrupt current turn
- `respond_to_approval(threadId, approvalId, response)` — answer approval (quick action or custom payload)
- `get_thread_messages(threadId)` — load full thread messages
- `search_messages(workspaceId, query)` — FTS search across messages

### Git — Status & Files
- `get_git_status(repoPath)` — branch, files, ahead/behind
- `get_file_diff(repoPath, filePath, staged)` — unified diff for file
- `stage_files(repoPath, files)` — git add
- `unstage_files(repoPath, files)` — git reset
- `commit(repoPath, message)` — git commit
- `get_file_tree(repoPath)` — recursive file listing
- `get_file_tree_page(repoPath, offset?, limit?)` — paginated file listing (default limit: 2000)
- `watch_git_repo(repoPath)` — start filesystem watcher

### Git — Remote Operations
- `fetch_git(repoPath)` — git fetch
- `pull_git(repoPath)` — git pull
- `push_git(repoPath)` — git push

### Git — Branches
- `list_git_branches(repoPath, scope, offset?, limit?)` — paginated local/remote branch listing (default limit: 200)
- `checkout_git_branch(repoPath, branchName, isRemote)` — checkout branch
- `create_git_branch(repoPath, branchName, fromRef?)` — create new branch
- `rename_git_branch(repoPath, oldName, newName)` — rename branch
- `delete_git_branch(repoPath, branchName, force)` — delete branch

### Git — History & Stash
- `list_git_commits(repoPath, offset?, limit?)` — paginated commit log (default limit: 100)
- `list_git_stashes(repoPath)` — list stashes
- `apply_git_stash(repoPath, stashIndex)` — apply stash
- `pop_git_stash(repoPath, stashIndex)` — pop stash

### Terminal
- `terminal_create_session(workspaceId, cols, rows)` — spawn a PTY session in the workspace root
- `terminal_write(workspaceId, sessionId, data)` — write raw bytes to PTY
- `terminal_resize(workspaceId, sessionId, cols, rows)` — resize PTY
- `terminal_close_session(workspaceId, sessionId)` — kill one session
- `terminal_close_workspace_sessions(workspaceId)` — kill all sessions for a workspace
- `terminal_list_sessions(workspaceId)` — list live sessions

### Engines
- `list_engines()` — available engines + models
- `engine_health(engineId)` — check engine availability + version

### Tauri Event Channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `stream-event-{threadId}` | Backend → Frontend | `StreamEvent` (engine events for chat) |
| `git-repo-changed` | Backend → Frontend | `{ repoPath }` (filesystem watcher trigger) |
| `thread-updated` | Backend → Frontend | `{ threadId, title? }` (auto-title, status changes) |
| `terminal-output-{workspaceId}` | Backend → Frontend | `{ sessionId, data }` (PTY stdout chunk) |
| `terminal-exit-{workspaceId}` | Backend → Frontend | `{ sessionId, code, signal }` (PTY process exit) |
