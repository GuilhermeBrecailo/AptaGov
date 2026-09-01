import type { SqliteDatabase } from '../db/database';

export type OrganizationRole = 'OWNER' | 'MEMBER';

export interface Organization {
  id: number;
  name: string;
  slug: string;
}

export interface OrganizationMembership {
  organization: Organization;
  role: OrganizationRole;
}

export class OrganizationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(name: string): Organization {
    const now = new Date().toISOString();
    const baseSlug = slugify(name) || `empresa-${Date.now()}`;
    let slug = baseSlug;
    let suffix = 2;
    while (this.db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const result = this.db.prepare(`
      INSERT INTO organizations (name, slug, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), slug, now, now);
    return this.findById(Number(result.lastInsertRowid)) as Organization;
  }

  findById(id: number): Organization | undefined {
    const row = this.db.prepare('SELECT id, name, slug FROM organizations WHERE id = ?').get(id) as OrganizationRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  onboardingCompletedAt(organizationId: number): string | null | undefined {
    const row = this.db.prepare('SELECT onboarding_completed_at FROM organizations WHERE id = ?')
      .get(organizationId) as { onboarding_completed_at: string | null } | undefined;
    return row?.onboarding_completed_at;
  }

  markOnboardingCompleted(organizationId: number, completedAt = new Date().toISOString()): void {
    this.db.prepare('UPDATE organizations SET onboarding_completed_at = ?, updated_at = ? WHERE id = ?')
      .run(completedAt, completedAt, organizationId);
  }

  addMember(organizationId: number, userId: number, role: OrganizationRole): void {
    this.db.prepare(`
      INSERT INTO organization_memberships (organization_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role
    `).run(organizationId, userId, role, new Date().toISOString());
  }

  listForUser(userId: number): Organization[] {
    const rows = this.db.prepare(`
      SELECT o.id, o.name, o.slug
      FROM organizations o
      INNER JOIN organization_memberships m ON m.organization_id = o.id
      WHERE m.user_id = ?
      ORDER BY o.name
    `).all(userId) as OrganizationRow[];
    return rows.map(mapRow);
  }

  listAll(): Organization[] {
    const rows = this.db.prepare('SELECT id, name, slug FROM organizations ORDER BY id').all() as OrganizationRow[];
    return rows.map(mapRow);
  }

  findMembership(userId: number, organizationId?: number): OrganizationMembership | undefined {
    const row = this.db.prepare(`
      SELECT o.id, o.name, o.slug, m.role
      FROM organizations o
      INNER JOIN organization_memberships m ON m.organization_id = o.id
      WHERE m.user_id = ? AND (? IS NULL OR o.id = ?)
      ORDER BY o.id
      LIMIT 1
    `).get(userId, organizationId ?? null, organizationId ?? null) as (OrganizationRow & { role: OrganizationRole }) | undefined;
    return row ? { organization: mapRow(row), role: row.role } : undefined;
  }
}

type OrganizationRow = { id: number; name: string; slug: string };

function mapRow(row: OrganizationRow): Organization {
  return { id: row.id, name: row.name, slug: row.slug };
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
