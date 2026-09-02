import type { SqliteDatabase } from '../db/database';
import type { FilterConfig } from '../domain/types';
import { OpportunityRepository } from '../repositories/opportunityRepository';
import {
  PushNotificationRepository,
  type PushSubscriptionInput,
  type PushDelivery,
  type PushQueueOptions,
  type OperationalPushInput,
} from '../repositories/pushNotificationRepository';
import { scoreOpportunity } from './scoring/ruleScorer';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface PushSender {
  send(subscription: PushDelivery, message: PushMessage): Promise<{ providerId?: string }>;
}

export class ExpiredPushSubscriptionError extends Error {
  constructor(message = 'Assinatura de notificação expirada') {
    super(message);
    this.name = 'ExpiredPushSubscriptionError';
  }
}

export class PushNotificationService {
  private readonly push: PushNotificationRepository;

  constructor(private readonly db: SqliteDatabase) {
    this.push = new PushNotificationRepository(db);
  }

  isConfigured(subject: string, publicKey: string, privateKey: string): boolean {
    return Boolean(subject && publicKey && privateKey);
  }

  registerSubscription(userId: number, input: PushSubscriptionInput): void {
    this.push.upsertSubscription(userId, input);
  }

  removeSubscription(userId: number, endpoint: string): void {
    this.push.removeForUser(userId, endpoint);
  }

  subscriptionCount(userId: number): number {
    return this.push.countForUser(userId);
  }

  queueRecent(since: string, limit = Number.POSITIVE_INFINITY, options: PushQueueOptions = {}): number {
    return this.push.queueRecent(since, limit, options);
  }

  queueRecentForRadar(organizationId: number, filters: FilterConfig, since: string, limit = Number.POSITIVE_INFINITY): number {
    const opportunities = new OpportunityRepository(this.db).listCreatedSince(since, 0, organizationId).filter((opportunity) => {
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
      return !score.excluded && score.score >= filters.minimumScore;
    });
    return this.queueRecent(since, limit, {
      organizationId,
      opportunityIds: opportunities.map((opportunity) => opportunity.id),
    });
  }

  queueUpcomingDeadlines(organizationId: number, from: string, to: string, limit = Number.POSITIVE_INFINITY): number {
    return this.push.queueUpcomingDeadlines(organizationId, from, to, limit);
  }

  queueOperationalAlert(input: OperationalPushInput): number {
    return this.push.queueOperationalAlert(input);
  }

  pendingCount(organizationId?: number): number {
    return this.push.pendingCount(organizationId);
  }

  async deliverPending(sender: PushSender, organizationId?: number): Promise<number> {
    let delivered = 0;
    for (const delivery of this.push.listPending(100, organizationId)) {
      try {
        const result = await sender.send(delivery, {
          title: delivery.title,
          body: delivery.body,
          url: delivery.url,
        });
        this.push.markSent(delivery.id, result.providerId);
        delivered += 1;
      } catch (error) {
        if (error instanceof ExpiredPushSubscriptionError) this.push.removeSubscription(delivery.subscriptionId);
        else this.push.markFailed(delivery.id, error instanceof Error ? error.message : 'Falha desconhecida no canal de notificação');
        throw error;
      }
    }
    return delivered;
  }
}
