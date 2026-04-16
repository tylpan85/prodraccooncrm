import { prisma } from '@openclaw/db';
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ ok: true }));

  fastify.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ ok: true });
    } catch (err) {
      fastify.log.error({ err }, 'readiness check failed');
      return reply.code(503).send({ ok: false });
    }
  });
}
