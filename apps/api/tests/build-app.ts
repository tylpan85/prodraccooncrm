import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../src/lib/error-envelope.js';
import { authRoutes } from '../src/modules/auth/routes.js';
import { identityRoutes } from '../src/modules/identity/routes.js';
import { healthRoutes } from '../src/routes/health.js';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie, { secret: process.env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  app.setErrorHandler(errorHandler);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(identityRoutes);
  await app.ready();
  return app;
}
