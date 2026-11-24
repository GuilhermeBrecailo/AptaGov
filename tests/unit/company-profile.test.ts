import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { emptyCompanyProfile, profileHash, type CompanyProfile } from '../../src/domain/companyProfile';
import { CompanyProfileRepository } from '../../src/repositories/companyProfileRepository';
import { handleCompanyProfilePut } from '../../server/api/company-profile.put';

function org(db: ReturnType<typeof createTestDatabase>): number {
  const row = db.prepare("INSERT INTO organizations (name, slug, created_at, updated_at) VALUES ('Org', ?, ?, ?)").run(`org-${Math.random()}`, new Date().toISOString(), new Date().toISOString());
  return Number(row.lastInsertRowid);
}

const attestation = { service: 'Pavimentação', quantity: 10, unit: 'm2', contractor: 'Prefeitura', catNumber: null, technicianId: null, issuedAt: null };

describe('company profile', () => {
  it('migration creates tables', () => {
    const db = createTestDatabase();
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain('company_profiles');
    expect(names).toContain('edital_analyses');
  });

  it('find returns empty profile when no row; save/find round trips', () => {
    const db = createTestDatabase();
    const id = org(db);
    const repo = new CompanyProfileRepository(db);
    expect(repo.find(id)).toEqual(emptyCompanyProfile());
    const profile: CompanyProfile = { ...emptyCompanyProfile(), registrations: [{ council: 'CREA', number: '123', state: 'SP', validUntil: null }] };
    repo.save(id, profile);
    repo.save(id, profile);
    expect(repo.find(id)).toEqual(profile);
  });

  it('profileHash is key-order independent and sensitive to values', () => {
    const a = { ...emptyCompanyProfile(), attestations: [{ id: '1', ...attestation }] };
    const b = JSON.parse(JSON.stringify(a)) as CompanyProfile;
    const reordered = { ...b, attestations: [Object.fromEntries(Object.entries(b.attestations[0]!).reverse())] } as unknown as CompanyProfile;
    expect(profileHash(reordered)).toBe(profileHash(a));
    const changed = { ...a, attestations: [{ id: '1', ...attestation, quantity: 11 }] };
    expect(profileHash(changed)).not.toBe(profileHash(a));
  });

  it('handleCompanyProfilePut generates ids, keeps given ids, rejects invalid', () => {
    const db = createTestDatabase();
    const id = org(db);
    const result = handleCompanyProfilePut({
      db, organizationId: id,
      body: { ...emptyCompanyProfile(), attestations: [attestation, { id: 'keep', ...attestation }], technicians: [{ name: 'A', title: 'Eng', registrationNumber: '1' }] },
    });
    expect(result.attestations[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(result.attestations[1]!.id).toBe('keep');
    expect(result.technicians[0]!.id).toBeTruthy();
    expect(new CompanyProfileRepository(db).find(id)).toEqual(result);
    expect(() => handleCompanyProfilePut({ db, organizationId: id, body: { ...emptyCompanyProfile(), attestations: [{ ...attestation, quantity: -1 }] } }))
      .toThrowError(expect.objectContaining({ statusCode: 400, statusMessage: 'Perfil inválido' }));
  });

  it('accepts negative net worth', () => {
    const db = createTestDatabase();
    const id = org(db);
    const body = { ...emptyCompanyProfile(), financial: { ...emptyCompanyProfile().financial, netWorthCents: -500000 } };
    expect(handleCompanyProfilePut({ db, organizationId: id, body }).financial.netWorthCents).toBe(-500000);
  });
});
