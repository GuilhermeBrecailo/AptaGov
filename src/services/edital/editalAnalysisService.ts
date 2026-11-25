import { createError } from 'h3';
import type { AppEnv } from '../../config/env';
import type { SqliteDatabase } from '../../db/database';
import { emptyCompanyProfile, profileHash } from '../../domain/companyProfile';
import { logger, redactLogData } from '../../observability/logger';
import { CompanyProfileRepository } from '../../repositories/companyProfileRepository';
import {
  EditalAnalysisRepository,
  type EditalAnalysisDocument,
  type EditalAnalysisRecord
} from '../../repositories/editalAnalysisRepository';
import { OpportunityRepository } from '../../repositories/opportunityRepository';
import { AgendaService } from '../agendaService';
import { estimateCostUsdMicros, ExtractionFailedError, type EditalExtractor } from './claudeExtractor';
import type { EditalExtraction } from './extraction';
import { compareRequirements, markPartial, type LotVerdict } from './compareRequirements';
import {
  DocumentTooLargeError,
  fitToBudget,
  parsePncpId,
  PncpHttpError,
  selectDocuments,
  UnsupportedDocumentError,
  UntrustedDocumentUrlError,
  type PncpDocumentClient,
  type PncpFile,
  type SelectedDocument
} from './pncpDocuments';

export type EditalAnalysisView = {
  enabled: boolean;
  disabledReason: string | null;
  analysis: EditalAnalysisRecord | null;
  lots: LotVerdict[];
  profileChanged: boolean;
  profileEmpty: boolean;
};

export type EditalAnalysisServiceDeps = {
  db: SqliteDatabase;
  env: AppEnv;
  extractor: EditalExtractor | null;
  documents: PncpDocumentClient;
  now?: () => Date;
};

const NOT_ALLOWED = 'Análise de edital não liberada para sua empresa';
const MISSING_KEY = 'Configure ANTHROPIC_API_KEY para analisar editais';
const MONTHLY_LIMIT = 'Limite mensal de análises atingido';
const NOT_AVAILABLE = 'Edital não disponível no PNCP';
const UNSUPPORTED = new UnsupportedDocumentError().message;
const GENERIC_FAILURE = 'Falha ao analisar o edital. Tente novamente mais tarde.';

const REASON_SUPERSEDED = 'Versão anterior';
const REASON_UNSUPPORTED = 'Formato não suportado';
const REASON_TOO_LARGE = 'Excede o limite de tamanho';
const REASON_UNTRUSTED = 'Link fora do PNCP';

type Downloaded = SelectedDocument & { bytes: number; data: Buffer };

function supersededKind(file: PncpFile): string {
  return file.typeName.includes('Edital') ? 'EDITAL' : 'TERMO_REFERENCIA';
}

function documentEntry(doc: { kind: string; title: string; url: string }, reason: string | null): EditalAnalysisDocument {
  return { kind: doc.kind, title: doc.title, url: doc.url, included: reason === null, reason };
}

export class EditalAnalysisService {
  private readonly env: AppEnv;
  private readonly extractor: EditalExtractor | null;
  private readonly documents: PncpDocumentClient;
  private readonly now: () => Date;
  private readonly analyses: EditalAnalysisRepository;
  private readonly profiles: CompanyProfileRepository;
  private readonly opportunities: OpportunityRepository;
  private readonly agenda: AgendaService;

  constructor(deps: EditalAnalysisServiceDeps) {
    this.env = deps.env;
    this.extractor = deps.extractor;
    this.documents = deps.documents;
    this.now = deps.now ?? (() => new Date());
    this.analyses = new EditalAnalysisRepository(deps.db);
    this.profiles = new CompanyProfileRepository(deps.db);
    this.opportunities = new OpportunityRepository(deps.db);
    this.agenda = new AgendaService(deps.db);
  }

  availability(organizationId: number): { enabled: boolean; reason: string | null } {
    if (!this.env.editalAnalysisOrganizationIds.includes(organizationId)) return { enabled: false, reason: NOT_ALLOWED };
    if (!this.extractor) return { enabled: false, reason: MISSING_KEY };
    return { enabled: true, reason: null };
  }

