import type { CompanyProfile } from '../../domain/companyProfile';
import type { EditalExtraction, ExtractedMatch, ExtractedRequirement, RequirementCategory } from './extraction';
import { displayUnit, normalizeUnit } from './units';

export type CheckStatus = 'ok' | 'fail' | 'check';

export type RequirementCheck = {
  requirementId: string;
  category: RequirementCategory;
  description: string;
  status: CheckStatus;
  informative: boolean;
  required: string;
  companyValue: string | null;
  note: string;
  page: number | null;
  excerpt: string;
  deadline: string | null;
};

export type LotVerdict = {
  lotId: string | null;
  verdict: 'APT' | 'NOT_APT' | 'CHECK';
  failCount: number;
  checkCount: number;
  checks: RequirementCheck[];
};

export type CompareInput = {
  extraction: EditalExtraction;
  profile: CompanyProfile;
  opportunityEstimatedValueCents: number;
  now: Date;
};

type Evaluation = Pick<RequirementCheck, 'status' | 'required' | 'companyValue' | 'note'>;

/** Estimated value used for percentage requirements; `trusted: false` when it was read from the edital by the AI. */
type Estimate = { cents: number; trusted: boolean } | null;

type Context = {
  profile: CompanyProfile;
  matches: ExtractedMatch[];
  estimate: Estimate;
  now: Date;
};

const BALANCE_SHEET_MAX_AGE_MONTHS = 16;
const INFORMATIVE: ReadonlySet<RequirementCategory> = new Set(['technical_visit', 'bid_guarantee']);
const COUNTED_CONFIDENCE: ReadonlySet<ExtractedMatch['confidence']> = new Set(['high', 'medium']);

const moneyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const ratioFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

const money = (cents: number): string => moneyFormat.format(cents / 100).replace(/\s/gu, ' ');
const quantity = (value: number, unit: string): string => `${numberFormat.format(value)} ${displayUnit(unit)}`;

function isoDay(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value.slice(0, 10))) ? value.slice(0, 10) : null;
}

