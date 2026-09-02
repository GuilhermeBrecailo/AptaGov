import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadEnv } from '../src/config/env';
import { loadFilters } from '../src/config/filters';
import { createDatabase, type SqliteDatabase } from '../src/db/database';
import { PncpClient } from '../src/integrations/pncp/PncpClient';
import { OpenDataClient } from '../src/integrations/pncp/OpenDataClient';
import { ResendEmailNotifier } from '../src/integrations/notifications/ResendEmailNotifier';
import { AgendaService } from '../src/services/agendaService';
import { createDatabaseBackup, validateDatabaseBackupArtifact } from '../src/services/backupService';
import { ChecklistService } from '../src/services/checklistService';
import { classifyOrganizationOpportunities } from '../src/services/scoring/classificationService';
import { MarketIntelligenceService } from '../src/services/marketIntelligenceService';
import { MarketRepository } from '../src/repositories/marketRepository';
import { ChecklistRepository } from '../src/repositories/checklistRepository';
import { NotificationService } from '../src/services/notificationService';
import { OperationalSyncService } from '../src/services/operationalSyncService';
import { OpportunityRepository } from '../src/repositories/opportunityRepository';
import { syncFromPncp } from '../src/services/syncService';

export interface OperationalE2EChannels {
  resendApiKey: string;
  notificationEmailFrom: string;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
}

export interface OperationalE2EConfig {
  databaseUrl: string;
  allowNotificationDelivery: boolean;
  notificationEmail: string | null;
  channels: OperationalE2EChannels;
}

const EMPTY_CHANNELS: OperationalE2EChannels = {
  resendApiKey: '',
  notificationEmailFrom: '',
  vapidSubject: '',
  vapidPublicKey: '',
  vapidPrivateKey: '',
};

export function resolveOperationalE2EConfig(
  source: NodeJS.ProcessEnv,
  configuredDatabaseUrl: string,
  defaultDatabaseUrl: string,
  configuredChannels: OperationalE2EChannels,
): OperationalE2EConfig {
  const requestedDatabaseUrl = source.E2E_DATABASE_URL?.trim();
  const databaseUrl = requestedDatabaseUrl || defaultDatabaseUrl;
  if (requestedDatabaseUrl && sameDatabasePath(requestedDatabaseUrl, configuredDatabaseUrl) && !parseBoolean(source.E2E_ALLOW_EXISTING_DATABASE)) {
    throw new Error('Para usar o banco configurado, informe E2E_ALLOW_EXISTING_DATABASE=true.');
  }

  const notificationEmail = source.E2E_NOTIFICATION_EMAIL?.trim().toLowerCase() || null;
  const allowNotificationDelivery = parseBoolean(source.E2E_ALLOW_NOTIFICATION_DELIVERY) && Boolean(notificationEmail);
  return {
    databaseUrl,
    allowNotificationDelivery,
    notificationEmail,
    channels: allowNotificationDelivery ? configuredChannels : EMPTY_CHANNELS,
  };
}

interface OwnerRow {
  organization_id: number;
  user_id: number;
}

