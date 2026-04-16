import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TAG = 'PH5-';

afterAll(async () => {
  await cleanupFixtures();
  await app.close();
  await prisma.$disconnect();
});

beforeAll(async () => {
  await cleanupFixtures();
});

async function cleanupFixtures() {
  // Delete invoices → jobs → customers (respecting FK order)
  await prisma.invoice.deleteMany({
    where: {
      organizationId: ORG_ID,
      customer: { displayName: { startsWith: TAG } },
    },
  });
  await prisma.jobTag.deleteMany({
    where: {
      job: { organizationId: ORG_ID, customer: { displayName: { startsWith: TAG } } },
    },
  });
  await prisma.job.deleteMany({
    where: {
      organizationId: ORG_ID,
      customer: { displayName: { startsWith: TAG } },
    },
  });
  await prisma.customer.deleteMany({
    where: { organizationId: ORG_ID, displayName: { startsWith: TAG } },
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

function uniq(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// ── Fixture helpers ───────────────────────────────────────────────────────

let fixtureCustomerId: string;
let fixtureAddressId: string;
let fixtureDnsCustomerId: string;
let fixtureDnsAddressId: string;

async function createFixtureCustomer(access: string, dns = false) {
  const name = uniq(`${TAG}Cust`);
  const res = await app.inject({
    method: 'POST',
    url: '/api/customers',
    cookies: { oc_access: access },
    payload: {
      firstName: name,
      customerType: 'Homeowner',
      doNotService: dns,
      primaryAddress: { street: '100 Main', city: 'Austin', state: 'TX', zip: '78701' },
    },
  });
  const body = JSON.parse(res.body);
  return {
    customerId: body.item.id as string,
    addressId: body.item.addresses[0].id as string,
  };
}

async function getActiveTeamMember(): Promise<string> {
  const tm = await prisma.teamMember.findFirst({
    where: { organizationId: ORG_ID, activeOnSchedule: true },
    select: { id: true },
  });
  if (!tm) throw new Error('No active team member in seed');
  return tm.id;
}

async function getInactiveTeamMember(): Promise<string> {
  // Create an inactive team member
  const existing = await prisma.teamMember.findFirst({
    where: { organizationId: ORG_ID, activeOnSchedule: false },
    select: { id: true },
  });
  if (existing) return existing.id;

  const tm = await prisma.teamMember.create({
    data: {
      organizationId: ORG_ID,
      displayName: `${TAG}Inactive`,
      color: '#999999',
      activeOnSchedule: false,
    },
  });
  return tm.id;
}

beforeAll(async () => {
  const access = await login();
  const normal = await createFixtureCustomer(access, false);
  fixtureCustomerId = normal.customerId;
  fixtureAddressId = normal.addressId;
  const dns = await createFixtureCustomer(access, true);
  fixtureDnsCustomerId = dns.customerId;
  fixtureDnsAddressId = dns.addressId;
});

// ── Tests ─��───────────────────────────────────────────────────────────────

describe('POST /api/customers/:customerId/jobs', () => {
  it('creates an unscheduled job', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        titleOrSummary: 'Test cleaning',
        priceCents: 15000,
        tags: ['vip'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.item.jobNumber).toMatch(/^J-\d+$/);
    expect(body.item.scheduleState).toBe('unscheduled');
    expect(body.item.jobStatus).toBe('open');
    expect(body.item.priceCents).toBe(15000);
    expect(body.item.tags).toEqual(['vip']);
  });

  it('creates a scheduled job', async () => {
    const access = await login();
    const tmId = await getActiveTeamMember();
    const start = '2026-05-01T14:00:00.000Z';
    const end = '2026-05-01T16:00:00.000Z';
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        titleOrSummary: 'Scheduled cleaning',
        priceCents: 20000,
        scheduledStartAt: start,
        scheduledEndAt: end,
        assigneeTeamMemberId: tmId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.item.scheduleState).toBe('scheduled');
    expect(body.item.scheduledStartAt).toBe(start);
    expect(body.item.assigneeTeamMemberId).toBe(tmId);
  });

  it('rejects scheduled job for DNS customer', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureDnsCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureDnsAddressId,
        scheduledStartAt: '2026-05-01T14:00:00.000Z',
        scheduledEndAt: '2026-05-01T16:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('DO_NOT_SERVICE_BLOCK');
  });

  it('allows unscheduled job for DNS customer', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureDnsCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureDnsAddressId,
        titleOrSummary: 'DNS unscheduled OK',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects address not owned by customer', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureDnsAddressId, // belongs to different customer
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('ADDRESS_NOT_OWNED_BY_CUSTOMER');
  });

  it('rejects inactive assignee', async () => {
    const access = await login();
    const inactiveTm = await getInactiveTeamMember();
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        assigneeTeamMemberId: inactiveTm,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_ASSIGNEE');
  });

  it('rejects invalid date range (end �� start)', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        scheduledStartAt: '2026-05-01T16:00:00.000Z',
        scheduledEndAt: '2026-05-01T14:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('job lifecycle (schedule/assign/finish/reopen)', () => {
  let jobId: string;

  it('create → schedule → assign → finish → reopen', async () => {
    const access = await login();
    const tmId = await getActiveTeamMember();

    // Create unscheduled
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        titleOrSummary: 'Lifecycle test',
        priceCents: 5000,
      },
    });
    expect(createRes.statusCode).toBe(201);
    jobId = JSON.parse(createRes.body).item.id;

    // Schedule
    const schedRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/schedule`,
      cookies: { oc_access: access },
      payload: {
        scheduledStartAt: '2026-06-01T09:00:00.000Z',
        scheduledEndAt: '2026-06-01T11:00:00.000Z',
      },
    });
    expect(schedRes.statusCode).toBe(200);
    expect(JSON.parse(schedRes.body).item.scheduleState).toBe('scheduled');

    // Assign
    const assignRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/assign`,
      cookies: { oc_access: access },
      payload: { assigneeTeamMemberId: tmId },
    });
    expect(assignRes.statusCode).toBe(200);
    expect(JSON.parse(assignRes.body).item.assigneeTeamMemberId).toBe(tmId);

    // Finish → creates invoice
    const finishRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/finish`,
      cookies: { oc_access: access },
    });
    expect(finishRes.statusCode).toBe(200);
    const finishBody = JSON.parse(finishRes.body);
    expect(finishBody.item.jobStatus).toBe('finished');
    expect(finishBody.item.invoice).toBeTruthy();
    expect(finishBody.item.invoice.status).toBe('draft');
    expect(finishBody.item.invoice.totalCents).toBe(5000);
    expect(finishBody.invoice).toBeTruthy();

    // Reopen → deletes draft invoice
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/reopen`,
      cookies: { oc_access: access },
    });
    expect(reopenRes.statusCode).toBe(200);
    expect(JSON.parse(reopenRes.body).item.jobStatus).toBe('open');
    expect(JSON.parse(reopenRes.body).item.invoice).toBeNull();
  });

  it('reopen with non-draft invoice is refused', async () => {
    const access = await login();

    // Create + finish
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        titleOrSummary: 'Sent invoice test',
        priceCents: 3000,
      },
    });
    const jId = JSON.parse(createRes.body).item.id;

    await app.inject({
      method: 'POST',
      url: `/api/jobs/${jId}/finish`,
      cookies: { oc_access: access },
    });

    // Manually mark invoice as sent
    await prisma.invoice.updateMany({
      where: { jobId: jId },
      data: { status: 'sent', sentAt: new Date() },
    });

    // Reopen should fail
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jId}/reopen`,
      cookies: { oc_access: access },
    });
    expect(reopenRes.statusCode).toBe(400);
    const body = JSON.parse(reopenRes.body);
    expect(body.error.code).toBe('INVOICE_NOT_DRAFT_CANNOT_REOPEN');
  });
});

describe('job actions', () => {
  it('unschedule clears times but preserves assignee', async () => {
    const access = await login();
    const tmId = await getActiveTeamMember();

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        scheduledStartAt: '2026-07-01T10:00:00.000Z',
        scheduledEndAt: '2026-07-01T12:00:00.000Z',
        assigneeTeamMemberId: tmId,
      },
    });
    const jId = JSON.parse(createRes.body).item.id;

    const unschedRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jId}/unschedule`,
      cookies: { oc_access: access },
    });
    expect(unschedRes.statusCode).toBe(200);
    const job = JSON.parse(unschedRes.body).item;
    expect(job.scheduleState).toBe('unscheduled');
    expect(job.scheduledStartAt).toBeNull();
    expect(job.assigneeTeamMemberId).toBe(tmId);
  });

  it('unassign clears team member', async () => {
    const access = await login();
    const tmId = await getActiveTeamMember();

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        assigneeTeamMemberId: tmId,
      },
    });
    const jId = JSON.parse(createRes.body).item.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jId}/unassign`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).item.assigneeTeamMemberId).toBeNull();
  });

  it('edit updates title/tags without touching schedule', async () => {
    const access = await login();

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: fixtureAddressId,
        titleOrSummary: 'Original',
        scheduledStartAt: '2026-08-01T10:00:00.000Z',
        scheduledEndAt: '2026-08-01T12:00:00.000Z',
      },
    });
    const jId = JSON.parse(createRes.body).item.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/jobs/${jId}`,
      cookies: { oc_access: access },
      payload: { titleOrSummary: 'Updated', tags: ['rush'] },
    });
    expect(patchRes.statusCode).toBe(200);
    const job = JSON.parse(patchRes.body).item;
    expect(job.titleOrSummary).toBe('Updated');
    expect(job.tags).toEqual(['rush']);
    expect(job.scheduleState).toBe('scheduled');
  });
});

describe('GET /api/jobs', () => {
  it('lists jobs for the org', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBeGreaterThan(0);
  });
});

describe('GET /api/customers/:customerId/jobs', () => {
  it('returns jobs for a customer', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${fixtureCustomerId}/jobs`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.customerId).toBe(fixtureCustomerId);
    }
  });
});
