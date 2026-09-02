# Task 7 — Orquestração durável de fontes oficiais

Data: 2026-09-02  
Status: rodada 3 — corte 1 concluído e verificado localmente

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
- `027_durable_worker_followup.sql`: retry da outbox, backfill de tenant e single-flight terminal.
- `028_legacy_job_scope.sql`: marca globais legados e encerra payloads de tenant incompatíveis.
- `029_worker_delivery_leases.sql`: leases aditivos por entrega de e-mail e Web Push.

As tabelas e colunas existentes foram preservadas; o comportamento manual, automático, scheduler, classificação, notificações e backup continua compatível.

## Verificações desta rodada

- Focused Task 7: passou — 8 arquivos, 25 testes.
- Correções da rodada 3: `task7-fix-round3` passou com 7/7 testes e `source-checkpoint` passou com 10/10.
- Suíte completa: passou — 50 arquivos, 181 testes.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm run build`: passou.

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

Verificações do corte: focused Task 7 em 9 arquivos/30 testes, lint e typecheck passaram. A regressão de `source-checkpoint` e as demais pendências do rereview foram corrigidas na rodada 3; suíte completa e build também passaram.

As pendências listadas acima foram tratadas na rodada 3; permanecem apenas as limitações concretas abaixo.

## Rodada 3 — fechamento das pendências operacionais

- A pausa global legada agora é identificada explicitamente no status mesmo quando coexistem pausas compostas. Ela bloqueia todos os estágios; resume seletivo remove somente a condição selecionada e não apaga a pausa global. `result.paused` deriva da visão persistida.
- Resume de notificações usa check por canal: override legado só atende a pausa global do worker, enquanto canais usam tentativa controlada injetável ou um resultado `SENT` recente, além da configuração. Nenhuma credencial ou mensagem bruta é retornada/logada pelo painel.
- A API de leitura de checkpoint sem fluxo mantém compatibilidade apenas como fallback explícito quando há um único checkpoint de mercado para a janela; gravações e leituras com `flow`/`scopeKey` continuam separadas. Falhas do sync preservam o fluxo/escopo da query que falhou.
- Sync manual rejeita radar inexistente ou pertencente a outra organização tanto no runtime quanto no endpoint HTTP.
- O endpoint administrativo existente passa a expor `sourceRuns` e ciclos do worker com contagens, status e categorias de erro, omitindo `error_message`, payloads, cursores e caminhos de backup.
- Jobs legados com tenant válido são reivindicáveis pelo payload quando necessário; globais são marcados explicitamente e payloads incompatíveis deixam de ser órfãos em `PENDING`. Jobs inválidos também são terminalizados pelo runtime.

Focused desta etapa: `tests/unit/task7-fix-round3.test.ts` passou com 7/7 testes; `tests/unit/source-checkpoint.test.ts` passou com 10/10; lint passou. A suíte completa passou com 50 arquivos/181 testes; typecheck e build também passaram.

## Rodada 3 — corte 1: entrega, reclaim, fingerprint e owner

- Entregas de e-mail e Web Push usam claim atômico por canal com `lease_owner`/`lease_until`; envio, renovação, `markSent` e `markFailed` são condicionados ao owner. O dedupe por `eventKey` foi preservado.
- Reclaim stale da outbox com `attempts >= MAX_OUTBOX_ATTEMPTS` é terminalizado como `FAILED` sem nova reivindicação; `complete`/`fail` exigem owner e tenant explícito.
- O eventKey de sincronização usa o fingerprint dos campos oficiais observados, evitando novo evento quando o polling só altera `updated_at`.
- Mutações de job após claim exigem owner; payload inválido tem transição atômica própria e o caminho legado usa conclusão explícita.

Verificações do corte 1: focused de concorrência/lease/reclaim/fingerprint em 6 arquivos e 24 testes passou; `npm run lint` e `npm run typecheck` passaram. A migration 029 foi incluída neste corte.

Pendências do rereview-2 não incluídas neste corte: compatibilidade/rollout da migration 023, isolamento de `recordFailure` em queries compostas, health checks efetivos de backup/global/notificações e preservação de resultados por fonte em falha total do ciclo.
