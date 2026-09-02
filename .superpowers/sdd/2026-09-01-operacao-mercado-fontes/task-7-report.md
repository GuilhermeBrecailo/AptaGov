# Task 7 — Orquestração durável de fontes oficiais

Data: 2026-09-02  
Status: rodada 8 — gaps de tenant e entrega corrigidos e verificados localmente

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

## Rodada 4 — corte parcial: falha por query e métricas por fonte

- `SourceSyncService` mantém a query atualmente processada e registra `recordFailure` no `flow`/`scopeKey` correto. Uma falha em uma query composta não rebaixa o checkpoint concluído de outra query; os `source_runs` permanecem isolados por escopo.
- A API mantém o comportamento anterior de lançar quando todas as fontes falham por padrão. O worker usa uma opção explícita para receber o resultado detalhado, registrar cada fonte como `FAILED` com categoria e persistir o job/ciclo com o diagnóstico completo.
- `source_runs` e `worker_cycle_metrics` agora preservam falhas por fonte no ciclo e no painel administrativo, incluindo fontes distintas no mesmo ciclo.
- Durante a validação foi corrigido o bind condicional do tenant no claim da outbox, que deixava o fluxo manual com organização falhar por excesso de parâmetros.

Verificação do corte: focused Task 7 + source checkpoint em 9 arquivos e 42 testes passou. As pendências de migration 023/rollback e health checks efetivos permanecem deliberadamente fora deste corte.

## Rodada 5 — compatibilidade legada e health checks efetivos

- `030_source_checkpoint_compatibility.sql` usa rollout coordenado: `source_checkpoints` continua sendo uma tabela legada com a chave de três colunas aceita pelo `ON CONFLICT` do worker antigo, enquanto o worker novo usa `source_checkpoints_scoped`, com `flow` e `scope_key` separados. O fallback e o espelhamento são limitados a `opportunity/default`; mercado e demais escopos não compartilham cursor.
- Foi adicionado teste executável que aplica o schema novo, executa duas escritas com o SQL do worker antigo e valida fallback, espelhamento e cursor independente de mercado. O rollback permanece compatível porque a tabela antiga continua disponível durante a migração aditiva.
- Resume de notificações não é liberado por configuração isolada: cada canal relevante precisa de tentativa controlada saudável ou de resultado `SENT` recente. A pausa sem canal exige que todos os canais configurados estejam saudáveis; override legado não substitui o check de outro estágio.
- Backup exige destino/artefato existente, arquivo não vazio e `PRAGMA integrity_check` exatamente igual a `ok`. A pausa global só é removida quando o check global e todos os componentes compostos estão saudáveis; componentes saudáveis podem ser limpos sem apagar a condição global ainda inválida.

Verificações finais: focused Task 7 + source checkpoint (11 arquivos, 49 testes), suíte completa (53 arquivos, 192 testes), lint, typecheck e build passaram.

Limitações reais desta rodada:

1. O worker antigo só representa o namespace `opportunity/default`; por isso, o compat layer não espelha mercado nem outros escopos na tabela legada, evitando cursor compartilhado. A troca/rollback entre workers deve respeitar o rollout coordenado.
2. Sem callback de tentativa controlada, o health check de notificação depende de um envio `SENT` recente persistido; não há chamada automática a provedor externo durante o health check.
3. Após restart, backup só pode ser considerado saudável quando houver artefato válido no caminho registrado pelas métricas persistidas; sem esse artefato a pausa permanece ativa.

## Rodada 6 — corte parcial: toggle automático e falha total de mercado

- Jobs duráveis pendentes no modo automático agora são filtrados pelo estado atual da organização e, quando aplicável, do radar. Jobs de tenant desabilitado permanecem `PENDING` e são adiados até a reativação, sem bloquear a criação/execução dos jobs habilitados; payloads órfãos inválidos continuam chegando ao executor para transição terminal.
- `MarketRefreshService` preserva o resultado detalhado de cada fonte mesmo quando todas falham. O executor grava `sourceResults` no checkpoint do job, marca o `market_refresh` como `FAILED`, e o ciclo/painel administrativo mantém status e categoria por fonte, incluindo `source_runs`.

