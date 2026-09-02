import { createHash } from 'node:crypto';
import type { OpportunityChangeEvent, OpportunityChangeType, OpportunityOfficialSnapshot } from '../domain/operationalTypes';
import type { Opportunity } from '../domain/types';
import type { OpportunityChangeRepository } from '../repositories/opportunityChangeRepository';

type ChangeField = Exclude<keyof OpportunityOfficialSnapshot, 'opportunityId' | 'sourceCode' | 'fingerprint'>;

interface DetectedChange {
  type: OpportunityChangeType;
  summary: string;
  payload: Record<string, unknown>;
}

export class OpportunityChangeService {
  constructor(private readonly changes: OpportunityChangeRepository) {}

  detectAndRecord(
    previous: OpportunityOfficialSnapshot | undefined,
    current: OpportunityOfficialSnapshot,
  ): OpportunityChangeEvent[] {
    if (!previous || previous.fingerprint === current.fingerprint) return [];

    const detected = detectChanges(previous, current);
    const detectedAt = new Date().toISOString();
    return detected.flatMap((change) => {
      const recorded = this.changes.record({
        opportunityId: current.opportunityId,
        sourceCode: current.sourceCode,
        type: change.type,
        fingerprint: hashCanonical({ type: change.type, payload: change.payload }),
        summary: change.summary,
        payload: change.payload,
        detectedAt,
      });
      return recorded.created ? [recorded.event] : [];
    });
  }

  listForOrganization(organizationId: number, opportunityId: number, unreadOnly = false): OpportunityChangeEvent[] {
    return this.changes.listForOrganization(organizationId, opportunityId, unreadOnly);
  }

  listAllForOrganization(organizationId: number, unreadOnly = false): OpportunityChangeEvent[] {
    return this.changes.listForOrganization(organizationId, undefined, unreadOnly);
  }

  markRead(organizationId: number, opportunityId: number, changeId: number): OpportunityChangeEvent | undefined {
    const visible = this.changes.listForOrganization(organizationId, opportunityId)
      .find((event) => event.id === changeId);
    if (!visible || !this.changes.markRead(organizationId, changeId)) return undefined;
    return this.changes.listForOrganization(organizationId, opportunityId)
      .find((event) => event.id === changeId);
  }
}

export function normalizeOpportunitySnapshot(opportunity: Opportunity): OpportunityOfficialSnapshot {
  const raw = asRecord(opportunity.raw);
  const snapshot = {
    opportunityId: opportunity.id,
    sourceCode: opportunity.source,
    biddingDeadline: normalizeText(opportunity.biddingDeadline),
    sessionOpening: firstText(raw.dataAberturaSessaoPublica, raw.dataAberturaProposta, raw.dataAberturaSessao),
    disputeStart: firstText(raw.dataInicioDisputa, raw.dataHoraInicioDisputa),
    closingResult: firstText(raw.situacaoCompra, raw.statusCompra, raw.resultado),
    title: opportunity.title.trim(),
    description: opportunity.description.trim(),
    estimatedValueCents: opportunity.estimatedValueCents,
    editalUrl: firstText(raw.linkEdital, raw.urlEdital, raw.linkArquivo),
    officialFiles: normalizeOfficialFiles(raw.arquivos ?? raw.documentos ?? raw.anexos),
  };
  return { ...snapshot, fingerprint: hashCanonical(snapshot) };
}

function detectChanges(previous: OpportunityOfficialSnapshot, current: OpportunityOfficialSnapshot): DetectedChange[] {
  const changes: DetectedChange[] = [];
  addDirectChange(changes, previous, current, 'biddingDeadline', 'PROPOSAL_DEADLINE', 'Prazo de propostas alterado');
  addDirectChange(changes, previous, current, 'sessionOpening', 'SESSION_OPENING', 'Abertura da sessão alterada');
  addDirectChange(changes, previous, current, 'disputeStart', 'DISPUTE_START', 'Início da disputa alterado');
  addDirectChange(changes, previous, current, 'closingResult', 'CLOSING_RESULT', 'Encerramento ou resultado alterado');

  const sourceFields: ChangeField[] = ['title', 'description', 'estimatedValueCents', 'editalUrl', 'officialFiles'];
  const sourceChanges = Object.fromEntries(sourceFields.flatMap((field) => (
    equalCanonical(previous[field], current[field])
      ? []
      : [[field, { from: previous[field], to: current[field] }]]
  )));
  if (Object.keys(sourceChanges).length > 0) {
    changes.push({
      type: 'SOURCE_UPDATE',
      summary: 'Fonte oficial atualizada',
      payload: { changes: sourceChanges },
    });
  }
  return changes;
}

function addDirectChange(
  changes: DetectedChange[],
  previous: OpportunityOfficialSnapshot,
  current: OpportunityOfficialSnapshot,
  field: ChangeField,
  type: OpportunityChangeType,
  summary: string,
): void {
  if (equalCanonical(previous[field], current[field])) return;
  changes.push({ type, summary, payload: { from: previous[field], to: current[field] } });
}

function normalizeOfficialFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item.trim();
    const file = asRecord(item);
    return JSON.stringify({
      id: firstText(file.id, file.identificador, file.sequencialDocumento),
      name: firstText(file.nome, file.titulo, file.tipoDocumentoNome),
      url: firstText(file.url, file.link, file.uri),
      hash: firstText(file.hash, file.checksum),
    });
  }).filter(Boolean).sort();
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}
