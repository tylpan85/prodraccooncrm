import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@openclaw/db';
import Fastify from 'fastify';
import { loadEnv } from './lib/env.js';
import { errorHandler } from './lib/error-envelope.js';
import { createLogger } from './lib/logger.js';
import { authRoutes } from './modules/auth/routes.js';
import { invoicesRoutes } from './modules/billing/invoices.js';
import { customersRoutes } from './modules/customers/routes.js';
import { identityRoutes } from './modules/identity/routes.js';
import { eventsRoutes } from './modules/scheduling/events.js';
import { jobsRoutes } from './modules/scheduling/jobs.js';
import { recurringRoutes } from './modules/scheduling/recurring.js';
import { scheduleRoutes } from './modules/scheduling/schedule.js';
import { healthRoutes } from './routes/health.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  const fastify = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    disableRequestLogging: false,
  });

  await fastify.register(cors, {
    origin:
      env.NODE_ENV === 'development'
        ? true
        : ['http://localhost:3000', 'http://localhost:3100'],
    credentials: true,
  });

  await fastify.register(cookie, {
    secret: env.COOKIE_SECRET,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  fastify.setErrorHandler(errorHandler);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(identityRoutes);
  await fastify.register(customersRoutes);
  await fastify.register(jobsRoutes);
  await fastify.register(eventsRoutes);
  await fastify.register(recurringRoutes);
  await fastify.register(scheduleRoutes);
  await fastify.register(invoicesRoutes);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, 'shutting down');
      await fastify.close();
      process.exit(0);
    });
  }

  try {
    await fastify.listen({ port: env.API_PORT, host: env.API_HOST });
    logger.info(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

main();