  start(organizationId: number, opportunityId: number): EditalAnalysisRecord {
    if (!this.env.editalAnalysisOrganizationIds.includes(organizationId)) {
      throw createError({ statusCode: 403, statusMessage: NOT_ALLOWED, message: NOT_ALLOWED });
    }
    if (!this.extractor) throw createError({ statusCode: 503, statusMessage: MISSING_KEY, message: MISSING_KEY });
    if (!this.opportunities.findById(opportunityId)) {
      throw createError({ statusCode: 404, statusMessage: 'Oportunidade não encontrada', message: 'Oportunidade não encontrada' });
    }

    const now = this.now();
    const latest = this.analyses.latest(organizationId, opportunityId, now);
    if (latest?.status === 'RUNNING') return latest;
    if (this.analyses.countThisMonth(organizationId, now) >= this.env.editalAnalysisMonthlyLimit) {
      throw createError({ statusCode: 429, statusMessage: MONTHLY_LIMIT, message: MONTHLY_LIMIT });
    }

    const record = this.analyses.createRunning(organizationId, opportunityId, profileHash(this.profiles.find(organizationId)), now);
    setImmediate(() => {
      this.run(record.id).catch((error: unknown) => {
        logger.error({ analysisId: record.id, error: redactLogData(error) }, 'Edital analysis crashed');
      });
    });
    return record;
  }

  /** Processes a RUNNING analysis. Never rejects: every failure is recorded with `fail`. */
  async run(recordId: string): Promise<void> {
    let documents: EditalAnalysisDocument[] | undefined;
    try {
      const record = this.analyses.findById(recordId);
      if (!record || record.status !== 'RUNNING') return;
      const extractor = this.extractor;
      if (!extractor) {
        this.analyses.fail(recordId, MISSING_KEY, undefined, this.now());
        return;
      }

      const opportunity = this.opportunities.findById(record.opportunityId);
      if (!opportunity || !parsePncpId(opportunity.pncpId)) {
        this.analyses.fail(recordId, NOT_AVAILABLE, undefined, this.now());
        return;
      }

      let files: PncpFile[];
      try {
        files = await this.documents.list(opportunity.pncpId);
      } catch (error) {
        // 4xx means the PNCP has no such purchase/files: retrying would only burn the monthly quota.
        if (error instanceof PncpHttpError && error.status >= 400 && error.status < 500) {
          this.analyses.fail(recordId, NOT_AVAILABLE, undefined, this.now());
          return;
        }
        throw error;
      }
      const { selected, superseded } = selectDocuments(files);
      if (selected.length === 0) {
        this.analyses.fail(recordId, NOT_AVAILABLE, undefined, this.now());
        return;
      }
      const supersededEntries = superseded.map((file) => documentEntry({ ...file, kind: supersededKind(file) }, REASON_SUPERSEDED));

      // Documents left out before the budget step, with the reason shown to the user.
      const skipped = new Map<SelectedDocument, string>(selected.filter((doc) => !doc.supported).map((doc) => [doc, REASON_UNSUPPORTED]));
      const entriesWith = (included: Set<string>): EditalAnalysisDocument[] => [
        ...selected.map((doc) => documentEntry(doc, skipped.get(doc) ?? (included.has(doc.url) ? null : REASON_TOO_LARGE))),
        ...supersededEntries
      ];

      const downloaded: Downloaded[] = [];
      for (const doc of selected) {
        if (skipped.has(doc)) continue;
        try {
          const data = await this.documents.download(doc.url);
          downloaded.push({ ...doc, bytes: data.length, data });
        } catch (error) {
          if (error instanceof UnsupportedDocumentError) skipped.set(doc, REASON_UNSUPPORTED);
          else if (error instanceof UntrustedDocumentUrlError) skipped.set(doc, REASON_UNTRUSTED);
          else if (error instanceof DocumentTooLargeError) {
            skipped.set(doc, REASON_TOO_LARGE);
            // Edital alone over the limit: spec decision 6 says the analysis fails.
            if (doc.kind === 'EDITAL') {
              documents = entriesWith(new Set());
              throw error;
            }
          } else throw error;
        }
      }

      if (downloaded.length === 0) {
        documents = entriesWith(new Set());
        const reasons = new Set(skipped.values());
        if (reasons.has(REASON_TOO_LARGE)) throw new DocumentTooLargeError();
        if (reasons.has(REASON_UNTRUSTED) && !reasons.has(REASON_UNSUPPORTED)) throw new UntrustedDocumentUrlError();
        this.analyses.fail(recordId, UNSUPPORTED, documents, this.now());
        return;
      }

      let budget: { included: Downloaded[]; partial: boolean };
      try {
        budget = fitToBudget(downloaded);
      } catch (error) {
        // Edital alone (or every document) exceeds the budget: nothing is analyzed.
        documents = entriesWith(new Set());
        throw error;
      }
      documents = entriesWith(new Set(budget.included.map((doc) => doc.url)));
      if (budget.included.length === 0) throw new DocumentTooLargeError();

      const profile = this.profiles.find(record.organizationId);
      const result = await extractor.extract({
        documents: budget.included.map((doc) => ({ kind: doc.kind, title: doc.title, data: doc.data })),
        profile
      });

      this.analyses.complete(recordId, {
        profileHash: profileHash(profile),
        documents,
        partial: budget.partial || skipped.size > 0,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsdMicros: estimateCostUsdMicros(result.model, result.inputTokens, result.outputTokens),
        extraction: result.extraction
      }, this.now());
      this.applyAgendaDeadlines(record.organizationId, record.opportunityId, result.extraction);
    } catch (error) {
      this.recordFailure(recordId, error, documents);
    }
  }

