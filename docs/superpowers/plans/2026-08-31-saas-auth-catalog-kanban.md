# SaaS Auth Catalog Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the local single-user panel into a sellable SaaS MVP with user authentication, isolated company workspaces, searchable opportunities and a selected-opportunity kanban.

**Architecture:** Keep the PNCP synchronization global, then scope customer-facing data through `organizations`, memberships, sessions and organization-owned kanban rows. Use SQLite for the current local MVP, Node `crypto.scrypt` for password hashes, opaque hashed session tokens in HttpOnly cookies, and server-side authorization on every customer API.

**Tech Stack:** Node.js 22+, TypeScript strict, Nuxt 4, Vue 3, SQLite via better-sqlite3, Zod, Pino, Vitest and ESLint.

**Spec:** `docs/superpowers/specs/2026-08-31-licitacoes-pncp-design.md`

## Global Constraints

- Frontend 100% PT-BR; code, tables and persisted states in English.
- Every customer query must be scoped by the authenticated organization.
- Passwords are never stored or logged in plain text; session tokens are stored only as hashes.
- The PNCP source table remains globally deduplicated by `pncp_id`.
- `npm run dev` remains the single command that starts panel and worker.
- The catalog must support server-side text search, score filtering and pagination without dropping the final page.
- Kanban state belongs to the organization, not to the global PNCP opportunity.
- `.env`, `config/filters.json`, `*.db`, `data/` and `backups/` stay out of Git.
- Do not make a Git commit; the user will commit later.

### Task 1: Authentication and tenancy contracts

**Files:**
- Create: `src/auth/password.ts`, `src/auth/session.ts`, `src/auth/types.ts`
- Create: `src/repositories/userRepository.ts`, `src/repositories/organizationRepository.ts`, `src/repositories/sessionRepository.ts`
- Test: `tests/unit/auth.test.ts`, `tests/unit/tenancy.test.ts`

- [ ] Write failing tests for password hash/verify, session expiration and organization membership isolation.
- [ ] Run the focused tests and confirm they fail because the auth modules do not exist.
- [ ] Implement password hashing with `crypto.scrypt`, random salts and timing-safe verification.
- [ ] Implement opaque session creation, hashed token lookup, expiration and revocation.
- [ ] Implement organization creation and membership lookup.
- [ ] Run the focused tests and the full test suite.

### Task 2: Database migration and organization-owned kanban

**Files:**
- Modify: `migrations/001_initial.sql`
- Create: `migrations/002_saas_auth_and_kanban.sql`
- Modify: `src/db/migrate.ts`, `src/domain/types.ts`
- Create: `src/repositories/kanbanRepository.ts`
- Test: `tests/unit/saas-migration.test.ts`, `tests/unit/kanban-isolation.test.ts`

- [ ] Write failing tests for migration-created users, organizations, memberships, sessions and organization kanban rows.
- [ ] Add an idempotent migration with `users`, `organizations`, `organization_memberships`, `sessions` and `organization_opportunities` tables plus unique constraints.
- [ ] Implement organization-scoped selection, listing and state updates.
- [ ] Verify one organization cannot read or mutate another organization’s kanban rows.

### Task 3: Authenticated server API

**Files:**
- Create: `server/utils/auth.ts`
- Create: `server/api/auth/signup.post.ts`, `server/api/auth/login.post.ts`, `server/api/auth/logout.post.ts`, `server/api/auth/me.get.ts`
- Modify: `server/utils/app.ts`
- Test: `tests/unit/auth-api.test.ts`

- [ ] Write failing tests for signup, duplicate email, login failure, authenticated session and logout.
- [ ] Implement HttpOnly cookie authentication with secure production flags and same-site protection.
- [ ] Create the first organization during signup and make the user its owner.
- [ ] Require the session on all customer-facing opportunity, filter and kanban endpoints.

### Task 4: Catalog, filters and kanban API

**Files:**
- Modify: `src/repositories/opportunityRepository.ts`
- Modify: `server/api/opportunities.get.ts`, `server/api/opportunities/[id]/state.patch.ts`
- Create: `server/api/opportunities/[id]/kanban.post.ts`, `server/api/organization.get.ts`
- Test: `tests/unit/catalog.test.ts`, `tests/unit/kanban-api.test.ts`

- [ ] Write failing tests for text search, score filter, page size/page number, final-page retention and adding one opportunity to a company kanban.
- [ ] Implement validated query parameters: `q`, `minScore`, `page`, `pageSize` and `kanbanOnly`.
- [ ] Return catalog rows with `inKanban` and organization-specific `kanbanState`.
- [ ] Implement idempotent add-to-kanban and organization-scoped state transitions.

### Task 5: Login flow and responsive product UI

**Files:**
- Create: `app/pages/login.vue`, `app/pages/cadastro.vue`
- Create: `app/components/OpportunityCatalog.vue`, `app/components/OpportunityKanban.vue`, `app/components/OpportunityDetails.vue`
- Modify: `app/pages/index.vue`, `app/assets/css/main.css`
- Test: `tests/unit/ui-contract.test.ts`

- [ ] Write failing UI contract tests for the login/cadastro labels, `Licitações`, `Meu kanban`, search, filters and `Adicionar ao kanban` action.
- [ ] Add route-aware login and signup pages with clear error messages.
- [ ] Split the authenticated home into catalog and kanban views.
- [ ] Use compact cards in the kanban, full details in a drawer/panel, and a stacked list with kanban state tabs on mobile.
- [ ] Keep all user-facing copy in PT-BR and remove references to IA, Telegram and outbound notifications.

### Task 6: Verification and handoff

- [ ] Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] Run the real PNCP E2E to confirm the global sync still works.
- [ ] Start with `npm run dev` and manually validate signup → login → catalog search → add to kanban → change state → logout.
- [ ] Capture desktop and mobile screenshots of the authenticated UI.
- [ ] Report that recurring payment and external notification delivery remain intentionally outside this MVP slice.
