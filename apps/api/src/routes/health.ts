import type { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ ok: true }));

  fastify.get('/ready', async (_req, reply) => {
    // Phase 1+: check DB connection via @openclaw/db prisma.$queryRaw`SELECT 1`
    // For Phase 0 the DB isn't wired yet; always report ok.
    return reply.send({ ok: true });
  });
}
