# Task 5 - Fix round 2

## Status

Correcao do bloqueio P1 de upgrade implementada. Nao ha bloqueio concreto.

## Correcao

- A migration 020 foi restaurada a semantica compativel e imutavel da versao anterior; a comparacao com `adeb4bc` nao mostra diferencas.
- A migration forward `022_market_results_contract.sql`, aplicada apos 021, adiciona as colunas exigidas com defaults/backfill, preserva dados existentes e cria os indices de auditoria.
- O teste simula 020/021 ja marcadas, roda o migrator do HEAD, executa o migrator novamente e compara o schema com banco fresco.

## TDD e verificacoes

- RED confirmado: o teste de upgrade falhou porque o runner ainda nao aplicava 022 e o schema legado nao tinha as colunas novas.
- Focused: `npm test -- --run tests/unit/source-contract.test.ts tests/unit/source-checkpoint.test.ts tests/unit/pagination-safety.test.ts tests/unit/migration-upgrade.test.ts` - 4 arquivos, 18 testes aprovados.
- Suite completa: `npm test -- --run` - 43 arquivos, 133 testes aprovados; warnings conhecidos do h3 permanecem.
- Typecheck: `npm run typecheck` - aprovado.
- Lint: `npm run lint` - aprovado.
- Build: `npm run build` - aprovado; somente warning conhecido de depreciacao do mapeamento de modulo `./` em `@vue/shared`.

## Compatibilidade e limites

- Banco fresco e banco legado com 020/021 ja aplicadas chegam ao mesmo schema de `market_results`.
- Dados existentes de `market_results` sao preservados; novas colunas recebem defaults seguros e a migration e registrada pelo runner para nao reaplicar ALTERs.
- O worker, UI, deploy e fluxos de agenda/checklist nao foram alterados.
- BEC/SP permanece opt-in e usa somente o Web Service publico JSON documentado em:
  <https://portal.fazenda.sp.gov.br/acessoinformacao/Paginas/Webservice-BEC.aspx>
- Nenhum segredo foi adicionado. Nao houve push ou deploy.
