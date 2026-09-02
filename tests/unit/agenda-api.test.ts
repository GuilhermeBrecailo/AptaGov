import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityChangeRepository } from '../../src/repositories/opportunityChangeRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OpportunityReminderRepository } from '../../src/repositories/opportunityReminderRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { handleAlertPreferencesGet } from '../../server/api/agenda-preferences.get';
import { handleAlertPreferencesPut } from '../../server/api/agenda-preferences.put';
import { AgendaService } from '../../src/services/agendaService';
import { syncRecords } from '../../src/services/syncService';
import { handleAgendaGet } from '../../server/api/agenda.get';
import { handleAgendaPost } from '../../server/api/agenda.post';
import { handleAgendaPatch } from '../../server/api/agenda/[id].patch';
import { handleOpportunityChangeRead } from '../../server/api/opportunities/[id]/changes/[changeId]/read.patch';
import { handleOpportunityChangesGet } from '../../server/api/opportunities/[id]/changes.get';
import { handleOpportunityChangesListGet } from '../../server/api/opportunities/changes.get';

function createOpportunity(db: ReturnType<typeof createTestDatabase>, pncpId: string): number {
  return new OpportunityRepository(db).insert({
    pncpId,
    title: `Oportunidade ${pncpId}`,
    description: '',
    organization: 'Prefeitura Exemplo',
    state: 'SP',
    sourceUrl: `https://pncp.gov.br/${pncpId}`,
    publicationDate: '2026-09-01T10:00:00.000Z',
    estimatedValueCents: 150_000,
  });
}

