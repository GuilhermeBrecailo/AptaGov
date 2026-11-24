# Análise de edital de obras — Design

## Intenção

O dono do AptaGov disputa licitações de obras e serviços de engenharia. Hoje, para saber se a empresa pode entrar numa disputa, ele precisa ler o edital inteiro (50 a 150 páginas) procurando exigências que eliminam: atestados/CAT com quantidade mínima, patrimônio líquido, índices contábeis, registro no CREA/CAU, visita técnica, garantia.

O recurso lê o edital da licitação escolhida e responde **"a minha empresa está apta?"**, item por item, com a página do edital como prova. O nome do produto ("Apta") vem daí.

## Objetivos

- Cadastro único do **perfil técnico e financeiro** da empresa.
- Botão **"Analisar edital"** no painel de detalhes de uma licitação.
- O sistema baixa sozinho os documentos oficiais do PNCP, extrai as exigências com IA e compara com o perfil.
- Resultado em itens ✅ atende / ❌ não atende / ⚠️ verificar, cada um com página e trecho do edital.
- Veredito geral: **Apto**, **Não apto (N impedimentos)** ou **Verificar (N pontos)**.
- Análise salva: reabrir a licitação mostra a análise anterior sem novo custo; botão para refazer.

## Não objetivos (desta etapa)

- Recurso de plano para outros clientes do SaaS (limites por plano, cobrança). O desenho por organização já deixa isso possível depois.
- Analisar editais automaticamente no sync (custo).
- Montar proposta, planilha orçamentária ou BDI.
- Editais fora do PNCP (upload manual de PDF fica para depois).
- Remover as variáveis `OPENAI_*` reservadas (há teste de contrato sobre elas; ficam como estão).

## Anti-objetivos

- **Dar "Apto" errado.** Na dúvida, o item vira ⚠️, nunca ✅. Um falso ✅ pode fazer a empresa ser inabilitada.
- A IA decidir sozinha. A IA **extrai e relaciona**; a comparação de números é **código determinístico e testado**.
- Gasto sem controle de IA.

## Restrições

- Stack existente: Nuxt 4 + TypeScript strict, SQLite (`better-sqlite3`), migrações SQL versionadas, Vitest, PT-BR na interface e inglês no código/tabelas.
- Uso real hoje é de uma organização (a do dono). Outros clientes do SaaS não podem disparar custo de IA.
- Documentos do PNCP são públicos; o **perfil da empresa é dado privado** e vai para a API da Anthropic na análise (aceitável para o dono; registrar no SETUP).
- Limite da API para PDF: 32 MB por requisição e 600 páginas.

## Abordagens consideradas

| | Abordagem | Prós | Contras |
|---|---|---|---|
| **A (escolhida)** | Claude lê os PDFs direto (bloco `document` base64) e devolve JSON estruturado | Lê PDF escaneado e tabelas; página exata; sem dependência de leitura de PDF | ~R$ 5 por edital de ~100 páginas no Opus 5.5; exige `ANTHROPIC_API_KEY` |
| B | Extrair texto do PDF no servidor e mandar texto para a IA | Bem mais barato | Falha em PDF escaneado (comum em prefeituras), perde tabelas de quantidades, nova biblioteca de PDF |
| C | Só regras/regex, sem IA | Custo zero | Não entende equivalências ("CBUQ" = pavimentação asfáltica) nem tabelas; muitos falsos ✅ |

O dono delegou a escolha ("você decide"). Escolhida **A** porque o erro mais caro é um falso "apto", e as exigências de obra costumam estar em tabelas e PDFs escaneados.

## Decisões tomadas

### Modelo e chamada
- SDK oficial `@anthropic-ai/sdk` (nova dependência, autorizada pela escolha da abordagem A).
- Modelo `claude-opus-5-5`, `thinking: { type: "adaptive" }`, `output_config.effort: "high"`, streaming com `finalMessage()` (documentos longos).
- Saída estruturada via `output_config.format` (JSON schema). Como o recurso de *citations* da API é incompatível com saída estruturada, **página e trecho são campos do próprio schema**.
- Fallback de recusa do lado do servidor: `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` (endpoint `client.beta.messages`).
- Credencial: `ANTHROPIC_API_KEY` no `.env`. Sem chave, o botão aparece desabilitado com explicação.

### Quem pode usar e custo
- Liberado só para organizações listadas em `EDITAL_ANALYSIS_ORGANIZATION_IDS` (lista de IDs no `.env`). As demais não veem o botão; a API responde 403.
- Limite mensal por organização: `EDITAL_ANALYSIS_MONTHLY_LIMIT` (padrão 30 análises). Acima disso, 429 com mensagem clara.
- Cada análise grava tokens de entrada/saída e custo estimado em US$.

