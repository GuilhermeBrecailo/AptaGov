# Task 2 Report — Operação Mercado Fontes

Data: 2026-09-01

## Escopo executado

Implementada a persistência de checklist por `organization_id` + `opportunity_id`, com inicialização idempotente após `add-to-Kanban`, sem alterar a regra de billing e sem bloquear transições válidas de Kanban quando o checklist estiver incompleto.

## Arquivos tocados

Criados:

- `migrations/017_opportunity_checklists.sql`
- `src/repositories/checklistRepository.ts`
- `src/services/checklistService.ts`
- `tests/unit/checklist.test.ts`

Modificados:

- `src/db/database.ts`
- `src/domain/operationalTypes.ts`
- `src/services/opportunityService.ts`
- `server/api/opportunities/[id]/kanban.post.ts`
- `server/api/opportunities/[id]/state.patch.ts`
- `tests/unit/kanban-api.test.ts`

## Decisões

1. Usei a migration `017_opportunity_checklists.sql`, respeitando o ruling do brief e preservando a `016` para leituras de mudanças.
2. Estendi `src/domain/operationalTypes.ts` sem remover ou renomear exports existentes, adicionando tipos e interfaces de checklist no mesmo módulo já usado pela Task 1.
3. Não criei `checklist_templates`, porque o contrato atual ficou simples e suficiente com defaults codificados no serviço e cópias independentes persistidas por oportunidade.
4. A inicialização padrão ficou no `ChecklistService.ensureDefaults`, com inserção transacional e `ON CONFLICT DO NOTHING` por `(organization_id, opportunity_id, title)`.
5. O endpoint `server/api/opportunities/[id]/kanban.post.ts` passou a chamar `ensureDefaults` depois de criar o vínculo em `organization_opportunities`, preservando o comportamento de estado e billing.
6. Extraí a transição por organização para `transitionOrganizationOpportunity` em `src/services/opportunityService.ts` e passei o `state.patch` a reutilizar essa regra, deixando explícito que checklist não interfere na transição válida.

## Ciclo TDD

### RED

Escrevi primeiro os testes:

- `tests/unit/checklist.test.ts`
- `tests/unit/kanban-api.test.ts`

Cobertura adicionada:

- primeiro add com criação do checklist padrão
- repetição idempotente sem duplicação
- isolamento por organização
- atualização de status/nota/conclusão
- checklist incompleto não bloqueando transição válida

Comando:

```bash
rtk npm test -- --run tests/unit/checklist.test.ts tests/unit/kanban-api.test.ts
```

Saída relevante:

```text
Failed Suites 2
Error: Cannot find module '../../src/repositories/checklistRepository'
```

Falha esperada, causada pela ausência da implementação.

### GREEN

Implementei migration, repositório, serviço e o gancho no fluxo de Kanban.

Comando:

```bash
rtk npm test -- --run tests/unit/checklist.test.ts tests/unit/kanban-api.test.ts
```

Saída relevante:

```text
✓ tests/unit/kanban-api.test.ts (2 tests)
✓ tests/unit/checklist.test.ts (3 tests)
Tests  5 passed (5)
```

## Verificações finais

### Typecheck

Primeira execução encontrou apenas erro de nulabilidade nos testes:

```text
tests/unit/checklist.test.ts(...): error TS2532: Object is possibly 'undefined'.
tests/unit/kanban-api.test.ts(...): error TS2532: Object is possibly 'undefined'.
```

Ajustei os acessos indexados com assertividade local e reexecutei.

Comando:

```bash
rtk npm run typecheck
```

Saída relevante final:

```text
> nuxt prepare && tsc --noEmit
*  Types generated in .nuxt.
```

### Self-review

Comandos usados:

```bash
rtk git diff --check
rtk rg -n "addToKanban\(|transitionOrganizationOpportunity\(|ensureDefaults\(" src server tests
rtk git status --short
```

