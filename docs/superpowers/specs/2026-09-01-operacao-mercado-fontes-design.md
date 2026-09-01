# AptaGov — agenda, operação, inteligência de mercado e fontes oficiais

## Status

Especificação proposta para revisão antes da implementação.

## Objetivo

Evoluir o AptaGov de um radar de novas licitações para uma ferramenta que ajuda a empresa a decidir, preparar e acompanhar uma oportunidade. A experiência continuará simples, em PT-BR e sem IA nesta rodada.

O cliente deverá conseguir:

1. enxergar os próximos prazos em uma agenda;
2. saber o que falta fazer em cada licitação;
3. consultar referências de mercado antes de definir preço e estratégia;
4. receber oportunidades de fontes oficiais adicionais sem depender de scraping instável.

## Base atual preservada

O AptaGov já possui:

- autenticação, organização e cobrança;
- catálogo pesquisável com filtros e paginação;
- score por regras e pesos ajustáveis;
- múltiplos radares com busca e notificações independentes;
- Kanban de oportunidades;
- e-mail e Web Push/PWA;
- worker automático a cada dez minutos;
- sincronização PNCP e API de Dados Abertos do Compras.gov.br;
- deduplicação por `pncp_id`, backups, retry, circuit breaker e pausa automática.

As novas funcionalidades serão adicionadas sem quebrar esses fluxos.

## Decisão de produto

A primeira versão não tentará competir imediatamente com plataformas que oferecem robô de lances, monitoramento de chat ou análise jurídica automática. O foco será o caminho mais frequente e de maior valor para uma pequena empresa:

```text
Encontrar → entender prazo → preparar documentos → definir estratégia → acompanhar → registrar resultado
```

O item 4 será executado por integrações oficiais. Não haverá coleta automatizada de portais que proíbam ou não ofereçam uma interface de dados autorizada.

## 1. Agenda e alterações do edital

### Experiência do usuário

Criar uma página `Agenda` acessível pelo menu principal, com:

- visão mensal e lista dos próximos eventos;
- filtros por radar, Kanban, órgão e tipo de evento;
- destaque visual para eventos vencidos, próximos e sem prazo informado;
- abertura da oportunidade ao clicar no evento;
- lembretes configuráveis por oportunidade;
- visão resumida na tela inicial com os próximos cinco eventos.

Os eventos iniciais serão derivados dos dados oficiais da oportunidade:

- fim do recebimento de propostas;
- abertura da sessão;
- início da disputa, quando disponível;
- encerramento ou resultado;
- lembrete criado manualmente pelo usuário.

### Detecção de alterações

Cada sincronização calculará uma impressão digital somente dos campos relevantes para o fornecedor: prazo, situação, valor, título, descrição, link de edital e arquivos publicados. Quando a impressão mudar, o sistema gravará um evento de alteração com os valores anterior e atual, sem armazenar credenciais ou conteúdo sensível.

Alterações iguais não serão gravadas novamente. Uma alteração relevante poderá gerar alerta persistido por organização, oportunidade, tipo de evento e versão da alteração.

### Modelo de dados

Adicionar, por migrações incrementais:

- `opportunity_reminders`: organização, oportunidade, tipo, data do evento, data do lembrete, status, responsável e timestamps;
- `opportunity_change_events`: oportunidade, tipo da alteração, impressão digital anterior, impressão digital atual, resumo seguro e data de detecção;
- índices por organização, data e status;
- restrição única para impedir o mesmo lembrete ou evento de ser criado duas vezes.

O prazo oficial continuará em `opportunities.bidding_deadline`; a agenda será uma projeção operacional, não uma cópia concorrente do dado oficial.

### Notificações

O usuário poderá ativar ou silenciar cada tipo de lembrete. Novas oportunidades continuam respeitando o radar. Alterações e prazos de oportunidades já acompanhadas continuam ligados ao acompanhamento da empresa, mesmo se o radar original for silenciado.

## 2. Checklist por licitação

### Experiência do usuário

Na página de detalhes e em cada card do Kanban, exibir um bloco `Preparação` com:

- progresso `concluídos / total`;
- itens pendentes mais urgentes;
- data limite relacionada;
- responsável pela tarefa;
- ação rápida para concluir ou reabrir.

