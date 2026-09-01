# Task 3 — relatório de execução e fix round 1

Data: 2026-09-01

## Status da implementação inicial

- Implementação da Task 3 concluída e commitada.
- Commit de implementação: `df37a33` — `feat: track opportunity changes and reminders`.
- Testes focados finais: 12/12 passando.
- Suíte unitária completa final: 97/97 passando em 36 arquivos.
- Typecheck final: passando.
- ESLint apenas nos arquivos alterados pela Task 3: passando, sem issues.
- ESLint global: ainda falha por um import não usado preexistente em `src/services/checklistService.ts:1` (`ChecklistTemplateKey`), arquivo não alterado pela Task 3.
- Este relatório foi escrito após o commit de implementação por solicitação de interrupção e não foi commitado.
- Nenhum push, deploy ou segredo foi alterado.

## Escopo entregue

- Snapshot normalizado e fingerprint determinístico sobre prazo de propostas, abertura de sessão, início da disputa, encerramento/resultado, título, descrição, valor estimado, URL do edital e referências de arquivos oficiais.
- Detecção e persistência idempotente dos tipos `PROPOSAL_DEADLINE`, `SESSION_OPENING`, `DISPUTE_START`, `CLOSING_RESULT` e `SOURCE_UPDATE`.
- Retorno de snapshots `previous/current` no upsert/sync sem alterar o shape histórico do agregador de radares.
- Agenda com lembretes oficiais e manuais, listagem por período e atualização isolada por organização.
- Preservação de horário editado manualmente em lembrete oficial.
- Event keys operacionais idempotentes para e-mail e Web Push, inclusive após falha de entrega.
- APIs protegidas por `requireActiveBilling(event, 'kanban')` para agenda e histórico/leitura de mudanças.
- Migration 018 para converter os tipos legados sem perder eventos ou leituras e sem colisão entre fingerprints convergentes.

## Arquivos principais

### Criados

- `migrations/018_opportunity_change_types.sql`
- `src/services/opportunityChangeService.ts`
- `src/services/agendaService.ts`
- `server/api/agenda.get.ts`
- `server/api/agenda.post.ts`
- `server/api/agenda/[id].patch.ts`
- `server/api/opportunities/[id]/changes.get.ts`
- `server/api/opportunities/[id]/changes/[changeId]/read.patch.ts`
- `tests/unit/change-detection.test.ts`
- `tests/unit/agenda-api.test.ts`

### Modificados

- `src/db/database.ts`
- `src/domain/operationalTypes.ts`
- `src/repositories/opportunityRepository.ts`
- `src/repositories/opportunityReminderRepository.ts`
- `src/repositories/opportunityChangeRepository.ts` não precisou de alteração funcional; seu contrato existente foi reutilizado.
- `src/repositories/notificationRepository.ts`
- `src/repositories/pushNotificationRepository.ts`
- `src/services/syncService.ts`
- `src/services/radarSyncService.ts`
- `src/services/notificationService.ts`
- `src/services/pushNotificationService.ts`
- `tests/unit/agenda-persistence.test.ts`
- `tests/unit/notification-events.test.ts`

## Decisões técnicas

1. Foi criada a migration 018 em vez de reescrever a migration 015 já aplicada. A tabela de eventos e a tabela de leituras são reconstruídas e copiadas, preservando IDs e leituras.
2. Fingerprints legados recebem o prefixo do tipo antigo durante a migration. Isso evita colisão quando `NOTICE_UPDATED` e `DOCUMENT_UPDATED` convergem para `SOURCE_UPDATE` com o mesmo fingerprint.
3. `SOURCE_UPDATE` agrega mudanças de metadados da fonte em um único evento, enquanto datas e resultado geram eventos independentes.
4. Lembretes oficiais são identificados por `createdByUserId === null`. O horário só acompanha uma nova data oficial quando ainda coincide com a data oficial anterior; divergência indica edição manual e é preservada.
5. Falhas de entrega mantêm a linha `FAILED`; o mesmo `eventKey` não cria uma segunda entrega. O retry continua pertencendo à máquina de estados existente.
6. A leitura de uma mudança valida organização, oportunidade da URL e `changeId`, evitando marcação cruzada.
7. O agregador de radares continua retornando apenas `received/created/updated`; os snapshots são expostos por `syncRecords`, evitando regressão de contrato.

## TDD e falhas observadas

### Vermelhos esperados

