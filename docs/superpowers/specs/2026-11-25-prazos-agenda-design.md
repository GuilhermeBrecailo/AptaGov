# Prazos do edital na Agenda + "Abrir na plataforma" — design curto

Data: 2026-11-25 · Status: aprovado pelo dono · Roteiro BLL/BNC, passo 1

## Intenção
O dono disputa obras e usa BLL/BNC todo dia. Lances, impugnações e recursos só acontecem na plataforma do órgão. O AptaGov deve mostrar **todos** os prazos que importam de cada licitação acompanhada e levar o usuário direto à plataforma certa, na hora certa.

## Hoje
- `AgendaService.scheduleOfficialReminders` já cria sozinho (createdByUserId null) 3 lembretes para licitações no escopo da organização: prazo de propostas (BID_DEADLINE), abertura da sessão (MEETING), início da disputa (FOLLOW_UP); atualiza a data se o órgão mudar e o usuário não tiver mexido. Chamado em `operationalSyncService.ts:44` e `workerRuntime.ts:633`.
- Preferências por organização (`migrations/019`, `organizationAlertPreferenceRepository`): proposalDeadline, sessionOpening, disputeStart, changeAlerts.
- `opportunities.source_url` = `linkSistemaOrigem` quando existe (`syncService.ts:123`), senão página do PNCP. Na prévia: 84% pncp.gov.br; 544 Compras.gov (cnetmobile.estaleiro.serpro.gov.br), 155 BLL, 24 BNC, outras.
- Botões atuais: "Abrir fonte oficial ↗" (AgendaView.vue:342) e "Abrir na fonte oficial ↗" (OpportunityDetails.vue:89).

## Objetivos
1. Dois lembretes automáticos novos: **Prazo de impugnação** e **Prazo de esclarecimentos**, em até 3 dias úteis antes da abertura (Lei 14.133, art. 164). Base: `sessionOpening`, ou `biddingDeadline` se não houver abertura.
2. Dias úteis: pula sábado, domingo e feriados nacionais oficiais (Corpus Christi e Carnaval não são feriados nacionais por lei): 1/1, Sexta-feira Santa, 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11, 25/12). Hora: fim do dia (23:59 horário de Brasília) do dia calculado.
3. Nota do lembrete: "Estimado pela Lei 14.133 (3 dias úteis antes da abertura) — confira no edital."
4. Se existir análise de edital COMPLETED com datas extraídas de impugnação/esclarecimentos, elas substituem a estimativa; nota "Conforme edital, pág. X". Exige 2 campos novos opcionais no schema de extração (`summary.challengeDeadline`, `summary.clarificationDeadline`, cada um `{ at, page } | null`) e uma linha no prompt.
5. Preferências ganham `challengeDeadline` e `clarificationDeadline`, ligadas por padrão, com toggle na tela de preferências da Agenda.
6. Botão com nome da plataforma, por host do `sourceUrl`: BLL (bllcompras.com), BNC (bnccompras.com), Compras.gov (*.serpro.gov.br, compras.gov.br, comprasnet), Licitações-e (licitacoes-e*.bb.com.br), Portal de Compras Públicas, Licitar Digital, Licita Mais Brasil, Licitanet, ComprasBR; pncp.gov.br → "Abrir no PNCP"; outros → "Abrir no site do órgão". Só renderiza link se o protocolo for https: (reusar `safeHttpsUrl`). Aplicar na Agenda e no detalhe.

## Não-objetivos
Busca por região, ações dentro da BLL/BNC, feriados estaduais/municipais, novo crawler de plataformas.

## Anti-objetivos
- Prazo estimado apresentado como certo (sempre com a nota).
- Sobrescrever data que o usuário editou à mão (mesma regra dos lembretes oficiais atuais).
- Link http/javascript renderizado.

## Abordagens
- **A (escolhida):** calcular pela lei para todas as licitações acompanhadas + usar a data do edital quando a análise existir. Cobre 100% sem custo e melhora quando há análise.
- B: só pela análise de edital — exige IA paga por licitação e deixa a maioria sem prazo.
- C: só pela lei — mais simples, mas ignora o edital quando ele está disponível.

## Decisões deixadas ao construtor
- Como guardar os tipos novos: a tabela `opportunity_reminders` tem CHECK de `type` (migrations/015), então incluir 'CHALLENGE_DEADLINE' e 'CLARIFICATION_DEADLINE' exige migração que recria a tabela (padrão SQLite) ou outra forma equivalente; manter a regra "um lembrete oficial por tipo".
- Onde recalcular quando a análise conclui (ex.: no fim de `EditalAnalysisService.run`, chamando a Agenda).
- Rótulos/ícones dos tipos novos na AgendaView.
</content>
</invoke>
