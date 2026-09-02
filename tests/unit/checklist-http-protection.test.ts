import { createError, type H3Event } from 'h3';
import { describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { BillingService } from '../../src/services/billingService';

describe('proteção HTTP dos handlers de checklist', () => {
  it('retorna 402 nos dois exports quando o billing da organização está inativo', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Checklist Billing');
    const billing = new BillingService(db, { trialDays: -1 });
    billing.ensureTrial(organization.id);

    vi.doMock('../../server/utils/app', () => ({
      getAppDatabase: () => db,
      getRuntime: () => ({ opportunities: new OpportunityRepository(db) }),
      requireActiveBilling: () => {
        if (!billing.canUse(organization.id, 'kanban')) {
          throw createError({ statusCode: 402, message: 'Billing inativo' });
        }
        return { organization: { id: organization.id } };
      },
    }));

    const [checklistGetModule, checklistPatchModule] = await Promise.all([
      import('../../server/api/opportunities/[id]/checklist.get'),
      import('../../server/api/opportunities/[id]/checklist/[itemId].patch'),
    ]);
    const event = {} as H3Event;

    expect(() => checklistGetModule.default(event)).toThrowError(expect.objectContaining({ statusCode: 402 }));
    await expect(checklistPatchModule.default(event)).rejects.toThrowError(expect.objectContaining({ statusCode: 402 }));

    vi.doUnmock('../../server/utils/app');
  });
});