- `change-detection.test.ts`: inicialmente falhou por ausência de `opportunityChangeService.ts`.
- `agenda-persistence.test.ts`: falhou pelo CHECK antigo da migration 015 ao inserir os novos tipos.
- `agenda-api.test.ts`: falhou por ausência de `agendaService.ts` e depois das rotas de changes.
- `notification-events.test.ts`: falhou com `notifications.queueOperationalAlert is not a function`.
- Teste de upgrade da migration: falhou com `UNIQUE constraint failed` quando dois tipos legados convergiam para `SOURCE_UPDATE`; corrigido com prefixo no fingerprint legado.

### Última falha de teste

Comando: `npm test`

Falha histórica mais recente antes da correção:

- `tests/unit/saved-search-limits.test.ts`
- Esperava `{ received: 3, created: 2, updated: 1 }`, mas recebeu também `entries: []`.
- Correção: manter `runSelectedRadars` com o contrato histórico de contadores e limitar `entries` ao resultado de `syncRecords`.

Resultado após a correção: 36 arquivos passando, 97 testes passando, 0 falhas.

### Última falha de typecheck

Comando: `npm run typecheck`

Falha histórica mais recente antes da correção:

- `tests/unit/agenda-persistence.test.ts(51,127): error TS1005: ')' expected`.
- Era um parêntese ausente no matcher do teste de migration.

Resultado após a correção: `nuxt prepare && tsc --noEmit` com exit code 0.

## Comandos e resultados finais

- `npm test -- --run tests/unit/change-detection.test.ts tests/unit/agenda-api.test.ts tests/unit/notification-events.test.ts`
  - 3 arquivos passando; 12 testes passando.
- `npm test`
  - 36 arquivos passando; 97 testes passando.
- `npm run typecheck`
  - exit code 0; tipos Nuxt gerados; nenhuma falha TypeScript.
- `npx eslint <arquivos alterados pela Task 3>`
  - `ESLint: No issues found`.
- `git diff --check` e `git diff --cached --check`
  - exit code 0; nenhuma falha de whitespace.
- `npm run lint`
  - exit code 1 por erro preexistente fora do diff: `src/services/checklistService.ts:1:66`, import `ChecklistTemplateKey` não usado.
- `git commit -m "feat: track opportunity changes and reminders"`
  - commit criado: `df37a33`.

## SHAs

- HEAD anterior à Task 3: `0f75645`.
- Implementação da Task 3: `df37a33`.

## Concerns pendentes

1. O lint global permanece vermelho pelo import não usado preexistente em `src/services/checklistService.ts`; não foi corrigido para evitar ampliação de escopo.
2. Por interrupção explícita, não houve nova verificação pós-commit; todas as verificações listadas foram executadas imediatamente antes do commit sobre exatamente o conteúdo staged.
3. Este relatório parcial não está incluído em `df37a33` e não foi criado um segundo commit de documentação.
4. O arquivo preexistente não rastreado `docs/superpowers/plans/2026-09-01-operacao-mercado-fontes.md` foi mantido fora do commit.

## Fora de escopo preservado

- Nenhuma UI alterada.
- Nenhum conector de fonte alterado.
- Nenhuma integração Mercado alterada.
- Nenhum ciclo completo do worker implementado ou alterado.
- Nenhum push ou deploy executado.
- Nenhum segredo alterado.

## Fix round 1 — ativação, isolamento e preferências

### Status

- Findings críticos e importantes da revisão tratados.
- Commit de código da rodada: `61ef68b` — `fix: activate operational change workflow`.
- O fluxo atual de ingestão executa o contrato operacional por hook injetável, sem reestruturar fontes/jobs da Task 7.
- Isolamento de agenda reforçado no serviço e no repositório.
- Migration 019, repositório de preferências e APIs protegidas GET/PUT adicionados.
- Nenhum push, deploy ou segredo alterado.

### Resolução dos findings

1. **Ativação em produção:** `syncRecords` e `syncFromPncp` agora aceitam `SyncHooks.onEntry`. `WorkerRuntime` injeta o mesmo hook nos caminhos com e sem radares. `OperationalSyncService` executa `detectAndRecord`, materializa reminders no escopo e enfileira e-mail/Web Push com `opportunity-change:{organizationId}:{opportunityId}:{changeId}`.
2. **Isolamento organizacional:** `OpportunityReminderRepository.hasOpportunityScope` exige vínculo por `organization_opportunities` ou um reminder já existente da mesma organização/oportunidade. `create`, `update`, `AgendaService.createManual` e `scheduleOfficialReminders` rejeitam acesso fora desse escopo.
3. **Preferências organizacionais:** a migration `019_organization_alert_preferences.sql` adiciona três flags oficiais, todas ativas por default: prazo de propostas, abertura da sessão e início da disputa. `AgendaService` consulta essas flags antes de criar ou atualizar reminders automáticos.
4. **APIs protegidas:** `alert-preferences.get.ts` e `alert-preferences.put.ts` derivam `organizationId` do contexto autenticado e usam `requireActiveBilling(event, 'kanban')`. PUT valida um objeto estrito com três booleanos.
5. **Testes negativos:** duas organizações cobrem create, update e schedule cruzados; o repositório também é testado diretamente contra criação sem vínculo.

