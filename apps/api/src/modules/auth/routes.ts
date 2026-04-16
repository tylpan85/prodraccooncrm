import { ERROR_CODES, changePasswordRequestSchema, loginRequestSchema } from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../lib/error-envelope.js';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './cookies.js';
import { requireAuth } from './guard.js';
import * as authService from './service.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const body = loginRequestSchema.parse(req.body);
      const result = await authService.login(body.email, body.password, {
        userAgent: req.headers['user-agent'] ?? null,
        ip: req.ip ?? null,
      });
      setAuthCookies(reply, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      return reply.send({ item: result.session });
    },
  );

  fastify.post('/api/auth/logout', async (req, reply) => {
    await authService.logout(req.cookies[REFRESH_COOKIE]);
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  fastify.post('/api/auth/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) {
      throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    }
    const tokens = await authService.refresh(raw, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
    setAuthCookies(reply, tokens);
    return reply.send({ ok: true });
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.auth) {
      throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    }
    const session = await authService.getSession(req.auth);
    return reply.send({ item: session });
  });

  fastify.post('/api/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.auth) {
      throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    }
    const body = changePasswordRequestSchema.parse(req.body);
    await authService.changePassword(req.auth.sub, body.currentPassword, body.newPassword);
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });
}
