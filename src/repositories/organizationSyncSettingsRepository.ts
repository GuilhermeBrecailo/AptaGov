import type { SqliteDatabase } from '../db/database';

export interface OrganizationSyncSettings {
  organizationId: number;
  enabled: boolean;
}

export class OrganizationSyncSettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(organizationId: number): OrganizationSyncSettings | undefined {
    const row = this.db.prepare('SELECT organization_id, enabled FROM organization_sync_settings WHERE organization_id = ?')
      .get(organizationId) as OrganizationSyncSettingsRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  isEnabled(organizationId: number): boolean {
    return this.find(organizationId)?.enabled ?? true;
  }

  save(organizationId: number, enabled: boolean): OrganizationSyncSettings {
    this.db.prepare(`
      INSERT INTO organization_sync_settings (organization_id, enabled, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(organizationId, enabled ? 1 : 0, new Date().toISOString());
    return this.find(organizationId) as OrganizationSyncSettings;
  }

  listEnabledOrganizationIds(): number[] {
    const rows = this.db.prepare(`
      SELECT o.id
      FROM organizations o
      LEFT JOIN organization_sync_settings s ON s.organization_id = o.id
      WHERE COALESCE(s.enabled, 1) = 1
      ORDER BY o.id
    `).all() as Array<{ id: number }>;
    return rows.map((row) => row.id);
  }
}

type OrganizationSyncSettingsRow = { organization_id: number; enabled: number };

function mapRow(row: OrganizationSyncSettingsRow): OrganizationSyncSettings {
  return { organizationId: row.organization_id, enabled: row.enabled === 1 };
}
