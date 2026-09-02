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

- O worker consulta o PNCP e a API oficial de Dados Abertos do Compras.gov.br como fontes complementares, preservando o `pncp_id`, consolidando duplicidades e exibindo a origem no painel. Se uma fonte ficar indisponível, a outra continua funcionando; se ambas falharem, o ciclo é pausado para investigação.
- A empresa se cadastra e recebe um período de teste.
- O worker busca o PNCP imediatamente ao iniciar e repete automaticamente a cada `SYNC_INTERVAL_MINUTES` minutos (10 por padrão), com paginação completa e deduplicação por `pncp_id`. Cada empresa pode desligar a busca automática em `Configuração`; nesse caso, a consulta continua disponível pelo botão manual.
- O score determinístico usa os filtros da organização e pode ser ajustado no painel.
- A empresa pesquisa e filtra o catálogo, abre detalhes e adiciona apenas o que deseja ao próprio kanban.
- No primeiro acesso, um onboarding cria o radar inicial; depois a empresa pode manter radares separados por produto, região ou estratégia, pausar a busca ou silenciar os alertas de cada um.
- O catálogo permite selecionar um radar, filtrar prazo aberto, favoritar oportunidades ou removê-las como não relevantes sem afetar outras empresas.
- Alertas podem ser enviados por e-mail e por notificação nativa do PWA.
- Além de novidades, o worker pode avisar sobre prazo próximo para oportunidades acompanhadas, sem duplicar o mesmo evento.
- O plano inicial, de R$50/mês, é ativado pelo checkout do Mercado Pago e confirmado por webhook idempotente.
- A cobrança é por organização, com quatro planos; alertas respeitam o limite operacional de `MAX_NOTIFICATIONS_PER_HOUR`.
- O checkout oferece Inicial, Profissional, Empresarial e Ilimitado; o e-mail configurado como administrador acompanha a base em `/admin`.

## Comandos

- `npm run dev`: painel + worker.
- `npm run db:migrate`: aplica migrações.
- `npm run backup`: cria backup local.
- `npm run e2e:real`: PNCP + Dados Abertos reais → sincronização → classificação → backup.
- `npm run e2e:operational-real`: fluxo oficial completo em banco temporário → Kanban → checklist → agenda → Mercado → backup; envio real só com autorização explícita.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`: verificações.

## Configuração

Edite `config/filters.json` para regras de negócio e `.env` para credenciais e parâmetros operacionais. Os arquivos sensíveis já estão no `.gitignore`.

Para cobrança, e-mail e push, consulte o [SETUP.md](SETUP.md).

## Operação segura

O comando local único é `npm run dev`: ele inicia painel e worker juntos. A busca automática pode ser ligada ou desligada em `Configuração`; a sincronização manual continua disponível. O worker pausa apenas o estágio com falha e exibe o motivo no painel administrativo.

PNCP e Dados Abertos são as fontes locais padrão. BEC/SP fica desabilitado por padrão e só deve ser ativado com acesso ao Web Service oficial, configurando `BEC_SP_ENABLED`, `BEC_SP_BASE_URL`, `BEC_SP_TIMEOUT_MS` e `BEC_SP_MAX_RETRIES` no `.env`. A saúde agregada das fontes é restrita ao administrador da plataforma.

Para restauração, crie primeiro uma cópia de segurança do banco, valide o arquivo, substitua-o manualmente, confira as migrações com `npm run db:migrate` e reinicie painel e worker. Nenhuma restauração destrutiva é executada automaticamente. O procedimento completo e a validação do fluxo real estão em [SETUP.md](SETUP.md).

## Evidência da última validação local

Em 02/09/2026, foram aprovados lint, typecheck, build e 215 testes em 58 arquivos. As migrações passaram em banco novo e cópia do banco local. O E2E operacional validou 553 classificações, Kanban, 10 itens de checklist, 1 lembrete, backup válido e 1 entrega real no Resend, com a segunda tentativa do mesmo evento bloqueada. Na janela consultada, as fontes oficiais retornaram 0 registros novos; o restante do pipeline foi exercitado usando uma oportunidade já persistida no banco temporário. O runner informa esse caso sem contar resultado inexistente como sucesso de sincronização.