async function run(): Promise<void> {
  const env = loadEnv();
  const config = resolveOperationalE2EConfig(
    process.env,
    env.databaseUrl,
    './data/e2e-operational.db',
    {
      resendApiKey: env.resendApiKey,
      notificationEmailFrom: env.notificationEmailFrom,
      vapidSubject: env.vapidSubject,
      vapidPublicKey: env.vapidPublicKey,
      vapidPrivateKey: env.vapidPrivateKey,
    },
  );
  const filters = loadFilters();
  const e2eFilters = { ...filters, lookbackDays: Math.min(filters.lookbackDays, 7) };
  const db = createDatabase(config.databaseUrl);

  try {
    const owner = db.prepare(`
      SELECT m.organization_id, m.user_id
      FROM organization_memberships m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.role = 'OWNER'
      ORDER BY m.organization_id, m.user_id
      LIMIT 1
    `).get() as OwnerRow | undefined;
    if (!owner) throw new Error('E2E exige ao menos uma organização com usuário OWNER no banco temporário.');

    const opportunities = new OpportunityRepository(db);
    const initial = snapshot(db);
    const clients = [
      new PncpClient({ baseUrl: env.pncpBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries }),
      new OpenDataClient({ baseUrl: env.openDataBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries }),
    ];

    console.log('E2E operacional: sincronizando fontes oficiais...');
    const firstSync = await syncFromPncp(clients, opportunities, e2eFilters);
    const secondSync = await syncFromPncp(clients, opportunities, e2eFilters);
    const afterSync = snapshot(db);
    assert(afterSync.opportunities === initial.opportunities + firstSync.created, 'a primeira sincronização não bate com os registros criados');
    assert(secondSync.created === 0, 'a segunda sincronização criou duplicidade');
    assert(afterSync.opportunities === initial.opportunities + firstSync.created, 'a segunda sincronização alterou a contagem de licitações');

    const classification = await classifyOrganizationOpportunities(opportunities, owner.organization_id, filters);
    const targetId = firstSync.entries[0]?.current.opportunityId
      ?? opportunities.listKanbanOpportunityIds(owner.organization_id)[0]
      ?? opportunities.list()[0]?.id;
    if (!targetId) throw new Error('E2E não encontrou uma licitação sincronizada ou persistida para continuar o fluxo.');
    const target = opportunities.findById(targetId);
    if (!target) throw new Error(`E2E não encontrou a licitação ${targetId} após a sincronização.`);

    opportunities.addToKanban(owner.organization_id, targetId);
    assert(Boolean(opportunities.findOrganizationState(owner.organization_id, targetId)), 'licitação não entrou no Kanban');

    const checklist = new ChecklistService(new ChecklistRepository(db));
    const checklistFirst = checklist.ensureDefaults(owner.organization_id, targetId);
    const checklistSecond = checklist.ensureDefaults(owner.organization_id, targetId);
    assert(checklistFirst.length > 0, 'checklist padrão não foi inicializado');
    assert(checklistSecond.length === checklistFirst.length, 'checklist não é idempotente');

    const operational = new OperationalSyncService(db);
    for (const entry of [...firstSync.entries, ...secondSync.entries]) {
      operational.processEntry(entry, { organizationId: owner.organization_id });
    }
    const agenda = new AgendaService(db);
    const manualReminder = agenda.createManual({
      organizationId: owner.organization_id,
      opportunityId: targetId,
      userId: owner.user_id,
      type: 'DOCUMENT_REVIEW',
      title: 'Revisão E2E da oportunidade',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      note: 'Rehearsal operacional em banco temporário',
    });
    assert(Boolean(manualReminder), 'lembrete operacional não foi persistido');

    const market = new MarketIntelligenceService(new MarketRepository(db), {
      minimumObservations: env.marketMinObservations,
      lookbackDays: env.marketLookbackDays,
    }).getMarketSummary();

    const notifications = new NotificationService(db);
    let queued = 0;
    let duplicateQueued = 0;
    let delivered = 0;
    if (config.allowNotificationDelivery && config.notificationEmail) {
      notifications.saveSettings(owner.organization_id, { enabled: true, email: config.notificationEmail });
      const eventKey = `e2e-operational:${targetId}`;
      queued = notifications.queueOperationalAlert({
        organizationId: owner.organization_id,
        opportunityId: targetId,
        subject: `AptaGov E2E: ${target.title.slice(0, 70)}`,
        body: `Fluxo operacional validado para a licitação ${target.pncpId}.`,
        eventType: 'E2E_SMOKE',
        eventKey,
      }) ? 1 : 0;
      duplicateQueued = notifications.queueOperationalAlert({
        organizationId: owner.organization_id,
        opportunityId: targetId,
        subject: 'AptaGov E2E duplicado',
        body: 'Este evento não deve gerar um segundo envio.',
        eventType: 'E2E_SMOKE',
        eventKey,
      }) ? 1 : 0;
      delivered = await notifications.deliverPending(
        new ResendEmailNotifier(config.channels.resendApiKey, config.channels.notificationEmailFrom),
        owner.organization_id,
        { owner: `e2e:${process.pid}` },
      );
      assert(queued === 1, 'notificação E2E não foi enfileirada');
      assert(duplicateQueued === 0, 'notificação E2E duplicada foi aceita');
      assert(delivered >= 1, 'notificação E2E não foi entregue');
    }

    const backupPath = createDatabaseBackup(db, config.databaseUrl);
    assert(validateDatabaseBackupArtifact(backupPath), 'backup E2E não passou na validação');
    const final = snapshot(db);
    console.log(JSON.stringify({
      source: {
        firstReceived: firstSync.received,
        firstCreated: firstSync.created,
        firstUpdated: firstSync.updated,
        secondReceived: secondSync.received,
        secondCreated: secondSync.created,
        secondUpdated: secondSync.updated,
      },
      classification: classification.classified,
      opportunityId: targetId,
      kanbanState: opportunities.findOrganizationState(owner.organization_id, targetId),
      checklistItems: checklistSecond.length,
      reminders: agenda.list(owner.organization_id, {
        from: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
        to: new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString(),
      }).length,
      marketState: market.state,
      marketObservations: market.observationCount,
      notification: config.allowNotificationDelivery
        ? { queued, duplicateQueued, delivered }
        : { mode: 'skipped', reason: 'E2E_ALLOW_NOTIFICATION_DELIVERY=true e E2E_NOTIFICATION_EMAIL não foram informados' },
      backupValid: true,
      finalCounts: final,
    }, null, 2));
  } finally {
    db.close();
  }
}

function snapshot(db: SqliteDatabase): { opportunities: number; changes: number; reminders: number; notifications: number } {
  return {
    opportunities: count(db, 'SELECT COUNT(*) AS count FROM opportunities'),
    changes: count(db, 'SELECT COUNT(*) AS count FROM opportunity_change_events'),
    reminders: count(db, 'SELECT COUNT(*) AS count FROM opportunity_reminders'),
    notifications: count(db, 'SELECT COUNT(*) AS count FROM notification_deliveries'),
  };
}

function count(db: SqliteDatabase, query: string): number {
  return (db.prepare(query).get() as { count: number }).count;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseBoolean(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function sameDatabasePath(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === ':memory:' || right === ':memory:') return false;
  return resolve(left) === resolve(right);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void run().catch((error: unknown) => {
    console.error(`E2E operacional falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    process.exitCode = 1;
  });
}
