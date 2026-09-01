import type { SqliteDatabase } from '../db/database';
import type { FilterConfig, KanbanState, Opportunity, OpportunityInput, ClassificationSource, OpportunitySource } from '../domain/types';

type OpportunityRow = {
  id: number;
  pncp_id: string;
  source: OpportunitySource;
  title: string;
  description: string;
  organization: string;
  state: string;
  city: string;
  modality: string;
  source_url: string;
  publication_date: string;
  bidding_deadline: string | null;
  estimated_value_cents: number;
  kanban_state: KanbanState;
  score: number;
  score_breakdown_json: string;
  classification_source: ClassificationSource;
  raw_json: string;
  created_at: string;
  updated_at: string;
};

type OrganizationScoreRow = {
  organization_score: number | null;
  organization_score_breakdown_json: string | null;
  organization_classification_source: ClassificationSource | null;
};

export interface CatalogQuery {
  organizationId?: number;
  q?: string;
  minScore?: number;
  state?: string;
  page?: number;
  pageSize?: number;
  kanbanOnly?: boolean;
  feedback?: 'favorite' | 'not_relevant';
  hideNotRelevant?: boolean;
  radarFilters?: FilterConfig;
  openDeadlineOnly?: boolean;
  sort?: 'score' | 'deadline' | 'publication';
}

export interface CatalogOpportunity extends Opportunity {
  inKanban: boolean;
  favorite: boolean;
  notRelevant: boolean;
}

export interface CatalogPage {
  data: CatalogOpportunity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class OpportunityRepository {
  constructor(private readonly db: SqliteDatabase) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM opportunities').get() as { count: number }).count;
  }

