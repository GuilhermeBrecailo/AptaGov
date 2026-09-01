# SaaS Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir o Radar de Licitações de um MVP local para um núcleo SaaS vendável, mantendo o painel e o worker no mesmo repositório e preservando o fluxo PNCP já validado.

**Architecture:** A organização continua sendo o limite de isolamento. Uma conta de cobrança por organização controla período de teste, status e acesso; a integração com o gateway fica atrás de uma interface e do adaptador Mercado Pago, sem salvar credenciais no banco. Limites operacionais continuam no `.env`, enquanto filtros e pesos de aderência permanecem em `config/filters.json` e passam a ser editáveis pelo painel.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript strict, h3, SQLite/better-sqlite3, Vitest, web-push e fetch nativo para o gateway.

**Spec:** Requisitos e critérios de aceite enviados na conversa; estado atual documentado em `README.md` e `SETUP.md`.

## Global Constraints

- Frontend 100% PT-BR; código, tabelas e estados internos em inglês.
- Não reintroduzir IA ou Telegram; e-mail e web push são os canais adotados.
- Não salvar `.env`, chaves, bancos, filtros reais ou backups no Git.
- Preservar idempotência, recuperação após reinício, pausa automática e isolamento por organização.
- Não fazer commit sem pedido explícito do usuário.
- Provedores externos podem permanecer bloqueados por credenciais ausentes, mas o bloqueio deve ser explícito e testado.

---

### Task 1: Modelo de cobrança e entitlements

**Files:**
- Create: `migrations/005_billing.sql`
- Create: `src/repositories/billingRepository.ts`
- Create: `src/services/billingService.ts`
- Modify: `src/db/database.ts`
- Modify: `src/auth/service.ts`
- Test: `tests/unit/billing.test.ts`

**Interfaces:**
- Produces `BillingService.account(organizationId)`, `BillingService.ensureTrial(organizationId)`, `BillingService.canUse(organizationId, feature)` and `BillingService.activateFromWebhook(...)`.
- Produces a unique provider-event record so webhook retries are safe.

- [ ] Write failing tests for trial creation, expired access, idempotent webhook and organization isolation.
- [ ] Run the focused billing test and confirm it fails because the model does not exist.
- [ ] Add the migration and repository with a single organization billing account and unique provider event id.
- [ ] Implement trial defaults from `.env` and provider status transitions without deleting existing organizations.
- [ ] Run the focused billing test, then the full unit suite.

### Task 2: Checkout e webhook preparados para provedor

**Files:**
- Create: `src/integrations/billing/MercadoPagoBillingProvider.ts`
- Create: `src/integrations/billing/types.ts`
- Create: `server/api/billing.get.ts`
- Create: `server/api/billing/checkout.post.ts`
- Create: `server/api/billing/webhook.post.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/billing-provider.test.ts`

**Interfaces:**
- `BillingProvider.createSubscription(input)` returns a checkout URL and provider identifiers.
- Checkout requires authenticated organization owner and returns a precise `503` when gateway credentials are absent.
- Webhook is idempotent and never exposes an access token in logs or responses.

- [ ] Write failing tests for missing-credential blocking, checkout payload and duplicate webhook delivery.
- [ ] Run focused tests and confirm the provider adapter/API are missing.
- [ ] Implement the adapter with native fetch, typed input and structured safe errors.
- [ ] Implement authenticated billing API and webhook event validation.
- [ ] Run provider tests and lint/type check.

### Task 3: Painel de assinatura e limites

**Files:**
- Modify: `app/pages/index.vue`
- Modify: `app/assets/css/main.css`
- Modify: `server/api/status.get.ts`
- Modify: `README.md`
- Modify: `SETUP.md`
- Test: `tests/unit/ui-contract.test.ts`

- [ ] Add a PT-BR subscription card with trial/status, checkout action and blocked-state explanation.
- [ ] Expose only safe billing status to the frontend.
- [ ] Add tests for visible subscription states and owner-only checkout.
- [ ] Run the UI contract and browser smoke check.

### Task 4: Score ajustável pelo usuário

**Files:**
- Modify: `app/pages/index.vue`
- Modify: `app/assets/css/main.css`
- Test: `tests/unit/ui-contract.test.ts`

- [ ] Add four numeric controls for score weights with the existing filters form.
- [ ] Keep the current server-side schema as the source of truth and preserve the rule that weights are non-negative.
- [ ] Add a focused contract assertion and verify save/refresh behavior.

### Task 5: Limite global de notificações por hora

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `src/repositories/notificationRepository.ts`
- Modify: `src/repositories/pushNotificationRepository.ts`
- Modify: `src/services/notificationService.ts`
- Modify: `src/services/pushNotificationService.ts`
- Modify: `src/workerRuntime.ts`
- Test: `tests/unit/notification-budget.test.ts`

- [ ] Write failing tests proving the configured hourly cap stops new email and push queue entries.
- [ ] Add `MAX_NOTIFICATIONS_PER_HOUR` with a safe default and count only delivery records created in the rolling hour.
- [ ] Apply the cap before enqueueing, preserving delivery idempotency and retry of already-created records.
- [ ] Run focused and full notification tests.

### Task 6: Verificação e operação

**Files:**
- Modify: `SETUP.md`
- Modify: `README.md`
- Test: existing suite plus real E2E.

- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run e2e:real`.
- [ ] Validate authenticated UI, PWA button and safe external-credential errors.
- [ ] Report only remaining external blockers: provider credentials, domain/HTTPS and production deployment choices.
