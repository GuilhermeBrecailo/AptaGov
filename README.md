# AptaGov — Licitações PNCP

SaaS multiempresa para descobrir licitações públicas, ajustar o score de aderência, selecionar oportunidades do catálogo e acompanhar o pipeline em kanban.

## Início rápido

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

O comando `npm run dev` sobe painel e worker juntos. O painel fica normalmente em `http://localhost:3000`.

## Publicação em produção

Com `.env` e `config/filters.json` preenchidos, um único comando sobe a migração, o painel e o worker:

```powershell
docker compose -f docker-compose.production.yml up -d --build
```

O painel fica em `https://aptagov.site` e o worker continua executando em segundo plano.

## Fluxo do produto

- Se o PNCP estiver indisponível, o worker usa automaticamente a API oficial de Dados Abertos como fallback, preservando o `pncp_id` e exibindo a origem no painel.
- A empresa se cadastra e recebe um período de teste.
- O worker busca o PNCP imediatamente ao iniciar e repete automaticamente a cada `SYNC_INTERVAL_MINUTES` minutos (10 por padrão), com paginação completa e deduplicação por `pncp_id`. Cada empresa pode desligar a busca automática em `Configuração`; nesse caso, a consulta continua disponível pelo botão manual.
- O score determinístico usa os filtros da organização e pode ser ajustado no painel.
- A empresa pesquisa e filtra o catálogo, abre detalhes e adiciona apenas o que deseja ao próprio kanban.
- Alertas podem ser enviados por e-mail e por notificação nativa do PWA.
- O plano inicial, de R$50/mês, é ativado pelo checkout do Mercado Pago e confirmado por webhook idempotente.
- A cobrança é por organização, com quatro planos; alertas respeitam o limite operacional de `MAX_NOTIFICATIONS_PER_HOUR`.
- O checkout oferece Inicial, Profissional, Empresarial e Ilimitado; o e-mail configurado como administrador acompanha a base em `/admin`.

## Comandos

- `npm run dev`: painel + worker.
- `npm run db:migrate`: aplica migrações.
- `npm run backup`: cria backup local.
- `npm run e2e:real`: PNCP real → sincronização → classificação → backup.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`: verificações.

## Configuração

Edite `config/filters.json` para regras de negócio e `.env` para credenciais e parâmetros operacionais. Os arquivos sensíveis já estão no `.gitignore`.

Para cobrança, e-mail e push, consulte o [SETUP.md](SETUP.md).
