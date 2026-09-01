import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { FilterConfig } from '../domain/types';

const filterSchema = z.object({
  lookbackDays: z.number().int().positive(),
  states: z.array(z.string()),
  citiesIbge: z.array(z.string()),
  modalities: z.array(z.string()).min(1),
  keywords: z.array(z.string()),
  excludedKeywords: z.array(z.string()),
  minimumScore: z.number().min(0).max(100),
  estimatedValueMinCents: z.number().int().min(0),
  scoreWeights: z.object({
    keyword: z.number().min(0),
    region: z.number().min(0),
    value: z.number().min(0),
    deadline: z.number().min(0),
  }),
});

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadFilters(filePath = resolve(projectRoot, 'config/filters.json')): FilterConfig {
  return filterSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
}

export function saveFilters(filters: FilterConfig, filePath = resolve(projectRoot, 'config/filters.json')): FilterConfig {
  const valid = filterSchema.parse(filters);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(valid, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return valid;
}

export const filterConfigSchema = filterSchema;
