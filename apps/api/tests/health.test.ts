import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from '../src/routes/health.js';

describe('health routes', () => {
  it('GET /health returns { ok: true }', async () => {
    const app = Fastify();
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('GET /ready returns { ok: true }', async () => {
    const app = Fastify();
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
