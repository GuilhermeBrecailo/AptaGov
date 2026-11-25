import type Anthropic from '@anthropic-ai/sdk';
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import type { CompanyProfile } from '../../domain/companyProfile';
import { editalExtractionJsonSchema, editalExtractionSchema, type EditalExtraction } from './extraction';

export type ExtractionDocument = { kind: string; title: string; data: Buffer };

export type ExtractionResult = {
  extraction: EditalExtraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface EditalExtractor {
  extract(input: { documents: ExtractionDocument[]; profile: CompanyProfile }): Promise<ExtractionResult>;
}

export class ExtractionFailedError extends Error {
  constructor(message = 'Não foi possível ler o edital automaticamente — abra pelo link', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionFailedError';
  }
}

const MAX_TOKENS = 64000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// USD per 1M tokens. Unknown models are estimated at Opus 5.5 prices.
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 }
};
const DEFAULT_PRICE = { input: 4, output: 20 };

/** Estimated cost in millionths of a US dollar. */
export function estimateCostUsdMicros(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model] ?? DEFAULT_PRICE;
  // US$ X per 1M tokens equals X micro-dollars per token.
  return Math.round(inputTokens * price.input + outputTokens * price.output);
}

const INSTRUCTIONS = `Você é um analista de licitações de obras e serviços de engenharia no Brasil (Lei 14.133/2021).
Os PDFs acima são o edital e, quando houver, o termo de referência/projeto básico de uma licitação. O JSON acima é o perfil técnico da empresa interessada.

Extraia SOMENTE as exigências de habilitação e de participação (registro no conselho profissional, capacidade técnica operacional da empresa, capacidade técnico-profissional do responsável técnico, patrimônio líquido, capital social, índices contábeis, garantia de proposta, visita técnica e outras condições eliminatórias). Ignore regras de execução do contrato, medição, pagamento e penalidades.

Para cada exigência:
- "page": página do PDF onde ela aparece (null se não souber) e "excerpt": trecho LITERAL copiado do documento, com até ~300 caracteres. Não parafraseie o trecho.
- "description": resumo curto em português.
- "mandatory": false apenas quando o documento a tratar como facultativa.
- Campos numéricos conforme a categoria: "minQuantity" + "unit" (atestados; "allowsSum" indica se o edital permite somar atestados), "percentOfEstimate" (percentual, ex.: 10 para 10%) ou "amountCents" (valor em centavos) para patrimônio líquido/capital social, "ratioName" + "minRatio" para índices (uma exigência por índice; use apenas LG, SG ou LC com valor MÍNIMO exigido), "council" para registro, "deadline" (data/hora ISO 8601) para visita técnica. Use null quando o campo não se aplicar ou o edital não informar.
- Outros índices: qualquer índice que não seja LG, SG ou LC (ex.: grau de endividamento), ou qualquer índice exigido como valor MÁXIMO (ex.: "igual ou inferior a 0,5"), deve ter "ratioName": null, "minRatio": null e "conditional": true, com o trecho literal no "excerpt".
- "alternativeGroup": use somente quando cada lado da alternativa for UMA única exigência (ex.: patrimônio líquido mínimo de 10% do valor estimado OU capital social mínimo de 10% do valor estimado); dê o mesmo identificador de grupo às alternativas; caso contrário, null.
- Alternativa composta (E dentro de OU): quando um lado da alternativa for formado por várias exigências que precisam ser cumpridas juntas (ex.: LG, SG e LC iguais ou superiores a 1 OU patrimônio líquido mínimo de 10%), NÃO use "alternativeGroup"; marque todas as exigências envolvidas com "conditional": true e "alternativeGroup": null.
- "conditional": true quando a exigência depender de uma condição que você não consegue representar nos campos acima (ex.: só vale para determinada situação da empresa); caso contrário, false.
- "technical_capacity_company" é a capacidade técnico-operacional (atestados em nome da empresa). "technical_capacity_professional" é a capacidade técnico-profissional: exige a CAT (Certidão de Acervo Técnico) do responsável técnico (engenheiro ou arquiteto) indicado pela empresa; use essa categoria somente quando o edital pedir a CAT ou o acervo do profissional.
- "lot": identificador do lote a que se aplica (o mesmo usado em summary.lots) ou null quando vale para todos os lotes.
- "id": identificador único e curto (ex.: "r1", "r2").

No "summary": objeto, valor estimado em centavos, data/hora de abertura (ISO 8601), modalidade, regime de execução, critério de julgamento, se permite consórcio e a lista de lotes (vazia quando não houver divisão em lotes). Use null para o que o edital não informar.

Em "matches": para cada exigência de atestado (capacidade técnica operacional ou profissional), liste os atestados do perfil ("attestations[].id") que comprovam o MESMO TIPO DE SERVIÇO, com "confidence" (high, medium ou low) e uma justificativa curta em "reason". Avalie apenas a equivalência do serviço; NUNCA julgue se a quantidade é suficiente. Não invente ids que não estejam no perfil.

Não invente exigências nem valores que não estejam nos documentos.`;

