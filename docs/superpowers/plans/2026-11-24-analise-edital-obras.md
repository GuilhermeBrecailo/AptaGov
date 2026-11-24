# Análise de Edital de Obras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perfil técnico da empresa + botão "Analisar edital" que baixa os PDFs do PNCP, extrai exigências com Claude e compara de forma determinística, mostrando ✅/❌/⚠️ e veredito.

**Architecture:** Módulo `src/services/edital/` com quatro peças independentes (documentos PNCP, extrator Claude atrás de interface, comparação pura, serviço orquestrador) + dois repositórios SQLite + três endpoints Nuxt + duas telas. A IA só extrai e relaciona; números são comparados em código.

**Tech Stack:** Nuxt 4, TypeScript strict, better-sqlite3, zod, Vitest, `@anthropic-ai/sdk` (nova).

**Spec:** `docs/superpowers/specs/2026-11-24-analise-edital-obras-design.md`

## Global Constraints

- Interface em PT-BR; código, tabelas e estados em inglês.
- Única dependência nova: `@anthropic-ai/sdk`. ZIP/RAR/DOCX não são abertos.
- Modelo padrão `claude-opus-5-5`, `thinking: { type: "adaptive" }`, `output_config.effort: "high"`, streaming + `finalMessage()`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- Liberado só para IDs em `EDITAL_ANALYSIS_ORGANIZATION_IDS`; limite `EDITAL_ANALYSIS_MONTHLY_LIMIT` (padrão 30) por organização por mês-calendário (UTC).
- Orçamento de documentos: 24 MB brutos somados por análise.
- `RUNNING` há mais de 15 min vira `FAILED` ("Análise interrompida") na leitura.
- Na dúvida, ⚠️ — nunca ✅. Visita técnica e garantia são sempre ⚠️ informativos e não impedem "Apto".
- Não commitar sem pedido do usuário (regra global do dono); passos de commit deste plano ficam para quando ele pedir.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` precisam passar ao fim de cada task.

## Review Focus

1. Edital só em ZIP/DOCX no PNCP → falha com "Edital em formato não suportado (ZIP/DOCX) — abra pelo link", sem chamar a IA (Task 3/6).
2. Usuário clica "Analisar" duas vezes rápido → a segunda chamada devolve a análise `RUNNING` existente, não cria outra nem gasta (Task 6).
3. Perfil vazio (nenhum atestado, sem financeiro) → análise roda; atestado obrigatório vira ❌ "nenhum atestado cadastrado", financeiro vira ⚠️ (Task 5).
4. Chave `ANTHROPIC_API_KEY` ausente → botão desabilitado com explicação e API 503, nada é baixado (Task 6/8).
5. IA devolve JSON fora do schema ou `stop_reason` `refusal`/`max_tokens` → análise `FAILED` com mensagem legível, sem quebrar o painel (Task 4/6).

---

### Task 1: Configuração e dependência

**Files:**
- Modify: `package.json` (dependência `@anthropic-ai/sdk`), `src/config/env.ts`, `.env.example`, `SETUP.md`
- Test: `tests/unit/edital-config.test.ts`

**Interfaces:**
- Produces: `AppEnv.anthropicApiKey: string`, `AppEnv.editalAnalysisOrganizationIds: number[]`, `AppEnv.editalAnalysisMonthlyLimit: number`, `AppEnv.editalAnalysisModel: string`.

- [ ] **Step 1: Teste** `loadEnv({ EDITAL_ANALYSIS_ORGANIZATION_IDS: '3, 7,x', ANTHROPIC_API_KEY: 'k' })` → `editalAnalysisOrganizationIds` `[3, 7]`, `editalAnalysisMonthlyLimit` `30`, `editalAnalysisModel` `'claude-opus-5-5'`, `anthropicApiKey` `'k'`; `loadEnv({})` → `[]` e `''`. Teste extra: `.env.example` contém `ANTHROPIC_API_KEY=` e `EDITAL_ANALYSIS_ORGANIZATION_IDS=`.
- [ ] **Step 2: Rodar** `npx vitest run tests/unit/edital-config.test.ts` → FAIL.
- [ ] **Step 3: Implementar** os quatro campos no schema zod e no `loadEnv` (IDs: split por vírgula, `Number`, filtra inteiros positivos). `npm install @anthropic-ai/sdk`. Documentar no `SETUP.md`: as variáveis, custo aproximado e que o perfil da empresa é enviado à API da Anthropic.
- [ ] **Step 4: Rodar** o teste → PASS; suíte inteira → PASS.

### Task 2: Perfil técnico (domínio, migração, repositório, API)

**Files:**
- Create: `src/domain/companyProfile.ts`, `migrations/032_company_profiles_and_edital_analyses.sql`, `src/repositories/companyProfileRepository.ts`, `server/api/company-profile.get.ts`, `server/api/company-profile.put.ts`
- Modify: `src/db/database.ts` (registrar `032_company_profiles_and_edital_analyses`)
- Test: `tests/unit/company-profile.test.ts`

**Interfaces:**
- Produces:
  - `companyProfileSchema` (zod) e `type CompanyProfile = { registrations: Registration[]; technicians: Technician[]; attestations: Attestation[]; financial: Financial }`
    - `Registration { council: 'CREA' | 'CAU'; number: string; state: string; validUntil: string | null }`
    - `Technician { id: string; name: string; title: string; registrationNumber: string }`
    - `Attestation { id: string; service: string; quantity: number; unit: string; contractor: string; catNumber: string | null; technicianId: string | null; issuedAt: string | null }`
    - `Financial { netWorthCents: number | null; shareCapitalCents: number | null; liquidityGeneral: number | null; solvencyGeneral: number | null; liquidityCurrent: number | null; balanceSheetDate: string | null }`
  - `emptyCompanyProfile(): CompanyProfile`
  - `profileHash(profile: CompanyProfile): string` (sha256 do JSON com chaves ordenadas)
  - `class CompanyProfileRepository { find(orgId): CompanyProfile; save(orgId, profile): CompanyProfile }` (`find` devolve `emptyCompanyProfile()` se não houver linha)
  - `handleCompanyProfilePut({ db, organizationId, body }): CompanyProfile` — valida com zod (400 "Perfil inválido"), gera `id` UUID (`crypto.randomUUID()`) para atestados/técnicos sem `id`, preserva os existentes.
- Migração cria `company_profiles(organization_id PK, profile_json, updated_at)` e `edital_analyses(id PK, organization_id, opportunity_id, status, profile_hash, documents_json, partial INTEGER, model, input_tokens, output_tokens, cost_usd_micros, extraction_json, error, created_at, updated_at)` com índice `(organization_id, opportunity_id, created_at)`.
- Ambos os endpoints usam `requireActiveBilling(event, 'catalog')`.

- [ ] **Step 1: Testes:** migração aplicada em `createTestDatabase()` (tabelas existem); `find` sem linha = perfil vazio; `save`+`find` ida e volta; `profileHash` igual para objetos com chaves em ordem diferente e diferente quando muda uma quantidade; `handleCompanyProfilePut` gera `id` para atestado novo, mantém `id` informado, rejeita `quantity: -1` com 400.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** os arquivos acima.
- [ ] **Step 4: Rodar** → PASS; suíte inteira → PASS (inclui `migration-upgrade`).

### Task 3: Documentos do PNCP

**Files:**
- Create: `src/services/edital/pncpDocuments.ts`
- Test: `tests/unit/edital-pncp-documents.test.ts`

**Interfaces:**
- Produces:
  - `parsePncpId(pncpId: string): { cnpj: string; year: number; sequential: number } | null` — formato `{cnpj14}-{d}-{sequencial}/{ano}`; sequencial sem zeros à esquerda.
  - `type PncpFile = { sequential: number; typeName: string; title: string; url: string }`
  - `type SelectedDocument = PncpFile & { kind: 'EDITAL' | 'TERMO_REFERENCIA'; supported: boolean }`
  - `selectDocuments(files: PncpFile[]): { selected: SelectedDocument[]; superseded: PncpFile[] }` — `kind` EDITAL quando `typeName` contém "Edital"; TERMO_REFERENCIA quando contém "Termo de Referência" ou "Projeto Básico"; por `kind` fica o de maior `sequential`, demais vão para `superseded`; `supported` = título termina em `.pdf` (case-insensitive) ou sem extensão.
  - `class PncpDocumentClient { constructor(fetchImpl = fetch, baseUrl = 'https://pncp.gov.br/api/pncp/v1'); list(pncpId): Promise<PncpFile[]>; download(url): Promise<Buffer> }` — `download` confere assinatura `%PDF`; senão lança `UnsupportedDocumentError`.
  - `fitToBudget(docs: Array<SelectedDocument & { bytes: number }>, maxBytes = 24 * 1024 * 1024): { included: typeof docs; partial: boolean }` — EDITAL primeiro; se só o EDITAL não cabe, lança `DocumentTooLargeError`.

- [ ] **Step 1: Testes:** `parsePncpId('10882594000165-1-000640/2026')` → `{ cnpj: '10882594000165', year: 2026, sequential: 640 }`; formato inválido → `null`. `selectDocuments` com dois "Edital" (seq 1 e 4) → seleciona 4, 1 em `superseded`; ignora "Minuta do Contrato" e "Estudo Técnico Preliminar"; `edital.zip` → `supported: false`. `PncpDocumentClient.list` com `fetch` falso monta a URL `.../orgaos/10882594000165/compras/2026/640/arquivos` e mapeia `tipoDocumentoNome`/`titulo`/`url`/`sequencialDocumento`. `download` de bytes `PK..` lança `UnsupportedDocumentError`. `fitToBudget` com EDITAL 20 MB + TR 10 MB → só EDITAL, `partial: true`; EDITAL 30 MB → `DocumentTooLargeError`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.

### Task 4: Contrato de extração e extrator Claude

**Files:**
- Create: `src/services/edital/extraction.ts`, `src/services/edital/claudeExtractor.ts`
- Test: `tests/unit/edital-extraction.test.ts`

**Interfaces:**
- Produces:
  - `editalExtractionSchema` (zod) e `type EditalExtraction`:
    - `summary { object: string; estimatedValueCents: number | null; openingAt: string | null; modality: string | null; executionRegime: string | null; judgmentCriterion: string | null; allowsConsortium: boolean | null; lots: Array<{ id: string; object: string; estimatedValueCents: number | null }> }`
    - `requirements: Array<{ id: string; lot: string | null; category: RequirementCategory; description: string; page: number | null; excerpt: string; mandatory: boolean; alternativeGroup: string | null; conditional: boolean; minQuantity: number | null; unit: string | null; allowsSum: boolean | null; percentOfEstimate: number | null; amountCents: number | null; ratioName: 'LG' | 'SG' | 'LC' | null; minRatio: number | null; council: 'CREA' | 'CAU' | null; deadline: string | null }>`
    - `matches: Array<{ requirementId: string; attestationId: string; confidence: 'high' | 'medium' | 'low'; reason: string }>`
    - `RequirementCategory = 'professional_registration' | 'technical_capacity_company' | 'technical_capacity_professional' | 'net_worth' | 'share_capital' | 'financial_ratios' | 'bid_guarantee' | 'technical_visit' | 'other_elimination'`
  - `editalExtractionJsonSchema` — JSON Schema equivalente (todos os campos `required`, `additionalProperties: false`) para `output_config.format`.
  - `interface EditalExtractor { extract(input: { documents: Array<{ kind: string; title: string; data: Buffer }>; profile: CompanyProfile }): Promise<{ extraction: EditalExtraction; model: string; inputTokens: number; outputTokens: number }> }`
  - `class ExtractionFailedError extends Error` (mensagem em PT-BR para a tela).
  - `class ClaudeEditalExtractor implements EditalExtractor { constructor(input: { client: Anthropic; model: string }) }` — `client.beta.messages.stream(...)` com os parâmetros dos Global Constraints, `max_tokens: 64000`; conteúdo do usuário: um bloco `document` base64 por PDF (com `title`), depois o perfil em JSON e as instruções. Prompt (texto livre do construtor) deve pedir: só exigências de habilitação/participação; página e trecho literal; `alternativeGroup` para exigências alternativas; `conditional: true` quando não conseguir modelar a condição; matches apenas de equivalência de serviço, nunca juízo de quantidade.
  - `estimateCostUsdMicros(model, inputTokens, outputTokens): number` — Opus 5.5: US$ 4 / US$ 20 por 1M tokens.

- [ ] **Step 1: Testes:** schema aceita um exemplo completo e rejeita `category: 'foo'`. Com cliente falso que captura o request: um bloco `document` por PDF com `media_type: 'application/pdf'` antes do texto, `model`, `thinking`, `output_config.effort: 'high'`, `output_config.format` presente, `fallbacks: 'default'`. Resposta com `stop_reason: 'refusal'` → `ExtractionFailedError`; `stop_reason: 'max_tokens'` → `ExtractionFailedError`; texto que não valida no schema → `ExtractionFailedError`. `estimateCostUsdMicros('claude-opus-5-5', 1_000_000, 100_000)` → `6_000_000`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** (ler `typescript/claude-api/README.md` e `streaming.md` da skill `claude-api` para a forma exata do SDK; não adivinhar nomes).
- [ ] **Step 4: Rodar** → PASS.

### Task 5: Comparação determinística

**Files:**
- Create: `src/services/edital/compareRequirements.ts`, `src/services/edital/units.ts`
- Test: `tests/unit/edital-compare.test.ts`

**Interfaces:**
- Consumes: `EditalExtraction` (Task 4), `CompanyProfile` (Task 2).
- Produces:
  - `normalizeUnit(unit: string): string | null` — `m², m2, metro quadrado, metros quadrados → 'm2'`; idem `m3`, `m`, `km`, `t`/`ton`, `un`/`unidade`; desconhecida → `null`.
  - `type CheckStatus = 'ok' | 'fail' | 'check'`
  - `type RequirementCheck = { requirementId: string; category; description; status: CheckStatus; informative: boolean; required: string; companyValue: string | null; note: string; page: number | null; excerpt: string; deadline: string | null }`
  - `type LotVerdict = { lotId: string | null; verdict: 'APT' | 'NOT_APT' | 'CHECK'; failCount: number; checkCount: number; checks: RequirementCheck[] }`
  - `compareRequirements(input: { extraction: EditalExtraction; profile: CompanyProfile; opportunityEstimatedValueCents: number; now: Date }): LotVerdict[]` — um item por lote (`[{ lotId: null }]` se não houver lotes); exigências com `lot: null` entram em todos.
- Regras (spec "Comparação" + "Decisões após a revisão"): registro; atestados com `confidence` ≥ medium, soma se `allowsSum`, senão maior, unidade só se `normalizeUnit` igual; perfil sem nenhum atestado → `fail`; com atestados mas sem match → `check`; PL/capital com valor exigido de `amountCents` ou `percentOfEstimate × estimado` (estimado do lote, senão da oportunidade se > 0, senão do `summary` e então no máximo `check`); índices por `ratioName`, balanço com mais de 16 meses → `check`; `technical_visit`/`bid_guarantee` → `check` com `informative: true`; `other_elimination` e `conditional` → `check`; grupos `alternativeGroup` combinados antes do veredito (algum `ok` → `ok`; todos `fail` → `fail`; senão `check`). Veredito: algum `fail` em exigência obrigatória → `NOT_APT`; senão algum `check` não informativo → `CHECK`; senão `APT`.

- [ ] **Step 1: Testes** (um `it` por linha):
  - CREA válido até data futura → `ok`; vencido → `check`; sem registro e exigência CREA → `fail`.
  - Exige 1.500 m², atestados de 800 m2 e 900 metros quadrados com `allowsSum: true` → `ok`; `allowsSum: false` → `fail`.
  - Match `low` ignorado → `check` "a IA não encontrou atestado equivalente".
  - Perfil sem atestados → `fail` com nota "nenhum atestado cadastrado".
  - Unidade diferente (m² vs m³) → `check`.
  - PL 10% de R$ 1.000.000 com PL R$ 120.000 → `ok`; R$ 90.000 → `fail`; estimado da oportunidade 0 e do summary R$ 1.000.000 → `check`.
  - LG mínimo 1 com LG 0,9 → `fail`; mesmo caso em `alternativeGroup` com PL suficiente → grupo `ok` e veredito `APT`.
  - Visita técnica com prazo → `check` informativo; veredito continua `APT`.
  - Dois lotes com mínimos 500 e 3.000 m² e atestado de 1.000 m² → lote A `APT`, lote B `NOT_APT`.
  - Exigência `conditional: true` → `check` e veredito `CHECK`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.

### Task 6: Repositório e serviço de análise

**Files:**
- Create: `src/repositories/editalAnalysisRepository.ts`, `src/services/edital/editalAnalysisService.ts`
- Test: `tests/unit/edital-analysis-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `OpportunityRepository.findById(id)` (`pncpId`, `estimatedValueCents`).
- Produces:
  - `type EditalAnalysisRecord = { id; organizationId; opportunityId; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; profileHash; documents: Array<{ kind; title; url; included: boolean; reason: string | null }>; partial: boolean; model: string | null; inputTokens; outputTokens; costUsdMicros; extraction: EditalExtraction | null; error: string | null; createdAt; updatedAt }`
  - `EditalAnalysisRepository`: `createRunning(orgId, oppId, profileHash): EditalAnalysisRecord`, `complete(id, data)`, `fail(id, message, documents?)`, `latest(orgId, oppId): EditalAnalysisRecord | undefined` (aplica regra dos 15 min → `FAILED` "Análise interrompida"), `countThisMonth(orgId, now): number` (conta todas as análises criadas no mês UTC).
  - `type EditalAnalysisView = { enabled: boolean; disabledReason: string | null; analysis: EditalAnalysisRecord | null; lots: LotVerdict[]; profileChanged: boolean; profileEmpty: boolean }`
  - `class EditalAnalysisService { constructor(deps: { db; env: AppEnv; extractor: EditalExtractor | null; documents: PncpDocumentClient; now?: () => Date }); availability(orgId): { enabled: boolean; reason: string | null }; start(orgId, oppId): EditalAnalysisRecord; run(recordId): Promise<void>; view(orgId, oppId): EditalAnalysisView }`
