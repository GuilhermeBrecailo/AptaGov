# Prazos do edital na Agenda + "Abrir na plataforma" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lembretes automáticos de impugnação e esclarecimentos (estimados pela Lei 14.133 ou lidos do edital) e botão que nomeia a plataforma de disputa.

**Architecture:** Cálculo puro de dias úteis em `src/domain/legalDeadlines.ts`; `AgendaService.scheduleOfficialReminders` ganha dois tipos novos; a análise de edital extrai as datas reais e chama `AgendaService.applyEditalDeadlines`; UI usa `platformFor(url)`.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript strict, better-sqlite3, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-prazos-agenda-design.md`

## Global Constraints
- Prazo = 3 dias úteis antes da abertura (base `sessionOpening ?? biddingDeadline`), 23:59 horário de Brasília (UTC-3, sem horário de verão) do dia calculado, gravado em ISO UTC.
- Dias úteis pulam sábado, domingo e feriados nacionais: 1/1, Sexta-feira Santa (Páscoa − 2), 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11, 25/12.
- Nota estimada (texto exato): `Estimado pela Lei 14.133 (3 dias úteis antes da abertura) — confira no edital.`
- Nota do edital (texto exato): `Conforme edital, pág. {page}` (sem página: `Conforme edital`).
- Títulos exatos: `Prazo de impugnação`, `Prazo de esclarecimentos`.
- Nunca sobrescrever lembrete que o usuário editou (dueAt diferente do último valor automático).
- Link de plataforma só se `safeHttpsUrl(url)` (app/utils, já existe) retornar valor.
- Não commitar sem pedido explícito do dono (CLAUDE.md global); trabalhar na branch `feature/prazos-agenda`.

## Review Focus
- Abertura numa segunda após feriado (ex.: 2026-11-16 após 15/11 domingo, e 2026-04-06 após Páscoa) → contagem pula corretamente (teste em T1).
- Abertura sem horário / data inválida / null → nenhum lembrete legal criado (teste em T2).
- Abertura alterada pelo órgão → lembretes legais não editados acompanham; editados ficam (teste em T2).
- Edital extraiu data posterior à abertura ou inválida → ignorar e manter estimativa (teste em T3).
- URL `javascript:` ou `http:` no source_url → sem link, só texto (teste em T4).

---

### Task 1: Cálculo de prazos legais

**Files:**
- Create: `src/domain/legalDeadlines.ts`
- Test: `tests/unit/legal-deadlines.test.ts`

**Interfaces:**
- Produces: `isBrazilianNationalHoliday(dateYmd: string): boolean`; `businessDaysBefore(openingIso: string, days: number): string | null` (retorna ISO UTC das 23:59 BRT do dia útil resultante; null se data inválida); `LEGAL_DEADLINE_NOTE` (const com o texto exato).

- [ ] Step 1: testes — `businessDaysBefore('2026-12-10T12:00:00.000Z', 3)` → `'2026-12-08T02:59:00.000Z'` (dia 07/12 23:59 BRT); abertura `2026-11-16T13:00:00Z` → conta 13/11 (sex), 12/11, 11/11 → `'2026-11-12T02:59:00.000Z'`; abertura `2026-04-06T13:00:00Z` (segunda após Páscoa 05/04; 03/04 Sexta Santa) → 02/04, 01/04, 31/03 → `'2026-04-01T02:59:00.000Z'`; abertura `2026-09-08T13:00:00Z` → pula 07/09; data `'abc'` → null; abertura às 01:00Z (22:00 BRT do dia anterior) usa o dia em BRT.
- [ ] Step 2: rodar `npx vitest run tests/unit/legal-deadlines.test.ts` → FAIL.
- [ ] Step 3: implementar (Páscoa pelo algoritmo de Meeus; dias contados no calendário BRT).
- [ ] Step 4: rodar de novo → PASS.

### Task 2: Lembretes automáticos de impugnação e esclarecimentos

**Files:**
- Create: `migrations/033_legal_deadline_reminders.sql` (recria `opportunity_reminders` com CHECK incluindo `'CHALLENGE_DEADLINE','CLARIFICATION_DEADLINE'`, copiando dados e índices de 015; `ALTER TABLE organization_alert_preferences ADD COLUMN challenge_deadline_enabled INTEGER NOT NULL DEFAULT 1 CHECK (...IN (0,1))` e `clarification_deadline_enabled` igual)
- Modify: `src/db/database.ts:31` (registrar `033_legal_deadline_reminders`), `src/domain/operationalTypes.ts` (ReminderType + preferências `challengeDeadline`, `clarificationDeadline`), `src/repositories/organizationAlertPreferenceRepository.ts`, `src/services/agendaService.ts` (specs + `REMINDER_TYPES`), `server/api/agenda-preferences.put.ts` (aceitar os dois booleans)
- Test: `tests/unit/agenda-legal-deadlines.test.ts`

**Interfaces:**
- Consumes: `businessDaysBefore`, `LEGAL_DEADLINE_NOTE` (T1).
- Produces: `ReminderType` com `'CHALLENGE_DEADLINE' | 'CLARIFICATION_DEADLINE'`; `OrganizationAlertPreferences.challengeDeadline/clarificationDeadline: boolean`.

- [ ] Step 1: testes — snapshot com `sessionOpening` cria 2 lembretes (títulos e nota exatos, createdByUserId null, dueAt de T1); sem sessionOpening usa biddingDeadline; ambos null → nenhum; preferência desligada → não cria; órgão muda a abertura → lembretes não editados movem; lembrete com dueAt editado pelo usuário não muda; migração aplica sobre banco com lembretes antigos sem perder linhas.
- [ ] Step 2: rodar → FAIL.
- [ ] Step 3: implementar. Regra de atualização: recalcular a estimativa da abertura anterior (`previous`); só se `reminder.dueAt` for igual a ela, mover para a nova estimativa. Lembrete com data do edital (T3) ou editado pelo usuário não se move.
- [ ] Step 4: `npx vitest run tests/unit/agenda-legal-deadlines.test.ts` e a suíte de agenda existente → PASS.

### Task 3: Datas do edital substituem a estimativa

**Files:**
- Modify: `src/services/edital/extraction.ts` (zod + JSON schema: `summary.challengeDeadline` e `summary.clarificationDeadline`, cada um `{ at: string ISO, page: number | null } | null`), `src/services/edital/claudeExtractor.ts` (uma linha no prompt: extrair prazos de impugnação e de pedido de esclarecimentos com página; null se o edital não fixar), `src/services/agendaService.ts`, `src/services/edital/editalAnalysisService.ts` (após `complete`, chamar a Agenda; erro na Agenda não pode falhar a análise)
- Test: `tests/unit/agenda-edital-deadlines.test.ts` + atualizar fixtures de extração existentes (campos novos null)

**Interfaces:**
- Consumes: tipos de T2.
- Produces: `AgendaService.applyEditalDeadlines(organizationId: number, opportunityId: number, deadlines: { challenge: { at: string; page: number | null } | null; clarification: { at: string; page: number | null } | null }): void`.

- [ ] Step 1: testes — data do edital válida substitui lembrete legal não editado (dueAt e nota `Conforme edital, pág. 7`); lembrete editado pelo usuário fica; data inválida ou posterior à abertura é ignorada; extração antiga sem os campos continua válida (campos opcionais → tratados como null); run() concluído chama applyEditalDeadlines com as datas.
- [ ] Step 2: rodar → FAIL.
- [ ] Step 3: implementar.
- [ ] Step 4: rodar testes de edital e agenda → PASS.

### Task 4: Botão com nome da plataforma e UI dos tipos novos

**Files:**
- Create: `app/utils/platform.ts`
- Modify: `app/components/AgendaView.vue` (rótulos dos tipos novos nos dois mapas de label ~166-181; toggles "Prazos de impugnação" e "Prazos de esclarecimentos" ao lado de 281-282; botão em ~342; mostrar `note` do lembrete), `app/components/OpportunityDetails.vue:89`, `app/types.ts` se tiver o union de tipos
- Test: `tests/unit/platform.test.ts`, atualizar contrato de UI existente se ele fixar o texto "fonte oficial"

**Interfaces:**
- Produces: `platformFor(url: string | null | undefined): { label: string; href: string | null }` — label completo do botão (`Abrir na BLL ↗`, `Abrir na BNC ↗`, `Abrir no Compras.gov ↗`, `Abrir no Licitações-e ↗`, `Abrir no Portal de Compras Públicas ↗`, `Abrir na Licitar Digital ↗`, `Abrir na Licita Mais Brasil ↗`, `Abrir na Licitanet ↗`, `Abrir na ComprasBR ↗`, `Abrir no PNCP ↗`, outros `Abrir no site do órgão ↗`); `href` = `safeHttpsUrl(url)`.

- [ ] Step 1: testes — `https://bllcompras.com/Process/ProcessView?x` → BLL; `https://bnccompras.com/...` → BNC; `https://cnetmobile.estaleiro.serpro.gov.br/...` → Compras.gov; `https://licitacoes-e2.bb.com.br/...` → Licitações-e; `https://pncp.gov.br/app/editais/...` → PNCP; `https://compras.barueri.sp.gov.br` → site do órgão; `javascript:alert(1)` e `http://bllcompras.com` → href null; null → `{ label: 'Fonte oficial indisponível', href: null }`.
- [ ] Step 2: rodar → FAIL.
- [ ] Step 3: implementar util e trocar os dois botões (sem href → texto sem link).
- [ ] Step 4: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` → todos ok; conferir na prévia (Agenda e detalhe) em claro e escuro.
</content>
</invoke>
