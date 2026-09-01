export type KanbanState = 'NEW' | 'QUALIFIED' | 'CONTACTED' | 'IN_PROGRESS' | 'WON' | 'LOST' | 'DISCARDED';
export type OpportunitySource = 'PNCP' | 'OPEN_DATA';
export type ReminderType = 'BID_DEADLINE' | 'DOCUMENT_REVIEW' | 'FOLLOW_UP' | 'MEETING';
export type ReminderStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';
export type OpportunityChangeType =
  | 'PROPOSAL_DEADLINE'
  | 'SESSION_OPENING'
  | 'DISPUTE_START'
  | 'CLOSING_RESULT'
  | 'SOURCE_UPDATE';
export type ChecklistStatus = 'OPEN' | 'COMPLETED' | 'SKIPPED';
export type ChecklistCategory = 'DOCUMENTS' | 'COMMERCIAL' | 'PROPOSAL' | 'SESSION' | 'REVIEW';
export type AgendaVisualType = 'BID_DEADLINE' | 'MEETING' | 'DISPUTE' | 'RESULT' | 'MANUAL' | 'SOURCE_UPDATE';

export interface CatalogOpportunity {
  id: number;
  source: OpportunitySource;
  title: string;
  description: string;
  organization: string;
  state: string;
  city: string;
  modality: string;
  sourceUrl: string;
  publicationDate: string;
  biddingDeadline: string | null;
  estimatedValueCents: number;
  kanbanState: KanbanState;
  score: number;
  scoreBreakdown: Record<string, number>;
  inKanban: boolean;
  favorite: boolean;
  notRelevant: boolean;
}

export interface CatalogPage {
  data: CatalogOpportunity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FilterConfig {
  lookbackDays: number;
  states: string[];
  citiesIbge: string[];
  modalities: string[];
  keywords: string[];
  excludedKeywords: string[];
  minimumScore: number;
  estimatedValueMinCents: number;
  scoreWeights: {
    keyword: number;
    region: number;
    value: number;
    deadline: number;
  };
}

export interface NotificationSettings {
  enabled: boolean;
  email: string;
  pending: number;
}

export interface SyncSettings {
  organizationId?: number;
  enabled: boolean;
  intervalMinutes: number;
}

export interface SavedSearch {
  id: number;
  organizationId: number;
  name: string;
  filters: FilterConfig;
  enabled: boolean;
  notificationsEnabled: boolean;
  lastRunAt: string | null;
  lastMatchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingPayload {
  completed: boolean;
  completedAt: string | null;
  filters: FilterConfig;
  radars: SavedSearch[];
}

export interface BillingPayload {
  plan: 'TRIAL' | 'PRO';
  planCode: 'STARTER' | 'PRO' | 'BUSINESS' | 'UNLIMITED';
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE';
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  canUse: boolean;
  provider: string;
  monthlyPriceCents: number;
  plans: BillingPlanView[];
}

export interface BillingPlanView {
  code: 'STARTER' | 'PRO' | 'BUSINESS' | 'UNLIMITED';
  name: string;
  description: string;
  priceCents: number;
  maxUsers: number | null;
  maxOrganizations: number | null;
  monthlyAlerts: number | null;
  maxRadars: number | null;
}

export interface AuthPayload {
  user: { id: number; name: string; email: string };
  organization: { id: number; name: string; slug: string };
  role: 'OWNER' | 'MEMBER';
  isPlatformAdmin?: boolean;
}

export interface OrganizationAlertPreferences {
  organizationId: number;
  proposalDeadline: boolean;
  sessionOpening: boolean;
  disputeStart: boolean;
  changeAlerts: boolean;
}

export interface OpportunityReminder {
  id: number;
  organizationId: number;
  opportunityId: number;
  type: ReminderType;
  title: string;
  dueAt: string;
  status: ReminderStatus;
  note: string | null;
  createdByUserId: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityChangeEvent {
  id: number;
  opportunityId: number;
  sourceCode: OpportunitySource;
  type: OpportunityChangeType;
  fingerprint: string;
  summary: string;
  payload: Record<string, unknown>;
  detectedAt: string;
  readAt: string | null;
  createdAt: string;
}

export interface ChecklistItem {
  id: number;
  organizationId: number;
  opportunityId: number;
  templateKey: string | null;
  title: string;
  category: ChecklistCategory;
  status: ChecklistStatus;
  assigneeUserId: number | null;
  dueAt: string | null;
  note: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistPatchInput {
  title?: string;
  status?: ChecklistStatus;
  assigneeUserId?: number | null;
  dueAt?: string | null;
  note?: string | null;
}

export interface AgendaReminderDraft {
  id?: number;
  opportunityId: number | null;
  type: ReminderType;
  title: string;
  dueAt: string;
  note: string;
}

export interface AgendaEntryView {
  id: string;
  opportunityId: number;
  reminderId?: number;
  reminderType?: ReminderType;
  changeId?: number;
  kind: 'REMINDER' | 'CHANGE';
  visualType: AgendaVisualType;
  title: string;
  subtitle: string;
  occurredAt: string;
  sourceLabel: string;
  sourceUrl: string;
  opportunityTitle: string;
  statusBucket: 'OPEN' | 'COMPLETED';
  statusLabel: string;
  note: string | null;
  canEdit: boolean;
  canComplete: boolean;
  canSkip: boolean;
  readAt?: string | null;
}

export interface PlatformAdminMetrics {
  generatedAt: string;
  summary: {
    organizations: number;
    users: number;
    activeSubscriptions: number;
    trialingOrganizations: number;
    pastDueOrganizations: number;
    estimatedMrrCents: number;
    opportunities: number;
    notificationsThisMonth: number;
    completedOnboardingOrganizations: number;
    activeRadars: number;
    favoritedOpportunities: number;
    kanbanOpportunities: number;
  };
  plans: Array<BillingPlanView & { organizationCount: number; activeCount: number; estimatedMrrCents: number }>;
  recentOrganizations: Array<{
    id: number;
    name: string;
    ownerEmail: string;
    planCode: BillingPlanView['code'];
    status: string;
    createdAt: string;
    lastActivityAt: string;
  }>;
}

export const kanbanColumns: Array<{ state: KanbanState; label: string }> = [
  { state: 'NEW', label: 'Novas' },
  { state: 'QUALIFIED', label: 'Qualificadas' },
  { state: 'CONTACTED', label: 'Contatadas' },
  { state: 'IN_PROGRESS', label: 'Em andamento' },
  { state: 'WON', label: 'Ganhas' },
  { state: 'LOST', label: 'Perdidas' },
  { state: 'DISCARDED', label: 'Descartadas' },
];
