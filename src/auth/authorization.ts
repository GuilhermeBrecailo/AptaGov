import type { OrganizationRole } from '../repositories/organizationRepository';

export function isOrganizationOwner(context: { role: OrganizationRole }): boolean {
  return context.role === 'OWNER';
}
