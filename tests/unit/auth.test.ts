import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password';
import { createTestDatabase } from '../../src/db/database';
import { SessionRepository } from '../../src/repositories/sessionRepository';
import { UserRepository } from '../../src/repositories/userRepository';

describe('autenticação', () => {
  it('hash de senha valida a senha original e rejeita outra', async () => {
    const hash = await hashPassword('senha-segura-123');

    expect(hash).not.toContain('senha-segura-123');
    await expect(verifyPassword('senha-segura-123', hash)).resolves.toBe(true);
    await expect(verifyPassword('senha-errada', hash)).resolves.toBe(false);
  });

  it('sessão usa token opaco, expira e pode ser revogada', () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Usuário', email: 'user@example.com', passwordHash: 'hash' });
    const repository = new SessionRepository(db);
    const token = repository.create(user.id, new Date(Date.now() + 60_000));

    expect(token).not.toHaveLength(64);
    expect(repository.findUserId(token)).toBe(user.id);

    repository.revoke(token);
    expect(repository.findUserId(token)).toBeUndefined();
  });
});
