const KIND_LABELS: Record<string, string> = { EDITAL: 'Edital', TERMO_REFERENCIA: 'Termo de referência' };

export function documentKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Document URLs come from the PNCP and are stored in the database: only absolute https links
 * may become an href (blocks javascript:, data: and other schemes — stored XSS).
 */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
