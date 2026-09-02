# Task 4 — Agenda e preparação operacional

## Status

Implementação concluída em PT-BR para desktop e mobile, conectada às APIs existentes de agenda, mudanças oficiais, preferências de agenda e checklist.

## O que foi implementado

- Nova rota autenticada `/agenda`, adicionada ao drawer logo após `Painel`.
- Agenda operacional com:
  - visão mensal e visão em lista;
  - filtros por oportunidade, tipo de lembrete, situação e período;
  - criação e edição de lembretes;
  - ações de concluir e pular;
  - preferências de alertas oficiais;
  - eventos de mudança vindos da API `changes`;
  - fonte oficial, tipo do evento e links para a fonte e para a oportunidade.
- Distinção visual entre prazo oficial, sessão pública, início da disputa, resultado, atualização de fonte e lembrete manual.
- Bloco `Preparação` nos detalhes e nos cards do Kanban com progresso, itens urgentes, próximo prazo, responsável e conclusão rápida.
- Editor de item de preparação para título, responsável, prazo e nota.
- Carregamento e atualização de checklists centralizados na página principal, mantendo os componentes de apresentação sem acesso direto a regras ou serviços de domínio.
- Link da agenda para `/?opportunity=<id>`, que abre o Kanban e seleciona a oportunidade por lookup autorizado direto, mesmo quando ela está além da primeira página.
- Endpoint de mudanças em lote com isolamento por organização e lookup direto de oportunidades referenciadas por lembretes ou mudanças.
- Handlers autenticados de GET/PATCH do checklist versionados, com validação de `assigneeUserId` por membership da organização e atualização atomicamente escopada por organização, oportunidade e item.

## Direção visual aplicada

A direção aprovada de “mesa operacional de prazos” foi mantida. A estrutura usa os tokens azul-marinho, papel e laranja já existentes. A assinatura visual é a faixa vertical de urgência/tipo em cada evento; os demais elementos permanecem contidos para preservar densidade e leitura operacional. No mobile, ações usam alvos de toque de pelo menos 44 px, a agenda mensal mantém rolagem horizontal e o bloco de preparação inicia recolhido.

## Acessibilidade e responsividade

- Foco visível para botões, links e campos.
- Editores com `role="dialog"`, `aria-modal`, título associado, foco inicial e fechamento por `Esc`.
- Botão de preparação com `aria-expanded` e `aria-controls`.
- Barra de progresso com rótulo acessível.
- Layouts específicos para desktop, tablet e mobile.
- Rolagem horizontal do Kanban preservada.
- Transições removidas em `prefers-reduced-motion: reduce`.

## TDD e verificações

### Vermelho

Comando:

`npm test -- --run tests/unit/operational-ui-contract.test.ts`

Resultado esperado observado: 1 teste falhou porque `app/pages/agenda.vue` ainda não existia (`tests/unit/operational-ui-contract.test.ts:6`).

### Verde final

Comando:

`npm test -- --run tests/unit/operational-ui-contract.test.ts tests/unit/navigation.test.ts`

Resultado: 2 arquivos aprovados, 4 testes aprovados, 0 falhas.

### Rodada de correção

Comando:

`npm test -- --run tests/unit/operational-ui-contract.test.ts tests/unit/navigation.test.ts tests/unit/agenda-api.test.ts tests/unit/checklist-api.test.ts tests/unit/checklist.test.ts tests/unit/kanban-api.test.ts tests/unit/catalog.test.ts tests/unit/operational-view-model.test.ts`

Resultado: 8 arquivos aprovados, 25 testes aprovados, 0 falhas. A cobertura inclui autorização cross-org do responsável, mudanças em lote, preferências aplicadas à exibição, lookup direto além da primeira página e view model de apresentação da checklist.

### Tipos

Comando:

`npm run typecheck`

Resultado: concluído com código 0; tipos do Nuxt gerados e TypeScript sem erros.

### Lint focado