const TOO_LARGE_MESSAGE = 'Edital grande demais para análise automática — abra pelo link';
const BUSY_MESSAGE = 'Serviço de IA ocupado agora. Tente novamente em alguns minutos.';
const CONNECTION_MESSAGE = 'Não foi possível falar com o serviço de IA agora. Tente novamente em alguns minutos.';
const API_FAILURE_MESSAGE = 'Falha no serviço de IA ao ler o edital. Tente novamente mais tarde.';
// A 400 for an oversized prompt carries no stable error code, only this wording.
const CONTEXT_PATTERN = /prompt is too long|too many tokens|context (window|length)|too large/iu;

/** Maps SDK errors (spec decision 6) to messages the user can act on; the original text never reaches the UI. */
function translateApiError(error: unknown): unknown {
  // APIConnectionError extends APIError with no status, so it must be checked first.
  if (error instanceof APIConnectionError) return new ExtractionFailedError(CONNECTION_MESSAGE, { cause: error });
  if (!(error instanceof APIError)) return error;
  const status = error.status;
  if (status === 413 || (status === 400 && CONTEXT_PATTERN.test(`${error.apiMessage ?? ''} ${error.message}`))) {
    return new ExtractionFailedError(TOO_LARGE_MESSAGE, { cause: error });
  }
  if (status === 429 || (status !== undefined && status >= 500)) return new ExtractionFailedError(BUSY_MESSAGE, { cause: error });
  return new ExtractionFailedError(API_FAILURE_MESSAGE, { cause: error });
}

type ResponseBlock = { type: string; text?: string };

function outputText(content: ResponseBlock[]): string {
  // With server-side fallback, blocks before the last `fallback` block belong to a
  // model that declined; only the text after it is the final answer.
  let start = 0;
  content.forEach((block, index) => {
    if (block.type === 'fallback') start = index + 1;
  });
  return content
    .slice(start)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

export class ClaudeEditalExtractor implements EditalExtractor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(input: { client: Anthropic; model: string }) {
    this.client = input.client;
    this.model = input.model;
  }

  async extract(input: { documents: ExtractionDocument[]; profile: CompanyProfile }): Promise<ExtractionResult> {
    const documents: Anthropic.Beta.BetaRequestDocumentBlock[] = input.documents.map((document) => ({
      type: 'document',
      title: document.title,
      source: { type: 'base64', media_type: 'application/pdf', data: document.data.toString('base64') }
    }));

    let message;
    try {
      message = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high', format: { type: 'json_schema', schema: editalExtractionJsonSchema } },
          messages: [
            {
              role: 'user',
              content: [
                ...documents,
                { type: 'text', text: `Perfil técnico da empresa (JSON):\n${JSON.stringify(input.profile)}\n\n${INSTRUCTIONS}` }
              ]
            }
          ]
        })
        .finalMessage();
    } catch (error) {
      throw translateApiError(error);
    }

    if (message.stop_reason === 'refusal') {
      throw new ExtractionFailedError('A IA recusou analisar este edital — abra pelo link e confira manualmente');
    }
    if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
      throw new ExtractionFailedError('O edital é extenso demais para a análise automática — abra pelo link');
    }
    if (message.stop_reason !== 'end_turn') {
      throw new ExtractionFailedError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText(message.content as ResponseBlock[]));
    } catch (error) {
      throw new ExtractionFailedError(undefined, { cause: error });
    }
    const result = editalExtractionSchema.safeParse(parsed);
    if (!result.success) {
      throw new ExtractionFailedError(undefined, { cause: result.error });
    }

    return {
      extraction: result.data,
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    };
  }
}
