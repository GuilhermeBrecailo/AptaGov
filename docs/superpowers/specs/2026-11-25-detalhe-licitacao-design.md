# Página de detalhe da licitação — design curto

Data: 2026-11-25 · Status: aprovado pelo dono · Roteiro BLL/BNC, passo 3

## Intenção
Ter numa página tudo o que a BLL mostra no "ProcessView" para decidir se disputa uma obra: resumo, prazos, itens e arquivos oficiais. A página precisa ter link próprio, para poder ser compartilhada.

## Hoje
- O detalhe é o painel lateral `app/components/OpportunityDetails.vue`, com resumo, checklist, análise de edital, descrição, score e o botão da plataforma. Não mostra itens nem arquivos.
- API pública do PNCP, conferida em 2026-11-25:
  - `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens?pagina&tamanhoPagina` traz numeroItem, descricao, quantidade, unidadeMedida, valorUnitarioEstimado, valorTotal, orcamentoSigiloso, criterioJulgamentoNome, tipoBeneficioNome, situacaoCompraItemNome e materialOuServicoNome.
  - `/itens/quantidade` traz o total de itens.
  - `/arquivos` já é consumido por `PncpDocumentClient` (`src/services/edital/pncpDocuments.ts`).
- O PNCP não expõe lotes.

## Objetivos
1. Página `/licitacoes/[id]` com:
   - cabeçalho (objeto, órgão, cidade/UF, modalidade, situação, tipo de disputa, valor, botão da plataforma);
   - prazos (publicação, propostas, abertura, impugnação, esclarecimentos);
   - itens (tabela paginada com o total estimado);
   - arquivos (tipo, data, link oficial, versões anteriores marcadas);
   - análise de edital, checklist e "por que apareceu", reaproveitados do painel.
2. Link "Ver página completa" no painel lateral.
3. Itens e arquivos buscados pelo servidor e guardados em cache por 6 h. Se o PNCP falhar, a página mostra o cache com a data dele, ou o aviso de indisponível.
4. Fontes sem PNCP mostram o aviso "Itens e arquivos disponíveis na plataforma".

## Não-objetivos
Lotes (o PNCP não informa), baixar ou ler PDFs aqui, resultado ou vencedor da licitação.

## Anti-objetivos
- Mostrar R$ 0 para orçamento sigiloso.
- Link de arquivo para fora do pncp.gov.br ou sem https.
- Erro 500 quando o PNCP estiver fora do ar.
- Chamar o PNCP a cada visita.

## Abordagens
- **A (escolhida):** proxy no servidor com cache SQLite de 6 h. É rápido, resiste a falhas do PNCP e não depende de CORS.
- B: o navegador chama o PNCP direto. Fica sujeito a CORS, não tem cache e expõe o tráfego.
- C: baixar os itens de todas as licitações na sincronização. Custa caro e a maioria nunca é aberta.

## Decisões deixadas ao construtor
- Layout fino da página, mantendo os tokens existentes.
- Tamanho da página de itens no PNCP, até 500.
</content>
</invoke>
<invoke name="Bash">
<parameter name="command">cd "C:/Users/user/Documents/dev/AptaGov" && S="C:/Users/user/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.2/skills/subagent-driven-development/scripts"; P=docs/superpowers/plans/2026-11-25-detalhe-licitacao.md; W=$(bash "$S/sdd-workspace" $P); for n in 1 2 3; do bash "$S/task-brief" $P $n >/dev/null; done; git add docs/superpowers; printf '# SDD ledger — plan: %s\nSpec: docs/superpowers/specs/2026-11-25-detalhe-licitacao-design.md\nBranch: feature/detalhe (base main 3fbf0d9)\nRuling R1: no commits per task (owner rule) — staging; cost: one commit at end.\nRuling R2: worker-runtime/task7-fix-round5 failures pre-existing — cost none.\n## Tasks\nTask 1: dispatched (implementer sonnet)\n' "$P" > $W/progress.md; ls $W; git status --short