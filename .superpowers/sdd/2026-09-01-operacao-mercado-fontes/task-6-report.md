# Task 6 — Inteligência de mercado oficial

## Status

Implementada a leitura de inteligência de mercado com guardas de qualidade, autorização por organização e interface PT-BR. Não há bloqueio concreto para a entrega desta task.

## Implementação

- `MarketRepository` consulta `market_observations` e `market_results` com SQL parametrizado, filtros de período, estado, órgão, descrição normalizada, código do item e unidade, preservando quantidade, preço unitário, valor total, modalidade, situação e links de origem.
- `MarketIntelligenceService` deduplica por fonte/identificador/item, prioriza preço unitário válido, calcula mínimo/mediana/máximo em centavos, série mensal, compras, órgãos, regiões, modalidade, situação, última atualização e links de fonte/auditoria.
- A comparação só usa identidade completa compatível (`itemCode`, descrição normalizada e unidade). Amostras menores que `MARKET_MIN_OBSERVATIONS` retornam `INSUFFICIENT_DATA`, sem estimativa ou probabilidade.
- `GET /api/market` e `GET /api/opportunities/:id/market` exigem sessão e billing ativo (`catalog`). O segundo endpoint também exige que a oportunidade esteja autorizada para a organização.
- `Mercado`, `MarketSummary`, drawer, detalhe da oportunidade, tipos de frontend e CSS responsivo foram integrados em PT-BR.
- O contrato de ambiente recebeu `MARKET_MIN_OBSERVATIONS=5`, `MARKET_LOOKBACK_DAYS=365` e `BEC_SP_ENABLED=false` como defaults seguros. O worker e os conectores/checkpoints aprovados não foram alterados.

## TDD e verificações

- RED confirmado: a primeira execução falhou porque os módulos da Task 6 ainda não existiam.
- Focused final: `npm test -- --run tests/unit/market-intelligence.test.ts tests/unit/authorization.test.ts` — 2 arquivos, 13 testes aprovados.
- Typecheck: `npm run typecheck` — aprovado.
- Lint focado — aprovado.
- Lint completo: `npm run lint` — aprovado.
- Suíte completa: `npm test -- --run` — 44 arquivos, 145 testes aprovados.
- Build: `npm run build` — aprovado; permanece apenas o warning deprecatório do mapeamento de módulo `./` em `@vue/shared`.

## Arquivos principais

- `src/repositories/marketRepository.ts`
- `src/services/marketIntelligenceService.ts`
- `server/api/market.get.ts`
- `server/api/opportunities/[id]/market.get.ts`
- `app/pages/mercado.vue`
- `app/components/MarketSummary.vue`
- `app/components/OpportunityDetails.vue`
- `app/components/AppNavDrawer.vue`
- `app/types.ts`
- `app/assets/css/main.css`
- `src/config/env.ts` e `.env.example`
- `tests/unit/market-intelligence.test.ts` e `tests/unit/authorization.test.ts`

## Limites e bloqueios exatos

- Não foi executado E2E contra PNCP/Compras nem refresh real pelo worker: a integração de ciclos duráveis pertence à Task 7 e não foi autorizada nesta task; a interface consome os registros oficiais persistidos pelas migrations/adapters da Task 5.
- Não houve push, deploy, alteração de worker ou alteração das migrations/fontes/checkpoints aprovadas.
- O build emite o warning externo de depreciação de trailing slash em `@vue/shared`; não bloqueia o artefato.
