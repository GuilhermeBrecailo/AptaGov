import type { FilterConfig, OpportunityInput, OpportunitySource } from '../domain/types';
import { paginateAll } from '../integrations/pncp/paginator';
import type { OpportunityRepository } from '../repositories/opportunityRepository';

export interface PncpSyncClient {
  source?: OpportunitySource;
  fetchPublishedPage(query: {
    dateFrom: string;
    dateTo: string;
    state?: string;
    cityIbge?: string;
    modality?: string;
  }, page: number): Promise<{ data: Record<string, unknown>[]; totalPaginas?: number; paginasRestantes?: number; empty?: boolean }>;
}

export interface SyncResult {
  received: number;
  created: number;
  updated: number;
}

export async function syncRecords(records: OpportunityInput[], repository: OpportunityRepository): Promise<SyncResult> {
  let created = 0;
  let updated = 0;
  for (const record of records) {
    const result = repository.upsert(record);
    if (result.created) {
      created += 1;
    } else {
      updated += 1;
    }
  }
  return { received: records.length, created, updated };
}

export async function syncFromPncp(client: PncpSyncClient | PncpSyncClient[], repository: OpportunityRepository, filters: FilterConfig, today = new Date()): Promise<SyncResult> {
  const end = formatDate(today);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - filters.lookbackDays);
  const start = formatDate(startDate);
  const states = filters.states.length > 0 ? filters.states : [undefined];
  const cities = filters.citiesIbge.length > 0 ? filters.citiesIbge : [undefined];
  const modalities = filters.modalities;
  const records: OpportunityInput[] = [];
  const clients = Array.isArray(client) ? client : [client];

  for (const state of states) {
    for (const cityIbge of cities) {
      for (const modality of modalities) {
        const sourceResults = await Promise.all(clients.map(async (candidate) => {
          try {
            return {
              source: candidate.source ?? 'PNCP',
              records: await paginateAll((page) => candidate.fetchPublishedPage({ dateFrom: start, dateTo: end, state, cityIbge, modality }, page)),
            };
          } catch (error) {
            return { error };
          }
        }));
        const successfulSources = sourceResults.filter(isSuccessfulSourceResult);
        if (successfulSources.length === 0) {
          const failedSource = sourceResults.find((result) => 'error' in result);
          const error = failedSource && 'error' in failedSource ? failedSource.error : undefined;
          throw error instanceof Error ? error : new Error('No synchronization source available');
        }
        for (const result of successfulSources) {
          records.push(...result.records.map((record) => mapPncpRecord(record, result.source)));
        }
      }
    }
  }
  return syncRecords(deduplicateByPncpId(records), repository);
}

function isSuccessfulSourceResult(
  result: { source: OpportunitySource; records: Record<string, unknown>[] } | { error: unknown },
): result is { source: OpportunitySource; records: Record<string, unknown>[] } {
  return 'records' in result;
}

function deduplicateByPncpId(records: OpportunityInput[]): OpportunityInput[] {
  const unique = new Map<string, OpportunityInput>();
  for (const record of records) {
    const previous = unique.get(record.pncpId);
    if (!previous || sourcePriority(record.source) < sourcePriority(previous.source)) {
      unique.set(record.pncpId, record);
    }
  }
  return [...unique.values()];
}

function sourcePriority(source: OpportunitySource | undefined): number {
  return source === 'PNCP' || source === undefined ? 0 : 1;
}

export function mapPncpRecord(record: Record<string, unknown>, source: OpportunitySource = 'PNCP'): OpportunityInput {
  const organization = objectValue(record.orgaoEntidade);
  const unit = objectValue(record.unidadeOrgao) ?? objectValue(record.unidadeAdministrativa);
  const pncpId = firstString(record.numeroControlePNCP, record.numeroControlePncp, record.numeroControlePNCPCompra, record.id);
  if (!pncpId) {
    throw new Error('PNCP record has no stable identifier');
  }
  const year = firstNumber(record.anoCompra, record.ano);
  const sequence = firstNumber(record.sequencialCompra, record.sequencial);
  const cnpj = firstString(record.cnpjOrgao, organization?.cnpj);
  const sourceUrl = firstString(record.linkSistemaOrigem, record.urlSistemaOrigem)
    ?? (cnpj && year && sequence ? `https://pncp.gov.br/app/editais/${cnpj}/${year}/${sequence}` : `https://pncp.gov.br/app/contratacoes/${encodeURIComponent(pncpId)}`);
  const title = firstString(record.objetoCompra, record.objeto, record.titulo) ?? 'Contratação sem título';
  const description = firstString(record.informacaoComplementar, record.descricao) ?? '';
  const publicationDate = firstString(record.dataPublicacaoPncp, record.dataPublicacao, record.dataInclusao) ?? new Date().toISOString();
  const deadline = firstString(record.dataEncerramentoProposta, record.dataFimRecebimentoProposta, record.dataAberturaProposta);
  return {
    pncpId,
    source,
    title,
    description,
    organization: firstString(organization?.razaoSocial, organization?.nome, record.nomeOrgao) ?? '',
    state: firstString(unit?.ufSigla, unit?.uf, record.uf) ?? '',
    city: firstString(unit?.municipioNome, unit?.nomeMunicipio, record.municipioNome) ?? '',
    modality: firstString(record.modalidadeNome, record.modalidade) ?? '',
    sourceUrl,
    publicationDate,
    biddingDeadline: deadline,
    estimatedValueCents: moneyToCents(record.valorTotalEstimado ?? record.valorEstimado),
    raw: record,
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

function moneyToCents(value: unknown): number {
  if (typeof value === 'number') return Math.round(value * 100);
  if (typeof value !== 'string') return 0;
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}
