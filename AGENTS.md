# AGENTS.md

Guia obrigatório para qualquer agente LLM que atuar neste repositório.

## 1) Missão do projeto

Construir e evoluir o **Agent Workspace**: app desktop open-source (Tauri v2 + React + TypeScript + Rust) para orquestração de agentes de programação com suporte nativo a multi-repo.

Este projeto prioriza:

- arquitetura sólida e previsível;
- modelo unificado de eventos;
- persistência auditável;
- segurança por sandbox/trust-level;
- experiência de chat em tempo real com approvals.

## 2) Postura esperada do agente

- Seja direto, técnico e pragmático.
- Não “inventar” comportamento do sistema: valide no código antes.
- Em caso de dúvida, explicite a suposição e minimize impacto.
- Priorize consistência arquitetural sobre atalhos locais.
- Evite mudanças grandes sem justificar trade-offs.

## 3) Regras obrigatórias de execução

1. Sempre ler contexto antes de editar.
2. Não quebrar contratos IPC já expostos ao frontend.
3. Não alterar o modelo unificado de `EngineEvent` sem atualizar:
   - mapeamento de engine;
   - persistência;
   - renderização no chat.
4. Nunca misturar engine/model dentro da mesma thread existente.
5. Não remover controles de approval/sandbox por conveniência.
6. Não introduzir segredos em código, logs ou banco.
7. Não usar comandos destrutivos de git sem pedido explícito.

## 4) Fluxo padrão de trabalho

1. Entender o pedido e mapear arquivos afetados.
2. Fazer mudanças pequenas e coesas por módulo.
3. Validar localmente (quando ambiente permitir):
   - frontend: typecheck/build;
   - rust: fmt/check;
   - smoke de fluxo IPC afetado.
4. Reportar:
   - o que foi alterado;
   - riscos remanescentes;
   - gaps de teste.

## 5) Convenções de arquitetura (não violar)

## 5.1 Backend Rust

- `commands/*` = borda IPC (sem regra de negócio complexa).
- `engines/*` = integração com motores + normalização de eventos.
- `db/*` = acesso SQLite/migrations.
- `git/*` = estado Git confiável e independente do motor.
- `config/*` = leitura/escrita de configuração local.

## 5.2 Frontend

- Stores Zustand para estado global.
- Componentes de chat renderizam `ContentBlock` tipado.
- Eventos de streaming entram por canal `stream-event-{thread_id}`.
- Painel Git deve refletir estado real do repositório, sem depender do motor.

## 5.3 Persistência

- Toda mudança de schema passa por migration versionada.
- Ações e approvals relevantes devem ser persistidos para auditoria.
- Em streaming, mensagem de assistant nasce como placeholder `streaming`.

## 6) Regras de segurança

- `allowNetwork = false` por padrão.
- Respeitar `TrustLevel` do repositório (`trusted`, `standard`, `restricted`).
- Threads de workspace (multi-writable-roots) exigem política explícita.
- Truncar outputs grandes para evitar travamento de UI/banco.

## 7) Estilo de código e qualidade

- TypeScript estrito, sem `any` desnecessário.
- Rust com erros contextualizados (`anyhow::Context`) e tipos claros.
- Evitar comentários óbvios; comentar apenas decisão não trivial.
- Não adicionar dependência nova sem necessidade real.

## 8) Definição de pronto (DoD)

Uma tarefa só está pronta quando:

1. Compila/typecheck no escopo afetado (quando possível no ambiente).
2. Não quebra contratos existentes.
3. Tem cobertura mínima de cenário crítico (teste ou validação manual descrita).
4. Atualiza documentação se contrato/fluxo mudou.
5. Entrega com resumo objetivo e limitações explícitas.

## 9) Anti-padrões proibidos

- “Mockar” fluxo real do produto sem sinalizar claramente.
- Duplicar lógica entre frontend e backend sem motivo.
- Acoplamento direto da UI a payload bruto de engine não normalizado.
- Persistir dados sensíveis em texto puro.
- Corrigir bug visual mascarando erro de estado.

## 10) Prioridade de decisão (quando houver conflito)

1. Segurança e integridade de dados.
2. Correção funcional.
3. Consistência arquitetural.
4. Clareza de manutenção.
5. Velocidade de entrega.
