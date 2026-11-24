import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../db/database';
import { editalExtractionSchema, type EditalExtraction } from '../services/edital/extraction';

export type EditalAnalysisStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export type EditalAnalysisDocument = {
  kind: string;
  title: string;
  url: string;
  included: boolean;
  reason: string | null;
};

export type EditalAnalysisRecord = {
  id: string;
  organizationId: number;
  opportunityId: number;
  status: EditalAnalysisStatus;
  profileHash: string;
  documents: EditalAnalysisDocument[];
  partial: boolean;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdMicros: number | null;
  extraction: EditalExtraction | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompleteAnalysisData = {
  profileHash: string;
  documents: EditalAnalysisDocument[];
  partial: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  extraction: EditalExtraction;
};

/** A RUNNING analysis not touched for this long is treated as interrupted. */
export const STALE_RUNNING_MS = 15 * 60_000;
export const INTERRUPTED_MESSAGE = 'Análise interrompida';

type Row = {
  id: string;
  organization_id: number;
  opportunity_id: number;
  status: EditalAnalysisStatus;
  profile_hash: string;
  documents_json: string | null;
  partial: number;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd_micros: number | null;
  extraction_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export class EditalAnalysisRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createRunning(organizationId: number, opportunityId: number, profileHash: string, now: Date = new Date()): EditalAnalysisRecord {
    const id = randomUUID();
    const timestamp = now.toISOString();
    this.db.prepare(`
      INSERT INTO edital_analyses (id, organization_id, opportunity_id, status, profile_hash, documents_json, partial, created_at, updated_at)
      VALUES (?, ?, ?, 'RUNNING', ?, '[]', 0, ?, ?)
    `).run(id, organizationId, opportunityId, profileHash, timestamp, timestamp);
    return this.findById(id) as EditalAnalysisRecord;
  }

  findById(id: string): EditalAnalysisRecord | undefined {
    const row = this.db.prepare('SELECT * FROM edital_analyses WHERE id = ?').get(id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }

  complete(id: string, data: CompleteAnalysisData, now: Date = new Date()): void {
    this.db.prepare(`
      UPDATE edital_analyses
      SET status = 'COMPLETED', profile_hash = ?, documents_json = ?, partial = ?, model = ?, input_tokens = ?,
          output_tokens = ?, cost_usd_micros = ?, extraction_json = ?, error = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      data.profileHash,
      JSON.stringify(data.documents),
      data.partial ? 1 : 0,
      data.model,
      data.inputTokens,
      data.outputTokens,
      data.costUsdMicros,
      JSON.stringify(data.extraction),
      now.toISOString(),
      id
    );
  }

  fail(id: string, message: string, documents?: EditalAnalysisDocument[], now: Date = new Date()): void {
    this.db.prepare(`
      UPDATE edital_analyses
      SET status = 'FAILED', error = ?, documents_json = COALESCE(?, documents_json), updated_at = ?
      WHERE id = ?
    `).run(message, documents ? JSON.stringify(documents) : null, now.toISOString(), id);
  }

  /** Latest analysis for the opportunity; a RUNNING one older than 15 min is marked FAILED on read. */
  latest(organizationId: number, opportunityId: number, now: Date = new Date()): EditalAnalysisRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM edital_analyses
      WHERE organization_id = ? AND opportunity_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(organizationId, opportunityId) as Row | undefined;
    if (!row) return undefined;
    if (row.status === 'RUNNING' && now.getTime() - Date.parse(row.updated_at) > STALE_RUNNING_MS) {
      this.db.prepare(`
        UPDATE edital_analyses SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ? AND status = 'RUNNING'
      `).run(INTERRUPTED_MESSAGE, now.toISOString(), row.id);
      return this.findById(row.id);
    }
    return toRecord(row);
  }

  /** Every analysis created in the UTC calendar month of `now`, whatever its status. */
  countThisMonth(organizationId: number, now: Date): number {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM edital_analyses
      WHERE organization_id = ? AND created_at >= ? AND created_at < ?
    `).get(organizationId, start, end) as { total: number };
    return row.total;
  }
}

function toRecord(row: Row): EditalAnalysisRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    profileHash: row.profile_hash,
    documents: row.documents_json ? (JSON.parse(row.documents_json) as EditalAnalysisDocument[]) : [],
    partial: row.partial === 1,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsdMicros: row.cost_usd_micros,
    extraction: row.extraction_json ? editalExtractionSchema.parse(JSON.parse(row.extraction_json)) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
