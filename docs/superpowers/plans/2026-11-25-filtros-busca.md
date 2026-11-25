# Filtros da busca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Filtros de situação, modalidade, cidade, tipo de disputa e datas na busca, com etiquetas visíveis e estado na URL.

**Architecture:** Colunas `situation`/`dispute_mode` (migração 034 + sync) → `CatalogQuery` com filtros novos → endpoint de facetas → painel "Mais filtros" no `index.vue` sincronizado com a URL.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript strict, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-filtros-busca-design.md`

## Global Constraints
- Situação "Em andamento" (padrão) exclui exatamente: `Suspensa`, `Revogada`, `Anulada`, `Deserta`, `Fracassada`, `Encerrada` (comparação sem diferenciar maiúsculas); null/vazio conta como em andamento.
- Valores de `situationFilter`: `open` (padrão), `suspended`, `cancelled` (Revogada ou Anulada), `all`.
- Datas de filtro no formato `YYYY-MM-DD`, inclusivas, comparadas por `substr(coluna,1,10)`.
- Todo SQL com parâmetros; nada de interpolar texto do usuário.
- Textos da UI: botão `Mais filtros`, `Limpar filtros`; rótulos `Situação`, `Modalidade`, `Cidade`, `Tipo de disputa`, `Publicação de`, `Publicação até`, `Prazo de`, `Prazo até`; opções de situação `Em andamento`, `Suspensas`, `Revogadas ou anuladas`, `Todas`.
- Não commitar sem pedido explícito do dono; branch `feature/filtros`.
- Pré-existente: com o `config/filters.json` local, `worker-runtime.test.ts` e `task7-fix-round5.test.ts` falham ("expected 4 to be 1") — reportar, não corrigir.

## Review Focus
- Licitação OPEN_DATA (campos `...NomePncp`) recebe situação/disputa no backfill e no sync (teste T1).
- Situação null aparece em "Em andamento" (teste T2).
- Cidade com acento/maiúsculas ("São Paulo" vs "SAO PAULO") — comparar sem diferenciar maiúsculas (teste T2; acento: casar igual ao banco via faceta).
- Datas inválidas na URL são ignoradas, sem erro 500 (teste T2).
- Abrir a página com filtros na URL restaura os campos e etiquetas (teste T3).

---

### Task 1: Colunas de situação e disputa

**Files:**
- Create: `migrations/034_opportunity_situation_dispute.sql` (`ALTER TABLE opportunities ADD COLUMN situation TEXT`; `ADD COLUMN dispute_mode TEXT`; backfill `UPDATE ... SET situation = COALESCE(json_extract(raw_json,'$.situacaoCompraNome'), json_extract(raw_json,'$.situacaoCompraNomePncp'))`, idem disputa com `modoDisputaNome`/`modoDisputaNomePncp`, só onde `json_valid(raw_json)`; índices `(situation)`, `(state, city)`, `(modality)`)
- Modify: `src/db/database.ts` (registrar 034), `src/domain/types.ts` (Opportunity/OpportunityInput ganham `situation: string | null`, `disputeMode: string | null`), `src/services/syncService.ts` (`mapPncpRecord`), `src/repositories/opportunityRepository.ts` (insert/upsert e row→domínio)
- Test: `tests/unit/opportunity-situation.test.ts`

- [ ] Step 1: testes — mapPncpRecord de registro PNCP (`situacaoCompraNome: 'Suspensa'`, `modoDisputaNome: 'Aberto'`) e OPEN_DATA (`...NomePncp`) preenche os campos; sem campos → null; upsert grava e atualiza; migração em banco com linhas antigas faz backfill das duas variantes e ignora raw inválido.
- [ ] Step 2: rodar → FAIL. Step 3: implementar. Step 4: PASS + suíte de sync/repositório existente.

### Task 2: Filtros no catálogo e facetas

**Files:**
- Modify: `src/repositories/opportunityRepository.ts` (`CatalogQuery` += `situationFilter?: 'open'|'suspended'|'cancelled'|'all'`, `modalities?: string[]`, `city?: string`, `disputeModes?: string[]`, `publishedFrom?`, `publishedTo?`, `deadlineFrom?`, `deadlineTo?: string`), `server/api/opportunities.get.ts` (parse: listas separadas por vírgula, datas validadas por regex `^\d{4}-\d{2}-\d{2}$`, situação inválida → `open`)
- Create: `src/repositories/opportunityFacets.ts` com `listOpportunityFacets(db, state?: string): { modalities: string[]; disputeModes: string[]; cities: string[] }` (distintos, não vazios, ordenados pt-BR; cidades só do estado quando informado); `server/api/opportunities/facets.get.ts` (mesma proteção de billing do catálogo)
- Test: `tests/unit/catalog-filters.test.ts`

- [ ] Step 1: testes — padrão exclui Suspensa/Revogada/Anulada e inclui null; `suspended` só Suspensa; `cancelled` Revogada+Anulada; `all` tudo; modalities ["Dispensa"] filtra; city "são paulo" casa "São Paulo"; disputeModes; publishedFrom/To e deadlineFrom/To inclusivos; data inválida ignorada pelo parser; combinação com `state` e `openDeadlineOnly`; facetas distintas e por estado.
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + testes de catálogo existentes.

### Task 3: Painel "Mais filtros", etiquetas e URL

**Files:**
- Create: `app/viewModels/catalogFiltersViewModel.ts` com `filtersFromQuery(query: Record<string, unknown>): CatalogFilterState`, `filtersToQuery(state): Record<string, string>` (omite valores padrão), `activeFilterChips(state): Array<{ key: string; label: string }>` (a situação padrão também aparece, como `Situação: Em andamento` com "×"; remover leva a `all`, que não gera chip)
- Modify: `app/composables/useOpportunityWorkspace.ts` (estado + chamada da API com os parâmetros novos + leitura/escrita da URL via `useRoute`/`useRouter().replace`), `app/pages/index.vue` (botão `Mais filtros` com contador, segunda linha, chips, `Limpar filtros`, cidade com `<datalist>` das facetas do estado), `app/assets/css/main.css` (reusar tokens/classes existentes da `.filter-bar`)
- Test: `tests/unit/catalog-filters-view-model.test.ts`

- [ ] Step 1: testes — ida e volta query↔estado; padrões omitidos da URL; valores inválidos ignorados; chips com rótulos exatos (`Situação: Em andamento`, `Modalidade: Dispensa`, `Cidade: Campinas`, `Publicação: 01/11/2026–30/11/2026`); remover chip volta o campo ao padrão (situação → `all`).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build`.
</content>
</invoke>
