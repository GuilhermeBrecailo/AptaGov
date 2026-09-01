import type { SqliteDatabase } from '../db/database';
import { loadFilters } from '../config/filters';
import { hashPassword, verifyPassword } from './password';
import { OrganizationFilterRepository } from '../repositories/organizationFilterRepository';
import { OrganizationRepository, type Organization } from '../repositories/organizationRepository';
import { SessionRepository } from '../repositories/sessionRepository';
import { normalizeEmail, UserRepository, type User } from '../repositories/userRepository';
import type { AuthContext } from './types';
import { BillingService } from '../services/billingService';
import { loadEnv } from '../config/env';

const SESSION_DAYS = 30;

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: User;
  organization: Organization;
  sessionToken: string;
}

export async function registerUser(db: SqliteDatabase, input: RegisterInput): Promise<AuthResult> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const organizationName = input.organizationName.trim();
  if (name.length < 2 || !email.includes('@') || input.password.length < 8 || organizationName.length < 2) {
    throw new Error('Preencha nome, empresa, email e senha com dados válidos');
  }
  const users = new UserRepository(db);
  if (users.findByEmail(email)) throw new Error('Email já cadastrado');

  const passwordHash = await hashPassword(input.password);
  const organizations = new OrganizationRepository(db);
  const filters = new OrganizationFilterRepository(db);
  const created = db.transaction(() => {
    const user = users.create({ name, email, passwordHash });
    const organization = organizations.create(organizationName);
    organizations.addMember(organization.id, user.id, 'OWNER');
    filters.save(organization.id, loadFilters());
    // O onboarding é concluído depois do cadastro, quando o cliente escolhe seu primeiro radar.
    new BillingService(db, { trialDays: loadEnv().billingTrialDays }).ensureTrial(organization.id);
    return { user, organization };
  })();
  return createAuthResult(db, created.user, created.organization);
}

export async function loginUser(db: SqliteDatabase, input: LoginInput): Promise<AuthResult> {
  const user = new UserRepository(db).findByEmail(input.email);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new Error('Email ou senha inválidos');
  }
  const membership = new OrganizationRepository(db).findMembership(user.id);
  if (!membership) throw new Error('Usuário sem organização');
  return createAuthResult(db, user, membership.organization);
}

export function getAuthContext(db: SqliteDatabase, token: string | undefined): AuthContext | undefined {
  if (!token) return undefined;
  const userId = new SessionRepository(db).findUserId(token);
  if (!userId) return undefined;
  const user = new UserRepository(db).findById(userId);
  const membership = user ? new OrganizationRepository(db).findMembership(user.id) : undefined;
  return user && membership ? { user, organization: membership.organization, role: membership.role } : undefined;
}

function createAuthResult(db: SqliteDatabase, user: User, organization: Organization): AuthResult {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return { user, organization, sessionToken: new SessionRepository(db).create(user.id, expiresAt) };
}
