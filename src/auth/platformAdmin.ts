import { normalizeEmail } from '../repositories/userRepository';

export function isPlatformAdminEmail(email: string, configuredEmails: string[] | string): boolean {
  const values = Array.isArray(configuredEmails)
    ? configuredEmails
    : configuredEmails.split(',');
  const normalized = normalizeEmail(email);
  return values.map(normalizeEmail).includes(normalized);
}