### Documentos
- A partir do `pncp_id` (`{cnpj}-{esfera}-{sequencial}/{ano}`), consultar `GET https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` (verificado em 24/11/2026 com uma obra real: retorna Edital, Termo de Referência, Minuta, ETP, Outros, com `url` de download em PDF).
- Enviar **Edital** e **Termo de Referência / Projeto Básico**. Ignorar minuta, ETP e "outros".
- Se o conjunto passar de 32 MB ou 600 páginas: enviar só o Edital e marcar a análise como "parcial" (aviso na tela).
- Se a licitação não tiver documentos no PNCP ou não tiver `pncp_id` válido: análise falha com mensagem "Edital não disponível no PNCP".

### Perfil da empresa (por organização)
Tabela nova `company_profiles` (uma linha por organização, JSON validado com zod). Campos:
- **Registros**: conselho (CREA/CAU), número, UF, validade da certidão.
- **Responsáveis técnicos**: nome, título (engenheiro civil, arquiteto…), número de registro.
- **Atestados/CAT**: identificador, descrição do serviço, quantidade, unidade, contratante, número da CAT, responsável técnico vinculado (opcional), data.
- **Financeiro**: patrimônio líquido (R$), capital social (R$), índices LG, SG, LC, data do balanço.

Tela nova **"Perfil técnico"** em Configuração, com listas editáveis (adicionar/remover atestados e responsáveis).

### Extração (IA)
Uma chamada por análise. Entrada: PDFs + perfil da empresa (JSON) + instruções. Saída (schema):
- `summary`: objeto, valor estimado, data/hora de abertura, modalidade, regime de execução, critério de julgamento, permite consórcio, permite somatório de atestados.
- `requirements[]`: `category` (`professional_registration`, `technical_capacity_company`, `technical_capacity_professional`, `net_worth`, `share_capital`, `financial_ratios`, `bid_guarantee`, `technical_visit`, `other_elimination`), `description`, `page`, `excerpt` (até ~300 caracteres), `mandatory`, e campos numéricos conforme a categoria: `minQuantity` + `unit` (atestados), `percentOfEstimate` ou `amountCents` (PL/capital), `minRatio` (índices), `deadline` (visita), `allowsSum`.
- `matches[]`: para cada exigência de atestado, quais `profileAttestationIds` do perfil a IA considera **do mesmo tipo de serviço**, com uma justificativa curta. A IA **não** diz se a quantidade basta.

### Comparação (código determinístico)
Serviço puro `compareRequirements(extraction, profile, estimatedValueCents)`:
- Registro: ✅ se houver registro do conselho exigido com validade futura; ❌ se não houver; ⚠️ se vencido ou sem validade informada.
- Atestados (operacional e profissional): soma (se `allowsSum`) ou maior quantidade dos atestados relacionados, convertidos só quando a unidade for idêntica após normalização (m², m2, metro quadrado → `m2`). ✅ se ≥ mínimo; ❌ se < mínimo; ⚠️ se unidade diferente, sem atestado relacionado com justificativa fraca, ou exigência sem número.
- Patrimônio líquido / capital: valor exigido = `amountCents` ou `percentOfEstimate × valor estimado`. ✅/❌ pela comparação; ⚠️ se faltar o valor no perfil ou no edital.
- Índices: ✅/❌ por índice; ⚠️ se faltar no perfil ou balanço com mais de 16 meses.
- Visita técnica e garantia: sempre ⚠️ informativo (com data/valor), não impedem "Apto".
- `other_elimination`: sempre ⚠️ com o trecho.
- Veredito: algum ❌ obrigatório → **Não apto**; senão algum ⚠️ que não seja só informativo → **Verificar**; senão **Apto**.

### Execução e persistência
- Tabela `edital_analyses`: organização, oportunidade, status (`RUNNING`, `COMPLETED`, `FAILED`), documentos usados (tipo, título, url, páginas), flag parcial, modelo, tokens, custo estimado, extração (JSON), resultado da comparação (JSON), erro, datas.
- `POST /api/opportunities/:id/edital-analysis` cria a linha `RUNNING` e dispara o processamento no próprio processo web (sem bloquear a resposta). `GET` devolve a última análise.
- A comparação é recalculada no `GET` a partir da extração salva + perfil atual, para refletir mudanças no perfil sem nova chamada de IA.
- Análises `RUNNING` há mais de 15 min viram `FAILED` ("interrompida") na leitura.
- Uma análise `RUNNING` por oportunidade por vez.

