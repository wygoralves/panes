# Plano de Performance do Panes

## Objetivo

Elevar a performance do app de forma consistente, com foco em:

1. Latência de streaming no chat.
2. Redução de escrita desnecessária em SQLite.
3. Estabilidade em cenários de carga (threads longas, eventos frequentes, repos grandes).

## Escopo deste documento

- Este arquivo representa o inventário completo do mapeamento atual de performance.
- Rodada atual: fevereiro/2026.
- Status possíveis: `concluído`, `pendente`, `em validação`.

## Status executivo

- P0 concluído: `6/6` (`FP-01`, `FP-02`, `FP-03`, `FP-04`, `FP-05`, `FP-09`).
- Findings mapeados no total: `12`.
- Findings pendentes: `6` (P0: `0`, P1: `4`, P2: `2`).

## Inventário completo de findings

| ID | Área | Finding | Prioridade | Status | Impacto estimado | Evidências principais |
|---|---|---|---|---|---|---|
| FP-01 | Chat + DB | Write amplification no streaming de blocos/status | P0 | concluído | Alto | `src-tauri/src/commands/chat.rs`, `src-tauri/src/db/threads.rs` |
| FP-02 | DB | Escrita durante leitura em `get_thread_messages` | P0 | concluído | Alto | `src-tauri/src/db/messages.rs` |
| FP-03 | DB | SQLite sem tuning de concorrência em runtime | P0 | concluído | Alto | `src-tauri/src/db/mod.rs` |
| FP-04 | DB | Churn de conexão SQLite (abre conexão por operação, inclusive hot paths) | P0 | concluído | Alto | `src-tauri/src/db/mod.rs` |
| FP-05 | Backend | Operações bloqueantes de DB em comandos async fora de `spawn_blocking` | P0 | concluído | Alto | `src-tauri/src/commands/chat.rs`, `src-tauri/src/commands/workspace.rs`, `src-tauri/src/commands/threads.rs`, `src-tauri/src/commands/terminal.rs` |
| FP-06 | Chat + DB | Persistência ainda regrava `blocks_json` completo (payload cresce com thread longa) | P1 | pendente | Médio/Alto | `src-tauri/src/commands/chat.rs`, `src-tauri/src/db/messages.rs` |
| FP-07 | Chat | Leitura de thread sem paginação/lazy load (carrega histórico completo) | P1 | pendente | Médio/Alto | `src-tauri/src/db/messages.rs`, `src/stores/chatStore.ts` |
| FP-08 | Frontend Chat | Redutor de stream com cópias lineares e `findIndex` recorrente em blocos | P1 | pendente | Médio | `src/stores/chatStore.ts` |
| FP-09 | Git | Watcher recursivo + refresh completo por evento (risco de tempestade de refresh) | P0 | concluído | Alto | `src-tauri/src/git/watcher.rs`, `src/components/git/GitPanel.tsx` |
| FP-10 | Git UI | Parse de diff síncrono e lista de arquivos sem virtualização no Git panel | P1 | pendente | Médio/Alto | `src/components/git/GitChangesView.tsx` |
| FP-11 | Git Backend | `get_file_tree_page` ainda escaneia árvore inteira antes de paginar | P1 | pendente | Médio | `src-tauri/src/git/repo.rs` |
| FP-12 | Observabilidade | Telemetria só em memória e sem harness automatizado de regressão | P2 | pendente | Médio | `src/lib/perfTelemetry.ts`, ausência de suíte de benchmark |

## Itens já implementados (P0 entregues)

### FP-01 concluído: reduzir write amplification no streaming

- Persistência em lote (`~180ms`) no backend.
- Flush imediato apenas em eventos críticos e no fechamento do turno.
- Status de thread atualizado só em transição real.
- Ring buffer de output de ação no backend (`240` chunks).

### FP-02 concluído: remover escrita durante leitura de mensagens

- `get_thread_messages` mantido estritamente read-only.
- Backfill em leitura removido.

### FP-03 concluído: tuning de SQLite para throughput concorrente

- `journal_mode = WAL`
- `synchronous = NORMAL`
- `temp_store = MEMORY`
- `busy_timeout = 5s`

### FP-04 concluído: reduzir churn de conexão SQLite

- `Database` agora usa pool leve de conexões reutilizáveis (idle pool).
- Reuso de conexões em hot paths reduziu custo de `open/close` por operação.

### FP-05 concluído: tirar DB bloqueante do runtime async

- Chamadas de DB em comandos migradas para `spawn_blocking` com helper dedicado.
- Cobertura aplicada aos fluxos principais de chat, threads, workspace e terminal.

### FP-09 concluído: reduzir tempestade de refresh por watcher Git

- Backend: debounce maior e filtro de eventos de baixo valor (`Access`, `.git`-only).
- Frontend: coalescimento de refresh com fila e lock de in-flight no `GitPanel`.

## Plano recomendado de execução (próximo ciclo)

### Onda 1 (P1)

1. FP-07: paginação real de mensagens (carregar janela recente primeiro, histórico sob demanda).
2. FP-06: reduzir payload persistido de blocos (delta/segmentação/compressão no caminho quente).
3. FP-10: mover parse de diff do Git panel para worker e virtualizar lista de arquivos alterados.
4. FP-11: cache incremental para file tree e paginação sem full rescan.

### Onda 2 (P2)

1. FP-12: persistir snapshot de métricas e criar benchmark de regressão simples (script + dataset fixo).

## Métricas de acompanhamento

Monitorar no ambiente de desenvolvimento:

1. `chat.stream.flush.ms` (p95 alvo: <= `12ms`)
2. `chat.render.commit.ms` (p95 alvo: <= `16ms`)
3. `chat.markdown.worker.ms` (p95 alvo: <= `28ms`)
4. `git.refresh.ms` (p95 alvo: <= `350ms`)
5. `git.file_diff.ms` (p95 alvo: <= `250ms`)
6. Tempo de abertura de thread em histórico longo (meta: queda consistente após FP-07)
7. Frequência de warnings em `window.__panesPerf.recent()`

## Critério de pronto por finding

- Mudança implementada com impacto mensurável antes/depois.
- Sem regressão funcional no fluxo principal (chat, approvals, git changes).
- Métrica alvo atingida ou desvio documentado com justificativa.
