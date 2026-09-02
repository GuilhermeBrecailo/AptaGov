import type { SqliteDatabase } from '../db/database';
import type { Opportunity } from '../domain/types';
import type { FilterConfig } from '../domain/types';
import { loadFilters } from '../config/filters';
import { NotificationRepository, DEFAULT_NOTIFICATION_LEASE_MS, type NotificationSettings } from '../repositories/notificationRepository';
import { OrganizationFilterRepository } from '../repositories/organizationFilterRepository';
import { OpportunityRepository } from '../repositories/opportunityRepository';
import { scoreOpportunity } from './scoring/ruleScorer';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  idempotencyKey?: string;
}

export interface NotificationSender {
  send(message: EmailMessage): Promise<{ providerId?: string }>;
}

export interface OperationalEmailAlert {
  organizationId: number;
  opportunityId: number;
  subject: string;
  body: string;
  eventType: string;
  eventKey: string;
}

export interface NotificationDeliveryOptions {
  owner?: string;
  leaseMs?: number;
}

export class NotificationService {
  private readonly notifications: NotificationRepository;
  private readonly opportunities: OpportunityRepository;

  constructor(private readonly db: SqliteDatabase) {
    this.notifications = new NotificationRepository(db);
    this.opportunities = new OpportunityRepository(db);
  }

  queueRecent(organizationId: number, since: string, minimumScore = 0, limit = Number.POSITIVE_INFINITY): number {
    const settings = this.notifications.findSettings(organizationId);
    if (!settings?.enabled) return 0;
    const recent = this.opportunities.listCreatedSince(since, minimumScore, organizationId);
    let remaining = normalizeLimit(limit);
    return recent.reduce((count, opportunity) => {
      if (remaining <= 0) return count;
      const queued = this.notifications.enqueue(buildNotification(settings, opportunity));
      if (queued) remaining -= 1;
      return count + (queued ? 1 : 0);
    }, 0);
  }

  queueRecentForRadar(organizationId: number, filters: FilterConfig, since: string, limit = Number.POSITIVE_INFINITY): number {
    const settings = this.notifications.findSettings(organizationId);
    if (!settings?.enabled) return 0;
    let remaining = normalizeLimit(limit);
    return this.opportunities.listCreatedSince(since, 0, organizationId).reduce((count, opportunity) => {
      if (remaining <= 0) return count;
      const score = scoreOpportunity({
        title: opportunity.title,
        description: opportunity.description,
        state: opportunity.state,
        estimatedValueCents: opportunity.estimatedValueCents,
        deadline: opportunity.biddingDeadline,
      }, {
        keywords: filters.keywords,
        excludedKeywords: filters.excludedKeywords,
        states: filters.states,
        estimatedValueMinCents: filters.estimatedValueMinCents,
        scoreWeights: filters.scoreWeights,
      });
      if (score.excluded || score.score < filters.minimumScore) return count;
      const scoredOpportunity = { ...opportunity, score: score.score, scoreBreakdown: score.breakdown };
      const queued = this.notifications.enqueue(buildNotification(settings, scoredOpportunity));
      if (queued) remaining -= 1;
      return count + (queued ? 1 : 0);
    }, 0);
  }

  queueUpcomingDeadlines(organizationId: number, from: string, to: string, limit = Number.POSITIVE_INFINITY): number {
    const settings = this.notifications.findSettings(organizationId);
    if (!settings?.enabled) return 0;
    const filters = new OrganizationFilterRepository(this.db).find(organizationId) ?? loadFilters();
    let remaining = normalizeLimit(limit);
    return this.opportunities.listDeadlineSoon(organizationId, from, to, filters.minimumScore).reduce((count, opportunity) => {
      if (remaining <= 0) return count;
      const queued = this.notifications.enqueue(buildNotification(settings, opportunity, 'DEADLINE_SOON', 'deadline_48h'));
      if (queued) remaining -= 1;
      return count + (queued ? 1 : 0);
    }, 0);
  }

  queueOperationalAlert(input: OperationalEmailAlert): boolean {
    const settings = this.notifications.findSettings(input.organizationId);
    if (!settings?.enabled) return false;
    return this.notifications.enqueueOperational({
      ...input,
      recipient: settings.email,
    });
  }

  queueRecentForEnabledOrganizations(
    since: string,
    limit = Number.POSITIVE_INFINITY,
    canUseOrganization: (organizationId: number) => boolean = () => true,
  ): number {
    return this.queueRecentForOrganizations(since, limit, undefined, canUseOrganization);
  }

