# Agent Workspace

Open-source desktop orchestrator for coding agents with native multi-repo awareness.

## Stack

- Tauri v2 (Rust backend)
- React + TypeScript + Vite
- SQLite + FTS5
- Engines: Codex (`codex app-server`) and Claude sidecar (planned)

## Quick start

Prerequisites:

- Rust toolchain
- Node.js 20+
- pnpm 9+
- Tauri prerequisites for your OS

Commands:

```bash
pnpm install
pnpm tauri:dev
```

## Current status

Phase 1 scaffold + core runtime has been implemented:

- Workspace/repo/thread/message persistence
- Unified engine event model
- Codex engine process integration scaffold
- Chat streaming IPC channel
- Git panel IPC and status/diff/stage/commit commands
- Frontend three-column shell with typed blocks

## Delivery plan

- Full roadmap and acceptance criteria: `docs/PLANO_COMPLETO.md`

## License

MIT
