# Task 6 — Inteligência de mercado oficial

## Status

Implementada a leitura de inteligência de mercado com guardas de qualidade, autorização por organização e interface PT-BR. Não há bloqueio concreto para a entrega desta task.

## Implementação

- `MarketRepository` consulta `market_observations` e `market_results` com SQL parametrizado, filtros de período, estado, órgão, descrição normalizada, código do item e unidade, preservando quantidade, preço unitário, valor total, modalidade, situação e links de origem.
- `MarketIntelligenceService` deduplica por fonte/identificador/item, prioriza preço unitário válido, calcula mínimo/mediana/máximo em centavos, série mensal, compras, órgãos, regiões, modalidade, situação, última atualização e links de fonte/auditoria.
- A comparação só usa identidade completa compatível (`itemCode`, descrição normalizada e unidade). Amostras menores que `MARKET_MIN_OBSERVATIONS` retornam `INSUFFICIENT_DATA`, sem estimativa ou probabilidade.
- `GET /api/market` e `GET /api/opportunities/:id/market` exigem sessão e billing ativo (`catalog`). O segundo endpoint também exige que a oportunidade esteja autorizada para a organização.
- `Mercado`, `MarketSummary`, drawer, detalhe da oportunidade, tipos de frontend e CSS responsivo foram integrados em PT-BR.
- O contrato de ambiente recebeu `MARKET_MIN_OBSERVATIONS=5`, `MARKET_LOOKBACK_DAYS=365` e `BEC_SP_ENABLED=false` como defaults seguros. O worker e as migrations/checkpoints aprovados não foram alterados; os adapters oficiais foram estendidos nesta rodada.

## TDD e verificações

- RED confirmado: a primeira execução falhou porque os módulos da Task 6 ainda não existiam.
- Focused final: `npm test -- --run tests/unit/market-intelligence.test.ts tests/unit/authorization.test.ts` — 2 arquivos, 13 testes aprovados.
- Fix round 1 focused: `npm test -- --run tests/unit/source-contract.test.ts tests/unit/source-checkpoint.test.ts tests/unit/market-intelligence.test.ts` — 3 arquivos, 32 testes aprovados.
- Typecheck: `npm run typecheck` — aprovado.
- Lint focado — aprovado.
- Lint completo: `npm run lint` — aprovado.
- Suíte completa: `npm test -- --run` — 44 arquivos, 152 testes aprovados.
- Build: `npm run build` — aprovado; permanece apenas o warning deprecatório do mapeamento de módulo `./` em `@vue/shared`.

## Arquivos principais

- `src/repositories/marketRepository.ts`
- `src/services/marketIntelligenceService.ts`
- `src/repositories/sourceSyncRepository.ts`
- `src/integrations/sources/marketValues.ts`
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

## Fix round 1

- `OfficialSourceClient` e `BecSpClient` agora expõem `MarketResultInput` e páginas combinadas de observações/resultados. `syncSourceMarket` persiste o lote em transação, avança checkpoint somente após observações e resultados, e alimenta o mesmo `MarketRepository`/`MarketIntelligenceService`.
- `MarketRepository`/service transportam vencedor e `awarded_price_cents`. O awarded só é comparável para item com quantidade 1, ou quando o total adjudicado coincide explicitamente com o total do item; preço unitário direto tem prioridade na deduplicação.
- Observações persistem modalidade e situação no payload sanitizado quando não há coluna aprovada na migration; os breakdowns leem esses metadados reais.
- Parsers monetários retornam `null` para vazio/texto inválido e preservam zero explícito. Persistência rejeita lote com `sourceUrl` vazio; adapters usam fallback oficial determinístico.
- O registry padrão agora usa `loadEnv().becSpEnabled`, com teste para default desligado e ativação explícita.
- Teste de integração cobre adapter PNCP → persistência de observação/resultado → checkpoint → resumo e links de fonte/auditoria.

## Limitação externa exata

- Os módulos PNCP/OpenData existentes no repositório só expõem o endpoint oficial de publicações; não existe neste código um cliente documentado para endpoint dedicado de resultados homologados, contratos ou atas. O fix não inventa URL: mapeia esses dados quando presentes no payload oficial e deixa o contrato `MarketResultInput`/`listMarketResultPages` isolado para um cliente oficial documentado futuro. O worker continua fora do escopo, portanto a execução periódica real não foi ativada nesta task.