### Arquivos criados na rodada

- `migrations/019_organization_alert_preferences.sql`
- `src/repositories/organizationAlertPreferenceRepository.ts`
- `src/services/operationalSyncService.ts`
- `server/api/alert-preferences.get.ts`
- `server/api/alert-preferences.put.ts`

### Arquivos modificados na rodada

- `src/db/database.ts`
- `src/domain/operationalTypes.ts`
- `src/repositories/opportunityRepository.ts`
- `src/repositories/opportunityReminderRepository.ts`
- `src/services/agendaService.ts`
- `src/services/syncService.ts`
- `src/workerRuntime.ts`
- `server/api/agenda.post.ts`
- `server/api/agenda/[id].patch.ts`
- `tests/unit/change-detection.test.ts`
- `tests/unit/agenda-api.test.ts`
- `tests/unit/agenda-persistence.test.ts`

### Migration 019

- Caminho forward: criar tabela aditiva com FK `organization_id`, checks booleanos e timestamps; ausência de linha é lida como defaults ativos.
- Idempotência: DDL usa `CREATE TABLE IF NOT EXISTS`; escrita usa upsert por `organization_id`.
- Preservação: não altera nem copia tabelas existentes e não remove dados.
- Rollback planejado, não executado: remover primeiro APIs/leitores/escritores e só depois dropar `organization_alert_preferences`. O drop é destrutivo e exigiria autorização explícita.
- O plano reserva 020/021 para a Task 5; esta rodada registrou somente a 019.

### TDD — vermelhos observados

- Integração de sync: falhou por ausência de `operationalSyncService.ts`; após implementação, confirmou change persistida, três reminders oficiais e um único alerta por canal após ciclo repetido.
- Isolamento: repository.create retornou reminder para organização sem vínculo e schedule criou reminder cruzado; ambos passaram a rejeitar.
- Preferências: falhou por ausência de `organizationAlertPreferenceRepository.ts`, depois por ausência das APIs GET/PUT.
- Typecheck intermediário: fixtures positivas precisaram reconhecer o retorno opcional de `OpportunityReminderRepository.create` após o novo guard.

### Comandos e saídas da rodada

- `npm test -- --run tests/unit/change-detection.test.ts tests/unit/agenda-api.test.ts tests/unit/notification-events.test.ts tests/unit/agenda-persistence.test.ts`
  - 4 arquivos passando; 23 testes passando; 0 falhas.
- `npm run typecheck`
  - `nuxt prepare && tsc --noEmit`; exit code 0.
- `npm test`
  - 36 arquivos passando; 102 testes passando; 0 falhas.
- `npx eslint <arquivos alterados na fix round 1>`
  - `ESLint: No issues found`.
- `git diff --check` e `git diff --cached --check`
  - exit code 0.
- `git commit -m "fix: activate operational change workflow"`
  - commit criado: `61ef68b`.

### SHAs acumulados

- Base anterior à Task 3: `0f75645`.
- Implementação inicial da Task 3: `df37a33`.
- Fix round 1: `61ef68b`.

### Concerns após a rodada

1. O desenho completo de jobs/fontes continua deliberadamente fora de escopo e permanece para a Task 7; ela deve preservar `SyncHooks.onEntry` como contrato.
2. Desabilitar uma preferência impede novas materializações/atualizações automáticas, mas não apaga reminders já existentes; remoção automática seria destrutiva e não foi solicitada.
3. O arquivo preexistente não rastreado `docs/superpowers/plans/2026-09-01-operacao-mercado-fontes.md` permaneceu fora dos commits.

### Fora de escopo preservado na rodada

- Nenhuma UI alterada.
- Nenhum conector de fonte alterado.
- Nenhuma integração Mercado alterada.
- Nenhum redesenho completo do worker.
- Event keys, estados de retry e entrega existentes preservados.
- Nenhum push ou deploy executado.
