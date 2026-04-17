import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TAG = 'PH11-';

afterAll(async () => {
  await cleanupFixtures();
  await app.close();
  await prisma.$disconnect();
});

beforeAll(async () => {
  await cleanupFixtures();
});

async function cleanupFixtures() {
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

// ── Fixture helpers ─────────────────────────────────────────────────────

let customerId: string;
let addressId: string;

async function createFixtureCustomer(access: string) {
  const name = uniq(`${TAG}Cust`);
  const res = await app.inject({
    method: 'POST',
    url: '/api/customers',
    cookies: { oc_access: access },
    payload: {
      firstName: name,
      customerType: 'Homeowner',
      primaryAddress: { street: '200 Elm', city: 'Austin', state: 'TX', zip: '78701' },
    },
  });
  const body = JSON.parse(res.body);
  return {
    customerId: body.item.id as string,
    addressId: body.item.addresses[0].id as string,
  };
}

async function createAndFinishJob(access: string): Promise<{ jobId: string; invoiceId: string }> {
  // Create scheduled job
  const jobRes = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/jobs`,
    cookies: { oc_access: access },
    payload: {
      customerAddressId: addressId,
      titleOrSummary: 'Billing Test Service',
      priceCents: 15000,
      scheduledStartAt: '2026-04-20T09:00:00.000Z',
      scheduledEndAt: '2026-04-20T10:00:00.000Z',
    },
  });
  const jobId = JSON.parse(jobRes.payload).item.id;

  // Finish the job (auto-creates invoice)
  const finishRes = await app.inject({
    method: 'POST',
    url: `/api/jobs/${jobId}/finish`,
    cookies: { oc_access: access },
  });
  const finishBody = JSON.parse(finishRes.payload);
  return { jobId, invoiceId: finishBody.invoice.id };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Billing Phase 11', () => {
  it('bootstrap — login + create customer', async () => {
    const access = await login();
    const fixture = await createFixtureCustomer(access);
    customerId = fixture.customerId;
    addressId = fixture.addressId;
    expect(customerId).toBeTruthy();
  });

  // ── Auto-created invoice on finish ────────────────────────────────

  let invoiceId: string;
  let jobId: string;

  it('finishing a job auto-creates a draft invoice', async () => {
    const access = await login();
    const result = await createAndFinishJob(access);
    invoiceId = result.invoiceId;
    jobId = result.jobId;
    expect(invoiceId).toBeTruthy();
  });

  it('GET /api/invoices/:id returns correct detail', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/invoices/${invoiceId}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.payload).item;
    expect(inv.status).toBe('draft');
    expect(inv.totalCents).toBe(15000);
    expect(inv.serviceNameSnapshot).toBe('Billing Test Service');
    expect(inv.servicePriceCentsSnapshot).toBe(15000);
    expect(inv.jobId).toBe(jobId);
    expect(inv.dueDate).toBeNull();
  });

  // ── List invoices ─────────────────────────────────────────────────

  it('GET /api/invoices lists invoices', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/invoices?status=unsent filters drafts', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices?status=unsent',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.payload).items;
    for (const inv of items) {
      expect(inv.status).toBe('draft');
    }
  });

  // ── Edit draft ────────────────────────────────────────────────────

  it('PATCH /api/invoices/:id edits draft', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${invoiceId}`,
      cookies: { oc_access: access },
      payload: {
        serviceNameSnapshot: 'Updated Service Name',
        servicePriceCentsSnapshot: 20000,
        dueDate: '2026-05-01',
      },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.payload).item;
    expect(inv.serviceNameSnapshot).toBe('Updated Service Name');
    expect(inv.servicePriceCentsSnapshot).toBe(20000);
    expect(inv.totalCents).toBe(20000);
    expect(inv.amountDueCents).toBe(20000);
    expect(inv.dueDate).toBe('2026-05-01');
  });

  // ── Send (draft → sent) ──────────────────────────────────────────

  it('POST /api/invoices/:id/send transitions draft → sent', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/send`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.payload).item;
    expect(inv.status).toBe('sent');
    expect(inv.sentAt).toBeTruthy();
  });

  it('cannot edit sent invoice', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${invoiceId}`,
      cookies: { oc_access: access },
      payload: { serviceNameSnapshot: 'Should fail' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error.code).toBe('INVOICE_NOT_DRAFT');
  });

  // ── Mark paid (sent → paid) ──────────────────────────────────────

  it('POST /api/invoices/:id/mark-paid transitions sent → paid', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/mark-paid`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.payload).item;
    expect(inv.status).toBe('paid');
    expect(inv.paidAt).toBeTruthy();
    expect(inv.paidCents).toBe(20000);
    expect(inv.amountDueCents).toBe(0);
  });

  it('cannot void a paid invoice', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/void`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Void flow (new invoice) ──────────────────────────────────────

  let voidInvoiceId: string;

  it('void a draft invoice', async () => {
    const access = await login();
    const result = await createAndFinishJob(access);
    voidInvoiceId = result.invoiceId;

    const res = await app.inject({
      method: 'POST',
      url: `/api/invoices/${voidInvoiceId}/void`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.payload).item;
    expect(inv.status).toBe('void');
    expect(inv.voidedAt).toBeTruthy();
  });

  it('GET /api/invoices?status=void lists voided invoices', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices?status=void',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.payload).items;
    const found = items.find((i: { id: string }) => i.id === voidInvoiceId);
    expect(found).toBeTruthy();
  });

  // ── Manual invoice create ────────────────────────────────────────

  it('POST /api/jobs/:id/invoice creates manual invoice', async () => {
    const access = await login();
    // Create a new job (unfinished) and manually create invoice
    const jobRes = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/jobs`,
      cookies: { oc_access: access },
      payload: {
        customerAddressId: addressId,
        titleOrSummary: 'Manual Invoice Job',
        priceCents: 8000,
      },
    });
    const manualJobId = JSON.parse(jobRes.payload).item.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${manualJobId}/invoice`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(201);
    const inv = JSON.parse(res.payload).item;
    expect(inv.status).toBe('draft');
    expect(inv.totalCents).toBe(8000);

    // Cannot create again (409)
    const dupRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${manualJobId}/invoice`,
      cookies: { oc_access: access },
    });
    expect(dupRes.statusCode).toBe(409);
  });

  // ── Customer invoices list ────────────────────────────────────────

  it('GET /api/customers/:id/invoices returns customer invoices', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}/invoices`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.payload).items;
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  // ── GET /api/invoices?status=paid ─────────────────────────────────

  it('GET /api/invoices?status=paid lists paid invoices', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices?status=paid',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.payload).items;
    for (const inv of items) {
      expect(inv.status).toBe('paid');
    }
  });
});
