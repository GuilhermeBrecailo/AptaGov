# AptaGov — descoberta, radares e operação comercial

## Objetivo

Transformar o AptaGov em um produto simples de entender e fácil de usar para pequenas e médias empresas que vendem para órgãos públicos. O primeiro valor percebido deve acontecer em poucos minutos: o cliente informa o que vende, escolhe onde quer atuar, recebe um radar inicial e consegue decidir quais licitações entram no pipeline.

O produto continuará sem IA, Telegram, WhatsApp, robô de lances e gestão documental nesta etapa. A vantagem imediata será uma busca PNCP confiável, filtros ajustáveis, score explicável, alertas úteis e operação organizada em Kanban.

## Diagnóstico: onde estamos atrasados

- A conta é criada diretamente no painel, sem uma entrada guiada que ajude o cliente a montar seu primeiro radar.
- Cada organização possui um único conjunto de filtros salvo; isso impede separar, por exemplo, “software em São Paulo” de “serviços no Paraná”.
- O catálogo permite pesquisar e adicionar ao Kanban, mas ainda não comunica bem por que uma oportunidade foi encontrada, o que exige atenção e qual é o próximo passo.
- O detalhe da oportunidade não mostra a decomposição do score nem oferece ações comerciais claras, como favoritar, ignorar ou marcar acompanhamento.
- Os alertas são principalmente “nova licitação”; ainda faltam eventos operacionais como prazo próximo e alteração relevante.
- O painel administrativo já mostra empresas, planos, MRR e volume de alertas, mas não mede ativação, uso do catálogo, criação de radares, entrada no Kanban e conversão do teste.
- A interface existente tem uma boa base visual, mas precisa de hierarquia mais clara, estados vazios e carregamento mais orientados à decisão e melhor adaptação mobile.

## O que será feito agora

### 1. Experiência visual e navegação

- Refinar o painel, catálogo, Kanban, configuração, plano e admin com uma hierarquia visual consistente.
- Destacar score, prazo, órgão, valor estimado, origem e motivo da aderência sem poluir a tela.
- Manter a navegação por menu hambúrguer, com nomes claros e uma experiência equivalente no desktop e no celular.
- Criar estados de carregamento, vazio, erro, pausa do worker e ausência de notificações que expliquem a próxima ação.
- Manter toda a interface em PT-BR; nomes de tabelas, APIs, estados persistidos e código continuam em inglês.

### 2. Onboarding orientado ao primeiro radar

Após o cadastro, o usuário verá uma sequência curta para informar:

- o que a empresa fornece, usando palavras-chave;
- termos que devem ser excluídos;
- estados e cidades de interesse;
- modalidades e faixa de valor;
- score mínimo desejado;
- ativação da busca automática e do canal de notificação.

O fluxo salvará o perfil da organização e criará um radar inicial. O usuário poderá pular e completar depois, sem impedir o acesso ao produto.

### 3. Múltiplos radares salvos

Uma organização poderá criar, editar, pausar, reativar e excluir radares. Cada radar terá nome, filtros próprios, status e data da última execução/match.

Modelo inicial:

- `saved_searches`: identidade do radar, `organization_id`, nome, filtros JSON, habilitado, timestamps e último match;
- limite de radares será aplicado pelo plano, sem espalhar regra comercial pelo frontend;
- o radar inicial será criado pelo onboarding e o filtro legado continuará sendo migrado de forma compatível;
- a busca automática usará apenas radares habilitados; a busca manual poderá executar um radar pausado quando solicitada pelo proprietário.

O resultado continuará sendo deduplicado pelo `pncp_id`; a mesma licitação pode aparecer em mais de um radar sem gerar registro ou notificação duplicada para a organização.

### 4. Catálogo e decisão

O catálogo ganhará filtros e informações de decisão mais explícitos:

- radar selecionado, texto livre, estado, modalidade, score mínimo e prazo;
- ordenação por aderência, publicação e prazo;
- card/linha com badges de score, “por que apareceu”, prazo e ação principal;
- ações para abrir detalhes, adicionar ao Kanban, favoritar e marcar como não relevante;
- painel de detalhes com breakdown do score, dados da contratação, fonte PNCP e próximos passos;
- paginação continuará baseada no total real, incluindo a última página.

Favoritos e “não relevantes” serão privados por organização e idempotentes. O estado do Kanban continuará separado da licitação global.

### 5. Alertas úteis e seguros

Além de novas oportunidades aderentes, a evolução preparará alertas idempotentes para:

- prazo se aproximando;
- oportunidade favoritada atualizada;
- mudança de status/dados relevantes quando identificada na sincronização.

Cada evento terá uma chave de deduplicação por organização, oportunidade, evento e janela temporal. O registro persistido no banco continua sendo a fonte de verdade, mesmo quando o e-mail ou push estiver indisponível.

O canal disponível nesta etapa continua sendo e-mail e Web Push/PWA. A pausa automática por canal fora do ar, orçamento de notificações ou falha anormal do worker será preservada.

### 6. Métricas para decidir preço e produto

O admin passará a apresentar, quando houver dados:

- empresas cadastradas, ativas, em teste, pagantes e inadimplentes;
- MRR estimado e distribuição de planos;
- empresas que concluíram onboarding;
- quantidade de radares ativos;
- oportunidades visualizadas, favoritadas, adicionadas ao Kanban e notificações enviadas;
- conversão do teste e atividade recente.

Esses números são base para decidir quando subir o preço inicial de R$ 50, sem depender somente da quantidade de cadastros.

## Fluxo de ponta a ponta

1. Visitante cria conta e organização.
2. Onboarding salva o perfil e cria o primeiro radar.
3. Worker executa os radares habilitados a cada 10 minutos ou após sincronização manual.
4. PNCP é consultado com paginação completa; registros são atualizados de modo idempotente por `pncp_id`.
5. Regras e pesos calculam score por organização e radar, com motivos explicáveis.
6. Catálogo mostra os resultados com busca e filtros.
7. Cliente favorita uma oportunidade ou a adiciona ao Kanban.
8. Alertas persistidos são enfileirados uma única vez por evento e enviados por e-mail/PWA.
9. Reinício do worker recupera jobs pendentes e não repete licitações nem notificações já entregues.
10. Admin acompanha ativação, uso, receita e sinais de upgrade.

## Limites desta rodada

Não serão implementados agora:

- classificação ou resumo com IA;
- integração com Telegram ou WhatsApp;
- monitoramento de centenas de portais fora do PNCP/OpenData já existente;
- robô de lances;
- geração de proposta, OCR ou cofre de documentos;
- análise avançada de preços de mercado.

Esses itens ficam como oportunidades posteriores, depois de validar ativação, retenção e conversão do radar PNCP.

## Critérios de aceite desta evolução

- Um novo cliente entende o que fazer e consegue criar o primeiro radar sem suporte.
- Uma organização pode operar mais de um radar sem misturar seus filtros.
- A mesma licitação não duplica no banco, no Kanban nem na fila de notificações.
- O cliente consegue pesquisar, filtrar, entender o score e tomar uma ação em uma oportunidade.
- O worker respeita radares pausados e continua recuperável após reinício.
- O admin consegue distinguir cadastro, ativação, uso e receita.
- A experiência é legível e utilizável em desktop e mobile.
- Lint, type check, testes, build e fluxo E2E continuam aprovados.
