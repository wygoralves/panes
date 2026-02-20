# Plano de Performance do Panes

## Objetivo

Elevar a performance do app de forma consistente, com foco em:

1. Latência de streaming no chat.
2. Redução de escrita desnecessária em SQLite.
3. Estabilidade em cenários de carga (threads longas, eventos frequentes, repos grandes).

## Status Atual

- Item 1: concluído
- Item 2: concluído
- Item 3: concluído

## Itens Prioritários (P0)

### 1. Reduzir write amplification no streaming de chat

Status: concluído

Problema original:
- Persistência de blocos/status é feita com alta frequência durante o streaming.
- Atualização de status de thread pode ocorrer repetidamente sem transição real.
- Saída de ações pode crescer em memória com muitos chunks.

Ações implementadas:
- Persistência de estado do assistente em janela de batch (`~180ms`) no fluxo de streaming.
- Persistência imediata apenas em eventos críticos e no encerramento do turno.
- Atualização de status de thread somente quando há transição real.
- Ring buffer por ação para limitar chunks de output no backend (limite atual: `240`).

Arquivos alterados:
- `src-tauri/src/commands/chat.rs`
- `src-tauri/src/db/threads.rs`

Ganhos esperados após implementação:
- Menos lock de SQLite.
- Menor custo de I/O por turno.
- Melhor p95 de fluidez durante stream.

### 2. Remover escrita durante leitura de mensagens

Status: concluído

Problema original:
- Fluxo de leitura de mensagens (`get_thread_messages`) pode disparar escrita de backfill.

Ações implementadas:
- Tornar leitura estritamente read-only.
- Manter atualização de approvals respondidos somente no caminho de escrita apropriado.

Arquivos alterados:
- `src-tauri/src/db/messages.rs`

Ganhos esperados após implementação:
- Abertura de thread mais rápida.
- Menos contenção e comportamento mais previsível.

### 3. Ajustar SQLite para throughput concorrente

Status: concluído

Problema original:
- Conexão sem tuning explícito de PRAGMAs para o padrão de acesso da aplicação.

Ações implementadas:
- `journal_mode = WAL`
- `synchronous = NORMAL`
- `busy_timeout` configurado
- `temp_store = MEMORY`

Arquivo alterado:
- `src-tauri/src/db/mod.rs`

Ganhos esperados após implementação:
- Menos bloqueio entre leitores/escritores.
- Melhor throughput em cargas mistas (chat + git + UI).

## Métricas de acompanhamento

Monitorar no ambiente de desenvolvimento:

1. `chat.stream.flush.ms`
2. `chat.render.commit.ms`
3. `git.refresh.ms`
4. Tempo de abertura de thread (manual + logs)
5. Frequência de warnings de budget em `window.__panesPerf.recent()`

## Próximos passos de validação

1. Coletar baseline comparativo de latência de stream (p50/p95) em thread longa.
2. Medir tempo de abertura de thread antes/depois em cenário com histórico grande.
3. Observar lock contention e throughput em execução mista (chat + git panel aberto).
4. Validar se o limite de `240` chunks por ação é adequado para sessões longas.

Essas medições confirmam o ganho real e orientam os próximos P0/P1.