function brDate(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

function brDateTime(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : dateTimeFormat.format(new Date(time));
}

function evaluateRegistration(req: ExtractedRequirement, ctx: Context): Evaluation {
  if (req.council === null) {
    return {
      status: 'check',
      required: 'Registro no conselho profissional',
      companyValue: null,
      note: 'Edital não especifica o conselho — confira qual registro é exigido (CREA ou CAU).'
    };
  }
  const required = `Registro no ${req.council}`;
  const registrations = ctx.profile.registrations.filter((item) => item.council === req.council);
  if (registrations.length === 0) {
    return { status: 'fail', required, companyValue: null, note: `Nenhum registro no ${req.council} cadastrado no perfil técnico.` };
  }
  const today = ctx.now.toISOString().slice(0, 10);
  const describe = (item: (typeof registrations)[number], day: string | null) =>
    `${item.council} ${item.state} ${item.number}${day ? `, válido até ${brDate(day)}` : ', sem validade informada'}`;
  const dated = registrations.map((item) => ({ item, day: item.validUntil ? isoDay(item.validUntil) : null }));
  const valid = dated.find((entry) => entry.day !== null && entry.day >= today);
  if (valid) return { status: 'ok', required, companyValue: describe(valid.item, valid.day), note: '' };
  const latest = dated.filter((entry) => entry.day !== null).sort((a, b) => b.day!.localeCompare(a.day!))[0];
  if (latest && dated.every((entry) => entry.day !== null)) {
    return {
      status: 'check',
      required,
      companyValue: describe(latest.item, latest.day),
      note: `Registro vencido em ${brDate(latest.day!)} — confira se foi renovado e atualize o perfil técnico.`
    };
  }
  const undated = dated.find((entry) => entry.day === null)!;
  return {
    status: 'check',
    required,
    companyValue: describe(undated.item, null),
    note: 'Registro sem data de validade no perfil técnico — confira a validade da certidão.'
  };
}

function evaluateAttestations(req: ExtractedRequirement, ctx: Context): Evaluation {
  const required = req.minQuantity !== null && req.unit ? quantity(req.minQuantity, req.unit) : 'Atestado de capacidade técnica';
  if (ctx.profile.attestations.length === 0) {
    return { status: 'fail', required, companyValue: null, note: 'Perfil técnico com nenhum atestado cadastrado — cadastre os atestados que comprovam esta exigência.' };
  }
  const relatedIds = new Set(
    ctx.matches.filter((item) => item.requirementId === req.id && COUNTED_CONFIDENCE.has(item.confidence)).map((item) => item.attestationId)
  );
  const related = ctx.profile.attestations.filter((item) => relatedIds.has(item.id));
  if (related.length === 0) {
    return { status: 'check', required, companyValue: null, note: 'a IA não encontrou atestado equivalente — confira seus atestados com o trecho do edital.' };
  }
  const requiredUnit = req.unit ? normalizeUnit(req.unit) : null;
  if (req.minQuantity === null || !req.unit) {
    return { status: 'check', required, companyValue: null, note: 'O edital não informa quantidade mínima reconhecível — confira o trecho.' };
  }
  if (req.minQuantity <= 0) {
    return { status: 'check', required, companyValue: null, note: 'Quantidade mínima lida do edital parece implausível — confira o trecho.' };
  }
  if (requiredUnit === null) {
    return { status: 'check', required, companyValue: null, note: `Unidade "${req.unit}" não reconhecida para comparação automática — confira o trecho.` };
  }
  const compatible = related.filter((item) => normalizeUnit(item.unit) === requiredUnit);
  const incompatible = related.length - compatible.length;
  if (compatible.length === 0) {
    return { status: 'check', required, companyValue: null, note: 'Os atestados relacionados usam unidade diferente da exigida — confira a equivalência.' };
  }
  const total = compatible.reduce((sum, item) => sum + item.quantity, 0);
  const largest = Math.max(...compatible.map((item) => item.quantity));
  const counted = req.allowsSum === true ? total : largest;
  const companyValue = quantity(counted, req.unit);
  const basis = req.allowsSum === true ? 'Soma dos atestados relacionados.' : 'Maior atestado relacionado (o edital não permite somar).';
  if (counted >= req.minQuantity) return { status: 'ok', required, companyValue, note: basis };
  if (incompatible > 0) {
    return { status: 'check', required, companyValue, note: `${basis} Há atestados relacionados em outra unidade — confira a equivalência.` };
  }
  if (req.allowsSum === null && total >= req.minQuantity) {
    return { status: 'check', required, companyValue, note: 'Somando os atestados o mínimo seria atingido, mas o edital não deixa claro se a soma é permitida — confira.' };
  }
  return { status: 'fail', required, companyValue, note: `${basis} Quantidade abaixo do mínimo exigido.` };
}

function evaluateAmount(req: ExtractedRequirement, ctx: Context): Evaluation {
  const label = req.category === 'net_worth' ? 'Patrimônio líquido' : 'Capital social';
  const companyCents = req.category === 'net_worth' ? ctx.profile.financial.netWorthCents : ctx.profile.financial.shareCapitalCents;
  const companyValue = companyCents === null ? null : money(companyCents);
  let requiredCents: number;
  let trusted = true;
  let note = '';
  if (req.amountCents !== null) {
    if (req.amountCents <= 0) {
      return { status: 'check', required: `${label} mínimo`, companyValue, note: 'Valor exigido lido do edital parece implausível — confira o trecho.' };
    }
    requiredCents = req.amountCents;
  } else if (req.percentOfEstimate !== null) {
    const percent = `${numberFormat.format(req.percentOfEstimate)}%`;
    if (req.percentOfEstimate < 1 || req.percentOfEstimate > 100) {
      return { status: 'check', required: `${percent} do valor estimado`, companyValue, note: `O percentual de ${percent} lido do edital parece implausível — confira o trecho.` };
    }
    if (!ctx.estimate) {
      return { status: 'check', required: `${percent} do valor estimado`, companyValue, note: 'Valor estimado da contratação não disponível — confira o valor exigido no edital.' };
    }
    requiredCents = Math.round((ctx.estimate.cents * req.percentOfEstimate) / 100);
    trusted = ctx.estimate.trusted;
    note = `${percent} de ${money(ctx.estimate.cents)}.`;
  } else {
    return { status: 'check', required: `${label} mínimo`, companyValue, note: 'O edital não informa o valor exigido de forma reconhecível — confira o trecho.' };
  }
  const required = money(requiredCents);
  if (companyCents === null) {
    return { status: 'check', required, companyValue, note: `Informe o ${label.toLowerCase()} no perfil técnico.` };
  }
  if (!trusted) {
    return { status: 'check', required, companyValue, note: `${note} valor estimado lido do edital — confira antes de concluir.` };
  }
  return { status: companyCents >= requiredCents ? 'ok' : 'fail', required, companyValue, note };
}

function evaluateRatio(req: ExtractedRequirement, ctx: Context): Evaluation {
  if (req.ratioName === null || req.minRatio === null) {
    return { status: 'check', required: 'Índice contábil', companyValue: null, note: 'Índice não comparável automaticamente — confira a exigência no trecho do edital.' };
  }
  const required = `${req.ratioName} ≥ ${ratioFormat.format(req.minRatio)}`;
  if (req.minRatio <= 0) {
    return { status: 'check', required, companyValue: null, note: 'Índice mínimo lido do edital parece implausível — confira o trecho.' };
  }
  const { liquidityGeneral, solvencyGeneral, liquidityCurrent, balanceSheetDate } = ctx.profile.financial;
  const value = { LG: liquidityGeneral, SG: solvencyGeneral, LC: liquidityCurrent }[req.ratioName];
  if (value === null) {
    return { status: 'check', required, companyValue: null, note: `Informe o índice ${req.ratioName} no perfil técnico.` };
  }
  const companyValue = `${req.ratioName} ${ratioFormat.format(value)}`;
  const day = balanceSheetDate ? isoDay(balanceSheetDate) : null;
  if (!day) {
    return { status: 'check', required, companyValue, note: 'Informe a data do balanço no perfil técnico para validar o índice.' };
  }
  const limit = new Date(`${day}T00:00:00Z`);
  limit.setUTCMonth(limit.getUTCMonth() + BALANCE_SHEET_MAX_AGE_MONTHS);
  if (ctx.now.getTime() > limit.getTime()) {
    return { status: 'check', required, companyValue, note: `Balanço de ${brDate(day)} tem mais de ${BALANCE_SHEET_MAX_AGE_MONTHS} meses — confira se ainda é aceito.` };
  }
  return { status: value >= req.minRatio ? 'ok' : 'fail', required, companyValue, note: '' };
}

function evaluateInformative(req: ExtractedRequirement, ctx: Context): Evaluation {
  if (req.category === 'technical_visit') {
    return {
      status: 'check',
      required: req.deadline ? `Visita técnica até ${brDateTime(req.deadline)}` : 'Visita técnica',
      companyValue: null,
      note: 'Informativo: agende a visita técnica (ou a declaração substitutiva) dentro do prazo do edital.'
    };
  }
  let required = 'Garantia de proposta';
  if (req.amountCents !== null) required = money(req.amountCents);
  else if (req.percentOfEstimate !== null) {
    const percent = `${numberFormat.format(req.percentOfEstimate)}% do valor estimado`;
    required = ctx.estimate ? `${percent} (${money(Math.round((ctx.estimate.cents * req.percentOfEstimate) / 100))})` : percent;
  }
  return { status: 'check', required, companyValue: null, note: 'Informativo: providencie a garantia de proposta antes da sessão.' };
}

function evaluate(req: ExtractedRequirement, ctx: Context): Evaluation {
  switch (req.category) {
    case 'professional_registration':
      return evaluateRegistration(req, ctx);
    case 'technical_capacity_company':
    case 'technical_capacity_professional':
      return evaluateAttestations(req, ctx);
    case 'net_worth':
    case 'share_capital':
      return evaluateAmount(req, ctx);
    case 'financial_ratios':
      return evaluateRatio(req, ctx);
    case 'technical_visit':
    case 'bid_guarantee':
      return evaluateInformative(req, ctx);
    case 'other_elimination':
      return { status: 'check', required: req.description, companyValue: null, note: `Confira esta condição no edital: "${req.excerpt}"` };
  }
}

function buildCheck(req: ExtractedRequirement, ctx: Context, knownLot: boolean): RequirementCheck {
  const evaluation = evaluate(req, ctx);
  let { status, note } = evaluation;
  if (!knownLot) {
    status = 'check';
    note = `Exigência ligada a um lote não identificado ("${req.lot}") — confira a qual lote ela se aplica.`;
  } else if (req.conditional) {
    status = 'check';
    note = 'Exigência condicional ou composta que a análise automática não consegue decidir — confira no trecho do edital.';
  }
  return {
    requirementId: req.id,
    category: req.category,
    description: req.description,
    status,
    informative: INFORMATIVE.has(req.category),
    required: evaluation.required,
    companyValue: evaluation.companyValue,
    note,
    page: req.page,
    excerpt: req.excerpt,
    deadline: req.deadline
  };
}

type VerdictUnit = { status: CheckStatus; mandatory: boolean; informative: boolean };

function combine(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('ok')) return 'ok';
  if (statuses.every((status) => status === 'fail')) return 'fail';
  return 'check';
}

