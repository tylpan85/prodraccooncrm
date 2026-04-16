import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function extractCookie(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const all = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of all) {
    const pair = raw.split(';')[0] ?? '';
    const [k, v] = pair.split('=');
    if (k === name && v) return v;
  }
  return null;
}

describe('auth flow', () => {
  beforeAll(async () => {
    await prisma.refreshToken.deleteMany({});
  });

  it('rejects wrong credentials with 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@raccooncrm.local', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('logs in with seed admin and returns session + cookies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@raccooncrm.local', password: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.item.user.email).toBe('admin@raccooncrm.local');
    expect(body.item.user.mustResetPassword).toBe(true);
    expect(body.item.organization.name).toBe('Raccoon Cleaning Inc');
    const access = extractCookie(res.headers['set-cookie'], 'oc_access');
    const refresh = extractCookie(res.headers['set-cookie'], 'oc_refresh');
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();
  });

  it('GET /api/auth/me requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me returns session when authenticated', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@raccooncrm.local', password: 'admin' },
    });
    const access = extractCookie(login.headers['set-cookie'], 'oc_access');
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { oc_access: access ?? '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().item.user.email).toBe('admin@raccooncrm.local');
  });

  it('GET /api/team-members returns seeded members', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@raccooncrm.local', password: 'admin' },
    });
    const access = extractCookie(login.headers['set-cookie'], 'oc_access');
    const res = await app.inject({
      method: 'GET',
      url: '/api/team-members',
      cookies: { oc_access: access ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().items.map((m: { displayName: string }) => m.displayName);
    expect(names).toEqual(expect.arrayContaining(['Alex', 'Jordan']));
  });

  it('POST /api/auth/refresh rotates the refresh token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@raccooncrm.local', password: 'admin' },
    });
    const oldRefresh = extractCookie(login.headers['set-cookie'], 'oc_refresh');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { oc_refresh: oldRefresh ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const newRefresh = extractCookie(res.headers['set-cookie'], 'oc_refresh');
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { oc_refresh: oldRefresh ?? '' },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('POST /api/auth/logout clears cookies', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@raccooncrm.local', password: 'admin' },
    });
    const refresh = extractCookie(login.headers['set-cookie'], 'oc_refresh');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { oc_refresh: refresh ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const cookies = res.headers['set-cookie'];
    const joined = Array.isArray(cookies) ? cookies.join(';') : (cookies ?? '');
    expect(joined).toContain('oc_access=');
    expect(joined).toContain('oc_refresh=');
  });
});
