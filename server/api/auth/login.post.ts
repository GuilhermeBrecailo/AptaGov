import { createError, defineEventHandler, readBody } from 'h3';
import { loginUser } from '../../../src/auth/service';
import { getAppDatabase } from '../../utils/app';
import { authPayload, setSessionCookie } from '../../utils/authResponse';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event);
  try {
    const result = await loginUser(getAppDatabase(), { email: body.email ?? '', password: body.password ?? '' });
    setSessionCookie(event, result.sessionToken);
    return authPayload(result);
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Email ou senha inválidos' });
  }
});
