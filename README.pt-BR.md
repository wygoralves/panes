<p align="center">
  <img src="app-icon.svg" alt="Panes" width="128" height="128" />
</p>

<h1 align="center">Panes</h1>

<p align="center">
  <a href="./README.md">English</a> &bull; <strong>Português (Brasil)</strong>
</p>

<p align="center">
  <strong>O cockpit local-first para coding com agentes de IA.</strong>
</p>

<p align="center">
  <a href="https://panesade.com">Website</a> &bull;
  <a href="#recursos">Recursos</a> &bull;
  <a href="#como-começar">Como Começar</a> &bull;
  <a href="#desenvolvimento">Desenvolvimento</a> &bull;
  <a href="#arquitetura">Arquitetura</a> &bull;
  <a href="#contribuindo">Contribuindo</a> &bull;
  <a href="#licença">Licença</a>
</p>

<p align="center">
  <a href="https://github.com/wygoralves/panes/releases/latest"><img src="https://img.shields.io/github/v/release/wygoralves/panes?label=download&color=blue" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/auto--update-OTA-green.svg" alt="OTA Auto-Update" />
</p>

---

O Panes envolve uma UI desktop nativa em torno de agentes externos de coding, fluxos de git, terminal e edição leve de arquivos. Ele dá aos desenvolvedores um único lugar para conversar com agentes, inspecionar diffs, aprovar ações, gerenciar trabalho em múltiplos repos e manter um histórico auditável do que aconteceu.

O Panes não é uma IDE completa, mas inclui um editor multiaba embutido para revisão rápida e pequenas edições sem sair do app.

## Recursos

### Chat e Agentes

- Chat em streaming com blocos estruturados para texto, thinking, actions, diffs, approvals, attachments e atualizações de uso
- Integração de chat com Codex via `codex app-server`
- Integração de chat com Claude via sidecar do Claude Agent SDK
- Plan mode, attachments, controles de reasoning effort, overrides de approval/network por thread e overrides de sandbox mode específicos do Codex
- Busca global de mensagens com FTS e navegação por teclado
- Carregamento em janela e hidratação lazy para threads longas e outputs de action

### Git

- Suporte a múltiplos repos com toggles por repo e níveis de confiança
- Changes, diff, preparar, retirar, descartar, commit e soft reset
- Gerenciamento de branches com paginação e busca
- Histórico de commits, operações de stash, worktrees e remotes
- Fluxo de inicialização de repo pela UI
- Monitoramento de filesystem mais cache/truncamento da árvore de arquivos para repos grandes

### Terminal e Harnesses

- Terminal PTY nativo com xterm.js + WebGL
- Grupos de terminal, split panes, resize arrastável e broadcast mode
- Replay/resume de sessão e diagnósticos de renderer
- Fluxos de detecção, instalação e abertura de harnesses para Codex CLI, Claude Code, Gemini CLI, Kiro, OpenCode, Kilo Code e Factory Droid
- Multi-launch que pode abrir uma sessão por harness, opcionalmente com uma git worktree por sessão

### Editor e UX Desktop

- Editor CodeMirror multiaba com dirty tracking, save e avisos de modificação externa
- Find/replace embutido (`Cmd+F`, `Cmd+H`) e atalho para abrir o editor (`Cmd+E`)
- Command palette para comandos, arquivos, threads, workspaces, harnesses e ações de git
- Setup wizard para requisitos de Node.js e Codex, além de detecção de Git
- Update dialog com fluxo de download/instalação
- Crash recovery, toasts e persistência de sessão

## Estado Atual

O Panes ainda está em fase pre-MVP, mas já implementa o fluxo principal do desktop: chat engines, painel de git, terminais, abertura de harnesses, edição embutida, setup, updates e persistência local.

Já existe cobertura automatizada real, embora ainda seletiva. O repo também já possui automação de validação e release no GitHub Actions, incluindo publicação de bundles e de update manifests.

## Como Começar

### Pré-requisitos

| Requisito | Versão |
|---|---|
| Rust toolchain | stable |
| Node.js | 20+ |
| pnpm | 9+ |
| Codex CLI | Obrigatório para a chat engine do Codex; o setup pode instalá-lo via npm |
| Pré-requisitos do Tauri v2 | [Ver docs do Tauri](https://v2.tauri.app/start/prerequisites/) |

### Instalar e Rodar

```bash
git clone https://github.com/wygoralves/panes.git
cd panes
pnpm install
pnpm tauri:dev
```

### Build de Produção

```bash
pnpm tauri:build
```

Os artefatos de bundle normalmente incluem DMGs/arquivos de app no macOS e saídas DEB/AppImage no Linux, dependendo da plataforma e do target.

Git é recomendado para os recursos de gerenciamento de repo, mas o app ainda consegue abrir sem ele.

## Desenvolvimento

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

Somente Rust:

```bash
cd src-tauri
cargo check
cargo fmt
cargo clippy
```

### Caminhos de Runtime

| Caminho | Finalidade |
|---|---|
| `~/.agent-workspace/config.toml` | Configuração do app |
| `~/.agent-workspace/workspaces.db` | Banco SQLite |
| `~/.agent-workspace/logs` | Diretório de logs |

### Localização

A copy visível para o usuário no frontend é localizada com `i18next`/`react-i18next`. Trate i18n como parte da implementação de qualquer recurso novo, e não como limpeza feita depois que a UI já existe.

- Não adicione novas strings visíveis hardcoded em components, dialogs, menus, toasts ou empty states
- Adicione ou atualize chaves de tradução em `src/i18n/resources/en/` e `src/i18n/resources/pt-BR/`
- Reaproveite a estrutura de namespaces existente sempre que possível e mantenha as chaves alinhadas entre os locales
- Mantenha o teste de resources de i18n passando quando a copy mudar

## Arquitetura

O Panes usa um frontend React + Zustand rodando dentro de um shell Tauri, com um backend Rust responsável por persistência, orquestração de engines, operações de git, gerenciamento de terminal e acesso seguro ao filesystem.

Atualmente o app expõe Codex e Claude como chat engines. O Codex se conecta a `codex app-server`; o Claude é ligado por meio do sidecar runtime incluído.

### Stack

| Camada | Tecnologia |
|---|---|
| Desktop framework | Tauri v2 |
| Frontend | React 19 + TypeScript 5.5 + Vite 6 |
| Styling | Tailwind CSS 4 |
| Gerenciamento de estado | Zustand 5 |
| Markdown | micromark + highlight.js |
| Diff | diff2html + parser customizado |
| Editor de arquivos | CodeMirror 6 |
| Terminal | xterm.js + portable-pty |
| Banco de dados | SQLite + FTS5 |
| Git | `git2` + helpers via CLI |

## Contribuindo

Contribuições são bem-vindas.

1. Faça um fork do repo
2. Crie sua branch
3. Faça a mudança
4. Se a mudança adicionar ou editar copy visível ao usuário, atualize os dois conjuntos de locale no mesmo change
5. Rode os checks relevantes
6. Abra um pull request

## Licença

[MIT](LICENSE)
