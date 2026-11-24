import { describe, expect, it } from 'vitest';
import { emptyCompanyProfile, type Attestation, type CompanyProfile } from '../../src/domain/companyProfile';
import { compareRequirements, type LotVerdict, type RequirementCheck } from '../../src/services/edital/compareRequirements';
import type { EditalExtraction, ExtractedMatch, ExtractedRequirement } from '../../src/services/edital/extraction';
import { normalizeUnit } from '../../src/services/edital/units';

const NOW = new Date('2026-11-24T12:00:00Z');

function requirement(overrides: Partial<ExtractedRequirement> & Pick<ExtractedRequirement, 'id' | 'category'>): ExtractedRequirement {
  return {
    lot: null,
    description: `Exigência ${overrides.id}`,
    page: 10,
    excerpt: `Trecho ${overrides.id}`,
    mandatory: true,
    alternativeGroup: null,
    conditional: false,
    minQuantity: null,
    unit: null,
    allowsSum: null,
    percentOfEstimate: null,
    amountCents: null,
    ratioName: null,
    minRatio: null,
    council: null,
    deadline: null,
    ...overrides
  };
}

function extraction(
  requirements: ExtractedRequirement[],
  options: { matches?: ExtractedMatch[]; estimatedValueCents?: number | null; lots?: EditalExtraction['summary']['lots'] } = {}
): EditalExtraction {
  return {
    summary: {
      object: 'Construção de escola',
      estimatedValueCents: options.estimatedValueCents ?? null,
      openingAt: null,
      modality: null,
      executionRegime: null,
      judgmentCriterion: null,
      allowsConsortium: null,
      lots: options.lots ?? []
    },
    requirements,
    matches: options.matches ?? []
  };
}

function attestation(id: string, quantity: number, unit: string): Attestation {
  return { id, service: 'Edificação', quantity, unit, contractor: 'Prefeitura', catNumber: null, technicianId: null, issuedAt: null };
}

function match(requirementId: string, attestationId: string, confidence: ExtractedMatch['confidence'] = 'high'): ExtractedMatch {
  return { requirementId, attestationId, confidence, reason: 'Mesmo serviço' };
}

function profile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  const base = emptyCompanyProfile();
  return { ...base, ...overrides, financial: { ...base.financial, ...overrides.financial } };
}

function compare(ext: EditalExtraction, prof: CompanyProfile, opportunityEstimatedValueCents = 0): LotVerdict[] {
  return compareRequirements({ extraction: ext, profile: prof, opportunityEstimatedValueCents, now: NOW });
}

function only(verdicts: LotVerdict[], requirementId: string): RequirementCheck {
  expect(verdicts).toHaveLength(1);
  const check = verdicts[0]!.checks.find((item) => item.requirementId === requirementId);
  expect(check).toBeDefined();
  return check!;
}

const crea = requirement({ id: 'r1', category: 'professional_registration', council: 'CREA' });
const area = (overrides: Partial<ExtractedRequirement> = {}) =>
  requirement({ id: 'a1', category: 'technical_capacity_company', minQuantity: 1500, unit: 'm²', allowsSum: true, ...overrides });
const freshBalance = { balanceSheetDate: '2026-03-31' };

describe('normalizeUnit', () => {
  it('normaliza variações de unidade e rejeita desconhecidas', () => {
    expect(['m²', 'm2', 'metro quadrado', 'Metros Quadrados'].map(normalizeUnit)).toEqual(['m2', 'm2', 'm2', 'm2']);
    expect(['m³', 'm3', 'metros cúbicos'].map(normalizeUnit)).toEqual(['m3', 'm3', 'm3']);
    expect(['m', 'metro', 'metros lineares'].map(normalizeUnit)).toEqual(['m', 'm', 'm']);
    expect(['km', 'quilômetros'].map(normalizeUnit)).toEqual(['km', 'km']);
    expect(['t', 'ton', 'toneladas'].map(normalizeUnit)).toEqual(['t', 't', 't']);
    expect(['un', 'unidade', 'unidades'].map(normalizeUnit)).toEqual(['un', 'un', 'un']);
    expect(normalizeUnit('verba')).toBeNull();
  });
});

