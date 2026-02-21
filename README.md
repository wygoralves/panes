<p align="center">
  <img src="app-icon.png" alt="Panes" width="128" height="128" />
</p>

<h1 align="center">Panes</h1>

<p align="center">
  <strong>The open-source desktop cockpit for AI coding agents.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#development">Development</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://github.com/wygoralves/panes/releases/latest"><img src="https://img.shields.io/github/v/release/wygoralves/panes?label=download&color=blue" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/auto--update-OTA-green.svg" alt="OTA Auto-Update" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

---

Panes wraps a rich native UI around terminal-based coding agents, giving developers a single pane of glass to orchestrate, review, and approve everything their AI agents do — across multiple repositories.

Coding agents are powerful, but their CLI interfaces are limiting. Panes gives you real-time streaming chat, native git integration, multi-repo management, approval workflows, integrated terminal, and full audit trails — all in a fast, local-first desktop app.

<!-- TODO: Add screenshot here -->
<!-- <p align="center"><img src="docs/screenshot.png" alt="Panes screenshot" width="800" /></p> -->

## Features

**Chat & Streaming**
- Real-time streaming chat with structured content blocks (text, thinking, code, diffs, actions, approvals)
- Event coalescing and frontend batching for buttery-smooth streaming
- Markdown rendering with Web Worker offload and LRU caching
- Global message search (FTS5) with keyboard navigation

**Git — First-Class Citizen**
- Full git panel: status, diff, stage, unstage, commit
- Branch management: create, rename, delete, checkout (local + remote)
- Remote operations: fetch, pull, push with ahead/behind tracking
- Commit history browser and stash management
- Filesystem watcher for real-time change detection
- Multi-repo awareness: auto-detect nested repos, per-repo active toggle

**Engine Orchestration**
- Engine-agnostic architecture — orchestrate any external coding agent
- Codex engine fully integrated (JSONL protocol, streaming, approvals, model picker)
- Approval workflows with structured questionnaires and custom JSON mode
- Trust levels per repository (trusted / standard / restricted)
- Runtime model discovery and reasoning effort control

**Terminal**
- Integrated native terminal (PTY) with xterm.js + WebGL rendering
- Multi-session tabs per workspace
- Persistent sessions across navigation — scrollback survives workspace switches

**Desktop Experience**
- Three-column resizable layout with pin/unpin sidebar
- Virtualized message list and diff rendering for large threads
- Workspace/thread persistence across sessions
- Crash recovery for interrupted turns

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Rust toolchain | stable |
| Node.js | 20+ |
| pnpm | 9+ |
| Tauri v2 prerequisites | [See Tauri docs](https://v2.tauri.app/start/prerequisites/) |

### Install and Run

```bash
# Clone the repository
git clone https://github.com/wygoralves/panes.git
cd panes

# Install dependencies
pnpm install

# Run in development mode (hot-reload frontend + Rust backend)
pnpm tauri:dev
```

### Production Build

```bash
pnpm tauri:build
```

Build targets: `.app` (macOS), `.dmg` (macOS), `.deb` (Linux), `.AppImage` (Linux).

## Development

```bash
pnpm tauri:dev          # Full app dev mode (frontend + backend)
pnpm dev                # Frontend-only dev server (no Tauri backend)
pnpm build              # Frontend-only production build
pnpm typecheck          # TypeScript type checking
```

Rust-only:

```bash
cd src-tauri
cargo check             # Type check
cargo fmt               # Format
cargo clippy            # Lint
```

### Runtime Paths

| Path | Purpose |
|---|---|
| `~/.agent-workspace/config.toml` | App configuration |
| `~/.agent-workspace/workspaces.db` | SQLite database (all persistent state) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                Frontend (React + TS)                 │
│                                                     │
│  Sidebar  ←→  ChatPanel  ←→  GitPanel               │
│                  ↕                                   │
│            TerminalPanel                             │
│                  ↕                                   │
│   Zustand Stores + IPC Bridge + Web Workers          │
├─────────────────────────────────────────────────────┤
│              Tauri IPC boundary                      │
├─────────────────────────────────────────────────────┤
│                Backend (Rust)                        │
│                                                     │
│  Engines ←→ DB (SQLite) ←→ Git (libgit2)            │
│                ↕               ↕                     │
│          Terminal (PTY)    FS Watcher                 │
│                ↕                                     │
│     External Engine Process                          │
│     (codex app-server, etc)                          │
└─────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 (Rust + webview) |
| Frontend | React 19 + TypeScript 5.5 + Vite 6 |
| Styling | Tailwind CSS 4 |
| State management | Zustand 5 |
| Terminal | xterm.js + WebGL + portable-pty (Rust) |
| Database | SQLite (rusqlite) with FTS5 |
| Git | libgit2 for reads, CLI subprocess for writes |
| Markdown | micromark + highlight.js (Web Worker) |
| Diff | diff2html + custom parser (Web Worker) |

### Key Design Decisions

- **Event coalescing** — backend merges consecutive deltas (up to 8KB) before IPC emission; frontend batches events in 16ms windows before React state updates
- **Web Workers** — markdown and diff parsing offloaded to workers to keep UI thread at 60fps
- **Virtualization** — messages virtualized at 40+ items; diffs at 500+ lines
- **Engine-agnostic** — all engines emit a unified `EngineEvent` model regardless of native protocol
- **Local-first** — everything stored locally in SQLite, no cloud dependency

## Project Status

Panes is in **pre-MVP** stage. Core architecture and runtime are fully operational.

**Working:** Codex engine integration, streaming chat with content blocks, full git panel (status/diff/stage/commit/branches/stash/fetch/pull/push), multi-repo management, integrated terminal, FTS search, approval workflows, crash recovery, performance telemetry.

**Working:** OTA auto-updates via Tauri updater + GitHub Pages, CI/CD with automated releases.

**In progress:** Claude sidecar engine, direct API engine, automated tests.

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — all input helps.

1. Fork the repo
2. Create your branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push to your branch
5. Open a Pull Request

## License

[MIT](LICENSE)