describe('agenda e histórico operacional via handlers', () => {
  it('cria lembretes oficiais e preserva horário ajustado manualmente no próximo ciclo', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Agenda Oficial');
    const repository = new OpportunityRepository(db);
    const agenda = new AgendaService(db);
    const reminders = new OpportunityReminderRepository(db);
    const base = {
      pncpId: 'agenda-official-1',
      title: 'Pregão eletrônico de software',
      description: 'contratação de plataforma',
      organization: 'Prefeitura Exemplo',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/agenda-official-1',
      publicationDate: '2026-09-01T10:00:00.000Z',
      estimatedValueCents: 150_000,
      raw: {
        dataAberturaSessaoPublica: '2026-09-11T09:00:00.000Z',
        dataInicioDisputa: '2026-09-11T09:30:00.000Z',
      },
    };

    const initial = await syncRecords([{ ...base, biddingDeadline: '2026-09-10T18:00:00.000Z' }], repository);
    repository.addToKanban(organization.id, initial.entries[0]!.current.opportunityId);
    const firstRun = agenda.scheduleOfficialReminders(organization.id, initial.entries[0]!.previous, initial.entries[0]!.current);
    expect(firstRun.map((item) => [item.type, item.dueAt])).toEqual([
      ['BID_DEADLINE', '2026-09-10T18:00:00.000Z'],
      ['MEETING', '2026-09-11T09:00:00.000Z'],
      ['FOLLOW_UP', '2026-09-11T09:30:00.000Z'],
    ]);

    const changed = await syncRecords([{ ...base, biddingDeadline: '2026-09-12T18:00:00.000Z' }], repository);
    const secondRun = agenda.scheduleOfficialReminders(organization.id, changed.entries[0]!.previous, changed.entries[0]!.current);
    const deadline = secondRun.find((item) => item.type === 'BID_DEADLINE')!;
    expect(deadline.dueAt).toBe('2026-09-12T18:00:00.000Z');

    reminders.update(organization.id, deadline.id, { dueAt: '2026-09-13T15:00:00.000Z' });
    const changedAgain = await syncRecords([{ ...base, biddingDeadline: '2026-09-14T18:00:00.000Z' }], repository);
    const thirdRun = agenda.scheduleOfficialReminders(organization.id, changedAgain.entries[0]!.previous, changedAgain.entries[0]!.current);

    expect(thirdRun.find((item) => item.type === 'BID_DEADLINE')?.dueAt).toBe('2026-09-13T15:00:00.000Z');
  });

  it('cria lembrete manual, lista por período e atualiza apenas dentro da organização', async () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const user = users.create({ name: 'Ana', email: 'ana@agenda.test', passwordHash: 'hash' });
    const organization = organizations.create('Empresa Agenda API');
    organizations.addMember(organization.id, user.id, 'OWNER');
    const opportunityId = createOpportunity(db, 'agenda-api-1');
    new OpportunityRepository(db).addToKanban(organization.id, opportunityId);

    const created = await handleAgendaPost({
      service: undefined,
      db,
      organizationId: organization.id,
      userId: user.id,
      body: {
        opportunityId,
        type: 'FOLLOW_UP',
        title: 'Ligar para o órgão',
        dueAt: '2026-09-06T14:00:00.000Z',
        note: 'confirmar item técnico',
      },
    });

    const listed = handleAgendaGet({
      service: undefined,
      db,
      organizationId: organization.id,
      query: {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30T23:59:59.999Z',
      },
    });

    const updated = await handleAgendaPatch({
      service: undefined,
      db,
      organizationId: organization.id,
      reminderId: created.id,
      body: {
        status: 'COMPLETED',
        completedAt: '2026-09-05T11:00:00.000Z',
      },
    });

    expect(created).toMatchObject({
      organizationId: organization.id,
      createdByUserId: user.id,
      type: 'FOLLOW_UP',
    });
    expect(listed).toHaveLength(1);
    expect(updated).toMatchObject({
      id: created.id,
      status: 'COMPLETED',
      completedAt: '2026-09-05T11:00:00.000Z',
    });
  });

  it('rejeita create, update e schedule fora do escopo da organização', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const opportunities = new OpportunityRepository(db);
    const users = new UserRepository(db);
    const firstUser = users.create({ name: 'Dani', email: 'dani@agenda.test', passwordHash: 'hash' });
    const secondUser = users.create({ name: 'Eva', email: 'eva@agenda.test', passwordHash: 'hash' });
    const first = organizations.create('Empresa Agenda Isolada A');
    const second = organizations.create('Empresa Agenda Isolada B');
    organizations.addMember(first.id, firstUser.id, 'OWNER');
    organizations.addMember(second.id, secondUser.id, 'OWNER');
    const synced = await syncRecords([{
      pncpId: 'agenda-tenant-isolation',
      title: 'Oportunidade isolada',
      description: '',
      organization: 'Prefeitura Exemplo',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/agenda-tenant-isolation',
      publicationDate: '2026-09-01T10:00:00.000Z',
      biddingDeadline: '2026-09-10T18:00:00.000Z',
      estimatedValueCents: 150_000,
    }], opportunities);
    const entry = synced.entries[0]!;
    opportunities.addToKanban(first.id, entry.current.opportunityId);
    const agenda = new AgendaService(db);
    const [firstReminder] = agenda.scheduleOfficialReminders(first.id, entry.previous, entry.current);

    expect(agenda.scheduleOfficialReminders(second.id, entry.previous, entry.current)).toEqual([]);
    await expect(handleAgendaPost({
      service: agenda,
      db,
      organizationId: second.id,
      userId: secondUser.id,
      body: {
        opportunityId: entry.current.opportunityId,
        type: 'FOLLOW_UP',
        title: 'Tentativa cruzada',
        dueAt: '2026-09-08T14:00:00.000Z',
      },
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(handleAgendaPatch({
      service: agenda,
      db,
      organizationId: second.id,
      reminderId: firstReminder!.id,
      body: { status: 'COMPLETED' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('aplica preferências organizacionais e permite ajuste por GET e PUT', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const opportunities = new OpportunityRepository(db);
    const organization = organizations.create('Empresa Preferências API');
    const synced = await syncRecords([{
      pncpId: 'agenda-preferences-api',
      title: 'Oportunidade preferências',
      description: '',
      organization: 'Prefeitura Exemplo',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/agenda-preferences-api',
      publicationDate: '2026-09-01T10:00:00.000Z',
      biddingDeadline: '2026-09-10T18:00:00.000Z',
      estimatedValueCents: 150_000,
      raw: {
        dataAberturaSessaoPublica: '2026-09-11T09:00:00.000Z',
        dataInicioDisputa: '2026-09-11T09:30:00.000Z',
      },
    }], opportunities);
    const entry = synced.entries[0]!;
    opportunities.addToKanban(organization.id, entry.current.opportunityId);

    expect(handleAlertPreferencesGet({ db, organizationId: organization.id })).toMatchObject({
      proposalDeadline: true,
      sessionOpening: true,
      disputeStart: true,
      changeAlerts: true,
    });
    expect(await handleAlertPreferencesPut({
      db,
      organizationId: organization.id,
      body: {
        proposalDeadline: true,
        sessionOpening: false,
        disputeStart: false,
        changeAlerts: false,
      },
    })).toMatchObject({
      proposalDeadline: true,
      sessionOpening: false,
      disputeStart: false,
      changeAlerts: false,
    });
    expect(new AgendaService(db).scheduleOfficialReminders(organization.id, entry.previous, entry.current)
      .map((reminder) => reminder.type)).toEqual(['BID_DEADLINE']);
  });

  it('lista mudanças visíveis e marca leitura no escopo correto', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organization = organizations.create('Empresa Changes API');
    const opportunityId = createOpportunity(db, 'agenda-api-2');
    const opportunities = new OpportunityRepository(db);
    const changes = new OpportunityChangeRepository(db);
    opportunities.addToKanban(organization.id, opportunityId);
    const recorded = changes.record({
      opportunityId,
      sourceCode: 'PNCP',
      type: 'SOURCE_UPDATE',
      fingerprint: 'source:v2',
      summary: 'Fonte oficial atualizada',
      payload: { description: 'novo texto' },
      detectedAt: '2026-09-01T15:00:00.000Z',
    });

    const listed = handleOpportunityChangesGet({
      service: undefined,
      db,
      organizationId: organization.id,
      opportunityId,
      query: { unreadOnly: 'true' },
    });
    const marked = await handleOpportunityChangeRead({
      service: undefined,
      db,
      organizationId: organization.id,
      opportunityId,
      changeId: recorded.event.id,
    });
    const unreadAfter = handleOpportunityChangesGet({
      service: undefined,
      db,
      organizationId: organization.id,
      opportunityId,
      query: { unreadOnly: 'true' },
    });

    expect(listed).toMatchObject([{ id: recorded.event.id, readAt: null }]);
    expect(marked).toMatchObject({ id: recorded.event.id, readAt: expect.any(String) });
    expect(unreadAfter).toEqual([]);
  });

  it('lista mudanças de todas as oportunidades autorizadas da organização', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Changes em Lote A');
    const second = organizations.create('Empresa Changes em Lote B');
    const opportunities = new OpportunityRepository(db);
    const firstOpportunityId = createOpportunity(db, 'agenda-api-batch-a');
    const secondOpportunityId = createOpportunity(db, 'agenda-api-batch-b');
    opportunities.addToKanban(first.id, firstOpportunityId);
    opportunities.addToKanban(second.id, secondOpportunityId);
    const changes = new OpportunityChangeRepository(db);
    changes.record({
      opportunityId: firstOpportunityId,
      sourceCode: 'PNCP',
      type: 'SOURCE_UPDATE',
      fingerprint: 'batch:first',
      summary: 'Mudança da primeira oportunidade',
      payload: {},
      detectedAt: '2026-09-01T15:00:00.000Z',
    });
    changes.record({
      opportunityId: secondOpportunityId,
      sourceCode: 'PNCP',
      type: 'SOURCE_UPDATE',
      fingerprint: 'batch:second',
      summary: 'Mudança da segunda oportunidade',
      payload: {},
      detectedAt: '2026-09-01T16:00:00.000Z',
    });

    const listed = handleOpportunityChangesListGet({ db, organizationId: first.id, query: {} });

    expect(listed.map((change) => change.opportunityId)).toEqual([firstOpportunityId]);
  });

  it('mantém os endpoints protegidos por billing ativo operacional', () => {
    const root = resolve('C:/Users/user/Documents/dev/licitacoes-pncp/server/api');

    expect(readFileSync(resolve(root, 'agenda.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'agenda.post.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'agenda/[id].patch.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'opportunities/[id]/changes.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'opportunities/changes.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'opportunities/[id]/changes/[changeId]/read.patch.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'agenda-preferences.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'agenda-preferences.put.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'opportunities/[id]/checklist.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
    expect(readFileSync(resolve(root, 'opportunities/[id]/checklist/[itemId].patch.ts'), 'utf8')).toContain("requireActiveBilling(event, 'kanban')");
  });
});