### Interface
- No painel de detalhes: seção **"Análise do edital"** com botão "Analisar edital", estado "Lendo o edital… (pode levar até 3 minutos)", depois veredito + lista de itens agrupados (❌ primeiro, depois ⚠️, depois ✅), cada um com descrição, valor exigido vs. seu valor, página e trecho expansível, e link para o PDF oficial.
- Itens de visita técnica com data têm botão "Adicionar à agenda", reutilizando a criação de lembrete manual existente (`POST /api/agenda`).
- Perfil incompleto: aviso com link para "Perfil técnico" antes de analisar (a análise ainda roda; itens sem dado viram ⚠️).

### Testes
- Unitários: parser do `pncp_id`; seleção de documentos; cliente de arquivos PNCP com `fetch` falso; `compareRequirements` com casos de cada categoria e de normalização de unidade; handlers de API (permissão por allowlist, limite mensal, concorrência, recuperação de `RUNNING` antigo); repositório e migração.
- O cliente do Claude fica atrás de uma interface (`EditalExtractor`) com implementação falsa nos testes.
- Script opcional `npm run e2e:edital -- <pncp_id>` que faz uma análise real (gasta dinheiro; só roda com autorização explícita) e imprime tokens e custo.

## Decisões após a revisão do construtor (decisões do autor, para conferência do dono)

1. **Exigências alternativas ou condicionais** (ex.: "PL mínimo de 10% **ou** índices ≥ 1", art. 69 da Lei 14.133). O schema ganha `alternativeGroup` (string opcional): exigências com o mesmo grupo são alternativas. O grupo é ✅ se qualquer membro for ✅; ❌ se todos forem ❌; senão ⚠️. Exigência que a IA marcar como condicional sem conseguir modelar vira ⚠️. Evita falso "Não apto" sem arriscar falso "Apto".
2. **Edital com vários lotes.** O `summary` lista os lotes (`lots[]`: identificador, objeto, valor estimado) e cada exigência tem `lot` (identificador ou `null` = vale para todos). A comparação roda **por lote**; a tela mostra um seletor de lote quando houver mais de um e o veredito do lote selecionado (padrão: primeiro). Nunca se aplica o mínimo de um lote a outro.
3. **Perfil alterado depois da análise.** A análise guarda um hash do perfil usado. Se o perfil atual tiver hash diferente, a tela mostra "Seu perfil mudou desde esta análise" com botão **Refazer**, e atestados que não existiam na análise não entram na soma. IDs de atestado são UUIDs gerados no cadastro e nunca reaproveitados; atestado apagado simplesmente deixa de contar.
4. **Atestado sem relação.** O match da IA tem `confidence` (`high` | `medium` | `low`). Só `high` e `medium` contam. Exigência obrigatória de atestado: ❌ se o perfil **não tem nenhum atestado cadastrado**; ⚠️ se tem atestados mas nenhum relacionado com confiança suficiente ("a IA não encontrou atestado equivalente — confira"). Assim um erro de equivalência da IA vira ⚠️, não ❌ nem ✅.
5. **Arquivos que não são PDF e retificações.** Nesta etapa só PDF é enviado (sem nova dependência para ZIP/RAR/DOCX). Arquivo de outro formato fica listado como "não analisado" com link oficial, e a análise é marcada **parcial**; se nenhum Edital/TR for PDF, a análise falha com "Edital em formato não suportado (ZIP/DOCX) — abra pelo link". Com vários arquivos do mesmo tipo, usa-se o de maior sequencial (o mais recente) e os demais aparecem como "versões anteriores".
6. **Tamanho e páginas.** Sem contar páginas. Limite pelo tamanho bruto somado: até **24 MB** (base64 aumenta ~33% sobre o limite de 32 MB). Se Edital + TR passarem, vai só o Edital (parcial). Se o Edital sozinho passar, ou a API recusar por tamanho/contexto, a análise falha com mensagem clara e link oficial. O campo "páginas" sai dos documentos usados.
7. **Valor estimado para PL/capital percentual.** Usa `estimated_value_cents` da oportunidade (ou do lote, quando houver) se for maior que 0. Se for 0 ou sigiloso, usa o valor extraído pela IA, mas o item nunca passa de ⚠️ ("valor estimado lido do edital — confira"). Sem valor nenhum, ⚠️.

## Deixado para quem constrói

- Texto exato do prompt e do JSON schema (seguindo os campos acima).
- Layout fino da tela de Perfil técnico e da seção de análise, dentro do design system existente.
- Tabela de normalização de unidades (começar por m², m³, m, km, t, un).
- Timeout e número de tentativas do download dos PDFs.
