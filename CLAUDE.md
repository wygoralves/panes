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
| Markdown rendering | react-markdown + rehype-highlight + remark-gfm |
| Diff visualization | diff2html |
| Icons | lucide-react |
| Layout | react-resizable-panels (three-column) |
| Database | SQLite (rusqlite, bundled) with FTS5 for search |
| Git | git2 (libgit2) for reads + CLI subprocess for writes |
| File watching | notify (debounced fs watcher) |
| Async runtime | tokio (full features) |
| HTTP | reqwest (for future direct API calls) |
| Config | TOML (~/.agent-workspace/config.toml) |
| Package manager | pnpm |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐              │
│  │ Sidebar  │  │ ChatPanel │  │ GitPanel │              │
│  │(workspaces│  │(messages, │  │(status,  │              │
│  │ threads) │  │ streaming)│  │diff,stage)│             │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘              │
│       │               │              │                    │
│  ┌────┴───────────────┴──────────────┴─────┐             │
│  │         Zustand Stores + IPC bridge      │             │
│  └─────────────────┬───────────────────────┘             │
├────────────────────┼─────────────────────────────────────┤
│                Tauri IPC boundary                         │
├────────────────────┼─────────────────────────────────────┤
│                    │    Backend (Rust)                     │
│  ┌─────────────────┴──────────────────────┐              │
│  │            commands/* (IPC handlers)     │              │
│  └──┬──────────┬──────────┬───────────┬───┘              │
│     │          │          │           │                    │
│  ┌──┴───┐  ┌──┴───┐  ┌──┴────┐  ┌──┴──────┐            │
│  │engines│  │ db/* │  │ git/* │  │ config  │            │
│  │  /*   │  │SQLite│  │libgit2│  │  TOML   │            │
│  └──┬────┘  └──────┘  └───────┘  └─────────┘            │
│     │                                                     │
│  ┌──┴──────────────────────┐                              │
│  │ External Engine Process │                              │
│  │ (codex app-server, etc) │                              │
│  └─────────────────────────┘                              │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User sends a message** → `chatStore.send()` → IPC `send_message` command
2. **Backend** persists user message, starts engine turn, streams events via `Engine` trait
3. **Engine events** flow through `EngineEvent` (unified enum) → serialized to frontend via Tauri event channel `stream-event-{thread_id}`
4. **Frontend** applies events incrementally to the live message via `applyStreamEvent()` in chatStore
5. **Actions/approvals** are persisted to DB for auditability
6. **Git changes** detected by filesystem watcher → `git-repo-changed` event → frontend refreshes git panel

## Directory Structure

```
src/                              # Frontend
├── App.tsx                       # Root: layout, keyboard shortcuts, event listeners
├── main.tsx                      # React entry point
├── types.ts                      # Shared TypeScript types (Workspace, Thread, Message, ContentBlock, etc.)
├── globals.css                   # Global styles + Tailwind + design tokens
├── lib/
│   └── ipc.ts                    # All Tauri invoke() calls, typed. Single source of truth for IPC.
├── stores/
│   ├── chatStore.ts              # Chat state, message streaming, event accumulation
│   ├── threadStore.ts            # Thread CRUD, active thread selection
│   ├── workspaceStore.ts         # Workspace + repo management
│   ├── gitStore.ts               # Git status, diff, stage/unstage/commit
│   ├── engineStore.ts            # Engine listing + health checks
│   └── uiStore.ts                # UI toggle state (sidebar, git panel, search)
└── components/
    ├── layout/
    │   └── ThreeColumnLayout.tsx  # Resizable three-column shell
    ├── sidebar/
    │   └── Sidebar.tsx            # Project list + thread list per project
    ├── chat/
    │   ├── ChatPanel.tsx          # Message list + input + header
    │   ├── MessageBlocks.tsx      # Renders typed ContentBlock[] (text, thinking, action, diff, approval, error)
    │   └── SearchModal.tsx        # Global message search (Cmd+Shift+F)
    ├── git/
    │   └── GitPanel.tsx           # Branch info, file list, diff viewer, stage/commit
    ├── shared/
    │   ├── Dropdown.tsx           # Custom dropdown (portal-based, replaces native <select>)
    │   └── AppErrorBoundary.tsx   # Top-level React error boundary
    └── onboarding/
        └── EngineHealthBanner.tsx # Shows engine availability status

src-tauri/                        # Backend (Rust)
├── Cargo.toml
├── tauri.conf.json               # Tauri window config, bundle targets, CSP
└── src/
    ├── main.rs                   # Binary entry point
    ├── lib.rs                    # App bootstrap: plugins, state init, command registration
    ├── models.rs                 # All DTOs: WorkspaceDto, ThreadDto, MessageDto, GitStatusDto, etc.
    ├── state.rs                  # AppState (db + engine_manager + config) + TurnManager (active turn tracking)
    ├── commands/
    │   ├── chat.rs               # send_message, cancel_turn, respond_to_approval, search_messages
    │   ├── threads.rs            # list/create/confirm/delete threads, set reasoning effort
    │   ├── workspace.rs          # open/list/delete workspaces, list repos, set trust level
    │   ├── git.rs                # status, diff, stage, unstage, commit, file_tree, watch
    │   └── engines.rs            # list_engines, engine_health
    ├── engines/
    │   ├── mod.rs                # Engine trait + EngineManager (registry of available engines)
    │   ├── events.rs             # EngineEvent enum (unified event model for all engines)
    │   ├── codex.rs              # CodexEngine: manages codex app-server lifecycle
    │   ├── codex_transport.rs    # JSONL stdin/stdout process transport
    │   ├── codex_protocol.rs     # JSON-RPC-like message types for codex protocol
    │   ├── codex_event_mapper.rs # Maps codex-specific events → EngineEvent
    │   ├── claude_sidecar.rs     # ClaudeSidecarEngine (scaffold, not active)
    │   └── api_direct.rs         # Placeholder for direct API engine
    ├── db/
    │   ├── mod.rs                # Database initialization + migration runner
    │   ├── workspaces.rs         # Workspace CRUD
    │   ├── threads.rs            # Thread CRUD + listing
    │   ├── messages.rs           # Message persistence + FTS search
    │   ├── repos.rs              # Repo CRUD
    │   ├── actions.rs            # Action + approval persistence
    │   └── migrations/
    │       └── 001_initial.sql   # Full schema: workspaces, repos, threads, messages, actions, approvals, FTS
    ├── git/
    │   ├── repo.rs               # Git operations: status, diff, stage, unstage, commit, file_tree
    │   ├── watcher.rs            # Filesystem watcher with debounced git-repo-changed events
    │   ├── multi_repo.rs         # Scans directory tree for nested .git repos
    │   └── cli_fallback.rs       # Subprocess git commands for write operations
    └── config/
        └── app_config.rs         # TOML config read/write at ~/.agent-workspace/config.toml
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

Currently implemented:
- **Codex** (`codex app-server`) — fully operational via JSONL stdin/stdout protocol
- **Claude sidecar** — scaffold only, `is_available()` returns false

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

### ContentBlocks (Frontend)

Messages on the frontend are rendered as arrays of typed `ContentBlock`:

- `text` — markdown text
- `thinking` — reasoning trace (collapsible)
- `action` — tool/command execution with streaming output
- `diff` — code diff visualization
- `approval` — accept/decline/trust-session buttons
- `error` — error display

### Trust Levels

Each repository has a trust level that controls the approval policy:

- **trusted** — agent acts freely, approval only on failure
- **standard** — approval required for sensitive operations (default)
- **restricted** — approval required for everything

### Workspaces vs Repos vs Threads

- **Workspace** = a root folder the user opened. May contain multiple git repos.
- **Repo** = a git repository detected inside the workspace (via `.git` scanning).
- **Thread** = a conversation. Scoped to either a single repo or the whole workspace. Bound to one engine + model.

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

- **commands/** are thin IPC handlers. No business logic — validate input, call db/engine/git, return DTO.
- **engines/** own all interaction with external agent processes. Always normalize to `EngineEvent`.
- **db/** is plain SQLite functions per entity. Schema changes require versioned migrations in `db/migrations/`.
- **git/** is self-contained and engine-independent. Uses git2 for reads, CLI subprocess for writes.
- DTOs use `#[serde(rename_all = "camelCase")]` for frontend compatibility.
- Errors use `anyhow::Context` for meaningful context chains.
- Blocking operations (git2, SQLite) are wrapped in `tokio::task::spawn_blocking`.

### Frontend

- Zustand stores are the single source of truth. Components read from stores.
- `lib/ipc.ts` is the only file that calls `invoke()`. All IPC is typed and centralized.
- Streaming events arrive on `stream-event-{thread_id}` Tauri event channels.
- `chatStore.applyStreamEvent()` accumulates events into the live message in-place (no re-fetch).
- Components render typed `ContentBlock[]` — never raw engine payloads.
- Window drag: use `data-tauri-drag-region` attribute on header elements (not CSS `-webkit-app-region`).
- Custom dropdowns: use `shared/Dropdown.tsx` instead of native `<select>` elements.
- Keyboard shortcuts: `Cmd+B` (sidebar), `Cmd+Shift+B` (git panel), `Cmd+Shift+F` (search).

### General

- TypeScript strict mode, no unnecessary `any`.
- No secrets in code, logs, or database.
- No new dependencies without real justification.
- Comments only for non-obvious decisions, not obvious code.
- Small, cohesive changes per module. Don't mix unrelated changes.

## Database Schema

SQLite at `~/.agent-workspace/workspaces.db`. Current migration: `001_initial.sql`.

**Tables:** `workspaces`, `repos`, `threads`, `messages`, `actions`, `approvals`, `engine_event_logs`, `messages_fts` (FTS5 virtual table).

Key relationships:
- `repos.workspace_id` → `workspaces.id` (CASCADE DELETE)
- `threads.workspace_id` → `workspaces.id` (CASCADE DELETE)
- `threads.repo_id` → `repos.id` (SET NULL on delete)
- `messages.thread_id` → `threads.id` (CASCADE DELETE)
- FTS triggers keep `messages_fts` in sync with `messages`

## Current State (Pre-MVP)

Everything is pre-MVP. Core architecture is established but expect significant changes.

**Working:**
- Full Codex engine integration (JSONL protocol, approval flows, model picker, reasoning effort)
- Workspace/repo/thread/message persistence with SQLite
- Streaming chat with structured content blocks
- Git panel: status, diff, stage/unstage, commit, filesystem watcher
- Three-column resizable layout
- Global message search (FTS5)
- Trust levels + workspace write opt-in

**Scaffold/Stub:**
- Claude sidecar engine (trait implemented, returns stub)
- Direct API engine (empty placeholder)
- Attachment button (UI only)
- Settings/menu button (UI only)

**Not Started:**
- Automated tests (zero test coverage)
- CI/CD pipeline
- Release builds / distribution
- Message virtualization for long threads
- Engine onboarding / setup wizard
- Process crash recovery / reconnect
- Terminal integration

## IPC Command Reference

All commands are invoked from the frontend via `lib/ipc.ts` → `@tauri-apps/api invoke()`.

### Workspace
- `open_workspace(rootPath)` — open folder, scan for repos, persist
- `list_workspaces()` — list all workspaces
- `delete_workspace(workspaceId)` — delete workspace + cascade
- `list_repos(workspaceId)` — list repos in workspace
- `set_repo_trust_level(repoId, trustLevel)` — change trust level

### Threads
- `list_threads(workspaceId)` — list threads (only those with messages)
- `create_thread(workspaceId, repoId?, engineId, modelId)` — create new thread
- `confirm_thread_workspace(threadId)` — opt-in to workspace-wide writes
- `delete_thread(threadId)` — delete thread + cascade
- `set_reasoning_effort(threadId, effort)` — set reasoning level

### Chat
- `send_message(threadId, content)` — send user message, start agent turn
- `cancel_turn(threadId)` — interrupt current turn
- `respond_to_approval(threadId, approvalId, decision)` — answer approval request
- `search_messages(workspaceId, query)` — FTS search across messages

### Git
- `get_git_status(repoPath)` — branch, files, ahead/behind
- `get_file_diff(repoPath, filePath, staged)` — unified diff for file
- `stage_files(repoPath, files)` — git add
- `unstage_files(repoPath, files)` — git reset
- `commit(repoPath, message)` — git commit
- `get_file_tree(repoPath)` — recursive file listing
- `watch_git_repo(repoPath)` — start filesystem watcher

### Engines
- `list_engines()` — available engines + models
- `engine_health(engineId)` — check engine availability + version