- Regras de `start`: fora da allowlist → 403 "Análise de edital não liberada para sua empresa"; `extractor` nulo (sem chave) → 503 "Configure ANTHROPIC_API_KEY para analisar editais"; oportunidade inexistente → 404; já existe `RUNNING` → devolve a existente sem criar; `countThisMonth ≥ limite` → 429 "Limite mensal de análises atingido"; cria `RUNNING` e agenda `run` com `setImmediate` (erros capturados e gravados com `fail`). Erros como `createError` do h3.
- `run`: `parsePncpId` nulo → `fail('Edital não disponível no PNCP')`; lista → seleciona → nenhum suportado → `fail('Edital em formato não suportado (ZIP/DOCX) — abra pelo link')`; baixa os suportados → `fitToBudget` → extrai → `complete` com custo.
- `view`: recalcula `compareRequirements` com perfil atual; `profileChanged = profileHash(atual) !== analysis.profileHash`.

- [ ] **Step 1: Testes** (extrator e `fetch` falsos, `createTestDatabase()`): fluxo feliz grava `COMPLETED`, tokens, custo e `view` devolve lotes; fora da allowlist → 403; sem extrator → 503; segunda chamada com `RUNNING` existente devolve o mesmo `id` e o extrator é chamado uma vez; 30 análises no mês → 429; só ZIP → `FAILED` com a mensagem de formato e extrator não chamado; `RUNNING` com `updated_at` de 16 min atrás → `latest` devolve `FAILED`; extrator lançando `ExtractionFailedError` → `FAILED` com a mensagem dele; mudar o perfil depois → `profileChanged: true`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.

