import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();
const ORG_ID = '00000000-0000-0000-0000-000000000001';

afterAll(async () => {
  await cleanupFixtures();
  await app.close();
  await prisma.$disconnect();
});

beforeAll(async () => {
  await cleanupFixtures();
});

async function cleanupFixtures() {
  await prisma.event.deleteMany({
    where: { organizationId: ORG_ID, name: { startsWith: 'PH7-' } },
  });
}

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

let cachedAccess: string | null = null;
async function login() {
  if (cachedAccess) return cachedAccess;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@raccooncrm.local', password: 'admin' },
  });
  const access = extractCookie(res.headers['set-cookie'], 'oc_access');
  if (!access) throw new Error('Missing access cookie');
  cachedAccess = access;
  return access;
}

// Get first active team member for assignee tests
async function getActiveTeamMember(access: string): Promise<string> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/team-members',
    cookies: { oc_access: access },
  });
  const members = JSON.parse(res.payload).items;
  const active = members.find((m: { activeOnSchedule: boolean }) => m.activeOnSchedule);
  return active.id;
}

describe('Events Phase 7', () => {
  let teamMemberId: string;

  it('bootstrap — login + get team member', async () => {
    const access = await login();
    teamMemberId = await getActiveTeamMember(access);
    expect(teamMemberId).toBeTruthy();
  });

  // ── Create ────────────────────────────────────────────────────────

  let eventId: string;

  it('create event — unassigned', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      cookies: { oc_access: access },
      payload: {
        name: 'PH7-Team meeting',
        scheduledStartAt: '2026-05-01T09:00:00.000Z',
        scheduledEndAt: '2026-05-01T10:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.item.name).toBe('PH7-Team meeting');
    expect(body.item.assigneeTeamMemberId).toBeNull();
    expect(body.item.assigneeDisplayName).toBeNull();
    eventId = body.item.id;
  });

  it('create event — with assignee', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      cookies: { oc_access: access },
      payload: {
        name: 'PH7-Site visit',
        scheduledStartAt: '2026-05-02T14:00:00.000Z',
        scheduledEndAt: '2026-05-02T16:00:00.000Z',
        assigneeTeamMemberId: teamMemberId,
        location: '123 Main St',
        note: 'Bring tools',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.item.assigneeTeamMemberId).toBe(teamMemberId);
    expect(body.item.assigneeDisplayName).toBeTruthy();
    expect(body.item.location).toBe('123 Main St');
    expect(body.item.note).toBe('Bring tools');
  });

  it('create event — end before start is rejected', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      cookies: { oc_access: access },
      payload: {
        name: 'PH7-Bad',
        scheduledStartAt: '2026-05-01T10:00:00.000Z',
        scheduledEndAt: '2026-05-01T09:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('create event — invalid assignee is rejected', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      cookies: { oc_access: access },
      payload: {
        name: 'PH7-Bad assignee',
        scheduledStartAt: '2026-05-01T09:00:00.000Z',
        scheduledEndAt: '2026-05-01T10:00:00.000Z',
        assigneeTeamMemberId: '00000000-0000-0000-0000-000000000099',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('INVALID_ASSIGNEE');
  });

  // ── Get ───────────────────────────────────────────────────────────

  it('get event', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.item.id).toBe(eventId);
    expect(body.item.name).toBe('PH7-Team meeting');
  });

  it('get event — not found', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/events/00000000-0000-0000-0000-000000000099',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── List ──────────────────────────────────────────────────────────

  it('list events', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  // ── Update ────────────────────────────────────────────────────────

  it('update event', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      cookies: { oc_access: access },
      payload: {
        name: 'PH7-Updated meeting',
        location: 'Office 2',
        assigneeTeamMemberId: teamMemberId,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.item.name).toBe('PH7-Updated meeting');
    expect(body.item.location).toBe('Office 2');
    expect(body.item.assigneeTeamMemberId).toBe(teamMemberId);
  });

  it('update event — end before start is rejected', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      cookies: { oc_access: access },
      payload: {
        scheduledStartAt: '2026-05-01T12:00:00.000Z',
        scheduledEndAt: '2026-05-01T08:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Delete ────────────────────────────────────────────────────────

  it('delete event', async () => {
    const access = await login();
    // Create a throwaway event
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/events',
      cookies: { oc_access: access },
      payload: {
        name: 'PH7-To delete',
        scheduledStartAt: '2026-05-10T09:00:00.000Z',
        scheduledEndAt: '2026-05-10T10:00:00.000Z',
      },
    });
    const toDeleteId = JSON.parse(createRes.payload).item.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/events/${toDeleteId}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);

    // Verify deleted
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/events/${toDeleteId}`,
      cookies: { oc_access: access },
    });
    expect(getRes.statusCode).toBe(404);
  });

  // ── Schedule integration ──────────────────────────────────────────

  it('events appear in schedule day view', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/schedule/day?date=2026-05-01',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const allEvents = body.lanes.flatMap((l: { events: unknown[] }) => l.events);
    const found = allEvents.find((e: { id: string }) => e.id === eventId);
    expect(found).toBeTruthy();
  });
});
