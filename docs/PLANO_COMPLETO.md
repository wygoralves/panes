# Plano Completo de Entrega — Agent Workspace v3

## 1. Objetivo

Levar a base atual (v0 scaffold) até um **v1 funcional de produção inicial** para macOS/Linux, com:

1. Codex App Server integrado de forma real (JSONL streaming, approvals e interrupt).
2. Claude Sidecar funcional com protocolo estável e approvals equivalentes.
3. UI de chat/gít/threads consistente com persistência auditável.
4. Segurança por sandbox e trust-level aplicada de ponta a ponta.
5. CI, build, release e documentação operacional.

## 2. Estado Atual (baseline)

## 2.1 Já implementado

1. Estrutura completa de projeto Tauri + React + TS.
2. Migration SQLite inicial com FTS5 e tabelas de auditoria.
3. IPC principal (chat/workspace/git/engines/threads).
4. Modelo unificado de `EngineEvent` e renderização de blocos no frontend.
5. Fluxo de placeholder de mensagem assistant durante streaming.
6. Painel Git básico com status/diff/stage/unstage/commit.
7. Config local (`~/.agent-workspace/config.toml`) com limites de debug/output.
8. Sidecar Claude em scaffold (Node), ainda sem execução real via SDK.

## 2.2 Gap principal

1. `CodexEngine` ainda em modo scaffold, sem sessão persistente JSONL real.
2. Aprovações reais de engine ainda não estão mapeadas ponta a ponta.
3. Sidecar Claude sem callbacks reais de aprovação/execução.
4. Watchers Git não conectados ao ciclo de atualização da UI.
5. Fluxo de threads ainda simplificado (foco em thread demo).
6. Testes automatizados e critérios de qualidade ainda incompletos.
7. Pipeline de release (dmg/deb/appimage) não finalizada.

## 3. Plano Macro (fases)

## Fase A — Codex Engine Real (prioridade máxima)

Objetivo: substituir scaffold por integração real com `codex app-server`.

Entregáveis:

1. Processo persistente do Codex com lifecycle `start/stop/restart`.
2. Camada JSONL robusta (reader/writer, correlator por `id`, timeouts).
3. Handshake `initialize` + `initialized`.
4. `thread/start` e `thread/resume` reais por thread do app.
5. `turn/start` com streaming contínuo de eventos.
6. `turn/interrupt` funcional com idempotência.
7. Resposta de server requests para approval com payload JSON livre.
8. Mapeador isolado `codex_event_mapper.rs` para `EngineEvent`.

Critérios de aceite:

1. Um turn completo gera `TextDelta`, ações e `TurnCompleted` sem fallback fake.
2. `cancel_turn` interrompe turn em até 2 segundos em cenário normal.
3. Approval recebido no backend vira bloco de UI e retorna decisão ao Codex.
4. Crash de processo Codex marca mensagem como `interrupted` ou `error` sem corromper thread.

## Fase B — Threading, Persistência e Replay confiáveis

Objetivo: robustez de dados para uso real diário.

Entregáveis:

1. Criação de threads por workspace/repo com engine/model imutáveis.
2. Persistência de `engine_thread_id` e metadata por engine.
3. Replay de thread no boot com estado consistente (`idle`, `streaming`, `awaiting_approval`).
4. Correlação forte `engine_action_id -> action_id` com fallback de fila.
5. Persistência opcional de log bruto por turn (`engine_event_logs`).
6. Truncamento de output com marcador explícito de truncamento.

Critérios de aceite:

1. Reiniciar app durante streaming não perde histórico persistido.
2. Ação iniciada/concluída mantém o mesmo `actionId` renderizado.
3. Busca FTS retorna mensagens recém-gravadas no mesmo ciclo.

## Fase C — Git e Multi-Repo operacionais

Objetivo: entregar visão de estado Git confiável e multi-repo utilizável.

Entregáveis:

1. Detecção multi-repo no `open_workspace` com `scan_depth` configurável.
2. Watchers Git conectados ao backend para refresh incremental da UI.
3. Painel Git com árvore de arquivos, diff staged/unstaged e commit funcional.
4. Threads de workspace com `writableRoots` múltiplos somente com confirmação explícita.
5. Política de trust-level aplicada na construção do sandbox.

Critérios de aceite:

1. Alterações externas ao app atualizam painel Git automaticamente.
2. Workspace com 2+ repos permite thread de workspace apenas após opt-in.
3. Em repo `restricted`, ações com efeito colateral exigem approval sempre.

## Fase D — Claude Sidecar Real

Objetivo: paridade funcional de approvals e execução com Codex.

Entregáveis:

1. Sidecar Node persistente com protocolo JSONL request/response/notify estável.
2. Integração com Agent SDK da Anthropic para sessões reais.
3. Fluxo real de `approval_requested` + `respond_to_approval`.
4. Mapeamento completo de eventos Claude para `EngineEvent`.
5. Health-check e onboarding específico de Claude.

Critérios de aceite:

