import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompanyProfile } from '../../app/types';
import { formToProfile, parseNumberText, profileToForm } from '../../app/viewModels/profileFormViewModel';

const profile: CompanyProfile = {
  registrations: [{ council: 'CREA', number: '1', state: 'PR', validUntil: null }],
  technicians: [{ id: 't1', name: 'Ana', title: 'Eng', registrationNumber: '1' }],
  attestations: [{ id: 'a1', service: 'Pavimentação', quantity: 1500.5, unit: 'm2', contractor: 'Prefeitura', catNumber: null, technicianId: null, issuedAt: null }],
  financial: {
    netWorthCents: -500_000,
    shareCapitalCents: 12_345_678,
    liquidityGeneral: 1.25,
    solvencyGeneral: null,
    liquidityCurrent: 2,
    balanceSheetDate: '2026-03-31'
  }
};

describe('parseNumberText', () => {
  it('vazio é null; número válido é convertido; negativo é aceito', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('  ')).toBeNull();
    expect(parseNumberText('1500.5')).toBe(1500.5);
    expect(parseNumberText('-5000')).toBe(-5000);
    expect(parseNumberText('1500,5')).toBe(1500.5);
  });

  it('formato com milhar e vírgula é ambíguo e inválido', () => {
    expect(parseNumberText('1.500,50')).toBeUndefined();
  });

  it('texto incompleto ou inválido é undefined (não vira null nem 0)', () => {
    expect(parseNumberText('-')).toBeUndefined();
    expect(parseNumberText('1e')).toBeUndefined();
    expect(parseNumberText('abc')).toBeUndefined();
  });
});

describe('formulário do perfil técnico', () => {
  it('ida e volta mantém os valores, inclusive PL negativo', () => {
    const form = profileToForm(profile);
    expect(form.netWorth).toBe('-5000');
    expect(form.attestations[0]!.quantity).toBe('1500.5');
    expect(form.solvencyGeneral).toBe('');
    expect(formToProfile(form)).toEqual({ ok: true, profile });
  });

  it('valor digitado pela metade não é apagado no formulário e bloqueia o salvamento', () => {
    const form = profileToForm(profile);
    form.netWorth = '-';
    form.attestations[0]!.quantity = '1e';
    const result = formToProfile(form);
    expect(result.ok).toBe(false);
    expect(form.netWorth).toBe('-');
    if (!result.ok) expect(result.error).toContain('Patrimônio líquido');
  });

  it('quantidade do atestado vazia é inválida', () => {
    const form = profileToForm(profile);
    form.attestations[0]!.quantity = '';
    expect(formToProfile(form).ok).toBe(false);
  });

  it('perfil.vue não converte números enquanto digita', () => {
    const page = readFileSync('app/pages/perfil.vue', 'utf8');
    expect(page).not.toContain('numberFrom');
    expect(page).toContain('v-model="form.netWorth"');
    expect(page).toContain('v-model="item.quantity"');
    expect(page).toContain('formToProfile');
  });
});
