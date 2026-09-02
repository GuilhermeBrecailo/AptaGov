# Task 7 — Orquestração durável de fontes oficiais

Data: 2026-09-02  
Status: corte parcial da rodada 2 implementado e verificado

## Correções entregues

1. Checkpoints de oportunidades e mercado são independentes por fluxo e escopo, e só avançam após persistência.
2. Jobs usam chave operacional única, criação atômica, claim com owner/lease, renovação e recovery somente de leases stale. Jobs legados não permanecem `PENDING` quando o automático está desligado.
3. Persistência de oportunidades publica eventos na outbox transacional. O processamento downstream é idempotente e retryable, evitando perda de classificação, agenda, checklist e notificação após falha de hook.
4. Pausas são persistidas por estágio, fonte, canal e backup; o status faz merge entre pausa global e específica, bloqueia apenas o escopo correspondente e `result.paused` reflete o estado persistido.
5. Resume usa health check específico por fonte/estágio/canal e limpa somente as pausas saudáveis; pausas não saudáveis permanecem bloqueando o estágio correspondente.
6. Sync manual é filtrado por organização/radar na seleção, claim e efeitos downstream; a revalidação impede que um job de outro tenant seja consumido.
7. `source_runs` registra fluxo/escopo e métricas de ciclo são persistidas em `worker_cycle_metrics`, com resultados administrativos por fonte.
8. Contadores usam os registros efetivamente persistidos, e resultados de mercado mantêm contagem separada por fonte.
9. O desligamento do processamento automático absorve jobs legados pendentes em vez de deixá-los eternamente em `PENDING`.

## Migrations aditivas

- `024_worker_outbox.sql`: outbox durável com chave idempotente, tentativas e lease.
- `025_worker_pauses.sql`: pausas compostas por estágio/fonte/canal.
- `026_worker_cycle_metrics.sql`: métricas persistentes por ciclo/modo.

As tabelas e colunas existentes foram preservadas; o comportamento manual, automático, scheduler, classificação, notificações e backup continua compatível.

## Verificações desta rodada

- Focused Task 7: passou — 8 arquivos, 25 testes.
- `npm run typecheck`: passou.
- Suíte completa, lint e build: não executados nesta rodada final, conforme o escopo de fechamento reduzido solicitado.

## Limitações concretas

1. BEC/SP continua opt-in no registry existente e desligado por padrão (`BEC_SP_ENABLED=false`); sua ativação requer `BEC_SP_ENABLED=true` e os parâmetros `BEC_SP_*`.
2. O schema existente de `source_checkpoints` não tem dimensão de filtro/radar. O escopo é separado logicamente pela nova chave de fluxo/escopo, mas leituras remotas podem ser repetidas para janelas equivalentes; upsert/dedupe evita registros e alertas duplicados.
3. Jobs legados `sync_and_classify` não possuem cursor por página. No restart, o runtime pode absorvê-los no novo ciclo, mas não recupera a página exata do job antigo.
4. A entrega real de e-mail/Web Push continua dependente das credenciais/canais existentes (`RESEND_*` e `VAPID_*`); não houve deploy.

## Fora do escopo

Nenhum push, deploy ou alteração visual foi realizada.

## Rodada 2 — corte parcial

Este corte trata somente retry durável da outbox e single-flight/lease dos jobs.

- `worker_outbox.next_retry_at` usa backoff exponencial limitado e `MAX_OUTBOX_ATTEMPTS=5`; falhas não são reivindicadas novamente no mesmo ciclo e o loop ainda possui limite de segurança por ciclo.
- A migration aditiva `027_durable_worker_followup` adiciona `next_retry_at`, índice de retry, backfill de tenant a partir de `checkpoint_json`, tratamento explícito de jobs globais e unicidade da chave operacional em todos os estados. Duplicatas históricas são preservadas com chave legada sufixada.
- `JobRepository.reserve` mantém single-flight mesmo após `COMPLETED`, recupera jobs `FAILED` para o próximo ciclo, aceita payload legado na filtragem/claim e mantém conclusão/renovação condicionadas ao owner.
- `WorkerRuntime` renova leases durante sincronizações longas de fonte/mercado e durante a preparação de agenda; o parâmetro não utilizado do processamento da outbox foi removido.

Verificações do corte: focused Task 7 em 9 arquivos/30 testes, lint e typecheck passaram. A suíte completa ainda não foi rodada neste corte; a regressão de `source-checkpoint` e as demais pendências do rereview continuam abertas. Build também permanece pendente.

Pendências deliberadamente não implementadas neste corte: coerência da pausa global legada com pausas compostas, health check efetivo por canal de notificação sem fallback indevido do override, compatibilidade de leitura do checkpoint sem fluxo e falha no escopo correto, validação de `radarId` por organização, exposição administrativa de `source_runs`/métricas e fechamento dos status/categorias/órfãos legados.