1. Turn Claude produz streaming real (texto + ações + completion).
2. Aprovação pendente pausa execução e retoma corretamente após resposta.
3. Erros do sidecar são propagados para UI com mensagem recuperável.

## Fase E — UX, estabilidade e produção

Objetivo: fechar v1 utilizável e distribuível.

Entregáveis:

1. Atalhos de teclado (`Cmd+Enter`, `Cmd+.`, `Cmd+Shift+F`, `Cmd+B`, `Cmd+Shift+B`).
2. Virtualização da lista de mensagens para threads longas.
3. Onboarding completo de engines + setup wizard.
4. CI com lint/typecheck/test/check em frontend + rust + sidecar.
5. Build de release para macOS (app/dmg) e Linux (deb/appimage).
6. Documentação de instalação e troubleshooting.

Critérios de aceite:

1. App abre e roda em macOS Intel/Apple Silicon e Linux com artefatos gerados no CI.
2. Fluxo onboarding detecta ausência de engines e guia instalação.
3. Sessões longas não degradam UX por renderização de lista.

## 4. Backlog técnico por módulo

## 4.1 `src-tauri/src/engines/`

1. Criar `codex_protocol.rs` com tipos request/response/notifies tolerantes.
2. Criar `codex_transport.rs` para stdin/stdout JSONL com task dedicada.
3. Implementar mapa de pending requests por `id` e approvals pendentes por `approval_id`.
4. Implementar reconexão/restart com backoff limitado.
5. Evoluir `claude_sidecar.rs` para processo sidecar real e contract tests.

## 4.2 `src-tauri/src/commands/chat.rs`

1. Extrair mutação de `ContentBlock` para módulo próprio (`message_builder.rs`).
2. Encapsular persistência transacional por evento crítico.
3. Garantir atualização de estado de thread atomizada em erros.
4. Incluir canal dedicado `approval-request-{thread_id}` quando evento de approval chegar.

## 4.3 `src-tauri/src/db/`

1. Adicionar migrations incrementais para:
   `threads(engine_capabilities_json)`, `messages(stream_seq)`, `actions(truncated)`.
2. Criar testes de migration e de repositórios SQLite.
3. Adicionar índices de busca por status/thread/created_at quando necessário.

## 4.4 `src-tauri/src/git/`

1. Conectar `watcher.rs` ao estado global e `emit` por repo.
2. Garantir fallback CLI em operações limítrofes do `git2` com tratamento padronizado.
3. Adicionar proteção para repos grandes (timeouts e paginação de tree).

## 4.5 `src/`

1. Store de threads separada com criação/seleção/filtro por repo.
2. Renderização de approvals com modo avançado JSON custom.
3. Comportamento de autoscroll com lock explícito quando usuário sobe.
4. Busca global com preview/snippets e navegação para mensagem.
5. Tela de onboarding de engines e setup guiado.

## 4.6 Sidecar Claude (`src-tauri/src/sidecars/claude_agent/`)

1. Implementar contrato real de protocolo (notify independentes de response).
2. Runner com fila de turn, cancelamento e approval callbacks.
3. Logs estruturados e códigos de erro estáveis.

## 5. Testes obrigatórios

## 5.1 Rust

1. Unit tests para mapeamento de eventos Codex/Claude -> `EngineEvent`.
2. Unit tests para `message_builder` (sequência de blocos e correlação de ação).
3. Integration tests SQLite (migrations + persistência de turn).
4. Integration tests de IPC críticos (`send_message`, `cancel_turn`, approvals).

## 5.2 Frontend

1. Teste de renderização de cada `ContentBlock`.
2. Teste de store de chat em streaming e cancelamento.
3. Teste de fluxo approval (pending -> answered).
4. Teste do painel Git para status/diff/stage actions.

## 5.3 End-to-end

1. Turn Codex real com persistência e replay.
2. Turn Claude real com approval no meio do fluxo.
3. Multi-repo workspace thread com sandbox `writableRoots` múltiplos.

## 6. Riscos e mitigação

1. Instabilidade de protocolo do Codex.
Mitigação: parser tolerante + camada de compat por versão.

2. Complexidade de approvals cross-engine.
Mitigação: contrato interno comum + payload extensível por engine.

3. Desempenho em threads longas.
Mitigação: virtualização + truncamento + limites configuráveis.

4. Divergência de estado Git.
Mitigação: painel Git sempre baseado em leitura do repo local, não em eventos de engine.

## 7. Cronograma sugerido (8 semanas)

1. Semana 1-2: Fase A (Codex real).
2. Semana 3: Fase B (persistência/replay).
3. Semana 4: Fase C (Git watcher + multi-repo policy).
4. Semana 5-6: Fase D (Claude sidecar real).
5. Semana 7-8: Fase E (UX, testes, release).

## 8. Definição de pronto do v1

1. Codex e Claude funcionam com streaming + approval + interrupt.
2. Workspaces multi-repo operam com sandbox explícito e seguro.
3. Chat, Git panel e busca persistida funcionam de forma estável.
4. Testes críticos passam em CI.
5. Builds macOS/Linux geradas automaticamente com documentação de uso.
