import type { SqliteDatabase } from '../db/database';
import type { FilterConfig } from '../domain/types';
import { OpportunityRepository } from '../repositories/opportunityRepository';
import {
  PushNotificationRepository,
  DEFAULT_PUSH_LEASE_MS,
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
  eventId: string;
  dedupeKey: string;
}

export interface PushSender {
  send(subscription: PushDelivery, message: PushMessage): Promise<{ providerId?: string }>;
}

export interface PushDeliveryOptions {
  owner?: string;
  leaseMs?: number;
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

  hasRecentSuccess(since: string): boolean {
    return this.push.hasRecentSuccess(since);
  }

  async deliverPending(sender: PushSender, organizationId?: number, options: PushDeliveryOptions = {}): Promise<number> {
    let delivered = 0;
    const owner = options.owner ?? deliveryOwner('push');
    const leaseMs = options.leaseMs ?? DEFAULT_PUSH_LEASE_MS;
    while (true) {
      const delivery = this.push.claimNext(owner, leaseMs, organizationId);
      if (!delivery) break;
      try {
        const result = await withDeliveryLease(
          delivery.id,
          owner,
          leaseMs,
          () => this.push.renew(delivery.id, owner, leaseMs),
          () => sender.send(delivery, {
            title: delivery.title,
            body: delivery.body,
            url: delivery.url,
            eventId: `${delivery.opportunityId}:${delivery.eventKey}`,
            dedupeKey: `push:${delivery.subscriptionId}:${delivery.opportunityId}:${encodeURIComponent(delivery.eventKey)}`,
          }),
        );
        if (!this.push.markSent(delivery.id, result.providerId, owner)) {
          throw new Error('Lease da entrega push perdido antes da confirmação');
        }
        delivered += 1;
      } catch (error) {
        if (error instanceof ExpiredPushSubscriptionError) this.push.removeSubscription(delivery.subscriptionId);
        else this.push.markFailed(delivery.id, error instanceof Error ? error.message : 'Falha desconhecida no canal de notificação', owner);
        throw error;
      }
    }
    return delivered;
  }
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

function deliveryOwner(channel: string): string {
  return `${channel}:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