Comando aplicado aos arquivos de app/testes da Task 4.

Resultado: `ESLint: No issues found`.

### Revisão de diff

`git diff --check` concluído sem erros de whitespace.

## Arquivos principais

- `app/pages/agenda.vue`
- `app/components/AgendaView.vue`
- `app/components/OpportunityChecklist.vue`
- `app/components/ChecklistItemEditor.vue`
- `app/components/OpportunityKanban.vue`
- `app/components/OpportunityDetails.vue`
- `app/pages/index.vue`
- `app/components/AppNavDrawer.vue`
- `app/types.ts`
- `app/assets/css/main.css`
- `app/viewModels/operationalViewModels.ts`
- `server/api/opportunities/[id]/checklist.get.ts`
- `server/api/opportunities/[id]/checklist/[itemId].patch.ts`
- `server/api/opportunities/changes.get.ts`
- `tests/unit/operational-ui-contract.test.ts`
- `tests/unit/navigation.test.ts`
- `tests/unit/checklist-api.test.ts`
- `tests/unit/operational-view-model.test.ts`

## Self-review

- Nenhuma regra de score, transição de Kanban ou persistência foi adicionada ao Vue.
- A classificação dos eventos em cores/rótulos é apenas adaptação de apresentação dos tipos fornecidos pelas APIs.
- Urgência, próximo item e progresso são calculados em `app/viewModels/operationalViewModels.ts`, explicitamente como apresentação; o componente Vue apenas renderiza o resultado.
- Preferências oficiais filtram a exibição atual de lembretes e mudanças, preservando lembretes manuais.
- Os eventos e handlers de checklist mantêm o `opportunityId` explícito, evitando atualizar o card errado.
- O editor de lembrete recebeu foco inicial e a primeira coluna da grade mensal teve a borda corrigida durante a revisão.
- A rerevisão 3 foi incorporada sem ampliar o escopo: o lookup direto da agenda aceita somente oportunidades autorizadas por Kanban, favorito ou lembrete; o PATCH do checklist não altera item de outra oportunidade; e a distinção entre `FOLLOW_UP` oficial (`createdByUserId` nulo) e manual foi centralizada no view model.

## Concerns conhecidos

- O plano em `docs/superpowers/plans/` já estava não versionado no início desta execução e permanece fora do commit da correção.
- Não houve push, deploy ou manipulação de segredos.

## Rodada de correção da rerevisão 3 — 2026-09-02

- A1: `ChecklistRepository.updateForOpportunity` faz lookup e `UPDATE` com `organizationId + opportunityId + itemId`; o handler retorna 404 sem mutar item de outra oportunidade da mesma organização.
- A2: o lookup focado de `app/pages/index.vue` deixou de forçar Kanban; o catálogo aplica autorização explícita por Kanban, favorito ou lembrete para `opportunityId`.
- A3: `getReminderVisualType` classifica `FOLLOW_UP` oficial como `DISPUTE` e manual como `MANUAL`; a filtragem reativa da agenda aplica `preferences.disputeStart` ao oficial e preserva o manual.
- A4: os exports HTTP dos dois handlers foram exercitados com sessão ausente (401) e billing inativo (402), usando a fixture de `BillingService`; os testes existentes de organização e responsável foram preservados.

### Verificações desta rodada

Comando focado:

`npm exec vitest -- run tests/unit/checklist-api.test.ts tests/unit/checklist-http-protection.test.ts tests/unit/catalog.test.ts tests/unit/operational-view-model.test.ts tests/unit/agenda-api.test.ts tests/unit/operational-ui-contract.test.ts tests/unit/navigation.test.ts`

Resultado: 7 arquivos aprovados, 24 testes aprovados, 0 falhas.

`npm run typecheck`

Resultado: concluído com código 0; tipos do Nuxt gerados e TypeScript sem erros.

Lint focado nos arquivos alterados: concluído sem erros.

`git diff --check`: concluído sem erros de whitespace.
