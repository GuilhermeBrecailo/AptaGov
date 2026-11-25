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
    const ext = extraction([crea, requirement({ id: 'vt', category: 'technical_visit', deadline: '2026-12-10T10:00:00-03:00' })]);
    const result = compare(ext, profile({ registrations: [{ council: 'CREA', number: '123', state: 'PR', validUntil: '2027-06-30' }] }));
    const check = only(result, 'vt');
    expect(check.status).toBe('check');
    expect(check.informative).toBe(true);
    expect(check.deadline).toBe('2026-12-10T10:00:00-03:00');
    expect(result[0]!.verdict).toBe('APT');
  });

  it.each([
    ['nenhuma exigência', []],
    ['só exigências informativas', [requirement({ id: 'vt', category: 'technical_visit' }), requirement({ id: 'gp', category: 'bid_guarantee' })]]
  ])('lote com %s → CHECK com item sintético, nunca APT', (_label, requirements) => {
    const result = compare(extraction(requirements), profile());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ verdict: 'CHECK', failCount: 0, checkCount: 1 });
    const synthetic = result[0]!.checks.find((check) => check.description === 'Nenhuma exigência de habilitação encontrada — confira o edital');
    expect(synthetic).toMatchObject({ status: 'check', informative: false });
  });

  it('lote sem exigências próprias em edital com vários lotes também vira CHECK', () => {
    const ext = extraction([area({ id: 'a1', lot: 'A', minQuantity: 500 })], {
      lots: [
        { id: 'A', object: 'Lote A', estimatedValueCents: null },
        { id: 'B', object: 'Lote B', estimatedValueCents: null }
      ],
      matches: [match('a1', 'at1')]
    });
    const result = compare(ext, profile({ attestations: [attestation('at1', 1000, 'm2')] }));
    expect(result.map((lot) => [lot.lotId, lot.verdict])).toEqual([
      ['A', 'APT'],
      ['B', 'CHECK']
    ]);
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

  describe('correções da revisão', () => {
    const financial = (overrides: Partial<CompanyProfile['financial']>) => ({ ...emptyCompanyProfile().financial, ...overrides });
    const twoLots = (estimateA: number | null) => [
      { id: 'A', object: 'Lote A', estimatedValueCents: estimateA },
      { id: 'B', object: 'Lote B', estimatedValueCents: null }
    ];

    it('valor estimado do lote (lido pela IA) não é confiável: PL percentual vira check', () => {
      const ext = extraction([requirement({ id: 'pl', lot: 'A', category: 'net_worth', percentOfEstimate: 10 })], { lots: twoLots(100_000_000) });
      const result = compare(ext, profile({ financial: financial({ netWorthCents: 12_000_000 }) }), 500_000_000);
      const check = result[0]!.checks.find((item) => item.requirementId === 'pl')!;
      expect(check.status).toBe('check');
      expect(check.required).toBe('R$ 100.000,00');
      expect(check.note).toContain('valor estimado lido do edital');
      expect(result[0]!.verdict).toBe('CHECK');
    });

    it('com um único lote, o valor estimado da oportunidade é usado como confiável', () => {
      const ext = extraction([requirement({ id: 'pl', category: 'net_worth', percentOfEstimate: 10 })], {
        lots: [{ id: 'A', object: 'Lote único', estimatedValueCents: 50_000_000 }]
      });
      const check = only(compare(ext, profile({ financial: financial({ netWorthCents: 12_000_000 }) }), 100_000_000), 'pl');
      expect(check.status).toBe('ok');
      expect(check.required).toBe('R$ 100.000,00');
    });

    it('fail em exigência facultativa conta como check: veredito CHECK, nunca APT nem NOT_APT', () => {
      const ext = extraction([area({ mandatory: false })], { matches: [match('a1', 'at1')] });
      const result = compare(ext, profile({ attestations: [attestation('at1', 100, 'm2')] }));
      expect(only(result, 'a1').status).toBe('fail');
      expect(result[0]).toMatchObject({ verdict: 'CHECK', failCount: 0, checkCount: 1 });
    });

    it('registro sem conselho especificado no edital → check', () => {
      const ext = extraction([requirement({ id: 'r1', category: 'professional_registration', council: null })]);
      const check = only(compare(ext, profile({ registrations: [{ council: 'CREA', number: '1', state: 'PR', validUntil: '2027-06-30' }] })), 'r1');
      expect(check.status).toBe('check');
      expect(check.note).toContain('Edital não especifica o conselho');
    });

    it.each([
      ['percentual < 1%', requirement({ id: 'x', category: 'net_worth', percentOfEstimate: 0.5 })],
      ['percentual ≤ 0', requirement({ id: 'x', category: 'net_worth', percentOfEstimate: 0 })],
      ['percentual > 100%', requirement({ id: 'x', category: 'share_capital', percentOfEstimate: 150 })],
      ['amountCents ≤ 0', requirement({ id: 'x', category: 'net_worth', amountCents: 0 })],
      ['minQuantity ≤ 0', requirement({ id: 'x', category: 'technical_capacity_company', minQuantity: 0, unit: 'm2', allowsSum: true })],
      ['minRatio ≤ 0', requirement({ id: 'x', category: 'financial_ratios', ratioName: 'LG', minRatio: 0 })]
    ])('limiar implausível da IA (%s) → check com nota', (_label, req) => {
      const prof = profile({
        attestations: [attestation('at1', 5000, 'm2')],
        financial: financial({ ...freshBalance, netWorthCents: 999_999_999_00, shareCapitalCents: 999_999_999_00, liquidityGeneral: 5 })
      });
      const check = only(compare(extraction([req], { matches: [match('x', 'at1')] }), prof, 100_000_000), 'x');
      expect(check.status).toBe('check');
      expect(check.note).toContain('implausível');
    });

    it('registro sem data de validade → check', () => {
      const result = compare(extraction([crea]), profile({ registrations: [{ council: 'CREA', number: '1', state: 'PR', validUntil: null }] }));
      expect(only(result, 'r1').status).toBe('check');
      expect(only(result, 'r1').note).toContain('sem data de validade');
    });

    const technician = { id: 't1', name: 'Ana', title: 'Engenheira civil', registrationNumber: 'CREA-PR 1' };
    const withCat = (id: string, quantity: number, overrides: Partial<Attestation> = {}): Attestation =>
      ({ ...attestation(id, quantity, 'm²'), catNumber: 'CAT 123/2024', technicianId: 't1', ...overrides });
    const professional = () => extraction([area({ category: 'technical_capacity_professional', minQuantity: 300 })], { matches: [match('a1', 'at1')] });

    it('capacidade técnico-profissional usa os atestados relacionados com CAT e responsável', () => {
      const check = only(compare(professional(), profile({ technicians: [technician], attestations: [withCat('at1', 400)] })), 'a1');
      expect(check.status).toBe('ok');
      expect(check.category).toBe('technical_capacity_professional');
    });

    it.each([
      ['sem CAT', withCat('at1', 400, { catNumber: null })],
      ['CAT em branco', withCat('at1', 400, { catNumber: '  ' })],
      ['sem responsável', withCat('at1', 400, { technicianId: null })],
      ['responsável inexistente no perfil', withCat('at1', 400, { technicianId: 'outro' })]
    ])('capacidade técnico-profissional com atestado %s → check pedindo a CAT', (_label, item) => {
      const result = compare(professional(), profile({ technicians: [technician], attestations: [item] }));
      const check = only(result, 'a1');
      expect(check.status).toBe('check');
      expect(check.note).toBe('Exige CAT do responsável técnico — vincule a CAT e o responsável no perfil');
      expect(result[0]!.verdict).toBe('CHECK');
    });

    it('capacidade técnico-profissional conta só os atestados com CAT e responsável; abaixo do mínimo com outros sem CAT → check', () => {
      const ext = extraction([area({ category: 'technical_capacity_professional', minQuantity: 300 })], { matches: [match('a1', 'at1'), match('a1', 'at2')] });
      const check = only(compare(ext, profile({ technicians: [technician], attestations: [withCat('at1', 200), withCat('at2', 200, { catNumber: null })] })), 'a1');
      expect(check.status).toBe('check');
      expect(check.companyValue).toBe('200 m²');
      expect(check.note).toContain('Exige CAT do responsável técnico — vincule a CAT e o responsável no perfil');
    });

    it('capacidade técnico-profissional: atestado sem CAT não completa o mínimo do atestado com CAT', () => {
      const ext = extraction([area({ category: 'technical_capacity_professional', minQuantity: 300 })], { matches: [match('a1', 'at1'), match('a1', 'at2')] });
      const check = only(compare(ext, profile({ technicians: [technician], attestations: [withCat('at1', 200), withCat('at2', 200, { technicianId: null })] })), 'a1');
      expect(check.status).not.toBe('ok');
    });

    it('exigência ligada a lote inexistente entra em todos os lotes como check', () => {
      const ext = extraction([area({ lot: 'Z', minQuantity: 10 })], { lots: twoLots(null), matches: [match('a1', 'at1')] });
      const result = compare(ext, profile({ attestations: [attestation('at1', 1000, 'm2')] }));
      expect(result.map((lot) => [lot.lotId, lot.verdict, lot.checks[0]?.status])).toEqual([
        ['A', 'CHECK', 'check'],
        ['B', 'CHECK', 'check']
      ]);
      expect(result[0]!.checks[0]!.note).toContain('lote não identificado');
    });

    it('allowsSum: null e só a soma atinge o mínimo → check', () => {
      const ext = extraction([area({ allowsSum: null })], { matches: [match('a1', 'at1'), match('a1', 'at2')] });
      const check = only(compare(ext, profile({ attestations: [attestation('at1', 800, 'm2'), attestation('at2', 900, 'm2')] })), 'a1');
      expect(check.status).toBe('check');
      expect(check.companyValue).toBe('900 m²');
    });

    it('atestados com unidades mistas abaixo do mínimo → check', () => {
      const ext = extraction([area()], { matches: [match('a1', 'at1'), match('a1', 'at2')] });
      const check = only(compare(ext, profile({ attestations: [attestation('at1', 800, 'm2'), attestation('at2', 900, 'm³')] })), 'a1');
      expect(check.status).toBe('check');
      expect(check.companyValue).toBe('800 m²');
    });

    it('balanço com mais de 16 meses → check', () => {
      const ext = extraction([requirement({ id: 'lg', category: 'financial_ratios', ratioName: 'LG', minRatio: 1 })]);
      const check = only(compare(ext, profile({ financial: financial({ balanceSheetDate: '2025-06-30', liquidityGeneral: 2 }) })), 'lg');
      expect(check.status).toBe('check');
      expect(check.note).toContain('mais de 16 meses');
    });

    it('índice com ratioName: null → check, sem comparação numérica', () => {
      const ext = extraction([requirement({ id: 'ge', category: 'financial_ratios', ratioName: null, minRatio: 0.5 })]);
      const result = compare(ext, profile({ financial: financial({ ...freshBalance, liquidityGeneral: 2, solvencyGeneral: 2, liquidityCurrent: 2 }) }));
      expect(only(result, 'ge').status).toBe('check');
      expect(result[0]!.verdict).toBe('CHECK');
    });

    it('grupo alternativo com check + fail → check e veredito CHECK', () => {
      const ext = extraction([
        requirement({ id: 'lg', category: 'financial_ratios', ratioName: 'LG', minRatio: 1, alternativeGroup: 'g1' }),
        requirement({ id: 'pl', category: 'net_worth', percentOfEstimate: 10, alternativeGroup: 'g1' })
      ]);
      const result = compare(ext, profile({ financial: financial({ ...freshBalance, liquidityGeneral: 0.9 }) }), 100_000_000);
      expect(only(result, 'lg').status).toBe('fail');
      expect(only(result, 'pl').status).toBe('check');
      expect(result[0]).toMatchObject({ verdict: 'CHECK', failCount: 0, checkCount: 1 });
    });
  });
});