O usuário poderá criar itens próprios, editar o nome, marcar como concluído, pular um item e adicionar observação. A lista será privada por organização.

### Checklist inicial

Ao colocar uma oportunidade no Kanban, o sistema criará um checklist básico:

- ler o edital;
- conferir objeto e requisitos;
- separar documentos de habilitação;
- conferir certidões;
- definir preço e margem;
- montar proposta;
- revisar proposta;
- enviar proposta;
- acompanhar a sessão;
- registrar o resultado.

O checklist será editável e não impedirá o usuário de avançar o Kanban. A aplicação ajudará a organizar, mas não assumirá que uma tarefa foi concluída automaticamente.

### Modelo de dados

Adicionar:

- `opportunity_checklist_items`: organização, oportunidade, título, categoria, status, responsável, prazo, observação, ordem e timestamps;
- `checklist_templates`: organização, nome e itens padrão, permitindo personalização futura;
- restrição de acesso por `organization_id` em todas as consultas;
- criação idempotente do checklist padrão ao primeiro salvamento no Kanban.

O upload de arquivos e o cofre de documentos ficam fora desta primeira implementação. O checklist poderá registrar que um documento está pendente e, em uma etapa posterior, receberá o arquivo correspondente.

## 3. Inteligência de mercado

### Experiência do usuário

Criar uma área `Mercado` para consultas relacionadas ao produto ou serviço da empresa, com:

- preço mínimo, mediano e máximo observado;
- quantidade de compras no período;
- órgãos e regiões que mais compraram;
- evolução por mês;
- modalidade e situação;
- link para o processo ou contrato de origem;
- filtros por período, estado, órgão, descrição e código de item.

Na oportunidade, mostrar um resumo contextual quando houver dados compatíveis: referência de preço, quantidade de ocorrências e último resultado encontrado. O sistema deixará claro quando a referência for insuficiente.

### Fontes da primeira versão

Usar os módulos oficiais do PNCP e da API de Dados Abertos do Compras.gov.br para:

- resultados e itens homologados;
- contratos e atas;
- fornecedores vencedores;
- preços praticados;
- catálogo CATMAT/CATSER quando houver código compatível.

Essas informações serão tratadas como histórico de mercado, não como promessa de preço vencedor.

### Modelo de dados

Adicionar tabelas separadas das oportunidades atuais:

- `market_observations`: fonte, identificador externo, código do item, descrição normalizada, unidade, quantidade, preço unitário, órgão, estado, data, oportunidade/contrato de origem e payload bruto sanitizado;
- `market_results`: processo, item, vencedor, valor homologado, situação, fonte e data;
- índices por código, descrição normalizada, estado, órgão e data;
- chave única por fonte e identificador do item/resultado.

Os dados brutos poderão ser atualizados sem duplicar observações. Valores ausentes não serão convertidos silenciosamente para zero quando isso alterar a leitura estatística.

### Regras de qualidade

- Mostrar a data da última atualização da referência.
- Separar preço unitário de valor total.
- Não misturar unidades incompatíveis.
- Exigir quantidade ou unidade compatível antes de calcular mediana.
- Exibir “dados insuficientes” quando houver poucas observações.
- Registrar a fonte e o link de origem para auditoria do usuário.

## 4. Mais fontes oficiais

### Arquitetura

Criar uma interface única de conector, mantendo cada fonte isolada:

- identificação da fonte;
- consulta por janela de data e cursor/página;
- normalização para `OpportunityInput`;
- normalização de resultados e mudanças;
- checkpoint persistido;
- retry com backoff;
- circuit breaker por fonte;
- métricas de recebidos, criados, atualizados, ignorados e falhas.

O worker continuará consolidando fontes pelo identificador canônico. Quando a mesma contratação aparecer em mais de uma fonte, o registro oficial mais completo será priorizado e as origens serão preservadas para consulta.

### Fontes da primeira implementação

1. Manter PNCP como fonte nacional principal.
2. Manter Dados Abertos do Compras.gov.br como fonte complementar e ampliar seus módulos de histórico.
3. Adicionar BEC/SP pelo Web Service público documentado, com foco inicial em ofertas de compra, itens, prazos e resultados.

O conector BEC/SP terá seu próprio checkpoint e não poderá derrubar o ciclo inteiro se estiver indisponível. A fonte será exibida na interface como `BEC/SP`.