### Task 7: Endpoints

**Files:**
- Create: `server/api/opportunities/[id]/edital-analysis.get.ts`, `server/api/opportunities/[id]/edital-analysis.post.ts`
- Modify: `server/utils/app.ts` (`getEditalAnalysisService()` singleton: `ClaudeEditalExtractor` com `new Anthropic({ apiKey })` só se `anthropicApiKey` não vazio)
- Test: `tests/unit/edital-analysis-api.test.ts`

**Interfaces:**
- Consumes: `EditalAnalysisService` (Task 6).
- Produces: `handleEditalAnalysisGet({ service, organizationId, opportunityId }): EditalAnalysisView` e `handleEditalAnalysisPost(...)`: `EditalAnalysisView` (após `start`). Ambos com `requireActiveBilling(event, 'catalog')`; `id` não inteiro → 400.

- [ ] **Step 1: Testes:** GET sem análise → `analysis: null` e `enabled` conforme allowlist; POST inicia e GET seguinte mostra `RUNNING`; id `abc` → 400; organização de outra empresa não enxerga análise alheia (isolamento por `organizationId`).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.

### Task 8: Telas (Perfil técnico e Análise do edital)

**Files:**
- Create: `app/pages/perfil.vue`, `app/components/EditalAnalysisPanel.vue`
- Modify: `app/components/AppNavDrawer.vue` (link "Perfil técnico" em Conta, `to="/perfil"`), `app/components/AppShell.vue` (tipo `active` aceita `'profile'`), `app/components/OpportunityDetails.vue` (inclui `<EditalAnalysisPanel :opportunity-id="item.id" :source-url="item.sourceUrl" />`), `app/types.ts` (tipos de view espelhando Task 6), `app/assets/css/main.css`
- Test: `tests/unit/edital-ui-contract.test.ts`

