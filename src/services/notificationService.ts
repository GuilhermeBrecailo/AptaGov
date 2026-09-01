import type { SqliteDatabase } from '../db/database';
import type { Opportunity } from '../domain/types';
import { loadFilters } from '../config/filters';
import { NotificationRepository, type NotificationSettings } from '../repositories/notificationRepository';
import { OrganizationFilterRepository } from '../repositories/organizationFilterRepository';
import { OpportunityRepository } from '../repositories/opportunityRepository';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface NotificationSender {
  send(message: EmailMessage): Promise<{ providerId?: string }>;
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

  async deliverPending(sender: NotificationSender): Promise<number> {
    let delivered = 0;
    for (const delivery of this.notifications.listPending()) {
      try {
        const result = await sender.send({ to: delivery.recipient, subject: delivery.subject, body: delivery.body });
        this.notifications.markSent(delivery.id, result.providerId);
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha desconhecida no canal de notificação';
        this.notifications.markFailed(delivery.id, message);
        throw error;
      }
    }
    return delivered;
  }

  pendingCount(organizationId?: number): number {
    return this.notifications.pendingCount(organizationId);
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

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
}

function buildNotification(settings: NotificationSettings, opportunity: Opportunity) {
  return {
    organizationId: settings.organizationId,
    opportunityId: opportunity.id,
    recipient: settings.email,
    subject: `Nova licitação aderente: ${opportunity.title.slice(0, 90)}`,
    body: [
      `Score de aderência: ${opportunity.score}/100`,
      `Órgão: ${opportunity.organization}`,
      `Estado: ${opportunity.state}`,
      `Prazo: ${opportunity.biddingDeadline ?? 'não informado'}`,
      `Acesse: ${opportunity.sourceUrl}`,
    ].join('\n'),
  };
}
