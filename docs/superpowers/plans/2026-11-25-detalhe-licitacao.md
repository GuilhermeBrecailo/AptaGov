# Página de detalhe da licitação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Página `/licitacoes/[id]` com cabeçalho, prazos, itens e arquivos do PNCP (com cache de 6 h), reaproveitando análise de edital e checklist.

**Architecture:** `PncpDetailClient` (itens + arquivos) → `OpportunityDetailService` com cache SQLite (migração 035) → `GET /api/opportunities/[id]/detail` → página Vue + view-model.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript strict, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-detalhe-licitacao-design.md`

## Global Constraints
- Cache: 6 horas (`DETAIL_CACHE_TTL_MS = 6 * 60 * 60 * 1000`); só chama o PNCP se não houver cache válido.
- PNCP: só `https://pncp.gov.br/api/pncp/v1/...`; timeout 20 s por chamada; itens em páginas de 500, até 1.000 itens (acima disso `truncated: true`).
- Link de arquivo só se https em `pncp.gov.br` (reusar `safeHttpsUrl` + checagem de host).
- Textos: `Ver página completa`, `Itens`, `Arquivos`, `Prazos`, `Total estimado`, `Sigiloso`, `Versão anterior`, `PNCP indisponível agora`, `Dados do PNCP de {data}`, `Itens e arquivos disponíveis na plataforma`, `Mostrando os primeiros 1.000 itens`.
- Prazos de impugnação/esclarecimentos: lembrete automático da org (createdByUserId null) se existir; senão `businessDaysBefore(abertura, 3)` com a nota `Estimado pela Lei 14.133 (3 dias úteis antes da abertura) — confira no edital.`
- Testes nunca acessam a rede (fetch falso) nem `data/licitacoes.db`.
- Não commitar sem pedido do dono; branch `feature/detalhe`.
- Pré-existente: `worker-runtime.test.ts` e `task7-fix-round5.test.ts` falham com o `config/filters.json` local — reportar, não corrigir.

## Review Focus
- PNCP fora do ar com cache antigo → devolve cache com `stale: true` e data (teste T1).
- PNCP fora do ar sem cache → `unavailable: true`, sem 500 (teste T1).
- Licitação sem `pncpId` válido (BEC) → `source: 'platform-only'` sem chamar fetch (teste T1).
- Organização sem acesso/billing → mesma proteção do catálogo (teste T2).
- Item com `orcamentoSigiloso` → "Sigiloso", não R$ 0 (teste T3).

---

### Task 1: Cliente PNCP de detalhe + cache

**Files:**
- Create: `migrations/035_opportunity_detail_cache.sql` (`opportunity_detail_cache(opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE, items_json TEXT NOT NULL, files_json TEXT NOT NULL, items_total INTEGER NOT NULL, truncated INTEGER NOT NULL, fetched_at TEXT NOT NULL)`), registrar em `src/db/database.ts`
- Create: `src/services/opportunityDetail/pncpDetailClient.ts` — `PncpDetailClient(fetchImpl = fetch)` com `listItems(id: {cnpj, year, sequential}): Promise<{ items: PncpItem[]; total: number; truncated: boolean }>` e reuso de `PncpDocumentClient.list` + `selectDocuments` para arquivos (`PncpFileView = { title, typeName, url, publishedAt: string | null, superseded: boolean }`)
- Create: `src/services/opportunityDetail/opportunityDetailService.ts` — `OpportunityDetailService({ db, client, now })` com `get(opportunityId): Promise<OpportunityDetailPncp>` onde `OpportunityDetailPncp = { source: 'pncp' | 'platform-only'; items: PncpItem[]; itemsTotal: number; truncated: boolean; files: PncpFileView[]; fetchedAt: string | null; stale: boolean; unavailable: boolean }`
- `PncpItem = { number: number; description: string; quantity: number | null; unit: string | null; unitValueCents: number | null; totalValueCents: number | null; confidential: boolean; criterion: string | null; benefit: string | null; status: string | null; kind: string | null }`
- Test: `tests/unit/opportunity-detail-service.test.ts`