Resultado:

- sem erros de whitespace em diff
- gancho de checklist confirmado no endpoint de Kanban
- transição por organização centralizada no serviço
- worktree final limpo do escopo da task, exceto `docs/superpowers/plans/2026-09-01-operacao-mercado-fontes.md` já existente e não incluído no commit

## Commit e SHA(s)

Commit criado:

- `88209bd feat: initialize opportunity checklists`

SHA completo:

- `88209bd2a60668520931390c1e4b63b4f3210f62`

## Concerns

1. O checklist é inicializado automaticamente no endpoint `add-to-Kanban`, que era o requisito do brief. Chamadas diretas ao método de repositório `OpportunityRepository.addToKanban()` continuam sem bootstrap automático e precisam chamar `ChecklistService.ensureDefaults()` explicitamente em testes ou fluxos internos fora desse endpoint.
2. Não há endpoint/listagem pública de checklist nesta task; a persistência e a regra de bootstrap ficaram prontas para a próxima camada sem expandir escopo.

## Round 1 — Fix dos findings do review

### Findings tratados

1. A idempotência dos defaults dependia de `title`, então um rename de item padrão permitia duplicação.
2. O teste de Kanban não provava o bootstrap automático do fluxo de entrada, porque chamava `ensureDefaults()` manualmente.

### Arquivos tocados na rodada

- `migrations/017_opportunity_checklists.sql`
- `src/domain/operationalTypes.ts`
- `src/repositories/checklistRepository.ts`
- `src/services/checklistService.ts`
- `src/services/opportunityService.ts`
- `server/api/opportunities/[id]/kanban.post.ts`
- `tests/unit/checklist.test.ts`
- `tests/unit/kanban-api.test.ts`

### Decisões

1. Ajustei a própria migration `017` em vez de criar `018`, porque o usuário confirmou que `017` ainda não foi publicada/deployada.
2. Adicionei `template_key` próprio em `opportunity_checklist_items`, com unicidade por `(organization_id, opportunity_id, template_key)`.
3. Mantive itens personalizados possíveis com `template_key` nulo.
4. Os defaults agora usam chaves estáveis: `read_edital`, `requirements`, `documents`, `certificates`, `pricing_margin`, `proposal`, `review`, `submit`, `session`, `result`.
5. Extraí `addOpportunityToKanban()` em `src/services/opportunityService.ts` e o endpoint `server/api/opportunities/[id]/kanban.post.ts` passou a usar esse serviço de entrada.
6. O teste de Kanban agora chama o mesmo serviço de entrada usado pelo endpoint, sem invocar `ensureDefaults()` manualmente.

### RED

Comando:

```bash
rtk npm test -- --run tests/unit/checklist.test.ts tests/unit/kanban-api.test.ts
```

Saída relevante:

```text
× kanban por organização > adicionar a mesma licitação duas vezes permanece idempotente e inicializa o checklist só uma vez
  → (0 , addOpportunityToKanban) is not a function
× kanban por organização > mantém checklist isolado por organização para a mesma licitação
  → (0 , addOpportunityToKanban) is not a function
× checklist operacional > mantém a idempotência dos defaults mesmo se um item padrão for renomeado
  → expected [...] to have a length of 10 but got 11
```

Falhas esperadas e alinhadas aos findings.

### GREEN

Comando:

```bash
rtk npm test -- --run tests/unit/checklist.test.ts tests/unit/kanban-api.test.ts
```

Saída relevante:

```text
✓ tests/unit/kanban-api.test.ts (2 tests)
✓ tests/unit/checklist.test.ts (4 tests)
Tests  6 passed (6)
```

### Typecheck

Comando:

```bash
rtk npm run typecheck
```

Saída relevante:

```text
> nuxt prepare && tsc --noEmit
*  Types generated in .nuxt.
```

### Commit da rodada

- `b2380fc fix: stabilize checklist defaults`
