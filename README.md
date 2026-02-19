# Panes (Agent Workspace)

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

Pre-MVP with core runtime fully operational:

- Codex engine running in real streaming mode (JSONL), with approvals and interrupt
- Workspace/repo/thread/message persistence in SQLite (with FTS5 search)
- Thread flow by scope + engine + model, including archive/restore lifecycle
- Chat streaming with typed content blocks and explicit autoscroll lock
- Approval UI with structured input and advanced custom JSON mode
- Git panel with status/diff/stage/unstage/commit + filesystem watcher
- Large-repo protections in file tree scans (timeout/entry cap) and paginated file tree API

Recent delivery update (2026-02-19):

- Improved thread selection/creation for advanced multi-engine and multi-model flows
- Explicit autoscroll lock UX with "jump to latest" when user scrolls up
- Advanced approval mode with custom JSON payload validation
- Codex transport reconnect/restart with bounded backoff
- Incremental DB compatibility columns/indexes at runtime
- Backend/frontend support for paginated git file tree

## Delivery plan

- Full roadmap and acceptance criteria: `docs/PLANO_COMPLETO.md`

## License

MIT
