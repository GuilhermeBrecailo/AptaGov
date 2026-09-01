import type { EmailMessage, NotificationSender } from '../../services/notificationService';

export class ResendEmailNotifier implements NotificationSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(message: EmailMessage): Promise<{ providerId?: string }> {
    if (!this.apiKey || !this.from) throw new Error('Credenciais de e-mail não configuradas');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.body }),
    });
    if (!response.ok) throw new Error(`Canal de e-mail indisponível (HTTP ${response.status})`);
    const data = await response.json() as { id?: string };
    return { providerId: data.id };
  }
}
