# Filtros da busca (situação, modalidade, cidade, disputa, datas) — design curto

Data: 2026-11-25 · Status: aprovado pelo dono · Roteiro BLL/BNC, passo 2

## Intenção
"Ter tudo que a BLL/BNC têm, porém melhor": o dono acha rápido as obras que pode disputar, com os mesmos filtros das plataformas, sem a busca ficar confusa e sem esconder resultado sem ele perceber.

## Hoje
- `app/pages/index.vue:57-63` barra: pesquisa, estado, radar, ordenação, "Só prazo aberto". Estado da tela em `useOpportunityWorkspace.ts`.
- `server/api/opportunities.get.ts` → `OpportunityRepository.listCatalog(CatalogQuery)` (`src/repositories/opportunityRepository.ts:35,93`).
- Colunas existentes: `state`, `city`, `modality`, `publication_date`, `bidding_deadline`. Situação e modo de disputa só no `raw_json`: PNCP `situacaoCompraNome`/`modoDisputaNome`; OPEN_DATA `situacaoCompraNomePncp`/`modoDisputaNomePncp`. Mapeamento em `mapPncpRecord` (`src/services/syncService.ts:113`).
- Valores na prévia: modalidades Pregão - Eletrônico, Dispensa, Concorrência - Eletrônica, Concorrência - Presencial, Pregão - Presencial; situações Divulgada no PNCP, Suspensa, Revogada, Anulada; disputa Aberto, Fechado, Aberto-Fechado, Fechado-Aberto, Não se aplica.

## Objetivos
1. Colunas `situation` e `dispute_mode` em `opportunities`, preenchidas na sincronização e por backfill (migração 034) a partir do `raw_json`; índices para os filtros.
2. Filtros novos (AND com os atuais e com o radar): situação, modalidade (várias), cidade, tipo de disputa (vários), publicação de/até, prazo de/até.
3. Situação padrão "Em andamento" = tudo que não é Suspensa, Revogada, Anulada ou outro estado encerrado conhecido (situação desconhecida/null conta como em andamento). Opções: Em andamento, Suspensas, Revogadas ou anuladas, Todas.
4. Opções de modalidade, disputa e cidades vêm do próprio banco (endpoint de facetas), para sempre casar com os dados.
5. UI: botão "Mais filtros" abre segunda linha; cada filtro ativo vira etiqueta com "×"; botão "Limpar filtros"; contador "N filtros".
6. Filtros na URL (query string): recarregar ou compartilhar o link mantém a busca.

## Não-objetivos
Mapa/região (passo 4), salvar filtro como radar (já existe radar), novas fontes.

## Anti-objetivos
- Esconder resultados sem sinal visível (todo filtro ativo, inclusive o padrão de situação, aparece como etiqueta).
- SQL montado com texto do usuário (sempre parâmetros).
- Barra principal mais poluída que hoje.

## Abordagens
- **A (escolhida):** colunas novas + backfill + facetas do banco. Rápido, indexável, sempre consistente.
- B: `json_extract` no `raw_json` em cada busca — sem migração, mas lento e com nomes de campo diferentes por fonte.
- C: filtrar no navegador — não escala (paginação no servidor).

## Decisões deixadas ao construtor
- Formato exato dos parâmetros de URL/API (listas separadas por vírgula ou repetidas).
- Comparação de datas pelo dia (`substr(col,1,10)`), já que o PNCP manda horário local sem fuso.
</content>
</invoke>
