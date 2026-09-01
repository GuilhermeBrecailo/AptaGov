import type { SqliteDatabase } from '../db/database';
import type { OrganizationAlertPreferences } from '../domain/operationalTypes';

export type OrganizationAlertPreferenceInput = Omit<OrganizationAlertPreferences, 'organizationId'>;

interface OrganizationAlertPreferenceRow {
  organization_id: number;
  proposal_deadline_enabled: number;
  session_opening_enabled: number;
  dispute_start_enabled: number;
  change_alerts_enabled: number;
}

const DEFAULT_PREFERENCES: OrganizationAlertPreferenceInput = {
  proposalDeadline: true,
  sessionOpening: true,
  disputeStart: true,
  changeAlerts: true,
};

export class OrganizationAlertPreferenceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(organizationId: number): OrganizationAlertPreferences {
    const row = this.db.prepare(`
      SELECT organization_id, proposal_deadline_enabled, session_opening_enabled,
             dispute_start_enabled, change_alerts_enabled
      FROM organization_alert_preferences
      WHERE organization_id = ?
    `).get(organizationId) as OrganizationAlertPreferenceRow | undefined;
    return row ? mapRow(row) : { organizationId, ...DEFAULT_PREFERENCES };
  }

  save(organizationId: number, input: OrganizationAlertPreferenceInput): OrganizationAlertPreferences {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO organization_alert_preferences (
        organization_id, proposal_deadline_enabled, session_opening_enabled,
        dispute_start_enabled, change_alerts_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        proposal_deadline_enabled = excluded.proposal_deadline_enabled,
        session_opening_enabled = excluded.session_opening_enabled,
        dispute_start_enabled = excluded.dispute_start_enabled,
        change_alerts_enabled = excluded.change_alerts_enabled,
        updated_at = excluded.updated_at
    `).run(
      organizationId,
      input.proposalDeadline ? 1 : 0,
      input.sessionOpening ? 1 : 0,
      input.disputeStart ? 1 : 0,
      input.changeAlerts ? 1 : 0,
      now,
      now,
    );
    return this.find(organizationId);
  }
}

function mapRow(row: OrganizationAlertPreferenceRow): OrganizationAlertPreferences {
  return {
    organizationId: row.organization_id,
    proposalDeadline: row.proposal_deadline_enabled === 1,
    sessionOpening: row.session_opening_enabled === 1,
    disputeStart: row.dispute_start_enabled === 1,
    changeAlerts: row.change_alerts_enabled === 1,
  };
}
