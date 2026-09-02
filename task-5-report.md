# Task 5 — contrato de conectores oficiais

## Status

Primeiro corte funcional implementado, validado e pronto para commit. Não há bloqueio concreto.

## Decisões

- `source_code` é o identificador canônico (`PNCP`, `OPEN_DATA` ou `BEC/SP`). O campo legado `source` continua compatível com PNCP/OpenData; para BEC/SP ele permanece com o fallback PNCP e a origem real fica em `source_code`.
- `OfficialSourceClient` define o contrato comum de oportunidades e observações de mercado. PNCP e OpenData são adapters finos sobre os clientes existentes e reutilizam `paginateAll`; não há uma segunda implementação de paginação.
- O `SourceSyncRepository` persiste a página e atualiza o checkpoint na mesma transação. O cursor só avança depois que todos os itens da página foram normalizados e persistidos; qualquer erro faz rollback da página e mantém o cursor anterior.
- A deduplicação de observações usa `(source_code, external_id, item_code)`, com atualização idempotente.
- BEC/SP usa somente o webservice público oficial em JSON, com base URL, timeout, retries e operação configuráveis. O mapeamento está isolado em `BecSpClient`; não há HTML, browser automation ou segredo no código.
- A ativação padrão do registry mantém PNCP/OpenData e deixa BEC/SP opt-in, evitando chamadas externas inesperadas em ambientes existentes.
- As migrations 020 e 021 são aplicadas em ordem após as migrations existentes.

## TDD e verificações

- RED inicial: os testes de contrato/checkpoint falharam por ausência dos módulos da Task 5.
- Teste focado: `3` arquivos, `10` testes aprovados.
- Suíte completa: `42` arquivos, `125` testes aprovados.
- Typecheck: `npm run typecheck` aprovado.
- Lint focado nos arquivos alterados: aprovado sem issues.
- Cobertura funcional dos testes: páginas `1..N`, retomada por cursor, duplicidade de external id, labels das fontes e isolamento de falha entre fontes.

## Limites intencionais do primeiro corte

- O worker, a UI da Task 4, Mercado e deploy não foram alterados.
- O registry não faz sincronização automática nem habilita BEC/SP por padrão; a execução fica para a camada de orquestração posterior.
- A migration cria `market_results`, mas este corte implementa a persistência operacional de `market_observations`, que é a entrada usada pelo contrato de fontes.

## Fonte BEC/SP

O adapter segue o contrato público documentado no portal oficial da BEC/SP:
<https://portal.fazenda.sp.gov.br/acessoinformacao/Paginas/Webservice-BEC.aspx>

Nenhuma credencial foi adicionada ao repositório.
