import type { SqliteDatabase } from '../db/database';
import { companyProfileSchema, emptyCompanyProfile, type CompanyProfile } from '../domain/companyProfile';

export class CompanyProfileRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(organizationId: number): CompanyProfile {
    const row = this.db.prepare('SELECT profile_json FROM company_profiles WHERE organization_id = ?').get(organizationId) as { profile_json: string } | undefined;
    return row ? companyProfileSchema.parse(JSON.parse(row.profile_json)) : emptyCompanyProfile();
  }

  save(organizationId: number, profile: CompanyProfile): CompanyProfile {
    this.db.prepare(`
      INSERT INTO company_profiles (organization_id, profile_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at
    `).run(organizationId, JSON.stringify(profile), new Date().toISOString());
    return profile;
  }
}