Verificações do corte: focused Task 7 (13 arquivos, 55 testes), lint e typecheck passaram.

A compatibilidade da migration 030 com o worker anterior/rollback foi concluída nesta rodada.

## Rodada 7 — compatibilidade de rollout/rollback do checkpoint

- A migration 030 deixou de renomear a tabela scoped. `source_checkpoints` permanece o contrato canônico com `flow`/`scope_key` e chave de cinco colunas usado pelo worker anterior `0aca7bf`; `source_checkpoints_legacy` fica separado para o snapshot de três colunas. O novo repositório usa a mesma tabela canônica, mantendo opportunity e market independentes.
- A migration 031 é aditiva e corrige bancos que já aplicaram a 030 antiga: detecta o swap, restaura os nomes, mescla o snapshot legado apenas em `opportunity/default` escolhendo o registro mais recente por `updated_at`, e preserva o namespace market sem compartilhar cursor. A operação é idempotente e mantém o SQL antigo de `SELECT`/`UPSERT` funcional após fresh migration e rollback.
- Testes executáveis cobrem schema fresh, SQL do worker `0aca7bf`, progresso posterior escrito pelo worker anterior visível no repositório novo, reparo da 030 antiga e isolamento do cursor market.

Verificações finais: focused Task 7 + source checkpoint (15 arquivos, 58 testes), suíte completa (55 arquivos, 196 testes), lint, typecheck e build passaram.

Limitações residuais:

- A compatibilidade direta fica garantida para o contrato scoped do `0aca7bf`. Workers anteriores à migration 023 que exigem `ON CONFLICT(source_code, window_start, window_end)` continuam usando explicitamente `source_checkpoints_legacy` e não podem compartilhar cursor com market; o rollback deve usar o worker `0aca7bf`/scoped ou uma rotina compatível com a tabela legacy.
- A execução condicional da migration 031 depende do runner desta aplicação; SQLite não oferece uma forma portátil de condicionar esses `ALTER TABLE` apenas no arquivo SQL. Ferramentas externas de migração devem executar o runner da aplicação ou implementar a mesma guarda.

## Rodada 8 — isolamento por tenant e idempotência de entrega

- `WorkerRuntime` passou a mesclar jobs pendentes e reservas por escopo exato de organização/radar. Um `source_sync` ou `agenda_preparation` pendente de A não impede a reserva e execução do escopo habilitado de B; organizações e radars desabilitados continuam filtrados no modo automático, com seus jobs preservados em `PENDING` para retomada posterior.
- O e-mail calcula uma chave determinística a partir de organização, oportunidade e `eventKey`; o adaptador Resend envia essa chave no header `Idempotency-Key`. O teste simula falha após o primeiro envio e confirma que o retry usa a mesma chave.
- O Web Push inclui `eventId` e `dedupeKey` determinísticos no payload. O service worker grava a chave em IndexedDB com chave única antes de exibir a notificação, evitando a segunda exibição quando o mesmo evento for recuperado após a confirmação externa.

Verificações finais: focused Task 7 + source checkpoint (15 arquivos, 62 testes), suíte completa (55 arquivos, 200 testes), lint, typecheck e build passaram.

Limitações residuais desta rodada:

- A deduplicação do Resend depende do provedor respeitar o header de idempotência; o sistema mantém lease, retry e `eventKey` persistidos, sem registrar ou expor credenciais.
- Web Push não possui confirmação idempotente atômica no protocolo. Com IndexedDB indisponível, falhando ou sendo limpo pelo navegador, o service worker usa fallback fail-open para não perder a entrega; nessa condição residual a semântica é at-least-once e uma duplicidade após crash externo permanece possível.