**Interfaces:**
- Consumes: `GET/PUT /api/company-profile`, `GET/POST /api/opportunities/:id/edital-analysis`, `POST /api/agenda` (`type: 'MEETING'`, `title: 'Visita técnica'`, `dueAt` = `deadline`).
- Textos fixos: título da página "Perfil técnico"; botão "Analisar edital"; carregando "Lendo o edital… (pode levar até 3 minutos)"; vereditos "Apto", "Não apto", "Verificar"; aviso "Seu perfil mudou desde esta análise" + botão "Refazer"; aviso de perfil vazio com link "Preencher perfil técnico"; parcial "Análise parcial: só o edital foi lido"; botão de visita "Adicionar à agenda".
- Painel: GET ao abrir; se `RUNNING`, refaz GET a cada 5 s até mudar; seletor de lote quando `lots.length > 1`; itens `fail` → `check` → `ok`, cada um com exigido vs. empresa, nota, "pág. N" e trecho expansível (`<details>`); botão desabilitado com `disabledReason` quando `enabled: false`.
- Perfil: listas editáveis de registros, responsáveis e atestados (adicionar/remover linha), campos financeiros; valores em reais na tela convertidos para centavos no PUT.

- [ ] **Step 1: Teste de contrato** (padrão dos `*-ui-contract.test.ts`): `perfil.vue` contém "Perfil técnico" e `'/api/company-profile'`; `EditalAnalysisPanel.vue` contém "Analisar edital", "Lendo o edital", "Seu perfil mudou desde esta análise", "Adicionar à agenda"; `OpportunityDetails.vue` contém `<EditalAnalysisPanel`; `AppNavDrawer.vue` contém `to="/perfil"`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Verificação visual** na prévia local (`DATABASE_URL=./data/preview-redesign.db npx nuxt dev --port 3005`) com extrator real desligado: perfil salva e recarrega; painel mostra botão desabilitado sem chave; claro/escuro e celular sem quebra.

### Task 9: E2E real opcional

**Files:**
- Create: `scripts/e2e-edital.ts`; Modify: `package.json` (`"e2e:edital": "tsx scripts/e2e-edital.ts"`)

- [ ] **Step 1: Implementar** script que recebe `pncp_id` e um JSON de perfil opcional, roda documentos → extrator real → comparação em banco temporário e imprime veredito, tokens e custo em US$. Recusa rodar sem `ANTHROPIC_API_KEY`.
- [ ] **Step 2: Rodar somente com autorização explícita do dono** (gasta dinheiro): `npm run e2e:edital -- 10882594000165-1-000640/2026` → imprime veredito e custo.