Depois desta rodada, novos portais só entrarão quando houver API, Web Service, arquivo de dados oficial ou autorização clara de integração. A ausência de uma fonte não será escondida: o painel mostrará a saúde de cada conector.

### Fluxo do worker

```text
iniciar ciclo
  → recuperar jobs interrompidos
  → executar PNCP, Compras.gov.br e BEC/SP isoladamente
  → salvar checkpoint de cada fonte
  → normalizar e deduplicar oportunidades
  → detectar alterações relevantes
  → classificar por organização e radar
  → criar/atualizar agenda e checklist
  → atualizar histórico de mercado em job próprio
  → enfileirar alertas idempotentes
  → entregar e-mail/PWA
  → criar backup
  → concluir job
```

O histórico de mercado poderá rodar em um job durável separado para não atrasar a entrega de novas oportunidades. Um erro isolado em mercado não deverá impedir a sincronização do radar.

## API e interface

Adicionar endpoints protegidos por organização para:

- listar, criar, atualizar e concluir lembretes;
- listar alterações de uma oportunidade e marcar como lidas;
- listar, criar, atualizar e concluir itens de checklist;
- consultar resumo e séries de mercado;
- consultar saúde e última execução das fontes para o proprietário.

O menu terá `Painel`, `Agenda`, `Mercado`, `Configuração`, `Plano` e, somente para o administrador da plataforma, `Dashboard`. Todas as labels visíveis permanecem em PT-BR; código, banco, estados e nomes de API permanecem em inglês.

## Segurança e recuperação

- Toda tabela nova terá `organization_id` quando o dado for privado.
- Nenhuma credencial de portal será armazenada nesta rodada.
- Payloads brutos serão limitados e sanitizados para evitar log de dados indevidos.
- Jobs terão checkpoint e recuperação após reinício.
- A indisponibilidade de uma fonte ativará retry e circuit breaker daquela fonte.
- Falhas anormais, canal de notificação fora do ar e orçamento excedido continuarão pausando o worker conforme as regras existentes.
- Backups automáticos continuarão ocorrendo após ciclos concluídos.

## Testes e critérios de aceite

Adicionar testes para:

- criação idempotente de eventos de prazo;
- detecção de alteração somente quando um campo relevante mudar;
- lembrete enviado uma única vez por canal e versão;
- checklist isolado por organização e criado uma única vez;
- transição e reabertura de tarefa;
- cálculo de mediana sem misturar unidade ou quantidade incompatível;
- deduplicação de resultado e preço por fonte;
- paginação/checkpoint completo do conector BEC/SP;
- falha de uma fonte sem interromper as outras;
- retomada após reinício no meio do ciclo;
- permissão para proprietário e membro;
- renderização mobile e desktop das novas telas;
- fluxo real sincronizar → atualizar agenda → criar checklist → consultar mercado → notificar.

Critérios de aceite:

1. O usuário encontra todos os próximos prazos em uma agenda simples.
2. Uma mudança relevante do edital pode ser identificada e notificada sem repetição.
3. Toda oportunidade no Kanban pode ter checklist editável e privado.
4. O usuário consulta referências de preço e vê a fonte e a data.
5. PNCP, Compras.gov.br e BEC/SP são fontes isoladas, monitoradas e idempotentes.
6. Uma fonte fora do ar não apaga dados já sincronizados nem impede o restante do ciclo.
7. O worker recupera checkpoints após reinício.
8. Lint, type check, testes, build e E2E real continuam aprovados.

## Fora do escopo

- IA para leitura ou resumo de edital;
- robô de lances;
- monitoramento de chat de portais;
- envio de proposta diretamente em portais;
- WhatsApp ou Telegram;
- scraping sem autorização;
- cofre completo e upload de documentos;
- promessa de probabilidade de vitória.

## Ordem de implementação

1. Migrações, tipos e contratos de API.
2. Agenda, lembretes e detecção de alterações.
3. Checklist e integração com Kanban/detalhes.
4. Modelos e consultas de mercado usando PNCP/Compras.gov.br.
5. Interface Mercado e resumo contextual na oportunidade.
6. Interface de saúde de fontes e conector BEC/SP.
7. Worker durável, notificações, backup e recuperação.
8. Testes completos, build, E2E real e publicação.
