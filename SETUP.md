# Configuração e operação

## 1. Preparar o ambiente

Use Node.js 22 ou superior:

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
```

O arquivo `.env` contém credenciais e fica fora do Git. O mesmo vale para `config/filters.json`, `data/`, bancos locais e `backups/`.

## 2. Configurar os filtros

Edite `config/filters.json` usando `config/filters.example.json` como referência. A configuração controla período, estados, modalidades, palavras incluídas e excluídas, score mínimo, valor mínimo e os pesos de `keyword`, `region`, `value` e `deadline`.

O proprietário também pode ajustar o score no painel. As alterações ficam salvas somente na organização que fez a mudança.

## 3. Criar acesso da empresa

Com o sistema rodando, abra `http://localhost:3000/cadastro` e informe nome, empresa, e-mail e senha. O primeiro cadastro cria a organização, vira seu proprietário e inicia o período de teste configurado em `BILLING_TRIAL_DAYS`.

Cada organização possui filtros, configurações de alertas e pipeline próprios. O catálogo sincronizado do PNCP pode ser compartilhado, mas os cards do kanban ficam isolados por empresa.

## 4. Assinatura e cobrança

O painel mostra o período de teste e o botão `Ativar plano inicial`. O plano inicial custa R$50/mês. O checkout mensal usa Mercado Pago. Para habilitar a cobrança, preencha no `.env`:

```env
BILLING_PROVIDER=mercadopago
MERCADOPAGO_ACCESS_TOKEN=...
MERCADOPAGO_WEBHOOK_SECRET=...
PUBLIC_APP_URL=https://app.seudominio.com
BILLING_MONTHLY_PRICE_CENTS=5000
BILLING_TRIAL_DAYS=14
BILLING_PLANS_JSON=...
PLATFORM_ADMIN_EMAILS=brecailo3@gmail.com
```

O lançamento oferece quatro planos selecionáveis após o período de teste: Inicial (R$50/mês), Profissional (R$99/mês), Empresarial (R$199/mês) e Ilimitado (R$399/mês). Os preços e limites ficam no `BILLING_PLANS_JSON`, para serem ajustados sem alterar o código. A cobrança é por organização.

O e-mail informado em `PLATFORM_ADMIN_EMAILS` pode abrir `http://localhost:3000/admin` para acompanhar empresas cadastradas, usuários, trials, assinaturas ativas, pagamentos pendentes, MRR estimado, distribuição por plano, oportunidades e alertas do mês. Separe vários administradores por vírgula.

O sistema mantém uma proteção operacional de alertas definida por `MAX_NOTIFICATIONS_PER_HOUR` (100 por hora por padrão); esse limite evita disparos acidentais e pode ser ajustado no `.env`.

Configure no Mercado Pago a URL de webhook:

```text
https://app.seudominio.com/api/billing/webhook
```

O webhook atualiza a assinatura de forma idempotente. Sem o token, o botão informa que as credenciais não estão configuradas e nenhuma assinatura é ativada. Em produção, use HTTPS e uma URL pública.

## 5. Configurar alertas por e-mail

O canal de e-mail usa Resend. Crie uma chave e informe:

```env
RESEND_API_KEY=re_xxxxxxxxx
NOTIFICATION_EMAIL_FROM=AptaGov <notificacoes@seudominio.com>
MAX_NOTIFICATIONS_PER_HOUR=100
```

Enquanto voce ainda nao tiver um dominio, use `AptaGov <onboarding@resend.dev>` como remetente de teste. O Resend limita esse remetente ao e-mail da conta; para enviar aos usuarios finais, verifique um dominio e troque somente `NOTIFICATION_EMAIL_FROM` pelo endereco desse dominio.

Depois do login, abra `Configuração`, informe o endereço de destino e ative `Ativar alertas por e-mail`. Cada licitação é enfileirada uma única vez por organização. O limite por hora soma os envios por e-mail e por dispositivo.

Se o Resend estiver indisponível ou as credenciais estiverem ausentes, a entrega fica pendente, o erro não expõe a chave e o worker pausa para evitar perda silenciosa.

## 6. Configurar avisos no dispositivo

No menu, abra `Configuração`, clique em `Ativar notificações` e aceite a permissão do navegador. O PWA registra o dispositivo e pode exibir avisos mesmo com o painel fechado.

Para habilitar o envio web push, gere um par VAPID:

```powershell
npx web-push generate-vapid-keys
```

Copie os valores para:

