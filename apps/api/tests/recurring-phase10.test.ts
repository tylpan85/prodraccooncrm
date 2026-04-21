import { prisma } from '@openclaw/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './build-app.js';

const app = await buildTestApp();
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TAG = 'PH10-';

afterAll(async () => {
  await cleanupFixtures();
  await app.close();
  await prisma.$disconnect();
});

beforeAll(async () => {
  await cleanupFixtures();
});

async function cleanupFixtures() {
  // Delete recurring_series → invoices → job_tags → jobs → customers
  await prisma.recurringSeries.deleteMany({
    where: {
      organizationId: ORG_ID,
      sourceJob: { customer: { displayName: { startsWith: TAG } } },
    },
  });
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
let teamMemberId: string;

async function createFixtureCustomer(access: string) {
  const name = uniq(`${TAG}Cust`);
  const res = await app.inject({
    method: 'POST',
    url: '/api/customers',
    cookies: { oc_access: access },
    payload: {
      firstName: name,
      customerType: 'Homeowner',
      primaryAddress: { street: '100 Main', city: 'Austin', state: 'TX', zip: '78701' },
      phones: [{ value: '555-0100' }],
    },
  });
  const body = JSON.parse(res.body);
  return {
    customerId: body.item.id as string,
    addressId: body.item.addresses[0].id as string,
  };
}

async function createScheduledJob(access: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/jobs`,
    cookies: { oc_access: access },
    payload: {
      customerAddressId: addressId,
      titleOrSummary: 'Recurring Test Job',
      priceCents: 5000,
      scheduledStartAt: '2026-04-17T14:00:00.000Z',
      scheduledEndAt: '2026-04-17T15:00:00.000Z',
    },
  });
  const body = JSON.parse(res.body);
  return body.item.id;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Recurring Phase 10', () => {
  it('bootstrap — login + create customer', async () => {
    const access = await login();
    const fixture = await createFixtureCustomer(access);
    customerId = fixture.customerId;
    addressId = fixture.addressId;

    const tm = await prisma.teamMember.findFirst({
      where: { organizationId: ORG_ID, activeOnSchedule: true },
      select: { id: true },
    });
    teamMemberId = tm?.id ?? '';
    expect(customerId).toBeTruthy();
    expect(teamMemberId).toBeTruthy();
  });

  // ── Attach recurrence to existing job ─────────────────────────────

  let seriesId: string;
  let sourceJobId: string;

  it('attach recurrence to scheduled job — weekly FRI × 4', async () => {
    const access = await login();
    sourceJobId = await createScheduledJob(access);

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${sourceJobId}/recurrence`,
      cookies: { oc_access: access },
      payload: {
        recurrenceFrequency: 'weekly',
        recurrenceInterval: 1,
        recurrenceDayOfWeek: ['FRI'],
        recurrenceEndMode: 'after_n_occurrences',
        recurrenceOccurrenceCount: 4,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    seriesId = body.item.seriesId;
    expect(body.item.generatedCount).toBe(3); // 4 total - 1 source = 3 generated
  });

  it('source job is occurrence 1 with recurring_series_id', async () => {
    const job = await prisma.job.findUnique({ where: { id: sourceJobId } });
    expect(job?.recurringSeriesId).toBe(seriesId);
    expect(job?.occurrenceIndex).toBe(1);
    expect(job?.generatedFromRuleVersion).toBe(1);
  });

  it('series detail returns all 4 occurrences', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.item.totalOccurrences).toBe(4);
    const indices = body.item.occurrences.map(
      (o: { occurrenceIndex: number }) => o.occurrenceIndex,
    );
    expect(indices).toEqual([1, 2, 3, 4]);
  });

  it('generated occurrences have correct dates (weekly Fridays)', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(res.payload).item.occurrences;
    const dates = occs.map((o: { scheduledStartAt: string }) => o.scheduledStartAt.slice(0, 10));
    expect(dates).toEqual(['2026-04-17', '2026-04-24', '2026-05-01', '2026-05-08']);
  });

  it('reject attaching recurrence to already-recurring job', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${sourceJobId}/recurrence`,
      cookies: { oc_access: access },
      payload: {
        recurrenceFrequency: 'daily',
        recurrenceInterval: 1,
        recurrenceEndMode: 'after_n_occurrences',
        recurrenceOccurrenceCount: 3,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error.code).toBe('ALREADY_RECURRING');
  });

  // ── Get series for job ────────────────────────────────────────────

  it('GET /api/jobs/:id/series returns series info', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${sourceJobId}/series`,
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.item.id).toBe(seriesId);
    expect(body.item.recurrenceFrequency).toBe('weekly');
  });

  // ── Edit single occurrence (scope=this) ───────────────────────────

  it('edit scope=this updates only the selected occurrence', async () => {
    const access = await login();
    // Get second occurrence
    const seriesRes = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(seriesRes.payload).item.occurrences;
    const secondId = occs[1].id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${secondId}/occurrence-edit`,
      cookies: { oc_access: access },
      payload: {
        scope: 'this',
        changes: {
          titleOrSummary: 'One-off visit',
          scheduledStartAt: '2026-04-24T16:30:00.000Z',
          scheduledEndAt: '2026-04-24T17:45:00.000Z',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).item.scope).toBe('this');

    // Verify the edited occurrence is marked as exception
    const updated = await prisma.job.findUnique({ where: { id: secondId } });
    expect(updated?.isExceptionInstance).toBe(true);
    expect(updated?.titleOrSummary).toBe('One-off visit');

    // Verify third occurrence is untouched
    const thirdId = occs[2].id;
    const third = await prisma.job.findUnique({ where: { id: thirdId } });
    expect(third?.titleOrSummary).toBe('Recurring Test Job');
    expect(third?.isExceptionInstance).toBe(false);
  });

  it('scope=this with recurrenceRule is rejected', async () => {
    const access = await login();
    const seriesRes = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(seriesRes.payload).item.occurrences;
    const secondId = occs[1].id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${secondId}/occurrence-edit`,
      cookies: { oc_access: access },
      payload: {
        scope: 'this',
        changes: { titleOrSummary: 'Should fail' },
        recurrenceRule: {
          recurrenceFrequency: 'daily',
          recurrenceInterval: 1,
          recurrenceEndMode: 'never',
        },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Edit this-and-future (non-schedule change) ────────────────────

  it('edit scope=this_and_future non-schedule change propagates to future', async () => {
    const access = await login();
    const seriesRes = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(seriesRes.payload).item.occurrences;
    const thirdId = occs[2].id;
    const fourthId = occs[3].id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${thirdId}/occurrence-edit`,
      cookies: { oc_access: access },
      payload: {
        scope: 'this_and_future',
        changes: {
          titleOrSummary: 'Updated future title',
          priceCents: 7500,
        },
      },
    });

    expect(res.statusCode).toBe(200);

    // Verify third was updated
    const third = await prisma.job.findUnique({ where: { id: thirdId } });
    expect(third?.titleOrSummary).toBe('Updated future title');
    expect(third?.priceCents).toBe(7500);
    expect(third?.generatedFromRuleVersion).toBe(2);

    // Verify fourth was also updated
    const fourth = await prisma.job.findUnique({ where: { id: fourthId } });
    expect(fourth?.titleOrSummary).toBe('Updated future title');
    expect(fourth?.priceCents).toBe(7500);

    // Verify first (history) is untouched
    const first = await prisma.job.findUnique({ where: { id: sourceJobId } });
    expect(first?.titleOrSummary).toBe('Recurring Test Job');
  });

  // ── Delete scope=this ─────────────────────────────────────────────

  it('delete scope=this soft-deletes one occurrence', async () => {
    const access = await login();
    const seriesRes = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(seriesRes.payload).item.occurrences;
    // Second occurrence (the exception instance)
    const secondId = occs[1].id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${secondId}/occurrence-delete`,
      cookies: { oc_access: access },
      payload: { scope: 'this' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).item.deletedCount).toBe(1);

    // Verify it's soft-deleted
    const deleted = await prisma.job.findUnique({ where: { id: secondId } });
    expect(deleted?.deletedFromSeriesAt).toBeTruthy();

    // Series detail should now show 3 active occurrences
    const refreshed = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    expect(JSON.parse(refreshed.payload).item.totalOccurrences).toBe(3);
  });

  // ── Delete scope=this_and_future ──────────────────────────────────

  it('delete scope=this_and_future truncates series', async () => {
    const access = await login();
    const seriesRes = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(seriesRes.payload).item.occurrences;
    // Delete from 3rd occurrence onwards
    const thirdId = occs[1].id; // was index 3, now at position 1 (2 was deleted)

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${thirdId}/occurrence-delete`,
      cookies: { oc_access: access },
      payload: { scope: 'this_and_future' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.item.deletedCount).toBeGreaterThanOrEqual(2);

    // Series should be disabled
    const series = await prisma.recurringSeries.findUnique({ where: { id: seriesId } });
    expect(series?.recurrenceEnabled).toBe(false);

    // Only occurrence 1 remains active
    const remaining = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${seriesId}`,
      cookies: { oc_access: access },
    });
    expect(JSON.parse(remaining.payload).item.totalOccurrences).toBe(1);
  });

  // ── Create recurring job from scratch ─────────────────────────────

  let scratchSeriesId: string;

  it('POST /api/recurring-jobs creates series + materializes', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/recurring-jobs',
      cookies: { oc_access: access },
      payload: {
        customerId,
        job: {
          customerAddressId: addressId,
          titleOrSummary: 'Scratch recurring',
          priceCents: 3000,
        },
        schedule: {
          scheduledStartAt: '2026-04-17T10:00:00.000Z',
          scheduledEndAt: '2026-04-17T11:00:00.000Z',
          assigneeTeamMemberId: teamMemberId,
        },
        recurrence: {
          recurrenceFrequency: 'weekly',
          recurrenceInterval: 1,
          recurrenceDayOfWeek: ['FRI'],
          recurrenceEndMode: 'after_n_occurrences',
          recurrenceOccurrenceCount: 3,
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    scratchSeriesId = body.item.seriesId;
    expect(body.item.generatedCount).toBe(2); // 3 total - 1 source = 2 generated
  });

  it('scratch series has 3 occurrences with assignee', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${scratchSeriesId}`,
      cookies: { oc_access: access },
    });
    const body = JSON.parse(res.payload);
    expect(body.item.totalOccurrences).toBe(3);
    // All should have the same assignee
    for (const occ of body.item.occurrences) {
      expect(occ.assigneeTeamMemberId).toBe(teamMemberId);
    }
  });

  // ── Edit this_and_future with schedule change (rematerialization) ─

  it('edit scope=this_and_future with schedule change rematerializes tail', async () => {
    const access = await login();

    // Create a fresh series for this test
    const jobId = await createScheduledJob(access);
    const attachRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/recurrence`,
      cookies: { oc_access: access },
      payload: {
        recurrenceFrequency: 'weekly',
        recurrenceInterval: 1,
        recurrenceDayOfWeek: ['FRI'],
        recurrenceEndMode: 'after_n_occurrences',
        recurrenceOccurrenceCount: 5,
      },
    });
    const newSeriesId = JSON.parse(attachRes.payload).item.seriesId;

    // Get occurrences
    const seriesRes = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${newSeriesId}`,
      cookies: { oc_access: access },
    });
    const occs = JSON.parse(seriesRes.payload).item.occurrences;
    expect(occs).toHaveLength(5);
    const pivotId = occs[1].id; // second occurrence

    // Edit with schedule change + new rule (monthly)
    const editRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${pivotId}/occurrence-edit`,
      cookies: { oc_access: access },
      payload: {
        scope: 'this_and_future',
        changes: {
          scheduledStartAt: '2026-04-24T18:00:00.000Z',
          scheduledEndAt: '2026-04-24T19:30:00.000Z',
        },
        recurrenceRule: {
          recurrenceFrequency: 'monthly',
          recurrenceInterval: 1,
          recurrenceDayOfMonth: 24,
          recurrenceEndMode: 'after_n_occurrences',
          recurrenceOccurrenceCount: 3,
        },
      },
    });

    expect(editRes.statusCode).toBe(200);

    // Verify series has correct occurrences after rematerialization
    const refreshed = await app.inject({
      method: 'GET',
      url: `/api/recurring-series/${newSeriesId}`,
      cookies: { oc_access: access },
    });
    const newOccs = JSON.parse(refreshed.payload).item.occurrences;

    // First occurrence unchanged
    expect(newOccs[0].id).toBe(jobId);
    // Pivot is the same job
    expect(newOccs[1].id).toBe(pivotId);
    expect(newOccs[1].scheduledStartAt).toBe('2026-04-24T18:00:00.000Z');
    // New occurrences are monthly
    expect(newOccs.length).toBeGreaterThanOrEqual(3);
    if (newOccs.length >= 3) {
      expect(newOccs[2].scheduledStartAt).toContain('2026-05-24T18:00:00.000');
    }
    if (newOccs.length >= 4) {
      expect(newOccs[3].scheduledStartAt).toContain('2026-06-24T18:00:00.000');
    }
  });

  // ── Extend horizons ───────────────────────────────────────────────

  it('extend-horizons endpoint is callable', async () => {
    const access = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/recurring-series/extend-horizons',
      cookies: { oc_access: access },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.item).toHaveProperty('extended');
    expect(body.item).toHaveProperty('generated');
  });

  it('horizon extension replicates this_and_future notes onto newly materialized occurrences', async () => {
    const access = await login();

    const jobId = await createScheduledJob(access);
    const attachRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/recurrence`,
      cookies: { oc_access: access },
      payload: {
        recurrenceFrequency: 'weekly',
        recurrenceInterval: 1,
        recurrenceDayOfWeek: ['FRI'],
        recurrenceEndMode: 'on_date',
        recurrenceEndDate: '2026-05-08',
      },
    });
    expect(attachRes.statusCode).toBe(201);
    const horizonSeriesId = JSON.parse(attachRes.payload).item.seriesId;

    const noteRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/occurrence-edit`,
      cookies: { oc_access: access },
      payload: {
        scope: 'this_and_future',
        changes: {},
        noteOps: [{ op: 'create', tempId: 'tmp-h1', content: 'Horizon test note' }],
      },
    });
    expect(noteRes.statusCode).toBe(200);
    const mappings = JSON.parse(noteRes.payload).item.noteMappings;
    expect(mappings).toHaveLength(1);
    const noteGroupId = mappings[0].noteGroupId;

    const initialNotes = await prisma.customerNote.findMany({
      where: { noteGroupId },
      select: { jobId: true },
    });
    expect(initialNotes.length).toBeGreaterThanOrEqual(4);

    const jobsBefore = await prisma.job.findMany({
      where: { recurringSeriesId: horizonSeriesId, deletedFromSeriesAt: null },
      select: { id: true },
    });
    const beforeIds = new Set(jobsBefore.map((j) => j.id));

    await prisma.recurringSeries.update({
      where: { id: horizonSeriesId },
      data: {
        recurrenceEndDate: new Date('2026-07-24'),
        materializationHorizonUntil: new Date('2026-05-08'),
      },
    });

    const extRes = await app.inject({
      method: 'POST',
      url: '/api/recurring-series/extend-horizons',
      cookies: { oc_access: access },
    });
    expect(extRes.statusCode).toBe(200);
    expect(JSON.parse(extRes.payload).item.generated).toBeGreaterThan(0);

    const jobsAfter = await prisma.job.findMany({
      where: { recurringSeriesId: horizonSeriesId, deletedFromSeriesAt: null },
      select: { id: true },
    });
    const newIds = jobsAfter.map((j) => j.id).filter((id) => !beforeIds.has(id));
    expect(newIds.length).toBeGreaterThan(0);

    const newNotes = await prisma.customerNote.findMany({
      where: { noteGroupId, jobId: { in: newIds } },
      select: { jobId: true, content: true },
    });
    expect(newNotes).toHaveLength(newIds.length);
    for (const n of newNotes) {
      expect(n.content).toBe('Horizon test note');
    }
  });

});
