export type BillingPlanCode = 'STARTER' | 'PRO' | 'BUSINESS' | 'UNLIMITED';

export const billingPlanCodes = ['STARTER', 'PRO', 'BUSINESS', 'UNLIMITED'] as const;

export interface BillingPlanDefinition {
  code: BillingPlanCode;
  name: string;
  description: string;
  priceCents: number;
  maxUsers: number | null;
  maxOrganizations: number | null;
  monthlyAlerts: number | null;
  maxRadars: number | null;
}

export const defaultBillingPlans: BillingPlanDefinition[] = [
  { code: 'STARTER', name: 'Inicial', description: 'Para começar a encontrar oportunidades', priceCents: 5_000, maxUsers: 1, maxOrganizations: 1, monthlyAlerts: 300, maxRadars: 3 },
  { code: 'PRO', name: 'Profissional', description: 'Para uma operação comercial ativa', priceCents: 9_900, maxUsers: 3, maxOrganizations: 1, monthlyAlerts: 1_500, maxRadars: 10 },
  { code: 'BUSINESS', name: 'Empresarial', description: 'Para equipes que precisam de escala', priceCents: 19_900, maxUsers: 10, maxOrganizations: 1, monthlyAlerts: 5_000, maxRadars: 25 },
  { code: 'UNLIMITED', name: 'Ilimitado', description: 'Uso sem limite de alertas', priceCents: 39_900, maxUsers: null, maxOrganizations: null, monthlyAlerts: null, maxRadars: null },
];

export function parseBillingPlans(raw: string): BillingPlanDefinition[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('BILLING_PLANS_JSON inválido');
  }
  if (!Array.isArray(value)) throw new Error('BILLING_PLANS_JSON deve ser uma lista');

  const plans = value.map((item) => {
    if (!isRecord(item) || !isBillingPlanCode(item.code) || typeof item.name !== 'string' || typeof item.description !== 'string') {
      throw new Error('BILLING_PLANS_JSON contém um plano inválido');
    }
    if (typeof item.priceCents !== 'number' || !Number.isInteger(item.priceCents) || item.priceCents < 0) throw new Error(`Preço inválido para o plano ${item.code}`);
    if (!isLimit(item.maxUsers) || !isLimit(item.maxOrganizations) || !isLimit(item.monthlyAlerts) || (item.maxRadars !== undefined && !isLimit(item.maxRadars))) {
      throw new Error(`Limite inválido para o plano ${item.code}`);
    }
    const defaultPlan = defaultBillingPlans.find((plan) => plan.code === item.code);
    return {
      code: item.code,
      name: item.name,
      description: item.description,
      priceCents: item.priceCents,
      maxUsers: item.maxUsers,
      maxOrganizations: item.maxOrganizations,
      monthlyAlerts: item.monthlyAlerts,
      maxRadars: item.maxRadars === undefined ? defaultPlan?.maxRadars ?? null : item.maxRadars,
    };
  });

  const codes = new Set(plans.map((plan) => plan.code));
  if (codes.size !== 4 || defaultBillingPlans.some((plan) => !codes.has(plan.code))) {
    throw new Error('BILLING_PLANS_JSON deve configurar os quatro planos');
  }
  return plans;
}

export function findBillingPlan(plans: BillingPlanDefinition[], code: BillingPlanCode): BillingPlanDefinition {
  const plan = plans.find((item) => item.code === code);
  if (!plan) throw new Error(`Plano não configurado: ${code}`);
  return plan;
}

export function isBillingPlanCode(value: unknown): value is BillingPlanCode {
  return value === 'STARTER' || value === 'PRO' || value === 'BUSINESS' || value === 'UNLIMITED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLimit(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 0);
}
