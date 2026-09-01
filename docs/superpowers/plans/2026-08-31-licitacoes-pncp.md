# Licitações PNCP — Implementation Plan

**Goal:** Entregar um painel PT-BR e um worker durável no mesmo repositório para sincronizar oportunidades do PNCP, classificar por regras, acompanhar estados e recuperar-se de falhas.

**Architecture:** Nuxt 4 fornece painel e API; um processo `tsx` executa o worker. Domínio e infraestrutura compartilhados usam SQLite/better-sqlite3, migrações SQL e configuração validada.

**Tech Stack:** Node.js 22+, TypeScript strict, Nuxt 4, Vue 3, SQLite via better-sqlite3, Zod, Pino, Vitest e ESLint.

**Spec:** `docs/superpowers/specs/2026-08-31-licitacoes-pncp-design.md`

## Global Constraints

- Frontend 100% PT-BR; código e banco em inglês.
- Nenhum critério de negócio fora de `config/filters.json` e `.env`.
- O comando único documentado para subir painel e worker é `npm run dev`.
- A paginação deve terminar em `totalPaginas`, sem descartar a última página.
- `opportunities.pncp_id` é único.
- `.env`, `config/filters.json`, `*.db`, `data/`, `backups/` não entram no Git.
- Não fazer commit; o usuário fará o commit.

### Task 1: Scaffold e contratos de teste

- [x] Criar `package.json`, TypeScript, Nuxt, Vitest, ESLint e `.gitignore`.
- [x] Criar `.env.example`, `config/filters.json` e `config/filters.example.json`.
- [x] Criar testes comportamentais para os fluxos principais.

### Task 2: Banco, migrações e estados

- [x] Implementar migração idempotente e índices.
- [x] Implementar repositórios transacionais para oportunidades, eventos, jobs e estado.
- [x] Implementar histórico e transições válidas do kanban.

### Task 3: PNCP e resiliência

- [x] Testar paginação com resposta de três páginas, incluindo a última.
- [x] Implementar retry/backoff e circuit breaker injetáveis.
- [x] Implementar sincronização por período, normalização e upsert por `pncp_id`.

### Task 4: Classificação e worker

- [x] Implementar score determinístico com pesos vindos do filtro.
- [x] Implementar loop durável com retomada de jobs e pausa automática após falha.
- [x] Implementar backup atômico e redaction de log estruturado.

### Task 5: Painel e API

- [x] Expor oportunidades, status operacional, sincronização manual e mudança de estado.
- [x] Renderizar kanban PT-BR com score e pausa visível.
- [x] Permitir ajuste dos filtros pelo painel sem mover critérios para o código.

### Task 6: Documentação e verificação

- [x] Documentar execução, pausa e restauração de backup.
- [x] Rodar lint, typecheck, testes, build e E2E real PNCP.
- [x] Confirmar o fluxo crítico: sincronizar → classificar → persistir → backup.