- [ ] Step 1: testes com fetch falso — mapeia itens (centavos, sigiloso → valores null + confidential true); pagina 500 + total; >1000 → truncated; arquivos com supersede; cache válido não chama fetch; cache vencido rebusca e grava; PNCP erro + cache → stale true; erro sem cache → unavailable true; pncpId inválido → platform-only sem fetch.
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + lint/typecheck.

### Task 2: Endpoint de detalhe com prazos

**Files:**
- Create: `server/api/opportunities/[id]/detail.get.ts` (proteção igual a `server/api/opportunities.get.ts`, `requireActiveBilling(event,'catalog')`), exportando `handleOpportunityDetailGet({ db, organizationId, opportunityId, service })` → `{ opportunity: CatalogOpportunity; pncp: OpportunityDetailPncp; deadlines: Array<{ key: 'publication'|'proposal'|'opening'|'challenge'|'clarification'; label: string; at: string | null; note: string | null }> }`; 404 se não existir
- Modify: `server/utils/app.ts` (getter do serviço), `app/types.ts`
- Test: `tests/unit/opportunity-detail-api.test.ts`

- [ ] Step 1: testes — 404; prazos: com lembrete automático da org usa a data e a nota dele; sem lembrete usa estimativa legal com a nota exata; sem abertura → challenge/clarification null; rótulos `Publicação`, `Propostas até`, `Abertura`, `Impugnação até`, `Esclarecimentos até`.
- [ ] Step 2: FAIL. Step 3: implementar (lookup da oportunidade com `listCatalog({ organizationId, opportunityId, situationFilter: 'all', hideNotRelevant: false, pageSize: 1 })`). Step 4: PASS.

### Task 3: Página e link no painel

**Files:**
- Create: `app/pages/licitacoes/[id].vue` (usa `AppShell`, reusa `EditalAnalysisPanel`, `OpportunityChecklist`, `platformFor`), `app/viewModels/opportunityDetailViewModel.ts` com `itemRows(items): Array<{ number, description, quantityLabel, unitValueLabel, totalValueLabel, criterion, benefit, status }>`, `itemsTotalLabel(items)`, `pageOf<T>(rows: T[], page: number, size = 50): { rows: T[]; pages: number }`, `fileRows(files)` (link só https em pncp.gov.br)
- Modify: `app/components/OpportunityDetails.vue` (link `Ver página completa` para `/licitacoes/{id}`), `app/assets/css/main.css` (reusar tokens; tabela responsiva com rolagem horizontal só dentro da tabela)
- Test: `tests/unit/opportunity-detail-view-model.test.ts`

- [ ] Step 1: testes do view-model — moeda pt-BR; sigiloso → `Sigiloso`; total soma só não-sigilosos e mostra `Sigiloso` se todos forem; paginação 50; link http/fora do pncp → null.
- [ ] Step 2: FAIL. Step 3: implementar página (estados: carregando, `platform-only`, `unavailable`, `stale` com `Dados do PNCP de {data}`, `truncated`). Step 4: lint, typecheck, `npx vitest run`, `npm run build`.
</content>
</invoke>
<invoke name="Bash">
<parameter name="command">cd "C:/Users/user/Documents/dev/AptaGov" && S="C:/Users/user/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.2/skills/subagent-driven-development/scripts"; P=docs/superpowers/plans/2026-11-25-detalhe-licitacao.md; W=$(bash "$S/sdd-workspace" $P); for n in 1 2 3; do bash "$S/task-brief" $P $n >/dev/null; done; git add docs/superpowers; printf '# SDD ledger — plan: %s\nSpec: docs/superpowers/specs/2026-11-25-detalhe-licitacao-design.md\nBranch: feature/detalhe (base main 3fbf0d9)\nRuling R1: no commits per task (owner rule) — staging; cost: one commit at end.\nRuling R2: worker-runtime/task7-fix-round5 failures pre-existing — cost none.\n## Tasks\nTask 1: dispatched (implementer sonnet)\n' "$P" > $W/progress.md; ls $W