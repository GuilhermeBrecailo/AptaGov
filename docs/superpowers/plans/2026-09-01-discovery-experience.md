# AptaGov Discovery Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melhorar ativação, descoberta e operação comercial do AptaGov com onboarding, múltiplos radares, catálogo orientado à decisão, alertas idempotentes, métricas de uso e uma interface PT-BR mais clara em desktop e mobile.

**Architecture:** Preservar Nuxt 4 + TypeScript strict, SQLite com migrações versionadas, painel e API no Nuxt e worker separado compartilhando banco e domínio. Introduzir `saved_searches` como entidade de radar por organização, manter o filtro legado compatível como radar inicial e usar uma camada de serviços/repositórios para não duplicar regra entre API, worker e UI. Eventos de interação serão persistidos de forma idempotente e usados pelo admin.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, better-sqlite3, Zod, Vitest, CSS existente, worker `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-01-discovery-experience-design.md`

## Global Constraints

- Não implementar IA, Telegram, WhatsApp, robô de lances, OCR ou cofre de documentos nesta rodada.
- Não alterar a semântica dos estados do Kanban nem remover a deduplicação por `pncp_id`.
- Nenhum critério de negócio deve ser fixado na UI; limites e filtros vêm do banco, `config/filters.json` e `.env`.
- Toda interface nova deve ser PT-BR; código, APIs, tabelas, colunas e estados persistidos ficam em inglês.
- Toda rota deve validar sessão, organização e plano no servidor.
- Não expor credenciais em logs, testes ou documentação.
- Não fazer commit sem pedido explícito do usuário.
- Cada comportamento novo deve ter teste unitário ou de contrato antes da implementação correspondente.

## Fase 1 — contrato de dados, radar e onboarding

- [ ] 1. Criar testes de migração e repositório para `saved_searches`, incluindo isolamento por organização, atualização idempotente por nome e habilitar/pausar.
  - Arquivos: `tests/unit/saved-search.test.ts`, `src/repositories/savedSearchRepository.ts`, `migrations/010_saved_searches_and_onboarding.sql`.
  - A migração deve criar `saved_searches` e o campo de conclusão do onboarding em `organizations`, com índices e foreign keys.
  - O repositório deve mapear filtros validados e retornar nome, status, timestamps e último match.

- [ ] 2. Extrair um serviço de limites de produto para validar quantidade de radares pelo plano sem duplicar regra no frontend.
  - Arquivos: `src/services/billingService.ts`, `src/services/savedSearchService.ts`, `tests/unit/saved-search-limits.test.ts`.
  - O plano Inicial começa com limite coerente com a oferta atual; planos superiores e ilimitado usam a configuração já existente, com fallback seguro.

- [ ] 3. Implementar endpoints autenticados para listar, criar, editar, pausar/reativar e excluir radares.
  - Arquivos: `server/api/radars.get.ts`, `server/api/radars.post.ts`, `server/api/radars/[id].patch.ts`, `server/api/radars/[id].delete.ts`, `server/utils/app.ts`.
  - Validar corpo com Zod, garantir organização do usuário, respeitar billing e retornar erros PT-BR.
  - Criar um radar inicial compatível a partir dos filtros da organização quando ainda não existir.

- [ ] 4. Implementar o onboarding pós-cadastro sem bloquear o uso do produto.
  - Arquivos: `server/api/onboarding.get.ts`, `server/api/onboarding.put.ts`, `src/auth/service.ts`, `app/pages/boas-vindas.vue`, `app/types.ts`, testes de auth/onboarding.
  - O cadastro deve continuar funcionando; após a criação, a aplicação direciona para boas-vindas apenas quando o onboarding não estiver concluído.
  - Salvar filtros, criar ou atualizar o primeiro radar, registrar conclusão e permitir “fazer depois”.

## Fase 2 — worker e alertas por radar

- [ ] 5. Escrever testes de seleção de radares e execução manual/automática.
  - Arquivos: `tests/unit/radar-sync-policy.test.ts`, `src/services/radarSyncService.ts`, `src/services/syncPolicy.ts`.
  - O ciclo automático executa apenas radares habilitados; a execução manual pode apontar para um radar específico, sem duplicar oportunidades.
  - A falha de um radar deve manter a pausa/resiliência global já existente e atualizar a última execução do radar somente com resultado confirmado.

- [ ] 6. Adaptar classificação e catálogo para considerar filtro do radar sem criar cópias de `opportunities`.
  - Arquivos: `src/services/scoring/classificationService.ts`, `src/repositories/opportunityRepository.ts`, `src/repositories/savedSearchRepository.ts`, `tests/unit/radar-scoring.test.ts`.
  - Score permanece determinístico e explicável por organização; a oportunidade global continua única.

