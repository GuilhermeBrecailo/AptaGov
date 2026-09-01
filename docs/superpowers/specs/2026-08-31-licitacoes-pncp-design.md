# Painel de Oportunidades PNCP — Design

## Objetivo

Criar um produto SaaS em PT-BR, com painel e worker no mesmo repositório, para buscar contratações públicas no PNCP, aplicar filtros e score ajustáveis e permitir que cada empresa acompanhe suas oportunidades em um kanban privado.

## Arquitetura escolhida

O projeto é uma aplicação Nuxt 4 com TypeScript strict. O painel e a API rodam pelo Nuxt; o worker é um processo `tsx` separado, mas compartilha domínio, banco e configuração. O comando `npm run dev` inicia os dois processos com encerramento conjunto.

O banco é SQLite local via `better-sqlite3`, com migrações SQL versionadas. A contratação é identificada por `pncp_id` com `UNIQUE`. A classificação é determinística e baseada nas regras configuradas; filtros salvos pela interface ficam associados à organização.

## Fluxo crítico

1. O usuário cria uma conta e uma organização ou entra em uma sessão existente.
2. O worker lê `.env` e `config/filters.json`.
3. A sincronização consulta `contratacoes/publicacao` em todas as páginas, inclusive `totalPaginas` e a última página.
4. Cada registro é inserido ou atualizado por `pncp_id` dentro de transação.
5. O classificador aplica as regras e pesos configurados.
6. O catálogo fica disponível para pesquisa; o usuário escolhe quais oportunidades entram no kanban da própria organização.
7. Ao final do ciclo, o banco é copiado para `backups/` de forma atômica.
8. Ao reiniciar, o worker recupera jobs que estavam em `RUNNING`.

## Modelo de dados

- `opportunities`: contratação normalizada, `pncp_id` único, score e origem da classificação.
- `opportunity_events`: histórico de mudança de estado.
- `job_runs`: ciclos do worker, estado, erro e checkpoint.
- `system_state`: pausas automáticas e motivo.
- `users`, `organizations`, `organization_memberships`: identidade, empresa e isolamento de acesso.
- `sessions`: sessões opacas com expiração.
- `organization_filters`: preferências do radar por empresa.
- `organization_opportunities`: seleção e estado do kanban por empresa.
- `schema_migrations`: controle das migrações aplicadas.

Estados do kanban: `NEW`, `QUALIFIED`, `CONTACTED`, `IN_PROGRESS`, `WON`, `LOST`, `DISCARDED`.

## Resiliência e segurança

Retry exponencial com jitter para timeout, rede e respostas 5xx; circuit breaker para o PNCP; locks transacionais para jobs; retomada de `RUNNING` como `PENDING` na inicialização; pausa automática quando a sincronização falhar. Logs JSON têm campos operacionais e redaction de chaves, tokens e `Authorization`. `.env`, banco, dados, filtros reais e backups ficam fora do Git.

## API e painel

Endpoints de autenticação criam sessão, encerram sessão e retornam o contexto da organização. Endpoints internos listam e filtram o catálogo, adicionam oportunidades ao kanban, alteram estado, executam sincronização manual, leem o status do worker, atualizam filtros e configuram alertas. A fila de e-mail é idempotente por organização/licitação e usa Resend quando configurado. O painel exibe catálogo, score, busca, paginação, preferências, configuração de e-mail e kanban com cards compactos e detalhes. Todo texto de interface é PT-BR; nomes de código, tabelas e estados persistidos ficam em inglês.

## Testes e verificação

Vitest cobre dedupe, paginação final, score, retomada após reinício, autenticação, isolamento por organização, inclusão idempotente e transições. Um script E2E consulta o PNCP real, sincroniza, classifica e cria backup. A conclusão exige lint, type check, testes, build e execução do fluxo E2E, além da validação manual do fluxo de produto.

## Fora do escopo desta etapa

- IA para classificação.
- Cobrança recorrente, planos e webhooks de pagamento.
- Download e OCR de editais.
- Fila externa, Redis ou banco gerenciado.
