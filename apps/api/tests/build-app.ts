import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../src/lib/error-envelope.js';
import { authRoutes } from '../src/modules/auth/routes.js';
import { invoicesRoutes } from '../src/modules/billing/invoices.js';
import { customersRoutes } from '../src/modules/customers/routes.js';
import { identityRoutes } from '../src/modules/identity/routes.js';
import { eventsRoutes } from '../src/modules/scheduling/events.js';
import { jobsRoutes } from '../src/modules/scheduling/jobs.js';
import { recurringRoutes } from '../src/modules/scheduling/recurring.js';
import { scheduleRoutes } from '../src/modules/scheduling/schedule.js';
import { healthRoutes } from '../src/routes/health.js';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie, { secret: process.env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 10000, timeWindow: '1 minute' });
  app.setErrorHandler(errorHandler);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(identityRoutes);
  await app.register(customersRoutes);
  await app.register(jobsRoutes);
  await app.register(eventsRoutes);
  await app.register(recurringRoutes);
  await app.register(scheduleRoutes);
  await app.register(invoicesRoutes);
  await app.ready();
  return app;
}
