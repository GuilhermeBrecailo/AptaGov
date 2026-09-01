import type { Organization, OrganizationRole } from '../repositories/organizationRepository';
import type { User } from '../repositories/userRepository';

export interface AuthContext {
  user: User;
  organization: Organization;
  role: OrganizationRole;
}
