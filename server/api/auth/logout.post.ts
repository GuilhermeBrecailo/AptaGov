import { deleteCookie, defineEventHandler, getCookie } from 'h3';
import { revokeSession, SESSION_COOKIE } from '../../utils/app';

export default defineEventHandler((event) => {
  revokeSession(getCookie(event, SESSION_COOKIE));
  deleteCookie(event, SESSION_COOKIE, { path: '/' });
  return { ok: true };
});
