import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { loginUser, registerUser } from '../../src/auth/service';

describe('serviço de autenticação', () => {
  it('cria usuário, empresa e sessão no cadastro', async () => {
    const db = createTestDatabase();
    const result = await registerUser(db, {
      name: 'Ana Silva',
      email: 'ana@example.com',
      password: 'senha-segura-123',
      organizationName: 'Empresa Ana',
    });

    expect(result.user.email).toBe('ana@example.com');
    expect(result.organization.name).toBe('Empresa Ana');
    expect(result.sessionToken).toBeTruthy();
  });

  it('impede email duplicado e login com senha incorreta', async () => {
    const db = createTestDatabase();
    await registerUser(db, {
      name: 'Ana Silva',
      email: 'ana@example.com',
      password: 'senha-segura-123',
      organizationName: 'Empresa Ana',
    });

    await expect(registerUser(db, {
      name: 'Outra Ana',
      email: 'ANA@example.com',
      password: 'outra-senha-123',
      organizationName: 'Outra Empresa',
    })).rejects.toThrow('Email já cadastrado');

    await expect(loginUser(db, { email: 'ana@example.com', password: 'senha-errada' }))
      .rejects.toThrow('Email ou senha inválidos');
  });
});
