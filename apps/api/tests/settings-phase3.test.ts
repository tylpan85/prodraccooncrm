import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();
const ORG_ID = '00000000-0000-0000-0000-000000000001';

afterAll(async () => {
  await cleanupPhase3Fixtures();
  await prisma.organization.update({
    where: { id: ORG_ID },
    data: { name: 'Raccoon Cleaning Inc', timezone: 'UTC' },
  });
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

async function login() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@raccooncrm.local', password: 'admin' },
  });
  const access = extractCookie(res.headers['set-cookie'], 'oc_access');
  if (!access) throw new Error('Missing access cookie');
  return access;
}

async function cleanupPhase3Fixtures() {
  await prisma.invoice.deleteMany({
    where: {
      organizationId: ORG_ID,
      job: {
        jobNumber: {
          startsWith: 'PH3-',
        },
      },
    },
  });
  await prisma.job.deleteMany({
    where: {
      organizationId: ORG_ID,
      jobNumber: {
        startsWith: 'PH3-',
      },
    },
  });
  await prisma.event.deleteMany({
    where: {
      organizationId: ORG_ID,
      OR: [{ name: { startsWith: 'PH3-' } }, { location: { startsWith: 'PH3-' } }],
    },
  });
  await prisma.customerAddress.deleteMany({
    where: {
      customer: {
        organizationId: ORG_ID,
        displayName: {
          startsWith: 'PH3-',
        },
      },
    },
  });
  await prisma.customer.deleteMany({
    where: {
      organizationId: ORG_ID,
      displayName: {
        startsWith: 'PH3-',
      },
    },
  });
  await prisma.service.deleteMany({
    where: {
      organizationId: ORG_ID,
      name: {
        startsWith: 'PH3 ',
      },
    },
  });
  await prisma.teamMember.deleteMany({
    where: {
      organizationId: ORG_ID,
      displayName: {
        startsWith: 'PH3 ',
      },
    },
  });
}

async function createJobFixture(serviceId?: string, assigneeTeamMemberId?: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const customer = await prisma.customer.create({
    data: {
      organizationId: ORG_ID,
      displayName: `PH3-${suffix}`,
      customerType: 'Homeowner',
    },
  });
  const address = await prisma.customerAddress.create({
    data: {
      customerId: customer.id,
      street: '123 Phase 3 St',
    },
  });
  const job = await prisma.job.create({
    data: {
      organizationId: ORG_ID,
      jobNumber: `PH3-${suffix}`,
      customerId: customer.id,
      customerAddressId: address.id,
      serviceId,
      assigneeTeamMemberId,
      scheduleState: 'unscheduled',
      titleOrSummary: 'Phase 3 fixture',
    },
  });
  return { customer, address, job };
}

beforeAll(async () => {
  await cleanupPhase3Fixtures();
});

describe('Phase 3 settings API', () => {
  it('creates services, blocks case-insensitive duplicates, and lists inactive only when requested', async () => {
    const access = await login();

    const create = await app.inject({
      method: 'POST',
      url: '/api/services',
      cookies: { oc_access: access },
      payload: { name: 'PH3 Deep Clean' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().item.usedByJobCount).toBe(0);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/services',
      cookies: { oc_access: access },
      payload: { name: 'ph3 deep clean' },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('SERVICE_DUPLICATE');

    const serviceId = create.json().item.id as string;
    const deactivate = await app.inject({
      method: 'PATCH',
      url: `/api/services/${serviceId}`,
      cookies: { oc_access: access },
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().item.active).toBe(false);

    const activeOnly = await app.inject({
      method: 'GET',
      url: '/api/services',
      cookies: { oc_access: access },
    });
    expect(activeOnly.statusCode).toBe(200);
    expect(activeOnly.json().items.some((item: { id: string }) => item.id === serviceId)).toBe(
      false,
    );

    const includeInactive = await app.inject({
      method: 'GET',
      url: '/api/services?includeInactive=true',
      cookies: { oc_access: access },
    });
    expect(includeInactive.statusCode).toBe(200);
    const listed = includeInactive
      .json()
      .items.find((item: { id: string }) => item.id === serviceId);
    expect(listed).toMatchObject({ name: 'PH3 Deep Clean', active: false, usedByJobCount: 0 });
  });

  it('refuses to delete a service when jobs reference it', async () => {
    const access = await login();
    const service = await prisma.service.create({
      data: {
        organizationId: ORG_ID,
        name: `PH3 Service ${Date.now()}`,
      },
    });
    await createJobFixture(service.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/services/${service.id}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SERVICE_IN_USE');
  });

  it('creates a team member with auto-generated initials and updates organization with timezone validation', async () => {
    const access = await login();

    const create = await app.inject({
      method: 'POST',
      url: '/api/team-members',
      cookies: { oc_access: access },
      payload: {
        displayName: 'PH3 Jane Doe',
        initials: null,
        color: '#112233',
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().item.initials).toBe('PD');
    expect(create.json().item.activeOnSchedule).toBe(true);

    const invalidTimezone = await app.inject({
      method: 'PATCH',
      url: '/api/organizations/current',
      cookies: { oc_access: access },
      payload: { timezone: 'Mars/Phobos' },
    });
    expect(invalidTimezone.statusCode).toBe(400);
    expect(invalidTimezone.json().error.code).toBe('INVALID_TIMEZONE');

    const validTimezone = await app.inject({
      method: 'PATCH',
      url: '/api/organizations/current',
      cookies: { oc_access: access },
      payload: { name: 'Raccoon Cleaning Inc', timezone: 'America/Chicago' },
    });
    expect(validTimezone.statusCode).toBe(200);
    expect(validTimezone.json().item.timezone).toBe('America/Chicago');
  });

  it('refuses to delete a team member when a job references them', async () => {
    const access = await login();
    const member = await prisma.teamMember.create({
      data: {
        organizationId: ORG_ID,
        displayName: `PH3 Job Member ${Date.now()}`,
        initials: 'JM',
        color: '#445566',
      },
    });
    await createJobFixture(undefined, member.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/team-members/${member.id}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TEAM_MEMBER_IN_USE');
  });

  it('refuses to delete a team member when an event references them', async () => {
    const access = await login();
    const member = await prisma.teamMember.create({
      data: {
        organizationId: ORG_ID,
        displayName: `PH3 Event Member ${Date.now()}`,
        initials: 'EM',
        color: '#778899',
      },
    });
    await prisma.event.create({
      data: {
        organizationId: ORG_ID,
        assigneeTeamMemberId: member.id,
        name: `PH3-${Date.now()}`,
        location: `PH3-${Date.now()}`,
        scheduledStartAt: new Date('2026-04-16T10:00:00.000Z'),
        scheduledEndAt: new Date('2026-04-16T11:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/team-members/${member.id}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TEAM_MEMBER_IN_USE');
  });
});
