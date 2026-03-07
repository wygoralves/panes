<p align="center">
  <img src="app-icon.svg" alt="Panes" width="128" height="128" />
</p>

<h1 align="center">Panes</h1>

<p align="center">
  <strong>The local-first cockpit for AI-assisted coding.</strong>
</p>

<p align="center">
  <a href="https://panesade.com">Website</a> &bull;
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
</p>

---

Panes wraps a native desktop UI around external coding agents, git, terminal workflows, and lightweight file editing. It gives developers one place to chat with agents, inspect diffs, approve actions, manage multi-repo work, and keep an audit trail of what happened.

Panes is not a full IDE, but it does ship with a built-in multi-tab editor for quick review and edits without leaving the app.

## Features

### Chat & Agents

- Streaming chat with structured content blocks for text, thinking, actions, diffs, approvals, attachments, and usage updates
- Codex chat integration via `codex app-server`
- Claude chat integration via a Claude Agent SDK sidecar
- Plan mode, attachments, reasoning effort controls, per-thread approval/network overrides, and Codex-specific sandbox-mode overrides
- Global FTS message search with keyboard navigation
- Windowed message loading and lazy hydration for long threads/action output

### Git

- Multi-repo awareness with per-repo active toggles and trust levels
- Changes, diff, stage, unstage, discard, commit, and soft reset
- Branch management with pagination and search
- Commit history, stash operations, worktree management, and remote management
- Repo initialization flow from the UI
- Filesystem watching plus cached/truncated file-tree scanning for large repos

### Terminal & Harnesses

- Native PTY terminal powered by xterm.js + WebGL
- Terminal groups, split panes, draggable resize, and broadcast mode
- Session replay/resume and renderer diagnostics
- Harness detection, install, and launch flows for Codex CLI, Claude Code, Gemini CLI, Kiro, OpenCode, Kilo Code, and Factory Droid
- Multi-launch mode that can fan out one session per harness, optionally with one git worktree per session

### Editor & Desktop UX

- Multi-tab CodeMirror editor with dirty tracking, save, and external-modification warnings
- Built-in find/replace (`Cmd+F`, `Cmd+H`) and editor toggle (`Cmd+E`)
- Command palette for commands, files, threads, workspaces, harnesses, and git actions
- Setup wizard for Node.js and Codex requirements, plus Git detection
- Update dialog with download/install flow
- Crash recovery, toast notifications, and session persistence

## Current State

Panes is pre-MVP but already implements the core desktop workflow: chat engines, git panel, terminals, harness launch, built-in editing, setup, updates, and local persistence.

There is real automated coverage now, but it is still selective. The repo already has GitHub Actions validation and release automation, including bundle and update-manifest publishing.

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Rust toolchain | stable |
| Node.js | 20+ |
| pnpm | 9+ |
| Codex CLI | Required for the Codex chat engine; setup can install it via npm |
| Tauri v2 prerequisites | [See Tauri docs](https://v2.tauri.app/start/prerequisites/) |

### Install and Run

```bash
git clone https://github.com/wygoralves/panes.git
cd panes
pnpm install
pnpm tauri:dev
```

### Production Build

```bash
pnpm tauri:build
```

Common bundle artifacts include macOS DMGs/app archives and Linux DEB/AppImage outputs, depending on platform and target.

Git is recommended for the repo-management features, but the app can still launch without it.

## Development

```bash
pnpm tauri:dev          # full desktop app in dev mode
pnpm tauri:build        # native desktop bundles

pnpm dev                # frontend-only dev server
pnpm build              # frontend production build
pnpm test               # Vitest suite
pnpm typecheck          # TypeScript no-emit check

pnpm build:claude-sidecar   # bundle the runtime Claude sidecar
pnpm build:desktop          # build frontend + bundled sidecar assets, not native app bundles
pnpm release:check          # evaluate whether a release should be cut
pnpm release                # run release-it
```

Rust-only:

```bash
cd src-tauri
cargo check
cargo fmt
cargo clippy
```

### Runtime Paths

| Path | Purpose |
|---|---|
| `~/.agent-workspace/config.toml` | App configuration |
| `~/.agent-workspace/workspaces.db` | SQLite database |
| `~/.agent-workspace/logs` | App log directory |

### Localization

User-facing frontend copy is localized with `i18next`/`react-i18next`. Treat i18n as part of the implementation of every new feature, not as cleanup work after the UI is already built.

- Do not ship new visible UI strings hardcoded in components, dialogs, menus, toasts, or empty states
- Add or update translation keys in both `src/i18n/resources/en/` and `src/i18n/resources/pt-BR/`
- Reuse the existing namespace structure whenever possible and keep keys aligned across locales
- Keep the i18n resource test passing when copy changes

## Architecture

Panes uses a React + Zustand frontend running inside a Tauri shell, with a Rust backend that owns persistence, engine orchestration, git operations, terminal management, and filesystem-safe file access.

The app currently exposes Codex and Claude as chat engines. Codex talks to `codex app-server`; Claude is bridged through the bundled Claude runtime sidecar.

### Stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Frontend | React 19 + TypeScript 5.5 + Vite 6 |
| Styling | Tailwind CSS 4 |
| State management | Zustand 5 |
| Markdown | micromark + highlight.js |
| Diff | diff2html + custom parser |
| File editor | CodeMirror 6 |
| Terminal | xterm.js + portable-pty |
| Database | SQLite + FTS5 |
| Git | `git2` + CLI helpers |

## Contributing

Contributions are welcome.

1. Fork the repo
2. Create your branch
3. Make the change
4. If the change adds or edits user-facing copy, update both locale resource sets as part of the same change
5. Run the relevant checks
6. Open a pull request

## License

[MIT](LICENSE)
