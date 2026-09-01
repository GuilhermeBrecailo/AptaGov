import type { AuthContext } from '../../src/auth/types';
import type { AuthResult } from '../../src/auth/service';
import { setCookie, type H3Event } from 'h3';
import { SESSION_COOKIE } from './app';

export function setSessionCookie(event: H3Event, token: string): void {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
}

export function authPayload(result: AuthResult) {
  return {
    user: { id: result.user.id, name: result.user.name, email: result.user.email },
    organization: result.organization,
  };
}

export function contextPayload(context: AuthContext, isPlatformAdmin = false) {
  return {
    user: { id: context.user.id, name: context.user.name, email: context.user.email },
    organization: context.organization,
    role: context.role,
    isPlatformAdmin,
  };
}
