import type { SqliteDatabase } from '../db/database';
import {
  PushNotificationRepository,
  type PushSubscriptionInput,
  type PushDelivery,
  type PushQueueOptions,
} from '../repositories/pushNotificationRepository';

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

  pendingCount(): number {
    return this.push.pendingCount();
  }

  async deliverPending(sender: PushSender): Promise<number> {
    let delivered = 0;
    for (const delivery of this.push.listPending()) {
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
