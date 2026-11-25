import type Anthropic from '@anthropic-ai/sdk';
import {
  APIConnectionError,
  APIError,
  BadRequestError,
  ContentTooLargeError,
  InternalServerError,
  OverloadedError,
  RateLimitError
} from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { emptyCompanyProfile } from '../../src/domain/companyProfile';
import {
  ClaudeEditalExtractor,
  ExtractionFailedError,
  estimateCostUsdMicros
} from '../../src/services/edital/claudeExtractor';
import { editalExtractionJsonSchema, editalExtractionSchema, type EditalExtraction } from '../../src/services/edital/extraction';

const MODEL = 'claude-opus-5-5';

function example(): EditalExtraction {
  return {
    summary: {
      object: 'Pavimentação asfáltica de vias urbanas',
      estimatedValueCents: 150_000_000,
      openingAt: '2026-12-10T09:00:00-03:00',
      modality: 'Concorrência',
      executionRegime: 'Empreitada por preço unitário',
      judgmentCriterion: 'Menor preço',
      allowsConsortium: false,
      lots: [{ id: '1', object: 'Lote único', estimatedValueCents: 150_000_000 }]
    },
    requirements: [
      {
        id: 'r1',
        lot: null,
        category: 'technical_capacity_company',
        description: 'Atestado de pavimentação asfáltica',
        page: 12,
        excerpt: 'Comprovação de execução de pavimentação asfáltica de no mínimo 5.000 m²',
        mandatory: true,
        alternativeGroup: null,
        conditional: false,
        minQuantity: 5000,
        unit: 'm2',
        allowsSum: true,
        percentOfEstimate: null,
        amountCents: null,
        ratioName: null,
        minRatio: null,
        council: null,
        deadline: null
      },
      {
        id: 'r2',
        lot: '1',
        category: 'financial_ratios',
        description: 'Liquidez geral mínima',
        page: 15,
        excerpt: 'LG igual ou superior a 1,0',
        mandatory: true,
        alternativeGroup: 'g1',
        conditional: false,
        minQuantity: null,
        unit: null,
        allowsSum: null,
        percentOfEstimate: null,
        amountCents: null,
        ratioName: 'LG',
        minRatio: 1,
        council: 'CREA',
        deadline: null
      }
    ],
    matches: [{ requirementId: 'r1', attestationId: 'a1', confidence: 'high', reason: 'Mesmo serviço' }]
  };
}

function message(overrides: Partial<{ stop_reason: string; text: string }> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    stop_reason: overrides.stop_reason ?? 'end_turn',
    content: [{ type: 'text', text: overrides.text ?? JSON.stringify(example()) }],
    usage: { input_tokens: 1234, output_tokens: 567 }
  };
}

function fakeClient(response: unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          calls.push(params);
          return { finalMessage: async () => response };
        }
      }
    }
  };
  return { client: client as unknown as Anthropic, calls };
}

const input = {
  documents: [
    { kind: 'EDITAL', title: 'edital.pdf', data: Buffer.from('%PDF-edital') },
    { kind: 'TERMO_REFERENCIA', title: 'tr.pdf', data: Buffer.from('%PDF-tr') }
  ],
  profile: emptyCompanyProfile()
};