- [ ] 7. Evoluir a fila de notificações para eventos idempotentes e prazos próximos.
  - Arquivos: `migrations/011_notification_events.sql`, `src/repositories/notificationRepository.ts`, `src/services/notificationService.ts`, `src/workerRuntime.ts`, `tests/unit/notification-events.test.ts`.
  - Deduplicar por organização, oportunidade, tipo de evento e janela; manter e-mail e Web Push como canais atuais.
  - Adicionar evento de nova oportunidade e prazo próximo sem quebrar registros existentes; respeitar orçamento, billing, retry e pausa automática.

## Fase 3 — catálogo, detalhe e Kanban

- [ ] 8. Cobrir ações de favorito, não relevante e visualização com persistência privada por organização.
  - Arquivos: `migrations/012_opportunity_feedback.sql`, `src/repositories/opportunityFeedbackRepository.ts`, `server/api/opportunities/[id]/feedback.post.ts`, `tests/unit/opportunity-feedback.test.ts`.
  - Operações devem ser idempotentes e não alterar a licitação global nem o Kanban de outra organização.

- [ ] 9. Expandir a API de catálogo com radar, modalidade, prazo, ordenação e estados de feedback.
  - Arquivos: `server/api/opportunities.get.ts`, `src/repositories/opportunityRepository.ts`, `app/types.ts`, `tests/unit/catalog.test.ts`.
  - Preservar paginação completa, total real e compatibilidade dos filtros atuais.

- [ ] 10. Redesenhar o painel de oportunidades para o fluxo “encontrar → entender → decidir”.
  - Arquivos: `app/pages/index.vue`, `app/components/OpportunityCatalog.vue`, `app/components/OpportunityDetails.vue`, `app/components/OpportunityKanban.vue`, `app/components/AppNavDrawer.vue`.
  - Incluir seletor de radar, filtros recolhíveis no mobile, score com motivos, prazo em destaque, ações de favorito/não relevante/Kanban e estados de carregamento/vazio/erro/pausa.
  - Manter o Kanban com cards maiores, rolagem horizontal no mobile e transições de estado existentes.

## Fase 4 — configuração e métricas de negócio

- [ ] 11. Criar a tela de gestão de radares e integrar notificações/busca automática em uma configuração compreensível.
  - Arquivos: `app/pages/configuracao.vue`, `app/components/RadarEditor.vue`, `app/components/RadarList.vue`, `app/types.ts`, testes de contrato da UI.
  - Permitir criar, editar, duplicar, pausar e excluir radares, mostrar limite do plano e manter o toggle automático de 10 minutos.

- [ ] 12. Instrumentar eventos essenciais de ativação e uso sem armazenar conteúdo sensível.
  - Arquivos: `migrations/013_product_events.sql`, `src/repositories/productEventRepository.ts`, `src/services/productAnalyticsService.ts`, pontos de API de onboarding/catalog/feedback/Kanban.
  - Registrar somente evento, organização, oportunidade quando necessário e timestamp; nunca senha, token, chave ou payload bruto.

- [ ] 13. Ampliar métricas administrativas para ativação, radares e uso.
  - Arquivos: `src/services/platformAdminService.ts`, `server/api/admin/metrics.get.ts`, `app/pages/admin.vue`, `app/types.ts`, `tests/unit/platform-admin.test.ts`.
  - Exibir onboarding concluído, radares ativos, empresas ativas, uso do catálogo, favoritadas, Kanban e conversão de teste quando houver dados.

## Fase 5 — acabamento visual e validação

- [ ] 14. Refinar o sistema visual e os estados responsivos sem alterar o contrato de negócio.
  - Arquivos: `app/assets/css/main.css`, páginas e componentes tocados nas fases anteriores.
  - Corrigir hierarquia, contraste, textos quebrados, foco de teclado, tamanhos de toque e comportamento mobile/desktop.

- [ ] 15. Adicionar cobertura de recuperação e fluxo crítico da evolução.
  - Arquivos: `tests/unit/restart.test.ts`, `tests/unit/automatic-sync.test.ts`, `tests/unit/push-notification.test.ts`, `scripts/e2e-real.ts`.
  - Cobrir onboarding → radar → sync → score → catálogo → favorito/Kanban → notificação, reinício do worker e corte por orçamento/canal.

- [ ] 16. Executar verificação completa antes de considerar a evolução pronta.
  - Comandos: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e:real`.
  - Fazer uma inspeção manual autenticada em desktop e mobile; relatar qualquer bloqueio externo exato, especialmente credencial do canal de e-mail/push.

## Ordem de implementação

Executar as fases na ordem acima. A Fase 1 é pré-requisito para a Fase 2; a Fase 3 pode começar após o contrato do radar; a Fase 4 depende dos eventos definidos nas fases 2 e 3; a Fase 5 só fecha depois do fluxo completo funcionar.

