import { createHash } from 'node:crypto';
import { z } from 'zod';

const nullableDate = z.string().min(1).nullable();
const nonNegative = z.number().finite().nonnegative().nullable();

export const registrationSchema = z.object({
  council: z.enum(['CREA', 'CAU']),
  number: z.string().min(1),
  state: z.string().min(1),
  validUntil: nullableDate,
});

export const technicianSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),
  registrationNumber: z.string(),
});

export const attestationSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  quantity: z.number().finite().nonnegative(),
  unit: z.string().min(1),
  contractor: z.string(),
  catNumber: z.string().nullable(),
  technicianId: z.string().nullable(),
  issuedAt: nullableDate,
});

export const financialSchema = z.object({
  netWorthCents: z.number().int().nullable(),
  shareCapitalCents: nonNegative,
  liquidityGeneral: nonNegative,
  solvencyGeneral: nonNegative,
  liquidityCurrent: nonNegative,
  balanceSheetDate: nullableDate,
});

export const companyProfileSchema = z.object({
  registrations: z.array(registrationSchema),
  technicians: z.array(technicianSchema),
  attestations: z.array(attestationSchema),
  financial: financialSchema,
});

export type Registration = z.infer<typeof registrationSchema>;
export type Technician = z.infer<typeof technicianSchema>;
export type Attestation = z.infer<typeof attestationSchema>;
export type Financial = z.infer<typeof financialSchema>;
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export function emptyCompanyProfile(): CompanyProfile {
  return {
    registrations: [],
    technicians: [],
    attestations: [],
    financial: {
      netWorthCents: null,
      shareCapitalCents: null,
      liquidityGeneral: null,
      solvencyGeneral: null,
      liquidityCurrent: null,
      balanceSheetDate: null,
    },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function profileHash(profile: CompanyProfile): string {
  return createHash('sha256').update(JSON.stringify(canonical(profile))).digest('hex');
}
