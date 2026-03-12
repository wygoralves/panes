<p align="center">
  <img src="app-icon.svg" alt="Panes" width="128" height="128" />
</p>

<h1 align="center">Panes</h1>

<p align="center">
  <strong>English</strong> &bull; <a href="./README.pt-BR.md">Português (Brasil)</a>
</p>

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
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform" />
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

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Rust toolchain | stable |
| Node.js | 20+ |
| pnpm | 9+ |
| Codex CLI | Required for the Codex chat engine; setup can install it via npm |
| Tauri v2 prerequisites | [See Tauri docs](https://v2.tauri.app/start/prerequisites/) |

### Install on macOS

```bash
brew install --cask wygoralves/tap/panes
```

Homebrew is the primary macOS install path for prebuilt Panes releases. The macOS release is shipped as a universal app, so the same DMG works on both Apple Silicon and Intel Macs. The app updater then handles later versions in-app.

Panes is not currently signed and notarized with Apple, so Homebrew only reduces Gatekeeper friction; it does not eliminate it. The tap applies a best-effort quarantine removal step during install, but macOS may still require a manual first-launch confirmation depending on system policy. If that happens, use Finder's Open flow or download the DMG directly from [GitHub Releases](https://github.com/wygoralves/panes/releases/latest).

If Gatekeeper blocks a direct DMG install, use these commands instead of disabling Gatekeeper globally:

```bash
# If macOS blocks the downloaded DMG itself
xattr -d com.apple.quarantine ~/Downloads/Panes*.dmg
open ~/Downloads/Panes*.dmg

# After dragging Panes.app into /Applications, if first launch is blocked
xattr -dr com.apple.quarantine /Applications/Panes.app
open /Applications/Panes.app
```

Maintainers can find the tap/release automation setup in [docs/homebrew-distribution.md](./docs/homebrew-distribution.md).

### Install on Windows

Download the latest `*-setup.exe` installer from [GitHub Releases](https://github.com/wygoralves/panes/releases/latest) and run it. Later updates are delivered in-app through the Tauri updater.

### Install and Run from Source

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

Common bundle artifacts include macOS DMGs/app archives, Linux DEB/AppImage outputs, and Windows NSIS installers, depending on platform and target.

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
pnpm prune:artifacts:check  # inspect generated artifacts that are safe to remove
pnpm prune:artifacts        # remove repo-local generated artifacts like src-tauri/target
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

Generated build artifacts can grow quickly during Tauri/Rust development. `pnpm prune:artifacts` only removes repo-local generated output and is safe to regenerate on the next build.

### Runtime Paths

| Path | Purpose |
|---|---|
| macOS / Linux: `~/.agent-workspace/config.toml` | App configuration |
| macOS / Linux: `~/.agent-workspace/workspaces.db` | SQLite database |
| macOS / Linux: `~/.agent-workspace/logs` | App log directory |
| Windows: `%LOCALAPPDATA%\Panes\config.toml` | App configuration |
| Windows: `%LOCALAPPDATA%\Panes\workspaces.db` | SQLite database |
| Windows: `%LOCALAPPDATA%\Panes\logs` | App log directory |

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

Contributions are welcome. Use the pull request flow described in [CONTRIBUTING.md](./CONTRIBUTING.md).

All external changes should go through a reviewed pull request. If the change adds or edits user-facing copy, update both locale resource sets as part of the same change.

## License

[MIT](LICENSE)
