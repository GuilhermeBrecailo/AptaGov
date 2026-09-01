import { createError, defineEventHandler, readBody } from 'h3';
import { registerUser } from '../../../src/auth/service';
import { getAppDatabase } from '../../utils/app';
import { authPayload, setSessionCookie } from '../../utils/authResponse';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string; email?: string; password?: string; organizationName?: string }>(event);
  try {
    const result = await registerUser(getAppDatabase(), {
      name: body.name ?? '',
      email: body.email ?? '',
      password: body.password ?? '',
      organizationName: body.organizationName ?? '',
    });
    setSessionCookie(event, result.sessionToken);
    return authPayload(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível criar a conta';
    throw createError({ statusCode: message === 'Email já cadastrado' ? 409 : 400, statusMessage: message });
  }
});
