import { describe, expect, it } from 'vitest';
import { isOrganizationOwner } from '../../src/auth/authorization';

describe('autorizaÃ§Ã£o operacional', () => {
  it('permite pausar e retomar o worker somente ao proprietÃ¡rio', () => {
    expect(isOrganizationOwner({ role: 'OWNER' })).toBe(true);
    expect(isOrganizationOwner({ role: 'MEMBER' })).toBe(false);
  });
});