describe('compareRequirements', () => {
  it('CREA válido até data futura → ok', () => {
    const result = compare(extraction([crea]), profile({ registrations: [{ council: 'CREA', number: '123', state: 'PR', validUntil: '2027-06-30' }] }));
    expect(only(result, 'r1').status).toBe('ok');
    expect(result[0]!.verdict).toBe('APT');
  });

  it('CREA vencido → check', () => {
    const result = compare(extraction([crea]), profile({ registrations: [{ council: 'CREA', number: '123', state: 'PR', validUntil: '2026-01-31' }] }));
    expect(only(result, 'r1').status).toBe('check');
    expect(result[0]!.verdict).toBe('CHECK');
  });

  it('sem registro e exigência CREA → fail', () => {
    const result = compare(extraction([crea]), profile({ registrations: [{ council: 'CAU', number: '9', state: 'PR', validUntil: '2027-06-30' }] }));
    expect(only(result, 'r1').status).toBe('fail');
    expect(result[0]!.verdict).toBe('NOT_APT');
  });

  it('exige 1.500 m², atestados de 800 m2 e 900 metros quadrados com allowsSum: true → ok', () => {
    const ext = extraction([area()], { matches: [match('a1', 'at1'), match('a1', 'at2', 'medium')] });
    const check = only(compare(ext, profile({ attestations: [attestation('at1', 800, 'm2'), attestation('at2', 900, 'metros quadrados')] })), 'a1');
    expect(check.status).toBe('ok');
    expect(check.required).toBe('1.500 m²');
    expect(check.companyValue).toBe('1.700 m²');
  });

  it('mesmos atestados com allowsSum: false → fail', () => {
    const ext = extraction([area({ allowsSum: false })], { matches: [match('a1', 'at1'), match('a1', 'at2', 'medium')] });
    const result = compare(ext, profile({ attestations: [attestation('at1', 800, 'm2'), attestation('at2', 900, 'metros quadrados')] }));
    expect(only(result, 'a1').status).toBe('fail');
    expect(only(result, 'a1').companyValue).toBe('900 m²');
    expect(result[0]!.verdict).toBe('NOT_APT');
  });

  it('match low ignorado → check "a IA não encontrou atestado equivalente"', () => {
    const ext = extraction([area()], { matches: [match('a1', 'at1', 'low')] });
    const check = only(compare(ext, profile({ attestations: [attestation('at1', 5000, 'm2')] })), 'a1');
    expect(check.status).toBe('check');
    expect(check.note).toContain('a IA não encontrou atestado equivalente');
  });

  it('perfil sem atestados → fail com nota "nenhum atestado cadastrado"', () => {
    const check = only(compare(extraction([area()]), profile()), 'a1');
    expect(check.status).toBe('fail');
    expect(check.note).toContain('nenhum atestado cadastrado');
  });

  it('unidade diferente (m² vs m³) → check', () => {
    const ext = extraction([area()], { matches: [match('a1', 'at1')] });
    const check = only(compare(ext, profile({ attestations: [attestation('at1', 5000, 'm³')] })), 'a1');
    expect(check.status).toBe('check');
  });

  it('PL 10% de R$ 1.000.000 com PL R$ 120.000 → ok', () => {
    const ext = extraction([requirement({ id: 'pl', category: 'net_worth', percentOfEstimate: 10 })]);
    const check = only(compare(ext, profile({ financial: { ...emptyCompanyProfile().financial, netWorthCents: 12_000_000 } }), 100_000_000), 'pl');
    expect(check.status).toBe('ok');
    expect(check.required).toBe('R$ 100.000,00');
    expect(check.companyValue).toBe('R$ 120.000,00');
  });

  it('PL 10% de R$ 1.000.000 com PL R$ 90.000 → fail', () => {
    const ext = extraction([requirement({ id: 'pl', category: 'net_worth', percentOfEstimate: 10 })]);
    const check = only(compare(ext, profile({ financial: { ...emptyCompanyProfile().financial, netWorthCents: 9_000_000 } }), 100_000_000), 'pl');
    expect(check.status).toBe('fail');
  });

  it('PL com estimado da oportunidade 0 e do summary R$ 1.000.000 → check', () => {
    const ext = extraction([requirement({ id: 'pl', category: 'net_worth', percentOfEstimate: 10 })], { estimatedValueCents: 100_000_000 });
    const check = only(compare(ext, profile({ financial: { ...emptyCompanyProfile().financial, netWorthCents: 12_000_000 } }), 0), 'pl');
    expect(check.status).toBe('check');
    expect(check.note).toContain('valor estimado lido do edital');
  });

  it('LG mínimo 1 com LG 0,9 → fail', () => {
    const ext = extraction([requirement({ id: 'lg', category: 'financial_ratios', ratioName: 'LG', minRatio: 1 })]);
    const result = compare(ext, profile({ financial: { ...emptyCompanyProfile().financial, ...freshBalance, liquidityGeneral: 0.9 } }));
    const check = only(result, 'lg');
    expect(check.status).toBe('fail');
    expect(check.required).toBe('LG ≥ 1,00');
    expect(check.companyValue).toBe('LG 0,90');
    expect(result[0]!.verdict).toBe('NOT_APT');
  });

  it('LG 0,9 em alternativeGroup com PL suficiente → grupo ok e veredito APT', () => {
    const ext = extraction([
      requirement({ id: 'lg', category: 'financial_ratios', ratioName: 'LG', minRatio: 1, alternativeGroup: 'g1' }),
      requirement({ id: 'pl', category: 'net_worth', percentOfEstimate: 10, alternativeGroup: 'g1' })
    ]);
    const financial = { ...emptyCompanyProfile().financial, ...freshBalance, liquidityGeneral: 0.9, netWorthCents: 12_000_000 };
    const result = compare(ext, profile({ financial }), 100_000_000);
    expect(only(result, 'lg').status).toBe('fail');
    expect(only(result, 'pl').status).toBe('ok');
    expect(result[0]!.verdict).toBe('APT');
    expect(result[0]!.failCount).toBe(0);
  });

  it('visita técnica com prazo → check informativo; veredito continua APT', () => {
    const ext = extraction([requirement({ id: 'vt', category: 'technical_visit', deadline: '2026-12-10T10:00:00-03:00' })]);
    const result = compare(ext, profile());
    const check = only(result, 'vt');
    expect(check.status).toBe('check');
    expect(check.informative).toBe(true);
    expect(check.deadline).toBe('2026-12-10T10:00:00-03:00');
    expect(result[0]!.verdict).toBe('APT');
  });

  it('dois lotes com mínimos 500 e 3.000 m² e atestado de 1.000 m² → lote A APT, lote B NOT_APT', () => {
    const ext = extraction(
      [area({ id: 'a1', lot: 'A', minQuantity: 500 }), area({ id: 'b1', lot: 'B', minQuantity: 3000 })],
      {
        lots: [
          { id: 'A', object: 'Lote A', estimatedValueCents: null },
          { id: 'B', object: 'Lote B', estimatedValueCents: null }
        ],
        matches: [match('a1', 'at1'), match('b1', 'at1')]
      }
    );
    const result = compare(ext, profile({ attestations: [attestation('at1', 1000, 'm2')] }));
    expect(result.map((lot) => [lot.lotId, lot.verdict])).toEqual([
      ['A', 'APT'],
      ['B', 'NOT_APT']
    ]);
    expect(result[0]!.checks.map((check) => check.requirementId)).toEqual(['a1']);
    expect(result[1]!.checks.map((check) => check.requirementId)).toEqual(['b1']);
  });

  it('exigência conditional: true → check e veredito CHECK', () => {
    const ext = extraction([requirement({ id: 'lg', category: 'financial_ratios', ratioName: 'LG', minRatio: 1, conditional: true })]);
    const result = compare(ext, profile({ financial: { ...emptyCompanyProfile().financial, ...freshBalance, liquidityGeneral: 2 } }));
    expect(only(result, 'lg').status).toBe('check');
    expect(result[0]!.verdict).toBe('CHECK');
  });
});
