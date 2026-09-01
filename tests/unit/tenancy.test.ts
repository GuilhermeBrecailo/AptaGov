import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { UserRepository } from '../../src/repositories/userRepository';

describe('organizações', () => {
  it('mantém usuários vinculados somente às próprias organizações', () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const userA = users.create({ name: 'Ana', email: 'ana@example.com', passwordHash: 'hash-a' });
    const userB = users.create({ name: 'Bruno', email: 'bruno@example.com', passwordHash: 'hash-b' });
    const organizationA = organizations.create('Empresa A');
    const organizationB = organizations.create('Empresa B');

    organizations.addMember(organizationA.id, userA.id, 'OWNER');
    organizations.addMember(organizationB.id, userB.id, 'OWNER');

    expect(organizations.listForUser(userA.id).map((item) => item.id)).toEqual([organizationA.id]);
    expect(organizations.listForUser(userB.id).map((item) => item.id)).toEqual([organizationB.id]);
  });
});
