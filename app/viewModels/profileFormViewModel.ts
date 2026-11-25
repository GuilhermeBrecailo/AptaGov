import type { CompanyProfile, ProfileAttestation } from '../types';

/**
 * Numbers stay as the text the user typed until the profile is saved, so a partial value
 * ("-", "1e") is never wiped mid-typing.
 */
export type ProfileForm = {
  registrations: CompanyProfile['registrations'];
  technicians: CompanyProfile['technicians'];
  attestations: Array<Omit<ProfileAttestation, 'quantity'> & { quantity: string }>;
  // Valores monetários em reais na tela; convertidos para centavos ao salvar.
  netWorth: string;
  shareCapital: string;
  liquidityGeneral: string;
  solvencyGeneral: string;
  liquidityCurrent: string;
  balanceSheetDate: string | null;
};

const text = (value: number | null) => (value === null ? '' : String(value));

/** `null` for an empty field, `undefined` when the text is not a finite number. */
export function parseNumberText(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // "1500,50" (vírgula decimal, sem separador de milhar) is accepted; "1.500,50" is ambiguous and rejected.
  const normalized = trimmed.includes('.') ? trimmed : trimmed.replace(/^(-?\d+),(\d+)$/u, '$1.$2');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function profileToForm(profile: CompanyProfile): ProfileForm {
  const { financial } = profile;
  return {
    registrations: profile.registrations.map((item) => ({ ...item })),
    technicians: profile.technicians.map((item) => ({ ...item })),
    attestations: profile.attestations.map((item) => ({ ...item, quantity: text(item.quantity) })),
    netWorth: text(financial.netWorthCents === null ? null : financial.netWorthCents / 100),
    shareCapital: text(financial.shareCapitalCents === null ? null : financial.shareCapitalCents / 100),
    liquidityGeneral: text(financial.liquidityGeneral),
    solvencyGeneral: text(financial.solvencyGeneral),
    liquidityCurrent: text(financial.liquidityCurrent),
    balanceSheetDate: financial.balanceSheetDate,
  };
}

export function formToProfile(form: ProfileForm): { ok: true; profile: CompanyProfile } | { ok: false; error: string } {
  const invalid: string[] = [];
  const read = (value: string, label: string): number | null => {
    const parsed = parseNumberText(value);
    if (parsed === undefined) invalid.push(label);
    return parsed ?? null;
  };

  const attestations = form.attestations.map((item, index) => {
    // Required field: empty is as invalid as unparsable text.
    const quantity = parseNumberText(item.quantity);
    if (quantity === null || quantity === undefined) invalid.push(`Quantidade do atestado ${index + 1}`);
    return {
      ...item,
      quantity: quantity ?? 0,
      catNumber: item.catNumber?.trim() || null,
      technicianId: item.technicianId || null,
      issuedAt: item.issuedAt || null,
    };
  });
  const netWorth = read(form.netWorth, 'Patrimônio líquido');
  const shareCapital = read(form.shareCapital, 'Capital social');
  const financial = {
    netWorthCents: netWorth === null ? null : Math.round(netWorth * 100),
    shareCapitalCents: shareCapital === null ? null : Math.round(shareCapital * 100),
    liquidityGeneral: read(form.liquidityGeneral, 'Liquidez geral'),
    solvencyGeneral: read(form.solvencyGeneral, 'Solvência geral'),
    liquidityCurrent: read(form.liquidityCurrent, 'Liquidez corrente'),
    balanceSheetDate: form.balanceSheetDate || null,
  };

  if (invalid.length > 0) return { ok: false, error: `Revise os campos numéricos: ${invalid.join(', ')}.` };
  return {
    ok: true,
    profile: {
      registrations: form.registrations.map((item) => ({ ...item, validUntil: item.validUntil || null })),
      technicians: form.technicians.map((item) => ({ ...item })),
      attestations,
      financial,
    },
  };
}