  view(organizationId: number, opportunityId: number): EditalAnalysisView {
    const availability = this.availability(organizationId);
    const now = this.now();
    const profile = this.profiles.find(organizationId);
    const currentHash = profileHash(profile);
    const analysis = this.analyses.latest(organizationId, opportunityId, now) ?? null;

    let lots: LotVerdict[] = [];
    if (analysis?.status === 'COMPLETED' && analysis.extraction) {
      const opportunity = this.opportunities.findById(opportunityId);
      lots = compareRequirements({
        extraction: analysis.extraction,
        profile,
        opportunityEstimatedValueCents: opportunity?.estimatedValueCents ?? 0,
        now
      });
      if (analysis.partial) lots = markPartial(lots);
    }

    return {
      enabled: availability.enabled,
      disabledReason: availability.reason,
      analysis,
      lots,
      profileChanged: analysis !== null && analysis.profileHash !== currentHash,
      profileEmpty: currentHash === profileHash(emptyCompanyProfile())
    };
  }

  /** The Agenda is a side effect: a failure here is logged and never fails the analysis. */
  private applyAgendaDeadlines(organizationId: number, opportunityId: number, extraction: EditalExtraction): void {
    try {
      this.agenda.applyEditalDeadlines(organizationId, opportunityId, {
        challenge: extraction.summary.challengeDeadline,
        clarification: extraction.summary.clarificationDeadline
      });
    } catch (error) {
      logger.error({ opportunityId, error: redactLogData(error) }, 'Could not apply edital deadlines to the agenda');
    }
  }

  private recordFailure(recordId: string, error: unknown, documents: EditalAnalysisDocument[] | undefined): void {
    const known = error instanceof ExtractionFailedError
      || error instanceof UnsupportedDocumentError
      || error instanceof DocumentTooLargeError
      || error instanceof UntrustedDocumentUrlError;
    if (!known) {
      logger.error({ analysisId: recordId, error: redactLogData(error) }, 'Edital analysis failed');
    }
    try {
      this.analyses.fail(recordId, known ? (error as Error).message : GENERIC_FAILURE, documents, this.now());
    } catch (failError) {
      logger.error({ analysisId: recordId, error: redactLogData(failError) }, 'Could not record edital analysis failure');
    }
  }
}
