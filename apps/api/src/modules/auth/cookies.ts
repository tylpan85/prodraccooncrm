import type { FastifyReply } from 'fastify';
import { loadEnv } from '../../lib/env.js';

const env = loadEnv();

export const ACCESS_COOKIE = 'oc_access';
export const REFRESH_COOKIE = 'oc_refresh';

const isProd = env.NODE_ENV === 'production';

const baseOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  path: '/',
};

export function setAuthCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions,
    maxAge: env.JWT_ACCESS_TTL_MINUTES * 60,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    path: '/api/auth',
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
