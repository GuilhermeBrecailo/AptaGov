# Task 5 - Fix round 3

## Status

Correcao do bloqueio P1 de idempotencia implementada. Nao ha bloqueio concreto.

## Correcao

- A migration 020 foi restaurada exatamente ao conteudo do BASE `a71eeea`; `git diff --exit-code a71eeea -- migrations/020_market_intelligence.sql` passou.
- A migration forward `022_market_results_contract.sql`, aplicada apos 021, usa o runner para consultar `PRAGMA table_info` e adicionar somente colunas ausentes. O SQL de backfill e indices usa operacoes idempotentes.
- O teste aplica exatamente 020/021 do BASE, marca ambas como aplicadas, executa o migrator do HEAD duas vezes e compara colunas, indices e dados preservados com banco fresco.

## TDD e verificacoes

- RED confirmado: o fixture do BASE falhou com `duplicate column name: normalized_description` quando 022 ainda usava `ADD COLUMN` incondicional.
- Focused: `npm test -- --run tests/unit/source-contract.test.ts tests/unit/source-checkpoint.test.ts tests/unit/pagination-safety.test.ts tests/unit/migration-upgrade.test.ts` - 4 arquivos, 18 testes aprovados.
- Suite completa: `npm test -- --run` - 43 arquivos, 133 testes aprovados; warnings conhecidos do h3 permanecem.
- Typecheck: `npm run typecheck` - aprovado.
- Lint: `npm run lint` - aprovado.
- Build: `npm run build` - aprovado; somente warning conhecido de depreciacao do mapeamento de modulo `./` em `@vue/shared`.

## Compatibilidade e limites

- Banco fresco e banco legado com 020/021 ja aplicadas chegam ao mesmo schema de `market_results`.
- Dados existentes de `market_results` sao preservados; novas colunas recebem defaults seguros e 022 e registrada pelo runner, que nao reaplica ALTERs quando as colunas ja existem.
- O worker, UI, deploy e fluxos de agenda/checklist nao foram alterados.
- BEC/SP permanece opt-in e usa somente o Web Service publico JSON documentado em:
  <https://portal.fazenda.sp.gov.br/acessoinformacao/Paginas/Webservice-BEC.aspx>
- Nenhum segredo foi adicionado. Nao houve push ou deploy.
