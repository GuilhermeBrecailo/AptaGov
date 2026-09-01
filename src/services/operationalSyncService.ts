import type { SqliteDatabase } from '../db/database';
import type { OpportunityChangeType, OrganizationAlertPreferences } from '../domain/operationalTypes';
import { OrganizationAlertPreferenceRepository } from '../repositories/organizationAlertPreferenceRepository';
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
  private readonly alertPreferences: OrganizationAlertPreferenceRepository;
  private readonly notifications: NotificationService;
  private readonly pushNotifications: PushNotificationService;

  constructor(db: SqliteDatabase) {
    this.opportunities = new OpportunityRepository(db);
    this.changes = new OpportunityChangeService(new OpportunityChangeRepository(db));
    this.agenda = new AgendaService(db);
    this.alertPreferences = new OrganizationAlertPreferenceRepository(db);
    this.notifications = new NotificationService(db);
    this.pushNotifications = new PushNotificationService(db);
  }

  processEntry(entry: SyncEntry): void {
    const changes = this.changes.detectAndRecord(entry.previous, entry.current);
    const opportunity = this.opportunities.findById(entry.current.opportunityId);
    if (!opportunity) return;

    for (const organizationId of this.opportunities.listOperationalOrganizationIds(opportunity.id)) {
      const preferences = this.alertPreferences.find(organizationId);
      this.agenda.scheduleOfficialReminders(organizationId, entry.previous, entry.current);
      for (const change of changes) {
        if (!isAlertEnabled(change.type, preferences)) continue;
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

function isAlertEnabled(type: OpportunityChangeType, preferences: OrganizationAlertPreferences): boolean {
  if (type === 'PROPOSAL_DEADLINE') return preferences.proposalDeadline;
  if (type === 'SESSION_OPENING') return preferences.sessionOpening;
  if (type === 'DISPUTE_START') return preferences.disputeStart;
  return preferences.changeAlerts;
}