```env
VAPID_SUBJECT=mailto:admin@seudominio.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

O `localhost` funciona no desenvolvimento. Em produção, use HTTPS. Se as chaves não estiverem configuradas, o painel informa o bloqueio exato e não grava uma assinatura falsa.

## 7. Rodar painel e worker

Na raiz do projeto, use um único comando:

```powershell
npm run dev
```

Esse comando sobe o painel e o worker juntos. O painel fica em `http://localhost:3000`. O worker executa uma busca imediatamente ao iniciar e repete automaticamente a cada `SYNC_INTERVAL_MINUTES` minutos, que por padrão é 10. A busca automática pode ser ativada ou desativada em `Configuração > Busca automática de licitações`; quando desativada, o botão de sincronização manual continua disponível.

Para uma verificação real do PNCP:

```powershell
npm run e2e:real
```

Esse fluxo consulta o PNCP, percorre todas as páginas, sincroniza por `pncp_id`, classifica por regras e cria backup.

### Fallback de dados

Se o PNCP estiver indisponível, o worker tenta automaticamente a API de Dados Abertos do Compras.gov.br. O endereço padrão já funciona sem credencial; se necessário, ajuste `OPEN_DATA_BASE_URL` no `.env`. Os registros continuam protegidos pelo mesmo `pncp_id` e o painel mostra quando a origem foi Dados Abertos. Essa fonte pode ter atraso ou cobertura diferente do PNCP e será reconciliada quando a fonte principal voltar.

## 8. Publicar em producao com Docker

Com `.env` e `config/filters.json` preenchidos no servidor, um unico comando sobe a migracao, o painel e o worker:

```powershell
docker compose -f docker-compose.production.yml up -d --build
```

O painel fica disponivel em `https://aptagov.site` e o `www` aponta para o mesmo servico. O painel usa a porta local `4100`, o banco fica persistido em `data/` e os backups em `backups/`. O worker e o painel reiniciam automaticamente apos uma falha ou reinicio do servidor.

Para conferir os servicos:

```powershell
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 worker
```

O tunel Cloudflare deve apontar `aptagov.site` e `www.aptagov.site` para `http://127.0.0.1:4100`.

## 9. Pausar e retomar

O worker pausa automaticamente quando há erro anormal de sincronização, falha do canal de notificação ou outra falha do ciclo. O painel mostra o motivo.

Também é possível pausar manualmente pelo painel. Investigue a causa antes de clicar em `Retomar`; o estado fica persistido no banco e sobrevive ao reinício.

## 10. Backup e restauração

O worker cria backup ao final de cada ciclo bem-sucedido. Para criar um backup manual:

```powershell
npm run backup
```

Para restaurar, pare o painel e o worker, escolha um arquivo conhecido dentro de `backups/`, preserve uma cópia do banco atual e substitua o banco configurado:

```powershell
Copy-Item .\data\licitacoes.db .\data\licitacoes-antes-da-restauracao.db
Copy-Item .\backups\licitacoes-AAAA-MM-DDTHH-MM-SS-sssZ.db .\data\licitacoes.db
npm run db:migrate
npm run dev
```

Nunca restaure arquivos de origem desconhecida. O banco atual deve ser copiado antes da troca para permitir retorno manual.

## 11. Primeiro radar e radares salvos

No primeiro cadastro, o AptaGov abre uma tela de boas-vindas. Informe palavras-chave, exclusões, estados, modalidades, score mínimo e o e-mail dos alertas. Você pode fazer essa etapa depois e completar em `Configuração`.

Em `Configuração > Radares salvos`, crie buscas separadas por produto, região ou estratégia. Cada radar pode ser editado, pausado, reativado ou excluído. O plano atual mostra o limite de radares; o plano Inicial começa com três. A busca automática executa somente radares ativos a cada dez minutos. A sincronização manual pode executar um radar pausado quando ele estiver selecionado no painel.

No painel, use o seletor de radar para pesquisar, ordenar por aderência/publicação/prazo e mostrar somente oportunidades com prazo aberto. Favoritar uma oportunidade mantém o acompanhamento privado da empresa; `Não interessa` retira o item do catálogo sem apagar a licitação do banco.

O aviso de novidade é idempotente por organização e licitação. O aviso de prazo próximo é um evento diferente, enviado uma vez para oportunidades no Kanban ou favoritadas quando vencem em até 48 horas. E-mail e PWA usam a mesma proteção contra repetição.

O `/admin` exibe, além da receita e dos planos, quantas empresas concluíram o primeiro radar, quantos radares estão ativos, quantas oportunidades foram favoritadas e quantas estão no Kanban. Use esses sinais de ativação e uso para decidir quando aumentar o preço.

## 12. Verificação completa

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run e2e:real
```

O conjunto de testes cobre deduplicação, paginação completa, score, notificações idempotentes, recuperação após reinício, limite de notificações e transições do kanban.
