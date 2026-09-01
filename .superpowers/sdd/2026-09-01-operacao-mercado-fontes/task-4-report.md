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
- Link da agenda para `/?opportunity=<id>`, que abre o Kanban e seleciona a oportunidade quando ela está no conjunto carregado.

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
- `tests/unit/operational-ui-contract.test.ts`
- `tests/unit/navigation.test.ts`

## Self-review

- Nenhuma regra de score, transição de Kanban ou persistência foi adicionada ao Vue.
- A classificação dos eventos em cores/rótulos é apenas adaptação de apresentação dos tipos fornecidos pelas APIs.
- A regra arbitrária anterior de “urgente em 48 horas” foi removida; a UI marca como urgente apenas item aberto com vencimento no dia atual ou anterior.
- Os eventos e handlers de checklist mantêm o `opportunityId` explícito, evitando atualizar o card errado.
- O editor de lembrete recebeu foco inicial e a primeira coluna da grade mensal teve a borda corrigida durante a revisão.

## Concerns conhecidos

- O lint do repositório inteiro ainda encontra um erro pré-existente fora do escopo da Task 4: `src/services/checklistService.ts:1` importa `ChecklistTemplateKey` sem uso. Os arquivos da Task 4 passam no lint focado.
- Os arquivos de API de checklist e o plano em `docs/superpowers/plans/` já estavam não versionados no início desta execução e foram preservados fora do commit da Task 4.
- Não houve push, deploy ou manipulação de segredos.
