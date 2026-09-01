import webpush from 'web-push';
import type { PushDelivery } from '../../repositories/pushNotificationRepository';
import { ExpiredPushSubscriptionError, type PushMessage, type PushSender } from '../../services/pushNotificationService';

export class WebPushNotifier implements PushSender {
  constructor(private readonly subject: string, private readonly publicKey: string, private readonly privateKey: string) {
    if (subject && publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(subscription: PushDelivery, message: PushMessage): Promise<{ providerId?: string }> {
    if (!this.subject || !this.publicKey || !this.privateKey) throw new Error('Credenciais de notificações do dispositivo não configuradas');
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(message));
      return {};
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) throw new ExpiredPushSubscriptionError('Assinatura de notificação não encontrada');
      throw new Error(`Canal de notificações do dispositivo indisponível${statusCode ? ` (HTTP ${statusCode})` : ''}`);
    }
  }
}
