# Task 5 — Fix round 1

## Status

Correções do review implementadas. Não há bloqueio concreto.

## Correções

- BEC/SP agora busca o detalhe `/.../OC` para cada resumo de operação `*_encerrado`, mescla os dados da OC e mapeia itens, município, UF, datas, link, oportunidade e observação de mercado.
- `market_results` foi alinhado ao contrato de mercado: origem canônica, identificador externo, item, descrição normalizada, unidade, quantidade, preços, organização, estado, oportunidade, vencedor/status, data, link e `raw_json` sanitizado. A persistência é transacional, idempotente e usa a chave `(source_code, external_id, item_code)`.
- O paginator existente agora também expõe páginas individuais; PNCP/OpenData usam esse mesmo fluxo. `syncSourceOpportunities` normaliza e persiste cada página antes de avançar o checkpoint, preservando a retomada em falhas intermediárias.
- Lotes com `source`/`sourceCode` divergente são rejeitados antes da transação. A persistência usa exclusivamente `input.sourceCode` para origem e deduplicação.
- Catalog, details e agenda exibem `sourceLabel`, preservando os códigos PNCP/OpenData e mostrando BEC/SP corretamente.
- Foram adicionados testes para constraints/índices 020/021, `source_runs`, `recordFailure` sem avanço de cursor, redaction, registry configurável e timeout/retry.

## TDD e verificações

- RED confirmado: 6 falhas reproduziram os achados do review antes das correções.
- Focused atual: `npm test -- --run tests/unit/source-contract.test.ts tests/unit/source-checkpoint.test.ts tests/unit/pagination-safety.test.ts` — 3 arquivos, 17 testes aprovados.
- Typecheck atual: `npm run typecheck` — aprovado.
- Lint atual: `npm run lint` — aprovado.
- Build atual: `npm run build` — aprovado. O processo emitiu somente o warning conhecido de depreciação do mapeamento de módulo `./` em `@vue/shared`.
- Suíte completa não foi repetida neste fix round por orientação de prioridade. A suíte do commit anterior havia passado com 42 arquivos/125 testes, mas esse resultado não substitui uma execução pós-fix.

## Limites e compatibilidade

- O worker, deploy e fluxos de agenda/checklist não foram alterados; a agenda só recebeu o label canônico da fonte.
- A migration 020 foi corrigida diretamente conforme solicitado; não foi criada uma migração 022 ambígua para SQLite.
- BEC/SP permanece opt-in no registry e usa apenas o Web Service público JSON documentado em:
  <https://portal.fazenda.sp.gov.br/acessoinformacao/Paginas/Webservice-BEC.aspx>
- Nenhum segredo foi adicionado. Não houve push ou deploy.
