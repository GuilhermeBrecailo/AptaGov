# Task 7 — Orquestração durável de fontes oficiais

Data: 2026-09-02
Status: implementada e verificada localmente

## Entrega

- `WorkerRuntime` recupera jobs `RUNNING`, retoma os jobs duráveis e mantém compatibilidade com o antigo `sync_and_classify` sem deixá-lo pendente.
- `source_sync`, `agenda_preparation` e `market_refresh` possuem payload/checkpoint, chave operacional e conclusão idempotente.
- PNCP, Dados Abertos e BEC/SP são executados isoladamente; uma falha de uma fonte não interrompe as demais. O BEC/SP continua respeitando o toggle existente `BEC_SP_ENABLED`.
- Cada página só avança o checkpoint depois da persistência transacional. Falhas são classificadas como retryable, rate-limited, unauthorized/configuration, malformed response, unavailable ou circuit open.
- O catálogo mantém normalização, dedupe canônico (PNCP > Dados Abertos > BEC/SP), detecção de mudanças, classificação global por organização/radar, lembretes de agenda e checklists Kanban.
- Refresh de mercado é separado do sync de oportunidades e também é durável, isolado por fonte e protegido por retry/circuit breaker.
- Alertas novos, prazos e mudanças operacionais continuam idempotentes por `eventKey`; a seleção de notificação permanece independente da seleção de busca.
- Pausas recebem estágio e razão legível para fonte, agenda, mercado, notificações, backup ou worker. O endpoint de resume só limpa a pausa após health check bem-sucedido.
- O scheduler continua com execução imediata e intervalo de `SYNC_INTERVAL_MINUTES`, cujo padrão permanece 10 minutos; o toggle automático é avaliado pelo runtime sem bloquear sincronização manual.
- Métricas de ciclo expõem jobs recuperados/criados/concluídos/falhos, resultados por fonte, agenda, notificações, backup e razão de pausa.

## Compatibilidade verificada

O runtime novo preserva a assinatura de `runCycle`, os modos `manual` e `automatic`, filtros por organização/radar, classificação, notificações, backup e `close`. O teste de contrato confirma que o automático desligado não sincroniza, que o manual ainda sincroniza e que um job interrompido é concluído sem criar outro `source_sync`.

## Verificações

- `npm test -- --run tests/unit/source-worker.test.ts tests/unit/automatic-sync.test.ts tests/unit/restart.test.ts tests/unit/resilience.test.ts tests/unit/worker-scheduler.test.ts tests/unit/worker-runtime.test.ts`: passou — 6 arquivos, 18 testes.
- `npm test`: passou no estado final — 46 arquivos, 162 testes.
- `npm run typecheck`: passou.
- `npm run lint`: passou.
- `npm run build`: passou.

## Limitações concretas

1. BEC/SP é opt-in no registry existente e permanece desligado por padrão (`BEC_SP_ENABLED=false`). O worker atual não deve fazer chamadas BEC/SP enquanto esse toggle estiver desligado; para ativá-lo são necessários `BEC_SP_ENABLED=true` e os parâmetros `BEC_SP_*`.
2. O schema aprovado de `source_checkpoints` identifica a janela apenas por fonte e datas, sem dimensão de filtro/radar. Dois radares na mesma janela podem refazer a leitura remota, mas o upsert/dedupe evita linhas e alertas duplicados.
3. Um job legado `sync_and_classify` não possui cursor por página. No restart ele é absorvido pelo novo ciclo durável e só é marcado concluído quando o ciclo termina sem pausa; não é possível recuperar a página exata desse job antigo.
4. A entrega real de e-mail/Web Push depende das credenciais/canais já existentes (`RESEND_*` e `VAPID_*`); não foram inventados canais nem feito deploy.

## Fora do escopo

Nenhum deploy, push ou alteração visual foi realizada.
