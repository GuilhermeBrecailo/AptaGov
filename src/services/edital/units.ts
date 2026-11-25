const aliases: Record<string, string[]> = {
  m2: ['m2', 'metro quadrado', 'metros quadrados'],
  m3: ['m3', 'metro cubico', 'metros cubicos'],
  m: ['m', 'metro', 'metros', 'metro linear', 'metros lineares'],
  km: ['km', 'quilometro', 'quilometros', 'kilometro', 'kilometros'],
  t: ['t', 'ton', 'tonelada', 'toneladas'],
  un: ['un', 'und', 'unid', 'unidade', 'unidades']
};

const lookup = new Map(Object.entries(aliases).flatMap(([unit, names]) => names.map((name) => [name, unit] as const)));

const display: Record<string, string> = { m2: 'm²', m3: 'm³' };

export function normalizeUnit(unit: string): string | null {
  const key = unit
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return lookup.get(key) ?? null;
}

/** Display form of a unit: the normalized symbol (m², m³, …) when known, otherwise the original text. */
export function displayUnit(unit: string): string {
  const normalized = normalizeUnit(unit);
  return normalized ? (display[normalized] ?? normalized) : unit.trim();
}
