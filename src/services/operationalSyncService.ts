import type { SqliteDatabase } from '../db/database';
import { OpportunityChangeRepository } from '../repositories/opportunityChangeRepository';
import { OpportunityRepository } from '../repositories/opportunityRepository';
import { AgendaService } from './agendaService';
import { NotificationService } from './notificationService';
import { OpportunityChangeService } from './opportunityChangeService';
import { PushNotificationService } from './pushNotificationService';
import type { SyncEntry } from './syncService';

export class OperationalSyncService {
  private readonly opportunities: OpportunityRepository;
  private readonly changes: OpportunityChangeService;
  private readonly agenda: AgendaService;
  private readonly notifications: NotificationService;
  private readonly pushNotifications: PushNotificationService;

  constructor(db: SqliteDatabase) {
    this.opportunities = new OpportunityRepository(db);
    this.changes = new OpportunityChangeService(new OpportunityChangeRepository(db));
    this.agenda = new AgendaService(db);
    this.notifications = new NotificationService(db);
    this.pushNotifications = new PushNotificationService(db);
  }

  processEntry(entry: SyncEntry): void {
    const changes = this.changes.detectAndRecord(entry.previous, entry.current);
    const opportunity = this.opportunities.findById(entry.current.opportunityId);
    if (!opportunity) return;

    for (const organizationId of this.opportunities.listOperationalOrganizationIds(opportunity.id)) {
      this.agenda.scheduleOfficialReminders(organizationId, entry.previous, entry.current);
      for (const change of changes) {
        const eventKey = `opportunity-change:${organizationId}:${opportunity.id}:${change.id}`;
        const subject = `Mudança oficial: ${opportunity.title.slice(0, 90)}`;
        const body = `${change.summary}\nAcesse: ${opportunity.sourceUrl}`;
        this.notifications.queueOperationalAlert({
          organizationId,
          opportunityId: opportunity.id,
          subject,
          body,
          eventType: 'OPPORTUNITY_CHANGE',
          eventKey,
        });
        this.pushNotifications.queueOperationalAlert({
          organizationId,
          opportunityId: opportunity.id,
          title: subject,
          body: change.summary,
          url: opportunity.sourceUrl,
          eventType: 'OPPORTUNITY_CHANGE',
          eventKey,
        });
      }
    }
  }
}
