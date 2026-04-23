import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TAG = 'PH4-';

afterAll(async () => {
  await cleanupPhase4Fixtures();
  await app.close();
  await prisma.$disconnect();
});

beforeAll(async () => {
  await cleanupPhase4Fixtures();
});

async function cleanupPhase4Fixtures() {
  await prisma.customer.deleteMany({
    where: {
      organizationId: ORG_ID,
      OR: [
        { displayName: { startsWith: TAG } },
        { firstName: { startsWith: TAG } },
        { companyName: { startsWith: TAG } },
      ],
    },
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

describe('Phase 4 customers API', () => {
  it('rejects creation when no name and no company name', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: { customerType: 'Homeowner' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('creates a customer with phones, emails, addresses, tags and derives display name', async () => {
    const access = await login();
    const last = uniq(`${TAG}Smith`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: `${TAG}John`,
        lastName: last,
        customerType: 'Homeowner',
        phones: [{ value: '(415) 555-0101', type: 'mobile' }],
        emails: [{ value: `john-${uniq('e')}@example.com` }],
        primaryAddress: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'ca',
          zip: '94110',
        },
        tags: ['VIP', 'vip', 'recurring'],
      },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item.displayName).toBe(`${TAG}John ${last}`);
    expect(item.phones).toHaveLength(1);
    expect(item.emails).toHaveLength(1);
    expect(item.addresses).toHaveLength(1);
    expect(item.addresses[0].state).toBe('CA');
    expect(item.tags).toEqual(['VIP', 'recurring']);
  });

  it('uses companyName as displayName when both are present', async () => {
    const access = await login();
    const company = uniq(`${TAG}Acme`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: `${TAG}Bob`,
        companyName: company,
        customerType: 'Business',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().item.displayName).toBe(company);
  });

  it('hard-blocks duplicate phone (normalized digits) across customers', async () => {
    const access = await login();
    const phone = `415555${Math.floor(Math.random() * 9000 + 1000)}`;
    const a = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}A`),
        customerType: 'Homeowner',
        phones: [{ value: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` }],
      },
    });
    expect(a.statusCode).toBe(201);

    const b = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}B`),
        customerType: 'Homeowner',
        phones: [{ value: `${phone.slice(0, 3)}.${phone.slice(3, 6)}.${phone.slice(6)}` }],
      },
    });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.code).toBe('CUSTOMER_DUPLICATE');
    expect(b.json().error.details.conflictType).toBe('phone');
  });

  it('hard-blocks duplicate email across customers (case-insensitive)', async () => {
    const access = await login();
    const email = `dup-${uniq('e')}@example.com`;
    const a = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}A`),
        customerType: 'Homeowner',
        emails: [{ value: email }],
      },
    });
    expect(a.statusCode).toBe(201);

    const b = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}B`),
        customerType: 'Homeowner',
        emails: [{ value: email.toUpperCase() }],
      },
    });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.code).toBe('CUSTOMER_DUPLICATE');
    expect(b.json().error.details.conflictType).toBe('email');
  });

  it('does not flag self as a duplicate when editing the same customer', async () => {
    const access = await login();
    const phone = '4155557777';
    const created = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}Self`),
        customerType: 'Homeowner',
        phones: [{ value: phone }],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().item.id as string;

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/customers/${id}`,
      cookies: { oc_access: access },
      payload: {
        phones: [{ value: phone, type: 'mobile' }],
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().item.phones[0].type).toBe('mobile');
  });

  it('partial PATCH does not wipe omitted sub-records (addresses, phones)', async () => {
    const access = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}Partial`),
        customerType: 'Homeowner',
        phones: [{ value: '4155558888' }],
        primaryAddress: { street: '1 Untouched Ave', city: 'SF', state: 'CA', zip: '94111' },
      },
    });
    const id = created.json().item.id as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/customers/${id}`,
      cookies: { oc_access: access },
      payload: { referredBy: 'A friend' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item.phones).toHaveLength(1);
    expect(patched.json().item.addresses[0].street).toBe('1 Untouched Ave');
    expect(patched.json().item.referredBy).toBe('A friend');
  });

  it('do_not_service forces sendNotifications false', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}DNS`),
        customerType: 'Homeowner',
        doNotService: true,
        sendNotifications: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().item.doNotService).toBe(true);
    expect(res.json().item.sendNotifications).toBe(false);
  });

  it('search by partial phone digits matches formatted-stored phones', async () => {
    const access = await login();
    const stamp = Math.floor(Math.random() * 9000 + 1000).toString();
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: uniq(`${TAG}Search`),
        customerType: 'Homeowner',
        phones: [{ value: `(415) 555-${stamp}` }],
      },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/api/customers?q=555-${stamp}`,
      cookies: { oc_access: access },
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ displayName: string }>;
    expect(items.some((i) => i.displayName.startsWith(`${TAG}Search`))).toBe(true);
  });

  it('search-duplicates returns name + city/zip matches without server-side block', async () => {
    const access = await login();
    const last = uniq(`${TAG}Soft`);
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: {
        firstName: 'John',
        lastName: last,
        customerType: 'Homeowner',
        primaryAddress: { city: 'Springfield', zip: '99001' },
      },
    });
    const dup = await app.inject({
      method: 'GET',
      url: `/api/customers/search-duplicates?firstName=John&lastName=${encodeURIComponent(last)}&city=Springfield`,
      cookies: { oc_access: access },
    });
    expect(dup.statusCode).toBe(200);
    expect((dup.json().items as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);
  });

  it('GET /customers/:id/jobs and /invoices return empty arrays for now', async () => {
    const access = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/customers',
      cookies: { oc_access: access },
      payload: { firstName: uniq(`${TAG}Tabs`), customerType: 'Homeowner' },
    });
    const id = created.json().item.id as string;
    const jobs = await app.inject({
      method: 'GET',
      url: `/api/customers/${id}/jobs`,
      cookies: { oc_access: access },
    });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().items).toEqual([]);
    const invoices = await app.inject({
      method: 'GET',
      url: `/api/customers/${id}/invoices`,
      cookies: { oc_access: access },
    });
    expect(invoices.statusCode).toBe(200);
    expect(invoices.json().items).toEqual([]);
  });

  it('unauthenticated requests are rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(res.statusCode).toBe(401);
  });
});
