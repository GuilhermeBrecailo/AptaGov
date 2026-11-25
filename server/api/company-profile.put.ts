import { randomUUID } from 'node:crypto';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import type { SqliteDatabase } from '../../src/db/database';
import { attestationSchema, companyProfileSchema, technicianSchema, type CompanyProfile } from '../../src/domain/companyProfile';
import { CompanyProfileRepository } from '../../src/repositories/companyProfileRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

const inputSchema = companyProfileSchema.extend({
  technicians: z.array(technicianSchema.extend({ id: z.string().min(1).optional() })),
  attestations: z.array(attestationSchema.extend({ id: z.string().min(1).optional() })),
});

export function handleCompanyProfilePut(input: { db: SqliteDatabase; organizationId: number; body: unknown }): CompanyProfile {
  const parsed = inputSchema.safeParse(input.body);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Perfil inválido' });
  const profile: CompanyProfile = {
    ...parsed.data,
    technicians: parsed.data.technicians.map((item) => ({ ...item, id: item.id ?? randomUUID() })),
    attestations: parsed.data.attestations.map((item) => ({ ...item, id: item.id ?? randomUUID() })),
  };
  // Duplicate ids would let one attestation or technician stand in for another in the edital comparison.
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(profile.technicians.map((item) => item.id)) || !unique(profile.attestations.map((item) => item.id))) {
    throw createError({ statusCode: 400, statusMessage: 'Perfil inválido' });
  }
  return new CompanyProfileRepository(input.db).save(input.organizationId, profile);
}

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  return handleCompanyProfilePut({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    body: await readBody(event),
  });
});