  queueRecentForOrganizations(
    since: string,
    limit = Number.POSITIVE_INFINITY,
    organizationIds?: ReadonlySet<number>,
    canUseOrganization: (organizationId: number) => boolean = () => true,
  ): number {
    const filters = new OrganizationFilterRepository(this.opportunitiesDatabase());
    let remaining = normalizeLimit(limit);
    return this.notifications.listEnabledSettings().reduce((count, settings) => {
      if (remaining <= 0) return count;
      if (organizationIds && !organizationIds.has(settings.organizationId)) return count;
      if (!canUseOrganization(settings.organizationId)) return count;
      const organizationFilters = filters.find(settings.organizationId) ?? loadFilters();
      const queued = this.queueRecent(settings.organizationId, since, organizationFilters.minimumScore, remaining);
      remaining -= queued;
      return count + queued;
    }, 0);
  }

  async deliverPending(sender: NotificationSender, organizationId?: number, options: NotificationDeliveryOptions = {}): Promise<number> {
    let delivered = 0;
    const owner = options.owner ?? deliveryOwner('email');
    const leaseMs = options.leaseMs ?? DEFAULT_NOTIFICATION_LEASE_MS;
    while (true) {
      const delivery = this.notifications.claimNext(owner, leaseMs, organizationId);
      if (!delivery) break;
      try {
        const result = await withDeliveryLease(
          delivery.id,
          owner,
          leaseMs,
          () => this.notifications.renew(delivery.id, owner, leaseMs),
          () => sender.send({
            to: delivery.recipient,
            subject: delivery.subject,
            body: delivery.body,
            idempotencyKey: emailDeliveryKey(delivery.organizationId, delivery.opportunityId, delivery.eventKey),
          }),
        );
        if (!this.notifications.markSent(delivery.id, result.providerId, owner)) {
          throw new Error('Lease da entrega de e-mail perdido antes da confirmação');
        }
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha desconhecida no canal de notificação';
        this.notifications.markFailed(delivery.id, message, owner);
        throw error;
      }
    }
    return delivered;
  }

  pendingCount(organizationId?: number): number {
    return this.notifications.pendingCount(organizationId);
  }

  hasRecentSuccess(since: string): boolean {
    return this.notifications.hasRecentSuccess(since);
  }

  settings(organizationId: number): NotificationSettings | undefined {
    return this.notifications.findSettings(organizationId);
  }

  saveSettings(organizationId: number, settings: Omit<NotificationSettings, 'organizationId'>): NotificationSettings {
    return this.notifications.saveSettings(organizationId, settings);
  }

  private opportunitiesDatabase(): SqliteDatabase {
    return this.db;
  }
}

function deliveryOwner(channel: string): string {
  return `${channel}:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function emailDeliveryKey(organizationId: number, opportunityId: number, eventKey: string): string {
  return `aptagov:email:${organizationId}:${opportunityId}:${encodeURIComponent(eventKey)}`;
}

async function withDeliveryLease<T>(
  id: number,
  owner: string,
  leaseMs: number,
  renew: () => boolean,
  operation: () => Promise<T>,
): Promise<T> {
  const intervalMs = Math.max(10, Math.min(60_000, Math.floor(Math.max(1, leaseMs) / 3)));
  let leaseLost = false;
  const timer = setInterval(() => {
    if (!renew()) leaseLost = true;
  }, intervalMs);
  try {
    const result = await operation();
    if (leaseLost) throw new Error(`Lease da entrega ${id} perdida durante o envio por ${owner}`);
    return result;
  } finally {
    clearInterval(timer);
  }
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
}

function buildNotification(settings: NotificationSettings, opportunity: Opportunity, eventType = 'NEW_OPPORTUNITY', eventKey = 'new_opportunity') {
  const deadlineEvent = eventType === 'DEADLINE_SOON';
  return {
    organizationId: settings.organizationId,
    opportunityId: opportunity.id,
    recipient: settings.email,
    subject: `${deadlineEvent ? 'Prazo próximo' : 'Nova licitação aderente'}: ${opportunity.title.slice(0, 90)}`,
    body: [
      `Score de aderência: ${opportunity.score}/100`,
      `Órgão: ${opportunity.organization}`,
      `Estado: ${opportunity.state}`,
      `Prazo: ${opportunity.biddingDeadline ?? 'não informado'}`,
      `Acesse: ${opportunity.sourceUrl}`,
    ].join('\n'),
    eventType,
    eventKey,
  };
}