  findById(id: number): Opportunity | undefined {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as OpportunityRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByPncpId(pncpId: string): Opportunity | undefined {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE pncp_id = ?').get(pncpId) as OpportunityRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(): Opportunity[] {
    const rows = this.db.prepare('SELECT * FROM opportunities ORDER BY score DESC, publication_date DESC').all() as OpportunityRow[];
    return rows.map(mapRow);
  }

  listCatalog(query: CatalogQuery = {}): CatalogPage {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 20)));
    const conditions = ['1 = 1'];
    const organizationId = query.organizationId ?? -1;
    const params: Array<string | number> = [organizationId, organizationId, organizationId];
    const search = query.q?.trim();
    if (search) {
      conditions.push('(o.title LIKE ? OR o.description LIKE ? OR o.organization LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }
    if (query.minScore !== undefined) {
      conditions.push('COALESCE(os.score, o.score) >= ?');
      params.push(Math.max(0, Math.min(100, query.minScore)));
    }
    if (query.state) {
      conditions.push('o.state = ?');
      params.push(query.state);
    }
    if (query.kanbanOnly) conditions.push('oo.opportunity_id IS NOT NULL');
    if (query.feedback === 'favorite') conditions.push("feedback.status = 'FAVORITED'");
    if (query.feedback === 'not_relevant') conditions.push("feedback.status = 'NOT_RELEVANT'");
    if (query.hideNotRelevant !== false && query.feedback !== 'not_relevant') conditions.push("(feedback.status IS NULL OR feedback.status != 'NOT_RELEVANT')");
    addRadarFilters(conditions, params, query.radarFilters);
    if (query.openDeadlineOnly) conditions.push("o.bidding_deadline IS NOT NULL AND julianday(o.bidding_deadline) > julianday('now')");
    const where = conditions.join(' AND ');
    const from = `FROM opportunities o
      LEFT JOIN organization_opportunities oo ON oo.opportunity_id = o.id AND oo.organization_id = ?
      LEFT JOIN organization_opportunity_scores os ON os.opportunity_id = o.id AND os.organization_id = ?
      LEFT JOIN opportunity_feedback feedback ON feedback.opportunity_id = o.id AND feedback.organization_id = ?`;
    const total = (this.db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(...params) as { count: number }).count;
    const rows = this.db.prepare(`
      SELECT o.*, oo.kanban_state AS organization_kanban_state,
        os.score AS organization_score,
        os.score_breakdown_json AS organization_score_breakdown_json,
        os.classification_source AS organization_classification_source,
        feedback.status AS feedback_status
      ${from}
      WHERE ${where}
      ORDER BY ${catalogOrder(query.sort)}
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as Array<OpportunityRow & OrganizationScoreRow & { organization_kanban_state: KanbanState | null; feedback_status: 'FAVORITED' | 'NOT_RELEVANT' | null }>;
    return {
      data: rows.map((row) => ({
        ...mapRowWithOrganizationScore(row),
        kanbanState: row.organization_kanban_state ?? 'NEW',
        inKanban: row.organization_kanban_state !== null,
        favorite: row.feedback_status === 'FAVORITED',
        notRelevant: row.feedback_status === 'NOT_RELEVANT',
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  addToKanban(organizationId: number, opportunityId: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO organization_opportunities (organization_id, opportunity_id, kanban_state, created_at, updated_at)
      VALUES (?, ?, 'NEW', ?, ?)
      ON CONFLICT(organization_id, opportunity_id) DO NOTHING
    `).run(organizationId, opportunityId, now, now);
  }

  findOrganizationState(organizationId: number, opportunityId: number): KanbanState | undefined {
    const row = this.db.prepare('SELECT kanban_state FROM organization_opportunities WHERE organization_id = ? AND opportunity_id = ?')
      .get(organizationId, opportunityId) as { kanban_state: KanbanState } | undefined;
    return row?.kanban_state;
  }

  updateOrganizationState(organizationId: number, opportunityId: number, state: KanbanState): void {
    this.db.prepare('UPDATE organization_opportunities SET kanban_state = ?, updated_at = ? WHERE organization_id = ? AND opportunity_id = ?')
      .run(state, new Date().toISOString(), organizationId, opportunityId);
  }

  listUnclassified(): Opportunity[] {
    const rows = this.db.prepare("SELECT * FROM opportunities WHERE score_breakdown_json = '{}' ORDER BY publication_date DESC").all() as OpportunityRow[];
    return rows.map(mapRow);
  }

  listUnclassifiedForOrganization(organizationId: number): Opportunity[] {
    const rows = this.db.prepare(`
      SELECT o.*
      FROM opportunities o
      LEFT JOIN organization_opportunity_scores os
        ON os.opportunity_id = o.id AND os.organization_id = ?
      WHERE os.opportunity_id IS NULL
      ORDER BY o.publication_date DESC
    `).all(organizationId) as OpportunityRow[];
    return rows.map(mapRow);
  }

  listCreatedSince(since: string, minimumScore = 0, organizationId?: number): Opportunity[] {
    const score = Math.max(0, Math.min(100, minimumScore));
    if (organizationId === undefined) {
      const rows = this.db.prepare('SELECT * FROM opportunities WHERE created_at >= ? AND score >= ? ORDER BY score DESC, publication_date DESC')
        .all(since, score) as OpportunityRow[];
      return rows.map(mapRow);
    }
    const rows = this.db.prepare(`
      SELECT o.*, os.score AS organization_score,
        os.score_breakdown_json AS organization_score_breakdown_json,
        os.classification_source AS organization_classification_source
      FROM opportunities o
      LEFT JOIN organization_opportunity_scores os
        ON os.opportunity_id = o.id AND os.organization_id = ?
      WHERE o.created_at >= ? AND COALESCE(os.score, o.score) >= ?
      ORDER BY COALESCE(os.score, o.score) DESC, o.publication_date DESC
    `).all(organizationId, since, score) as Array<OpportunityRow & OrganizationScoreRow>;
    return rows.map(mapRowWithOrganizationScore);
  }

  listDeadlineSoon(organizationId: number, from: string, to: string, minimumScore = 0): Opportunity[] {
    const rows = this.db.prepare(`
      SELECT o.*, os.score AS organization_score,
        os.score_breakdown_json AS organization_score_breakdown_json,
        os.classification_source AS organization_classification_source
      FROM opportunities o
      LEFT JOIN organization_opportunity_scores os
        ON os.opportunity_id = o.id AND os.organization_id = ?
      WHERE o.bidding_deadline >= ? AND o.bidding_deadline <= ?
        AND COALESCE(os.score, o.score) >= ?
        AND (
          EXISTS (SELECT 1 FROM organization_opportunities oo WHERE oo.organization_id = ? AND oo.opportunity_id = o.id)
          OR EXISTS (SELECT 1 FROM opportunity_feedback f WHERE f.organization_id = ? AND f.opportunity_id = o.id AND f.status = 'FAVORITED')
        )
      ORDER BY o.bidding_deadline ASC, COALESCE(os.score, o.score) DESC
    `).all(organizationId, from, to, Math.max(0, Math.min(100, minimumScore)), organizationId, organizationId) as Array<OpportunityRow & OrganizationScoreRow>;
    return rows.map(mapRowWithOrganizationScore);
  }

  insert(input: OpportunityInput): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO opportunities (
        pncp_id, source, title, description, organization, state, city, modality, source_url,
        publication_date, bidding_deadline, estimated_value_cents, raw_json, created_at, updated_at
      ) VALUES (@pncpId, @source, @title, @description, @organization, @state, @city, @modality, @sourceUrl,
        @publicationDate, @biddingDeadline, @estimatedValueCents, @rawJson, @now, @now)
    `).run({
      ...input,
      source: input.source ?? 'PNCP',
      city: input.city ?? '',
      modality: input.modality ?? '',
      biddingDeadline: input.biddingDeadline ?? null,
      rawJson: JSON.stringify(input.raw ?? {}),
      now,
    });
    return Number(result.lastInsertRowid);
  }

  upsert(input: OpportunityInput): { id: number; created: boolean; previous?: Opportunity; current: Opportunity } {
    const existing = this.findByPncpId(input.pncpId);
    if (existing) {
      const classificationChanged = existing.title !== input.title
        || existing.description !== input.description
        || existing.state !== input.state
        || existing.biddingDeadline !== (input.biddingDeadline ?? null)
        || existing.estimatedValueCents !== input.estimatedValueCents;
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE opportunities SET title = @title, description = @description, organization = @organization,
          source = @source, state = @state, city = @city, modality = @modality, source_url = @sourceUrl,
          publication_date = @publicationDate, bidding_deadline = @biddingDeadline,
          estimated_value_cents = @estimatedValueCents, raw_json = @rawJson, updated_at = @now
        WHERE pncp_id = @pncpId
      `).run({
        ...input,
        source: input.source ?? 'PNCP',
        city: input.city ?? '',
        modality: input.modality ?? '',
        biddingDeadline: input.biddingDeadline ?? null,
        rawJson: JSON.stringify(input.raw ?? {}),
        now,
      });
      if (classificationChanged) {
        this.db.prepare("UPDATE opportunities SET score = 0, score_breakdown_json = '{}', updated_at = ? WHERE id = ?")
          .run(now, existing.id);
        this.db.prepare('DELETE FROM organization_opportunity_scores WHERE opportunity_id = ?').run(existing.id);
      }
      return {
        id: existing.id,
        created: false,
        previous: existing,
        current: this.findById(existing.id) as Opportunity,
      };
    }
    const id = this.insert(input);
    return { id, created: true, current: this.findById(id) as Opportunity };
  }

  updateClassification(id: number, values: {
    score: number;
    breakdown: Record<string, number>;
    source: ClassificationSource;
  }): void {
    this.db.prepare(`
      UPDATE opportunities SET score = ?, score_breakdown_json = ?, classification_source = ?, updated_at = ?
      WHERE id = ?
    `).run(values.score, JSON.stringify(values.breakdown), values.source, new Date().toISOString(), id);
  }

  updateOrganizationClassification(organizationId: number, id: number, values: {
    score: number;
    breakdown: Record<string, number>;
    source: ClassificationSource;
  }): void {
    this.db.prepare(`
      INSERT INTO organization_opportunity_scores (
        organization_id, opportunity_id, score, score_breakdown_json, classification_source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, opportunity_id) DO UPDATE SET
        score = excluded.score,
        score_breakdown_json = excluded.score_breakdown_json,
        classification_source = excluded.classification_source,
        updated_at = excluded.updated_at
    `).run(
      organizationId,
      id,
      values.score,
      JSON.stringify(values.breakdown),
      values.source,
      new Date().toISOString(),
    );
  }

  updateState(id: number, state: KanbanState): void {
    this.db.prepare('UPDATE opportunities SET kanban_state = ?, updated_at = ? WHERE id = ?').run(state, new Date().toISOString(), id);
  }

  addEvent(id: number, fromState: KanbanState | null, toState: KanbanState): void {
    this.db.prepare('INSERT INTO opportunity_events (opportunity_id, from_state, to_state, created_at) VALUES (?, ?, ?, ?)')
      .run(id, fromState, toState, new Date().toISOString());
  }
}