function judgeLot(lotId: string | null, requirements: ExtractedRequirement[], checks: RequirementCheck[]): LotVerdict {
  const units: VerdictUnit[] = [];
  const groups = new Map<string, number[]>();
  requirements.forEach((req, index) => {
    if (req.alternativeGroup === null) {
      units.push({ status: checks[index]!.status, mandatory: req.mandatory, informative: checks[index]!.informative });
    } else {
      groups.set(req.alternativeGroup, [...(groups.get(req.alternativeGroup) ?? []), index]);
    }
  });
  for (const indexes of groups.values()) {
    const status = combine(indexes.map((index) => checks[index]!.status));
    units.push({
      status,
      mandatory: indexes.some((index) => requirements[index]!.mandatory),
      informative: indexes.every((index) => checks[index]!.informative)
    });
    if (status === 'ok') {
      for (const index of indexes) {
        const check = checks[index]!;
        if (check.status !== 'ok') check.note = `${check.note} Alternativa atendida por outra exigência do mesmo grupo.`.trim();
      }
    }
  }
  // A failed optional requirement never makes the lot NOT_APT, but it must not vanish into APT either.
  const failCount = units.filter((unit) => unit.status === 'fail' && unit.mandatory).length;
  const checkCount = units.filter(
    (unit) => (unit.status === 'check' && !unit.informative) || (unit.status === 'fail' && !unit.mandatory)
  ).length;
  requirements.forEach((req, index) => {
    const check = checks[index]!;
    if (req.alternativeGroup === null && !req.mandatory && check.status === 'fail') {
      check.note = `${check.note} Exigência facultativa não atendida — confira se ela afeta sua participação.`.trim();
    }
  });
  const verdict = failCount > 0 ? 'NOT_APT' : checkCount > 0 ? 'CHECK' : 'APT';
  return { lotId, verdict, failCount, checkCount, checks };
}

