import type { SqliteDatabase } from '../db/database';
import type { OrganizationAlertPreferences } from '../domain/operationalTypes';

type OrganizationAlertPreferenceValues = Omit<OrganizationAlertPreferences, 'organizationId'>;
export type OrganizationAlertPreferenceInput = Omit<OrganizationAlertPreferenceValues, 'challengeDeadline' | 'clarificationDeadline'>
  & Partial<Pick<OrganizationAlertPreferenceValues, 'challengeDeadline' | 'clarificationDeadline'>>;

interface OrganizationAlertPreferenceRow {
  organization_id: number;
  proposal_deadline_enabled: number;
  session_opening_enabled: number;
  dispute_start_enabled: number;
  change_alerts_enabled: number;
  challenge_deadline_enabled: number;
  clarification_deadline_enabled: number;
}

const DEFAULT_PREFERENCES: OrganizationAlertPreferenceValues = {
  proposalDeadline: true,
  sessionOpening: true,
  disputeStart: true,
  changeAlerts: true,
  challengeDeadline: true,
  clarificationDeadline: true,
};

export class OrganizationAlertPreferenceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(organizationId: number): OrganizationAlertPreferences {
    const row = this.db.prepare(`
      SELECT organization_id, proposal_deadline_enabled, session_opening_enabled,
             dispute_start_enabled, change_alerts_enabled,
             challenge_deadline_enabled, clarification_deadline_enabled
      FROM organization_alert_preferences
      WHERE organization_id = ?
    `).get(organizationId) as OrganizationAlertPreferenceRow | undefined;
    return row ? mapRow(row) : { organizationId, ...DEFAULT_PREFERENCES };
  }

  save(organizationId: number, input: OrganizationAlertPreferenceInput): OrganizationAlertPreferences {
    const now = new Date().toISOString();
    const current = this.find(organizationId);
    const challengeDeadline = input.challengeDeadline ?? current.challengeDeadline;
    const clarificationDeadline = input.clarificationDeadline ?? current.clarificationDeadline;
    this.db.prepare(`
      INSERT INTO organization_alert_preferences (
        organization_id, proposal_deadline_enabled, session_opening_enabled,
        dispute_start_enabled, change_alerts_enabled,
        challenge_deadline_enabled, clarification_deadline_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        proposal_deadline_enabled = excluded.proposal_deadline_enabled,
        session_opening_enabled = excluded.session_opening_enabled,
        dispute_start_enabled = excluded.dispute_start_enabled,
        change_alerts_enabled = excluded.change_alerts_enabled,
        challenge_deadline_enabled = excluded.challenge_deadline_enabled,
        clarification_deadline_enabled = excluded.clarification_deadline_enabled,
        updated_at = excluded.updated_at
    `).run(
      organizationId,
      input.proposalDeadline ? 1 : 0,
      input.sessionOpening ? 1 : 0,
      input.disputeStart ? 1 : 0,
      input.changeAlerts ? 1 : 0,
      challengeDeadline ? 1 : 0,
      clarificationDeadline ? 1 : 0,
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
    challengeDeadline: row.challenge_deadline_enabled === 1,
    clarificationDeadline: row.clarification_deadline_enabled === 1,
  };
}