function addRadarFilters(conditions: string[], params: Array<string | number>, filters: FilterConfig | undefined): void {
  if (!filters) return;
  if (filters.states.length > 0) {
    conditions.push(`o.state IN (${filters.states.map(() => '?').join(', ')})`);
    params.push(...filters.states);
  }
  const catalogCities = filters.citiesIbge.filter((city) => !/^\d+$/.test(city));
  if (catalogCities.length > 0) {
    conditions.push(`o.city IN (${catalogCities.map(() => '?').join(', ')})`);
    params.push(...catalogCities);
  }
  const catalogModalities = filters.modalities.filter((modality) => !/^\d+$/.test(modality));
  if (catalogModalities.length > 0) {
    conditions.push(`o.modality IN (${catalogModalities.map(() => '?').join(', ')})`);
    params.push(...catalogModalities);
  }
  if (filters.keywords.length > 0) {
    conditions.push(`(${filters.keywords.map(() => '(o.title LIKE ? OR o.description LIKE ?)').join(' OR ')})`);
    for (const keyword of filters.keywords) params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (filters.excludedKeywords.length > 0) {
    conditions.push(`NOT (${filters.excludedKeywords.map(() => '(o.title LIKE ? OR o.description LIKE ?)').join(' OR ')})`);
    for (const keyword of filters.excludedKeywords) params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (filters.estimatedValueMinCents > 0) {
    conditions.push('o.estimated_value_cents >= ?');
    params.push(filters.estimatedValueMinCents);
  }
}

function catalogOrder(sort: CatalogQuery['sort']): string {
  if (sort === 'deadline') return "CASE WHEN o.bidding_deadline IS NULL THEN 1 ELSE 0 END, o.bidding_deadline ASC, COALESCE(os.score, o.score) DESC";
  if (sort === 'publication') return 'o.publication_date DESC, COALESCE(os.score, o.score) DESC';
  return 'COALESCE(os.score, o.score) DESC, o.publication_date DESC';
}

function mapRow(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    pncpId: row.pncp_id,
    source: row.source,
    title: row.title,
    description: row.description,
    organization: row.organization,
    state: row.state,
    city: row.city,
    modality: row.modality,
    sourceUrl: row.source_url,
    publicationDate: row.publication_date,
    biddingDeadline: row.bidding_deadline,
    estimatedValueCents: row.estimated_value_cents,
    kanbanState: row.kanban_state,
    score: row.score,
    scoreBreakdown: JSON.parse(row.score_breakdown_json) as Record<string, number>,
    classificationSource: row.classification_source,
    raw: JSON.parse(row.raw_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowWithOrganizationScore(row: OpportunityRow & Partial<OrganizationScoreRow>): Opportunity {
  const opportunity = mapRow(row);
  if (row.organization_score === null || row.organization_score === undefined) return opportunity;
  return {
    ...opportunity,
    score: row.organization_score,
    scoreBreakdown: row.organization_score_breakdown_json
      ? JSON.parse(row.organization_score_breakdown_json) as Record<string, number>
      : opportunity.scoreBreakdown,
    classificationSource: row.organization_classification_source ?? opportunity.classificationSource,
  };
}
