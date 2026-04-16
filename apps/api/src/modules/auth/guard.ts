import { ERROR_CODES } from '@openclaw/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../lib/error-envelope.js';
import { ACCESS_COOKIE } from './cookies.js';
import { type AccessTokenPayload, verifyAccessToken } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessTokenPayload;
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = req.cookies[ACCESS_COOKIE];
  if (!token) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
  }
  try {
    req.auth = await verifyAccessToken(token);
  } catch {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
  }
}