describe('editalExtractionSchema', () => {
  it('accepts a complete example', () => {
    expect(editalExtractionSchema.safeParse(example()).success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const bad = example() as unknown as { requirements: Array<Record<string, unknown>> };
    bad.requirements[0]!.category = 'foo';
    expect(editalExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate requirement ids', () => {
    const bad = example();
    bad.requirements[1]!.id = 'r1';
    expect(editalExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects matches pointing to a requirement that does not exist', () => {
    const bad = example();
    bad.matches[0]!.requirementId = 'r9';
    expect(editalExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it('json schema requires every property and forbids extras', () => {
    const schema = editalExtractionJsonSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: { requirements: { items: { required: string[]; properties: Record<string, unknown> } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(['matches', 'requirements', 'summary']);
    const item = schema.properties.requirements.items;
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.required).toHaveLength(Object.keys(example().requirements[0]!).length);
  });
});

describe('ClaudeEditalExtractor', () => {
  it('sends one PDF document block per file before the text, with model, thinking, effort, format and fallbacks', async () => {
    const { client, calls } = fakeClient(message());
    const extractor = new ClaudeEditalExtractor({ client, model: MODEL });

    const result = await extractor.extract(input);

    expect(result).toEqual({ extraction: example(), model: MODEL, inputTokens: 1234, outputTokens: 567 });
    expect(calls).toHaveLength(1);
    const params = calls[0] as {
      model: string;
      max_tokens: number;
      thinking: unknown;
      output_config: { effort: string; format: { type: string; schema: unknown } };
      fallbacks: unknown;
      betas: string[];
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    expect(params.model).toBe(MODEL);
    expect(params.max_tokens).toBe(64000);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config.effort).toBe('high');
    expect(params.output_config.format).toEqual({ type: 'json_schema', schema: editalExtractionJsonSchema });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');

    expect(params.messages).toHaveLength(1);
    const content = params.messages[0]!.content;
    expect(params.messages[0]!.role).toBe('user');
    expect(content.map((block) => block.type)).toEqual(['document', 'document', 'text']);
    expect(content[0]).toEqual({
      type: 'document',
      title: 'edital.pdf',
      source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-edital').toString('base64') }
    });
    expect((content[1]!.source as { media_type: string }).media_type).toBe('application/pdf');
    expect(content[1]!.title).toBe('tr.pdf');
    const text = content[2]!.text as string;
    expect(text).toContain(JSON.stringify(input.profile));
    expect(text).toContain('alternativeGroup');
    expect(text).toContain('conditional');
  });

  it('instructs that compound alternatives (AND inside OR) are conditional, not grouped', async () => {
    const { client, calls } = fakeClient(message());
    await new ClaudeEditalExtractor({ client, model: MODEL }).extract(input);
    const content = (calls[0] as { messages: Array<{ content: Array<{ text?: string }> }> }).messages[0]!.content;
    const text = content.at(-1)!.text!;
    expect(text).toContain('Alternativa composta (E dentro de OU)');
    expect(text).toMatch(/NÃO use "alternativeGroup"; marque todas as exigências envolvidas com "conditional": true/);
    expect(text).toContain('use somente quando cada lado da alternativa for UMA única exigência');
    expect(text).not.toContain('patrimônio líquido mínimo de 10% OU índices');
  });

  it('instructs that other ratios or maximum ratios get ratioName null and conditional true', async () => {
    const { client, calls } = fakeClient(message());
    await new ClaudeEditalExtractor({ client, model: MODEL }).extract(input);
    const content = (calls[0] as { messages: Array<{ content: Array<{ text?: string }> }> }).messages[0]!.content;
    const text = content.at(-1)!.text!;
    expect(text).toContain('qualquer índice que não seja LG, SG ou LC');
    expect(text).toContain('valor MÁXIMO');
    expect(text).toMatch(/"ratioName": null, "minRatio": null e "conditional": true/);
  });

  it('instructs that professional capacity means the CAT of the responsible engineer', async () => {
    const { client, calls } = fakeClient(message());
    await new ClaudeEditalExtractor({ client, model: MODEL }).extract(input);
    const content = (calls[0] as { messages: Array<{ content: Array<{ text?: string }> }> }).messages[0]!.content;
    expect(content.at(-1)!.text!).toContain('technical_capacity_professional');
    expect(content.at(-1)!.text!).toMatch(/CAT \(Certidão de Acervo Técnico\) do responsável técnico/);
  });

  it('uses only text after the last fallback block', async () => {
    const response = message();
    response.content = [
      { type: 'text', text: '{"partial":' },
      { type: 'fallback' } as unknown as { type: string; text: string },
      { type: 'text', text: JSON.stringify(example()) }
    ];
    const { client } = fakeClient(response);
    const result = await new ClaudeEditalExtractor({ client, model: MODEL }).extract(input);
    expect(result.extraction).toEqual(example());
  });

  it.each([
    ['refusal', JSON.stringify(example())],
    ['max_tokens', '{"summary":'],
    ['end_turn', '{"summary": {}}'],
    ['end_turn', 'not json']
  ])('throws ExtractionFailedError for stop_reason %s with text %s', async (stopReason, text) => {
    const { client } = fakeClient(message({ stop_reason: stopReason, text }));
    const extractor = new ClaudeEditalExtractor({ client, model: MODEL });
    await expect(extractor.extract(input)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('duplicate requirement ids in the answer become ExtractionFailedError', async () => {
    const bad = example();
    bad.requirements[1]!.id = 'r1';
    const { client } = fakeClient(message({ text: JSON.stringify(bad) }));
    await expect(new ClaudeEditalExtractor({ client, model: MODEL }).extract(input)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  const TOO_LARGE = 'Edital grande demais para análise automática — abra pelo link';
  const BUSY = 'Serviço de IA ocupado agora. Tente novamente em alguns minutos.';
  const rejectingClient = (error: Error) =>
    ({ beta: { messages: { stream: () => ({ finalMessage: async () => { throw error; } }) } } }) as unknown as Anthropic;
  const apiError = (status: number, text: string) =>
    APIError.generate(status, { type: 'error', error: { type: 'api_error', message: text } }, text, new Headers());

  it.each([
    ['413 ContentTooLargeError', () => apiError(413, 'request_too_large'), ContentTooLargeError, TOO_LARGE],
    ['400 prompt too long', () => apiError(400, 'prompt is too long: 250000 tokens > 200000 maximum'), BadRequestError, TOO_LARGE],
    ['429 RateLimitError', () => apiError(429, 'rate limited'), RateLimitError, BUSY],
    ['529 OverloadedError', () => apiError(529, 'Overloaded'), OverloadedError, BUSY],
    ['500 InternalServerError', () => apiError(500, 'internal'), InternalServerError, BUSY]
  ])('translates SDK %s to ExtractionFailedError in Portuguese', async (_label, build, sdkClass, expected) => {
    const sdkError = build();
    expect(sdkError).toBeInstanceOf(sdkClass);
    const client = rejectingClient(sdkError);
    const promise = new ClaudeEditalExtractor({ client, model: MODEL }).extract(input);
    await expect(promise).rejects.toBeInstanceOf(ExtractionFailedError);
    await expect(promise).rejects.toThrow(expected);
  });

  it.each([
    ['400 genérico', () => apiError(400, 'invalid model')],
    ['401 autenticação', () => apiError(401, 'invalid x-api-key')],
    ['conexão', () => new APIConnectionError({ message: 'Connection error.' })]
  ])('translates other SDK errors (%s) to a generic Portuguese ExtractionFailedError without leaking the original text', async (_label, build) => {
    const sdkError = build();
    const client = rejectingClient(sdkError);
    const error = await new ClaudeEditalExtractor({ client, model: MODEL }).extract(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExtractionFailedError);
    expect((error as Error).message).not.toContain(sdkError.message);
    expect((error as Error).message).toMatch(/serviço de IA/i);
    expect((error as Error).message).not.toBe(TOO_LARGE);
  });

  it('translates an SDK error thrown synchronously by stream()', async () => {
    const client = { beta: { messages: { stream() { throw apiError(429, 'rate limited'); } } } } as unknown as Anthropic;
    await expect(new ClaudeEditalExtractor({ client, model: MODEL }).extract(input)).rejects.toThrow(BUSY);
  });

  it('error messages are in Portuguese', async () => {
    const { client } = fakeClient(message({ stop_reason: 'refusal' }));
    await expect(new ClaudeEditalExtractor({ client, model: MODEL }).extract(input)).rejects.toThrow(/edital/i);
  });
});

describe('estimateCostUsdMicros', () => {
  it('prices Opus 5.5 at US$ 4 / US$ 20 per million tokens', () => {
    expect(estimateCostUsdMicros('claude-opus-5-5', 1_000_000, 100_000)).toBe(6_000_000);
  });
});
