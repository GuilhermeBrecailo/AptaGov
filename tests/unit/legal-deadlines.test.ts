import { describe, expect, it } from 'vitest';
import {
  businessDaysBefore,
  parseBrtDateTime,
  isBrazilianNationalHoliday,
  LEGAL_DEADLINE_NOTE,
} from '../../src/domain/legalDeadlines';

describe('parseBrtDateTime', () => {
  it('data pura vale 23:59 BRT', () => {
    expect(parseBrtDateTime('2026-12-07')?.toISOString()).toBe('2026-12-08T02:59:00.000Z');
  });
  it('data/hora sem offset é lida como BRT', () => {
    expect(parseBrtDateTime('2026-12-07T18:00:00')?.toISOString()).toBe('2026-12-07T21:00:00.000Z');
  });
  it('Z e offset explícito são respeitados', () => {
    expect(parseBrtDateTime('2026-12-07T18:00:00Z')?.toISOString()).toBe('2026-12-07T18:00:00.000Z');
    expect(parseBrtDateTime('2026-12-07T18:00:00+00:00')?.toISOString()).toBe('2026-12-07T18:00:00.000Z');
    expect(parseBrtDateTime('2026-12-07T18:00:00-03:00')?.toISOString()).toBe('2026-12-07T21:00:00.000Z');
  });
  it('inválido retorna null', () => {
    expect(parseBrtDateTime('não é data')).toBeNull();
    expect(parseBrtDateTime('')).toBeNull();
    expect(parseBrtDateTime('2026-13-45')).toBeNull();
  });
});

describe('businessDaysBefore sem offset (PNCP)', () => {
  it('abertura sem offset é BRT, independente do fuso do servidor', () => {
    expect(businessDaysBefore('2026-12-10T00:30:00', 3)).toBe('2026-12-08T02:59:00.000Z');
  });
});

describe('businessDaysBefore', () => {
  it('conta 3 dias úteis antes da abertura, 23:59 BRT', () => {
    expect(businessDaysBefore('2026-12-10T12:00:00.000Z', 3)).toBe('2026-12-08T02:59:00.000Z');
  });
  it('pula fim de semana', () => {
    expect(businessDaysBefore('2026-11-16T13:00:00Z', 3)).toBe('2026-11-12T02:59:00.000Z');
  });
  it('pula Sexta-feira Santa', () => {
    expect(businessDaysBefore('2026-04-06T13:00:00Z', 3)).toBe('2026-04-01T02:59:00.000Z');
  });
  it('pula feriado fixo (07/09)', () => {
    expect(businessDaysBefore('2026-09-08T13:00:00Z', 3)).toBe('2026-09-03T02:59:00.000Z');
  });
  it('retorna null para data inválida', () => {
    expect(businessDaysBefore('abc', 3)).toBeNull();
  });
  it('usa o dia em BRT quando a abertura é 01:00Z', () => {
    // 2026-12-10T01:00Z = 09/12 22:00 BRT -> 3 úteis antes: 08, 07, 04 -> 04/12 23:59 BRT
    expect(businessDaysBefore('2026-12-10T01:00:00Z', 3)).toBe('2026-12-05T02:59:00.000Z');
  });
});

describe('isBrazilianNationalHoliday', () => {
  it('reconhece feriados fixos e móveis', () => {
    expect(isBrazilianNationalHoliday('2026-09-07')).toBe(true);
    expect(isBrazilianNationalHoliday('2026-04-03')).toBe(true);
    expect(isBrazilianNationalHoliday('2026-04-04')).toBe(false);
  });
});

describe('LEGAL_DEADLINE_NOTE', () => {
  it('tem o texto exato', () => {
    expect(LEGAL_DEADLINE_NOTE).toBe('Estimado pela Lei 14.133 (3 dias úteis antes da abertura) — confira no edital.');
  });
});