/**
 * The opportunity value (from PNCP) is trusted only when the edital has at most one lot; lot and summary
 * values are read by the AI, so percentage requirements based on them never go beyond `check`.
 */
function resolveEstimate(lotCents: number | null, input: CompareInput): Estimate {
  const lotCount = input.extraction.summary.lots.length;
  if (lotCount <= 1 && input.opportunityEstimatedValueCents > 0) return { cents: input.opportunityEstimatedValueCents, trusted: true };
  if (lotCents !== null && lotCents > 0) return { cents: lotCents, trusted: false };
  if (lotCount > 1) return null;
  const summaryCents = input.extraction.summary.estimatedValueCents;
  if (summaryCents !== null && summaryCents > 0) return { cents: summaryCents, trusted: false };
  return null;
}

/**
 * Deterministic comparison of the extracted requirements with the company profile, one verdict per lot.
 * Anything that cannot be decided from data becomes `check`, never `ok`.
 */
export function compareRequirements(input: CompareInput): LotVerdict[] {
  const { extraction, profile, now } = input;
  const lots = extraction.summary.lots;
  const lotIds = new Set(lots.map((lot) => lot.id));
  const targets = lots.length > 0 ? lots.map((lot) => ({ id: lot.id as string | null, estimatedValueCents: lot.estimatedValueCents })) : [{ id: null, estimatedValueCents: null }];

  return targets.map((target) => {
    const ctx: Context = { profile, matches: extraction.matches, estimate: resolveEstimate(target.estimatedValueCents, input), now };
    const requirements = extraction.requirements.filter((req) => req.lot === null || req.lot === target.id || !lotIds.has(req.lot));
    const checks = requirements.map((req) => buildCheck(req, ctx, req.lot === null || lotIds.has(req.lot)));
    return judgeLot(target.id, requirements, checks);
  });
}
