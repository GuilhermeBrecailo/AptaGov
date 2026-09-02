export function parseMarketMoneyToCents(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parseMarketNumber(value);
    if (parsed !== null) return Math.round(parsed * 100);
  }
  return null;
}

export function parseMarketNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  if (!text || !/^[+-]?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  let normalized = text;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = text.replace(',', '.');
  } else if ((text.match(/\./g) ?? []).length > 1) {
    normalized = text.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
