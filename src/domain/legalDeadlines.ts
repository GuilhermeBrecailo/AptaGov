export const LEGAL_DEADLINE_NOTE =
  'Estimado pela Lei 14.133 (3 dias úteis antes da abertura) — confira no edital.';

const BRT_OFFSET_HOURS = 3;
const DAY_MS = 86_400_000;
const FIXED_HOLIDAYS = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function ymd(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Algoritmo de Meeus/Jones/Butcher (calendário gregoriano).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function isBrazilianNationalHoliday(dateYmd: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!match) return false;
  if (FIXED_HOLIDAYS.has(`${match[2]}-${match[3]}`)) return true;
  const goodFriday = new Date(easterSunday(Number(match[1])).getTime() - 2 * DAY_MS);
  return ymd(goodFriday) === dateYmd;
}

function isBusinessDay(day: Date): boolean {
  const weekday = day.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isBrazilianNationalHoliday(ymd(day));
}

/**
 * Lê data/hora de edital/PNCP assumindo BRT (-03:00) quando não há fuso: `YYYY-MM-DD` vale 23:59 BRT e
 * data/hora sem Z/offset recebe -03:00. Com Z ou offset explícito, respeita o valor. Inválido → null.
 */
export function parseBrtDateTime(value: string): Date | null {
  const text = value.trim();
  let candidate = text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) candidate = `${text}T23:59:00-03:00`;
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) candidate = `${text.replace(' ', 'T')}-03:00`;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO UTC das 23:59 BRT do dia útil que fica `days` dias úteis antes da abertura; null se a data for inválida. */
export function businessDaysBefore(openingIso: string, days: number): string | null {
  const opening = parseBrtDateTime(openingIso);
  if (!opening || !Number.isInteger(days) || days < 0) return null;
  // Desloca para BRT e trunca para o dia civil (representado em UTC).
  const brt = new Date(opening.getTime() - BRT_OFFSET_HOURS * 3_600_000);
  let day = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()));
  let remaining = days;
  while (remaining > 0) {
    day = new Date(day.getTime() - DAY_MS);
    if (isBusinessDay(day)) remaining -= 1;
  }
  return new Date(day.getTime() + (23 + BRT_OFFSET_HOURS) * 3_600_000 + 59 * 60_000).toISOString();
}
