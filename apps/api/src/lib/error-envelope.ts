import { ERROR_CODES, type ErrorCode } from '@openclaw/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(err: FastifyError, _req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof ApiError) {
    reply.status(err.statusCode).send({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Validation failed',
        details: { fields: err.flatten().fieldErrors },
      },
    });
    return;
  }

  // Pass through Fastify/plugin 4xx errors (rate-limit 429, not-found 404, payload-too-large 413, etc.)
  // so clients see the real HTTP status and message instead of a generic 500.
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
    reply.status(err.statusCode).send({
      error: {
        code: err.code ?? 'CLIENT_ERROR',
        message: err.message,
      },
    });
    return;
  }

  reply.log.error({ err }, 'unhandled error');
  reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR' as const,
      message: 'Internal server error',
    },
  });
}
