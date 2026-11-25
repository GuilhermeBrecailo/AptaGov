import { z } from 'zod';

export const requirementCategories = [
  'professional_registration',
  'technical_capacity_company',
  'technical_capacity_professional',
  'net_worth',
  'share_capital',
  'financial_ratios',
  'bid_guarantee',
  'technical_visit',
  'other_elimination'
] as const;

export type RequirementCategory = (typeof requirementCategories)[number];

const ratioNames = ['LG', 'SG', 'LC'] as const;
const councils = ['CREA', 'CAU'] as const;
const confidences = ['high', 'medium', 'low'] as const;

const nullableNumber = z.number().finite().nullable();

export const editalExtractionSchema = z.object({
  summary: z.object({
    object: z.string(),
    estimatedValueCents: nullableNumber,
    openingAt: z.string().nullable(),
    modality: z.string().nullable(),
    executionRegime: z.string().nullable(),
    judgmentCriterion: z.string().nullable(),
    allowsConsortium: z.boolean().nullable(),
    lots: z.array(z.object({ id: z.string(), object: z.string(), estimatedValueCents: nullableNumber }))
  }),
  requirements: z.array(
    z.object({
      id: z.string(),
      lot: z.string().nullable(),
      category: z.enum(requirementCategories),
      description: z.string(),
      page: nullableNumber,
      excerpt: z.string(),
      mandatory: z.boolean(),
      alternativeGroup: z.string().nullable(),
      conditional: z.boolean(),
      minQuantity: nullableNumber,
      unit: z.string().nullable(),
      allowsSum: z.boolean().nullable(),
      percentOfEstimate: nullableNumber,
      amountCents: nullableNumber,
      ratioName: z.enum(ratioNames).nullable(),
      minRatio: nullableNumber,
      council: z.enum(councils).nullable(),
      deadline: z.string().nullable()
    })
  ),
  matches: z.array(
    z.object({
      requirementId: z.string(),
      attestationId: z.string(),
      confidence: z.enum(confidences),
      reason: z.string()
    })
  )
}).superRefine((value, ctx) => {
  // Duplicate ids would make one requirement's matches count for another.
  const ids = new Set<string>();
  value.requirements.forEach((req, index) => {
    if (ids.has(req.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requirements', index, 'id'], message: `Duplicate requirement id "${req.id}"` });
    ids.add(req.id);
  });
  value.matches.forEach((item, index) => {
    if (!ids.has(item.requirementId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['matches', index, 'requirementId'], message: `Unknown requirement id "${item.requirementId}"` });
    }
  });
});

export type EditalExtraction = z.infer<typeof editalExtractionSchema>;
export type ExtractedRequirement = EditalExtraction['requirements'][number];
export type ExtractedMatch = EditalExtraction['matches'][number];

// JSON Schema for output_config.format. Structured outputs require every object to
// list all properties as required and set additionalProperties: false; numeric and
// string-length constraints are not supported, so they are enforced by the zod schema.
type JsonSchema = Record<string, unknown>;

const str: JsonSchema = { type: 'string' };
const num: JsonSchema = { type: 'number' };
const int: JsonSchema = { type: 'integer' };
const bool: JsonSchema = { type: 'boolean' };
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const enumOf = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: [...values] });
const array = (items: JsonSchema): JsonSchema => ({ type: 'array', items });

function object(properties: Record<string, JsonSchema>, description?: string): JsonSchema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    additionalProperties: false
  };
}

export const editalExtractionJsonSchema: JsonSchema = object({
  summary: object({
    object: str,
    estimatedValueCents: nullable(int),
    openingAt: nullable({ type: 'string', description: 'ISO 8601 date-time of the bid opening session' }),
    modality: nullable(str),
    executionRegime: nullable(str),
    judgmentCriterion: nullable(str),
    allowsConsortium: nullable(bool),
    lots: array(object({ id: str, object: str, estimatedValueCents: nullable(int) }))
  }),
  requirements: array(
    object({
      id: str,
      lot: nullable({ type: 'string', description: 'Lot id from summary.lots, or null when it applies to every lot' }),
      category: enumOf(requirementCategories),
      description: str,
      page: nullable({ type: 'integer', description: 'PDF page where the requirement appears' }),
      excerpt: { type: 'string', description: 'Literal excerpt from the document, up to ~300 characters' },
      mandatory: bool,
      alternativeGroup: nullable({
        type: 'string',
        description: 'Same value for requirements that are alternatives to each other (any one suffices)'
      }),
      conditional: bool,
      minQuantity: nullable(num),
      unit: nullable(str),
      allowsSum: nullable(bool),
      percentOfEstimate: nullable(num),
      amountCents: nullable(int),
      ratioName: nullable(enumOf(ratioNames)),
      minRatio: nullable(num),
      council: nullable(enumOf(councils)),
      deadline: nullable(str)
    })
  ),
  matches: array(
    object({
      requirementId: str,
      attestationId: str,
      confidence: enumOf(confidences),
      reason: str
    })
  )
});
