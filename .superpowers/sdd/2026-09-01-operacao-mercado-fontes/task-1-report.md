# Task 1 Report - 2026-09-01

## Status

Implementação concluída localmente no workspace atual com TDD, testes focados verdes e `typecheck` verde, com rechecagem fresca realizada em 2026-09-01.

## Arquivos alterados

- `migrations/015_agenda_and_opportunity_changes.sql`
- `migrations/016_opportunity_change_reads.sql`
- `src/db/database.ts`
- `src/domain/operationalTypes.ts`
- `src/repositories/opportunityReminderRepository.ts`
- `src/repositories/opportunityChangeRepository.ts`
- `tests/unit/agenda-persistence.test.ts`

## Decisões

- Criei `opportunity_reminders` com unicidade em `(organization_id, opportunity_id, type, due_at)` para cobrir o caso de idempotência descrito no brief.
- Modelei `ReminderType`, `ReminderStatus` e `OpportunityChangeType` como unions literais para seguir o padrão do projeto.
- Mantive `OpportunityReminderRepository` com statements preparados no construtor e `create` encapsulado em transação do SQLite.
- Mantive `OpportunityChangeRepository.record` com `INSERT ... ON CONFLICT DO NOTHING` e leitura subsequente dentro de transação para devolver `{ event, created }` de forma determinística.
- Para preservar isolamento por organização nas consultas de eventos de mudança sem ampliar o schema além do brief, escopo `listForOrganization` e `markRead` por oportunidades que tenham lembretes da organização.
- `markRead` atualiza apenas `read_at`; removi uma atribuição redundante encontrada na self-review antes do fechamento.

## Comandos executados e saídas

### 1. Vermelho inicial do TDD

Comando:

```text
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' test -- --run tests/unit/agenda-persistence.test.ts
```

Saída:

```text
> vitest run --run tests/unit/agenda-persistence.test.ts
RUN  v3.2.7 C:/Users/user/Documents/dev/licitacoes-pncp
Test Files  1 failed (1)
Tests  no tests
FAIL  tests/unit/agenda-persistence.test.ts
Error: Cannot find module '../../src/repositories/opportunityChangeRepository'
```

Leitura: o ciclo RED ficou confirmado porque os repositórios exigidos pela tarefa ainda não existiam.

### 2. Teste focado após implementação

Comando:

```text
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' test -- --run tests/unit/agenda-persistence.test.ts
```

Saída final:

```text
> vitest run --run tests/unit/agenda-persistence.test.ts
RUN  v3.2.7 C:/Users/user/Documents/dev/licitacoes-pncp
✓ tests/unit/agenda-persistence.test.ts (3 tests) 35ms
Test Files  1 passed (1)
Tests  3 passed (3)
```

### 3. Typecheck final

Comando:

```text
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' run typecheck
```

Saída final:

```text
> nuxt prepare && tsc --noEmit
* Types generated in .nuxt.
```

### 4. Rechecagem de status

Comandos:

```text
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' test -- --run tests/unit/agenda-persistence.test.ts
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' run typecheck
```

Saídas:

```text
> vitest run --run tests/unit/agenda-persistence.test.ts
RUN  v3.2.7 C:/Users/user/Documents/dev/licitacoes-pncp
✓ tests/unit/agenda-persistence.test.ts (3 tests) 35ms
Test Files  1 passed (1)
Tests  3 passed (3)
```

```text
> nuxt prepare && tsc --noEmit
* Types generated in .nuxt.
```

## Self-review

- O teste cobre os quatro pontos pedidos no brief: unicidade de lembrete, transições de conclusão/pulo, isolamento entre organizações e deduplicação de eventos de mudança.
- O diff ficou restrito ao escopo da Task 1.
- Há um arquivo não relacionado já presente no worktree e preservado sem alterações:
  - `docs/superpowers/plans/2026-09-01-operacao-mercado-fontes.md`

## Commit SHA(s)

- `caccdc6` - `feat: persist operational calendar events`
- `720d0e4` - `docs: record task 1 report`

## Preocupações

- Assumi que o isolamento de `opportunity_change_events` deve ser derivado dos lembretes da organização porque o brief não pediu `organization_id` nessa tabela, mas pediu queries isoladas por organização. Se as próximas tasks precisarem expor eventos também para oportunidades sem lembrete associado, será necessário revisar esse critério de visibilidade.

## Fix round 1

### Achados corrigidos

- `[P1]` O estado de leitura deixou de ser global em `opportunity_change_events.read_at` e passou a ser armazenado por organização em `opportunity_change_event_reads`.
- `[P2]` A suíte agora cobre explicitamente duas organizações acompanhando a mesma oportunidade e validando leitura independente do mesmo evento.

### Arquivos alterados no fix

- `migrations/016_opportunity_change_reads.sql`
- `src/db/database.ts`
- `src/repositories/opportunityChangeRepository.ts`
- `tests/unit/agenda-persistence.test.ts`

### Decisões do fix

- Adicionei a migration `016_opportunity_change_reads` para criar uma tabela de leitura por organização sem quebrar o schema existente da Task 1.
- A migration faz backfill de `read_at` legado para organizações que já acompanhavam a oportunidade por `organization_opportunities` ou `opportunity_feedback` com status `FAVORITED`.
- `OpportunityChangeRepository.listForOrganization` agora considera visibilidade por acompanhamento da oportunidade via Kanban ou favorito, sem depender de lembretes.
- `OpportunityChangeRepository.markRead` grava leitura idempotente em `opportunity_change_event_reads`, preservando independência entre organizações para o mesmo `event.id`.

### Comandos executados e saídas do fix

#### 1. Vermelho do teste de regressão

Comando:

```text
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' test -- --run tests/unit/agenda-persistence.test.ts
```

Saída:

```text
> vitest run --run tests/unit/agenda-persistence.test.ts
RUN  v3.2.7 C:/Users/user/Documents/dev/licitacoes-pncp
❯ tests/unit/agenda-persistence.test.ts (4 tests | 1 failed) 49ms
× persistência de agenda operacional > mantém leitura independente por organização para a mesma oportunidade sem depender de lembretes
→ expected [] to match object [ { id: 1, readAt: null } ]
```

Leitura: o evento não ficava visível sem lembrete, confirmando a causa raiz apontada no review.

#### 2. Verde final do fix

Comandos:

```text
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' test -- --run tests/unit/agenda-persistence.test.ts
rtk npm --prefix 'C:\Users\user\Documents\dev\licitacoes-pncp' run typecheck
```

Saídas:

```text
> vitest run --run tests/unit/agenda-persistence.test.ts
RUN  v3.2.7 C:/Users/user/Documents/dev/licitacoes-pncp
✓ tests/unit/agenda-persistence.test.ts (4 tests) 43ms
Test Files  1 passed (1)
Tests  4 passed (4)
```

```text
> nuxt prepare && tsc --noEmit
* Types generated in .nuxt.
```

### Commit do fix

- `7fc9b33` - `fix: isolate change event reads per organization`
