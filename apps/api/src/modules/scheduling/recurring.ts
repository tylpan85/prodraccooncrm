import { type Prisma, type PrismaClient, prisma } from '@openclaw/db';
import {
  type RecurrenceRule,
  computeHorizonDate,
  generateOccurrenceDates,
} from '@openclaw/recurrence';
import {
  ERROR_CODES,
  type JobServiceItemInput,
  attachRecurrenceRequestSchema,
  createRecurringJobRequestSchema,
  occurrenceDeleteRequestSchema,
  occurrenceEditRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';
import { deriveJobTotals, normalizeServiceItems, validateServiceIds } from './jobs.js';
import { processNoteOps } from './notes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const idParam = z.object({ id: z.string().uuid() });

async function nextJobNumber(orgId: string, tx: Tx): Promise<string> {
  const counter = await tx.organizationCounter.upsert({
    where: { organizationId_name: { organizationId: orgId, name: 'job_number' } },
    create: { organizationId: orgId, name: 'job_number', nextValue: 1002 },
    update: { nextValue: { increment: 1 } },
  });
  return `J-${counter.nextValue - 1}`;
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Materialization engine bridge
// ---------------------------------------------------------------------------

interface SeriesRow {
  id: string;
  recurrenceFrequency: string;
  recurrenceInterval: number;
  recurrenceEndMode: string;
  recurrenceOccurrenceCount: number | null;
  recurrenceEndDate: Date | null;
  recurrenceDayOfWeek: string[];
  recurrenceDayOfMonth: number | null;
  recurrenceOrdinal: string | null;
  recurrenceMonthOfYear: string | null;
}

function seriesToRule(s: SeriesRow): RecurrenceRule {
  return {
    recurrenceFrequency: s.recurrenceFrequency as RecurrenceRule['recurrenceFrequency'],
    recurrenceInterval: s.recurrenceInterval,
    recurrenceEndMode: s.recurrenceEndMode as RecurrenceRule['recurrenceEndMode'],
    recurrenceOccurrenceCount: s.recurrenceOccurrenceCount,
    recurrenceEndDate: s.recurrenceEndDate ? s.recurrenceEndDate.toISOString().slice(0, 10) : null,
    recurrenceDayOfWeek:
      s.recurrenceDayOfWeek.length > 0
        ? (s.recurrenceDayOfWeek as RecurrenceRule['recurrenceDayOfWeek'])
        : null,
    recurrenceDayOfMonth: s.recurrenceDayOfMonth,
    recurrenceOrdinal: s.recurrenceOrdinal as RecurrenceRule['recurrenceOrdinal'],
    recurrenceMonthOfYear: s.recurrenceMonthOfYear as RecurrenceRule['recurrenceMonthOfYear'],
  };
}

interface PivotJob {
  id: string;
  customerId: string;
  customerAddressId: string;
  serviceId: string | null;
  titleOrSummary: string | null;
  priceCents: number;
  leadSource: string | null;
  privateNotes: string | null;
  assigneeTeamMemberId: string | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  tags: { tag: string }[];
  serviceItems: {
    serviceId: string | null;
    priceCents: number;
    nameSnapshot: string | null;
    orderIndex: number;
  }[];
}

async function materializeTail(
  tx: Tx,
  orgId: string,
  series: SeriesRow,
  pivot: PivotJob,
  startingIndex: number,
  ruleVersion: number,
  horizonOverride?: Date,
  templateJobIds?: string[],
): Promise<number> {
  const rule = seriesToRule(series);
  const anchorDate = new Date(
    pivot.scheduledStartAt.getFullYear(),
    pivot.scheduledStartAt.getMonth(),
    pivot.scheduledStartAt.getDate(),
  );
  const durationMs = pivot.scheduledEndAt.getTime() - pivot.scheduledStartAt.getTime();
  const defaultHorizon = computeHorizonDate(rule);
  const horizon = horizonOverride ?? defaultHorizon;

  // startIndex=1 skips the anchor date itself (occurrence 1 is the pivot)
  const dates = generateOccurrenceDates(rule, anchorDate, 20000, horizon, 1);

  let occurrenceIndex = startingIndex;
  const pivotTags = pivot.tags.map((t) => t.tag);
  const newJobIds: string[] = [];

  for (const date of dates) {
    const startAt = new Date(date);
    startAt.setHours(
      pivot.scheduledStartAt.getHours(),
      pivot.scheduledStartAt.getMinutes(),
      pivot.scheduledStartAt.getSeconds(),
      pivot.scheduledStartAt.getMilliseconds(),
    );
    const endAt = new Date(startAt.getTime() + durationMs);
    const jobNumber = await nextJobNumber(orgId, tx);

    const created = await tx.job.create({
      data: {
        organizationId: orgId,
        jobNumber,
        customerId: pivot.customerId,
        customerAddressId: pivot.customerAddressId,
        serviceId: pivot.serviceId,
        titleOrSummary: pivot.titleOrSummary,
        priceCents: pivot.priceCents,
        leadSource: pivot.leadSource,
        privateNotes: pivot.privateNotes,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        assigneeTeamMemberId: pivot.assigneeTeamMemberId,
        recurringSeriesId: series.id,
        occurrenceIndex,
        generatedFromRuleVersion: ruleVersion,
        isExceptionInstance: false,
        tags: pivotTags.length > 0 ? { create: pivotTags.map((tag) => ({ tag })) } : undefined,
        serviceItems:
          pivot.serviceItems.length > 0
            ? {
                create: pivot.serviceItems.map((it) => ({
                  serviceId: it.serviceId,
                  priceCents: it.priceCents,
                  nameSnapshot: it.nameSnapshot,
                  orderIndex: it.orderIndex,
                })),
              }
            : undefined,
      },
      select: { id: true },
    });

    newJobIds.push(created.id);
    occurrenceIndex++;
  }

  // Replicate `this_and_future` notes from the template jobs onto the fresh
  // occurrences, preserving noteGroupId so future update/delete ops still
  // target the whole group. Default template is the pivot (which carries any
  // this_and_future notes anchored at or before the pivot). Callers that
  // archive tail rows before rematerialization must pass those tail IDs
  // explicitly so the tombstoned notes are still captured.
  const sourceIds = templateJobIds && templateJobIds.length > 0 ? templateJobIds : [pivot.id];
  if (newJobIds.length > 0) {
    const sourceNotes = await tx.customerNote.findMany({
      where: { organizationId: orgId, jobId: { in: sourceIds } },
      select: {
        noteGroupId: true,
        content: true,
        authorUserId: true,
        customerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const templates = new Map<
      string,
      { content: string; authorUserId: string | null; customerId: string }
    >();
    for (const n of sourceNotes) {
      if (n.noteGroupId === null) continue;
      if (!templates.has(n.noteGroupId)) {
        templates.set(n.noteGroupId, {
          content: n.content,
          authorUserId: n.authorUserId,
          customerId: n.customerId,
        });
      }
    }
    if (templates.size > 0) {
      const rows: {
        organizationId: string;
        customerId: string;
        jobId: string;
        noteGroupId: string;
        content: string;
        authorUserId: string | null;
      }[] = [];
      for (const [noteGroupId, tpl] of templates) {
        for (const jobId of newJobIds) {
          rows.push({
            organizationId: orgId,
            customerId: tpl.customerId,
            jobId,
            noteGroupId,
            content: tpl.content,
            authorUserId: tpl.authorUserId,
          });
        }
      }
      await tx.customerNote.createMany({ data: rows });
    }
  }

  // Update horizon on series
  await tx.recurringSeries.update({
    where: { id: series.id },
    data: {
      materializationHorizonUntil: horizon,
      lastExtendedAt: new Date(),
    },
  });

  return occurrenceIndex - startingIndex;
}

// ---------------------------------------------------------------------------
// Lazy extension (Google Calendar-style "ends never" behavior)
// ---------------------------------------------------------------------------

/**
 * Ensures that every "ends never" recurring series in the org that is
 * referenced by the given view has enough occurrences materialized to cover
 * `targetDate`. No-op for series with a fixed end (`on_date` /
 * `after_n_occurrences`) — those must not be extended past their user-set end.
 *
 * Safe to call often; skips series whose horizon already covers targetDate.
 */
export async function ensureMaterializedUntil(
  orgId: string,
  targetDate: Date,
  opts: { customerId?: string; seriesIds?: string[] } = {},
): Promise<void> {
  const where: Prisma.RecurringSeriesWhereInput = {
    organizationId: orgId,
    recurrenceEnabled: true,
    recurrenceEndMode: 'never',
    OR: [
      { materializationHorizonUntil: null },
      { materializationHorizonUntil: { lt: targetDate } },
    ],
  };
  if (opts.seriesIds && opts.seriesIds.length > 0) {
    where.id = { in: opts.seriesIds };
  }
  if (opts.customerId) {
    where.sourceJob = { customerId: opts.customerId };
  }

  const series = await prisma.recurringSeries.findMany({ where });
  if (series.length === 0) return;

  // Extend past the target by 6 months so successive view-requests in the
  // same horizon window skip the check entirely instead of re-triggering
  // a 1-day incremental extension for every series on every request.
  const extendTo = new Date(targetDate);
  extendTo.setMonth(extendTo.getMonth() + 6);

  const CONCURRENCY = 10;
  for (let i = 0; i < series.length; i += CONCURRENCY) {
    const batch = series.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (s) => {
        const lastOccurrence = await prisma.job.findFirst({
          where: { recurringSeriesId: s.id, deletedFromSeriesAt: null },
          orderBy: { occurrenceIndex: 'desc' },
          include: {
            tags: true,
            serviceItems: { orderBy: { orderIndex: 'asc' } },
          },
        });
        if (!lastOccurrence || !lastOccurrence.scheduledStartAt || !lastOccurrence.scheduledEndAt) {
          return;
        }

        await prisma.$transaction(async (tx) => {
          const pivot: PivotJob = {
            id: lastOccurrence.id,
            customerId: lastOccurrence.customerId,
            customerAddressId: lastOccurrence.customerAddressId,
            serviceId: lastOccurrence.serviceId,
            titleOrSummary: lastOccurrence.titleOrSummary,
            priceCents: lastOccurrence.priceCents,
            leadSource: lastOccurrence.leadSource,
            privateNotes: lastOccurrence.privateNotes,
            assigneeTeamMemberId: lastOccurrence.assigneeTeamMemberId,
            scheduledStartAt: lastOccurrence.scheduledStartAt as Date,
            scheduledEndAt: lastOccurrence.scheduledEndAt as Date,
            tags: lastOccurrence.tags,
            serviceItems: lastOccurrence.serviceItems.map((it) => ({
              serviceId: it.serviceId,
              priceCents: it.priceCents,
              nameSnapshot: it.nameSnapshot,
              orderIndex: it.orderIndex,
            })),
          };
          await materializeTail(
            tx,
            orgId,
            s,
            pivot,
            (lastOccurrence.occurrenceIndex ?? 1) + 1,
            s.recurrenceRuleVersion,
            extendTo,
          );
        });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

async function validateAddressOwnership(customerId: string, addressId: string, orgId: string) {
  const addr = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId, customer: { organizationId: orgId } },
    select: { id: true },
  });
  if (!addr) {
    throw new ApiError(
      ERROR_CODES.ADDRESS_NOT_OWNED_BY_CUSTOMER,
      400,
      'Address does not belong to this customer',
    );
  }
}

async function validateAssignee(teamMemberId: string, orgId: string) {
  const tm = await prisma.teamMember.findFirst({
    where: { id: teamMemberId, organizationId: orgId },
    select: { activeOnSchedule: true },
  });
  if (!tm) {
    throw new ApiError(ERROR_CODES.INVALID_ASSIGNEE, 400, 'Team member not found');
  }
  if (!tm.activeOnSchedule) {
    throw new ApiError(
      ERROR_CODES.INVALID_ASSIGNEE,
      400,
      'Team member is not active on the schedule',
    );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function recurringRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── Attach recurrence to existing job ────────────────────────────────
  fastify.post('/api/jobs/:id/recurrence', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;
    const body = attachRecurrenceRequestSchema.parse(req.body);

    const job = await prisma.job.findFirst({
      where: { id, organizationId: orgId },
      include: {
        tags: true,
        serviceItems: { orderBy: { orderIndex: 'asc' } },
      },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (job.recurringSeriesId) {
      throw new ApiError(
        ERROR_CODES.ALREADY_RECURRING,
        400,
        'Job is already part of a recurring series',
      );
    }
    if (!job.scheduledStartAt || !job.scheduledEndAt) {
      throw new ApiError(
        ERROR_CODES.JOB_NOT_SCHEDULED,
        400,
        'Job must be scheduled before enabling recurrence',
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const series = await tx.recurringSeries.create({
        data: {
          organizationId: orgId,
          sourceJobId: id,
          recurrenceFrequency: body.recurrenceFrequency,
          recurrenceInterval: body.recurrenceInterval,
          recurrenceEndMode: body.recurrenceEndMode,
          recurrenceOccurrenceCount: body.recurrenceOccurrenceCount ?? null,
          recurrenceEndDate: body.recurrenceEndDate ? new Date(body.recurrenceEndDate) : null,
          recurrenceDayOfWeek: body.recurrenceDayOfWeek ?? [],
          recurrenceDayOfMonth: body.recurrenceDayOfMonth ?? null,
          recurrenceOrdinal: body.recurrenceOrdinal ?? null,
          recurrenceMonthOfYear: body.recurrenceMonthOfYear ?? null,
        },
      });

      await tx.job.update({
        where: { id },
        data: {
          recurringSeriesId: series.id,
          occurrenceIndex: 1,
          generatedFromRuleVersion: 1,
          isExceptionInstance: false,
          deletedFromSeriesAt: null,
        },
      });

      const pivot: PivotJob = {
        id: job.id,
        customerId: job.customerId,
        customerAddressId: job.customerAddressId,
        serviceId: job.serviceId,
        titleOrSummary: job.titleOrSummary,
        priceCents: job.priceCents,
        leadSource: job.leadSource,
        privateNotes: job.privateNotes,
        assigneeTeamMemberId: job.assigneeTeamMemberId,
        scheduledStartAt: job.scheduledStartAt as Date,
        scheduledEndAt: job.scheduledEndAt as Date,
        tags: job.tags,
        serviceItems: job.serviceItems.map((it) => ({
          serviceId: it.serviceId,
          priceCents: it.priceCents,
          nameSnapshot: it.nameSnapshot,
          orderIndex: it.orderIndex,
        })),
      };

      const generatedCount = await materializeTail(tx, orgId, series, pivot, 2, 1);

      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'recurring_series',
        entityId: series.id,
        action: 'attach_recurrence',
        payload: { jobId: id },
      });

      return { seriesId: series.id, generatedCount };
    });

    return reply.status(201).send({
      item: { seriesId: result.seriesId, generatedCount: result.generatedCount },
    });
  });

  // ── Create recurring job from scratch ────────────────────────────────
  fastify.post('/api/recurring-jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;
    const body = createRecurringJobRequestSchema.parse(req.body);

    // Validate customer
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, organizationId: orgId },
      select: { id: true, doNotService: true },
    });
    if (!customer) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    if (customer.doNotService) {
      throw new ApiError(
        ERROR_CODES.DO_NOT_SERVICE_BLOCK,
        400,
        'Cannot schedule for a Do Not Service customer',
      );
    }

    await validateAddressOwnership(body.customerId, body.job.customerAddressId, orgId);
    if (body.schedule.assigneeTeamMemberId) {
      await validateAssignee(body.schedule.assigneeTeamMemberId, orgId);
    }

    const tags = body.job.tags ? dedupeTags(body.job.tags) : [];

    const serviceItemsInput = normalizeServiceItems({
      services: body.job.services ?? null,
      serviceId: body.job.serviceId ?? null,
      priceCents: body.job.priceCents ?? 0,
    });
    await validateServiceIds(serviceItemsInput, orgId);
    const { totalCents, primaryServiceId } = deriveJobTotals(serviceItemsInput);

    const result = await prisma.$transaction(async (tx) => {
      const jobNumber = await nextJobNumber(orgId, tx);

      const sourceJob = await tx.job.create({
        data: {
          organizationId: orgId,
          jobNumber,
          customerId: body.customerId,
          customerAddressId: body.job.customerAddressId,
          serviceId: primaryServiceId,
          titleOrSummary: body.job.titleOrSummary ?? null,
          priceCents: totalCents,
          leadSource: body.job.leadSource ?? null,
          privateNotes: body.job.privateNotes ?? null,
          scheduledStartAt: new Date(body.schedule.scheduledStartAt),
          scheduledEndAt: new Date(body.schedule.scheduledEndAt),
          assigneeTeamMemberId: body.schedule.assigneeTeamMemberId ?? null,
          tags: tags.length > 0 ? { create: tags.map((tag) => ({ tag })) } : undefined,
          serviceItems:
            serviceItemsInput.length > 0
              ? {
                  create: serviceItemsInput.map((it, idx) => ({
                    serviceId: it.serviceId ?? null,
                    priceCents: it.priceCents,
                    nameSnapshot: it.nameSnapshot ?? null,
                    orderIndex: idx,
                  })),
                }
              : undefined,
        },
        include: {
          tags: true,
          serviceItems: { orderBy: { orderIndex: 'asc' } },
        },
      });

      const series = await tx.recurringSeries.create({
        data: {
          organizationId: orgId,
          sourceJobId: sourceJob.id,
          recurrenceFrequency: body.recurrence.recurrenceFrequency,
          recurrenceInterval: body.recurrence.recurrenceInterval,
          recurrenceEndMode: body.recurrence.recurrenceEndMode,
          recurrenceOccurrenceCount: body.recurrence.recurrenceOccurrenceCount ?? null,
          recurrenceEndDate: body.recurrence.recurrenceEndDate
            ? new Date(body.recurrence.recurrenceEndDate)
            : null,
          recurrenceDayOfWeek: body.recurrence.recurrenceDayOfWeek ?? [],
          recurrenceDayOfMonth: body.recurrence.recurrenceDayOfMonth ?? null,
          recurrenceOrdinal: body.recurrence.recurrenceOrdinal ?? null,
          recurrenceMonthOfYear: body.recurrence.recurrenceMonthOfYear ?? null,
        },
      });

      await tx.job.update({
        where: { id: sourceJob.id },
        data: {
          recurringSeriesId: series.id,
          occurrenceIndex: 1,
          generatedFromRuleVersion: 1,
        },
      });

      const pivot: PivotJob = {
        id: sourceJob.id,
        customerId: sourceJob.customerId,
        customerAddressId: sourceJob.customerAddressId,
        serviceId: sourceJob.serviceId,
        titleOrSummary: sourceJob.titleOrSummary,
        priceCents: sourceJob.priceCents,
        leadSource: sourceJob.leadSource,
        privateNotes: sourceJob.privateNotes,
        assigneeTeamMemberId: sourceJob.assigneeTeamMemberId,
        scheduledStartAt: sourceJob.scheduledStartAt as Date,
        scheduledEndAt: sourceJob.scheduledEndAt as Date,
        tags: sourceJob.tags,
        serviceItems: sourceJob.serviceItems.map((it) => ({
          serviceId: it.serviceId,
          priceCents: it.priceCents,
          nameSnapshot: it.nameSnapshot,
          orderIndex: it.orderIndex,
        })),
      };

      const generatedCount = await materializeTail(tx, orgId, series, pivot, 2, 1);

      const noteMappings = body.job.noteOps && body.job.noteOps.length > 0
        ? await processNoteOps({
            tx,
            orgId,
            jobId: sourceJob.id,
            customerId: body.customerId,
            authorUserId: actorUserId,
            recurringSeriesId: series.id,
            occurrenceIndex: 1,
            scope: 'this_and_future',
            noteOps: body.job.noteOps,
          })
        : [];

      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'recurring_series',
        entityId: series.id,
        action: 'create',
      });

      return { sourceJobId: sourceJob.id, seriesId: series.id, generatedCount, noteMappings };
    });

    return reply.status(201).send({
      item: {
        sourceJobId: result.sourceJobId,
        seriesId: result.seriesId,
        generatedCount: result.generatedCount,
      },
      noteMappings: result.noteMappings,
    });
  });

  // ── Get series detail ────────────────────────────────────────────────
  fastify.get('/api/recurring-series/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const series = await prisma.recurringSeries.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!series)
      throw new ApiError(ERROR_CODES.SERIES_NOT_FOUND, 404, 'Recurring series not found');

    const occurrences = await prisma.job.findMany({
      where: {
        recurringSeriesId: id,
        organizationId: orgId,
        deletedFromSeriesAt: null,
      },
      orderBy: { occurrenceIndex: 'asc' },
      select: {
        id: true,
        jobNumber: true,
        occurrenceIndex: true,
        isExceptionInstance: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        assigneeTeamMemberId: true,
        jobStage: true,
        titleOrSummary: true,
        priceCents: true,
      },
    });

    return reply.send({
      item: {
        id: series.id,
        recurrenceFrequency: series.recurrenceFrequency,
        recurrenceInterval: series.recurrenceInterval,
        recurrenceEndMode: series.recurrenceEndMode,
        recurrenceOccurrenceCount: series.recurrenceOccurrenceCount,
        recurrenceEndDate: series.recurrenceEndDate?.toISOString().slice(0, 10) ?? null,
        recurrenceDayOfWeek: series.recurrenceDayOfWeek,
        recurrenceDayOfMonth: series.recurrenceDayOfMonth,
        recurrenceOrdinal: series.recurrenceOrdinal,
        recurrenceMonthOfYear: series.recurrenceMonthOfYear,
        recurrenceEnabled: series.recurrenceEnabled,
        recurrenceRuleVersion: series.recurrenceRuleVersion,
        materializationHorizonUntil: series.materializationHorizonUntil?.toISOString() ?? null,
        occurrences: occurrences.map((o) => ({
          id: o.id,
          jobNumber: o.jobNumber,
          occurrenceIndex: o.occurrenceIndex,
          isExceptionInstance: o.isExceptionInstance,
          scheduledStartAt: o.scheduledStartAt?.toISOString() ?? null,
          scheduledEndAt: o.scheduledEndAt?.toISOString() ?? null,
          assigneeTeamMemberId: o.assigneeTeamMemberId,
          jobStage: o.jobStage,
          titleOrSummary: o.titleOrSummary,
          priceCents: o.priceCents,
        })),
        totalOccurrences: occurrences.length,
      },
    });
  });

  // ── Get series for a job ─────────────────────────────────────────────
  fastify.get('/api/jobs/:id/series', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const job = await prisma.job.findFirst({
      where: { id, organizationId: orgId },
      select: { recurringSeriesId: true },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (!job.recurringSeriesId) {
      return reply.send({ item: null });
    }

    const series = await prisma.recurringSeries.findUnique({
      where: { id: job.recurringSeriesId },
    });

    return reply.send({
      item: series
        ? {
            id: series.id,
            recurrenceFrequency: series.recurrenceFrequency,
            recurrenceInterval: series.recurrenceInterval,
            recurrenceEndMode: series.recurrenceEndMode,
            recurrenceEnabled: series.recurrenceEnabled,
            recurrenceRuleVersion: series.recurrenceRuleVersion,
            recurrenceDayOfWeek: series.recurrenceDayOfWeek,
            recurrenceOccurrenceCount: series.recurrenceOccurrenceCount,
            recurrenceEndDate: series.recurrenceEndDate,
            recurrenceDayOfMonth: series.recurrenceDayOfMonth,
            recurrenceOrdinal: series.recurrenceOrdinal,
            recurrenceMonthOfYear: series.recurrenceMonthOfYear,
          }
        : null,
    });
  });

  // ── Occurrence edit ──────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/occurrence-edit', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = occurrenceEditRequestSchema.parse(req.body);

    const job = await prisma.job.findFirst({
      where: { id, organizationId: orgId },
      include: { tags: true, invoice: { select: { id: true } } },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (!job.recurringSeriesId) {
      throw new ApiError(ERROR_CODES.NOT_RECURRING, 400, 'Job is not part of a recurring series');
    }
    if (job.deletedFromSeriesAt) {
      throw new ApiError(ERROR_CODES.OCCURRENCE_DELETED, 400, 'Cannot mutate a deleted occurrence');
    }
    if (job.jobStage === 'job_done' && job.invoice) {
      throw new ApiError(
        ERROR_CODES.FINISHED_OCCURRENCE_IMMUTABLE,
        400,
        'Cannot edit a finished occurrence with an invoice',
      );
    }

    // Validate changes
    const changes = body.changes;
    if (changes.customerAddressId) {
      await validateAddressOwnership(job.customerId, changes.customerAddressId, orgId);
    }
    if (changes.assigneeTeamMemberId) {
      await validateAssignee(changes.assigneeTeamMemberId, orgId);
    }

    // Cross-validate schedule range
    const effectiveStart = changes.scheduledStartAt
      ? new Date(changes.scheduledStartAt)
      : job.scheduledStartAt;
    const effectiveEnd = changes.scheduledEndAt
      ? new Date(changes.scheduledEndAt)
      : job.scheduledEndAt;
    if (
      (changes.scheduledStartAt || changes.scheduledEndAt) &&
      effectiveStart &&
      effectiveEnd &&
      effectiveEnd.getTime() <= effectiveStart.getTime()
    ) {
      throw new ApiError(ERROR_CODES.INVALID_DATE_RANGE, 400, 'End must be after start');
    }

    const servicesChanging = changes.services !== undefined;
    let servicesInput: JobServiceItemInput[] = [];
    let derivedTotals: { totalCents: number; primaryServiceId: string | null } | null = null;
    if (servicesChanging) {
      servicesInput = normalizeServiceItems({
        services: (changes.services as JobServiceItemInput[] | null | undefined) ?? null,
        serviceId: null,
        priceCents: 0,
      });
      await validateServiceIds(servicesInput, orgId);
      derivedTotals = deriveJobTotals(servicesInput);
    }
    const servicesWrite = servicesChanging
      ? {
          serviceItems: {
            deleteMany: {},
            create: servicesInput.map((it, idx) => ({
              serviceId: it.serviceId ?? null,
              priceCents: it.priceCents,
              nameSnapshot: it.nameSnapshot ?? null,
              orderIndex: idx,
            })),
          },
        }
      : undefined;

    if (body.scope === 'this') {
      // scope=this: update only this occurrence, mark as exception
      const data = buildJobUpdateData(changes, derivedTotals);
      data.isExceptionInstance = true;

      const tags = changes.tags ? dedupeTags(changes.tags) : undefined;

      const { updated, noteMappings } = await prisma.$transaction(async (tx) => {
        const updated = await tx.job.update({
          where: { id },
          data: {
            ...data,
            ...(tags ? { tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) } } : {}),
            ...(servicesWrite ?? {}),
          },
        });

        const noteMappings =
          body.noteOps && body.noteOps.length > 0
            ? await processNoteOps({
                tx,
                orgId,
                jobId: id,
                customerId: job.customerId,
                authorUserId: req.auth!.sub,
                recurringSeriesId: job.recurringSeriesId,
                occurrenceIndex: job.occurrenceIndex,
                scope: 'this',
                noteOps: body.noteOps,
              })
            : [];

        return { updated, noteMappings };
      });

      return reply.send({ item: { id: updated.id, scope: 'this', noteMappings } });
    }

    // scope=this_and_future
    const series = await prisma.recurringSeries.findUnique({
      where: { id: job.recurringSeriesId },
    });
    if (!series) throw new ApiError(ERROR_CODES.SERIES_NOT_FOUND, 404, 'Series not found');

    const nextRuleVersion = series.recurrenceRuleVersion + 1;
    const hasNewRule = !!body.recurrenceRule;
    // Compare at minute precision — the client's datetime-local input drops
    // sub-minute bits, so a round-tripped unchanged value would otherwise look
    // mutated and trigger rematerialization that wipes replicated notes.
    const toMinute = (d: Date) => Math.floor(d.getTime() / 60000);
    const startChanged =
      changes.scheduledStartAt !== undefined &&
      toMinute(new Date(changes.scheduledStartAt)) !== toMinute(job.scheduledStartAt);
    const endChanged =
      changes.scheduledEndAt !== undefined &&
      job.scheduledEndAt !== null &&
      toMinute(new Date(changes.scheduledEndAt)) !== toMinute(job.scheduledEndAt);
    const hasScheduleMutation = startChanged || endChanged;
    const requiresRematerialization = hasNewRule || hasScheduleMutation;

    const result = await prisma.$transaction(async (tx) => {
      // Update series rule
      const ruleUpdate: Prisma.RecurringSeriesUpdateInput = {
        recurrenceRuleVersion: nextRuleVersion,
      };
      if (hasNewRule) {
        const nr = body.recurrenceRule;
        if (nr) {
          ruleUpdate.recurrenceFrequency = nr.recurrenceFrequency;
          ruleUpdate.recurrenceInterval = nr.recurrenceInterval;
          ruleUpdate.recurrenceEndMode = nr.recurrenceEndMode;
          ruleUpdate.recurrenceOccurrenceCount = nr.recurrenceOccurrenceCount ?? null;
          ruleUpdate.recurrenceEndDate = nr.recurrenceEndDate
            ? new Date(nr.recurrenceEndDate)
            : null;
          ruleUpdate.recurrenceDayOfWeek = nr.recurrenceDayOfWeek ?? [];
          ruleUpdate.recurrenceDayOfMonth = nr.recurrenceDayOfMonth ?? null;
          ruleUpdate.recurrenceOrdinal = nr.recurrenceOrdinal ?? null;
          ruleUpdate.recurrenceMonthOfYear = nr.recurrenceMonthOfYear ?? null;
        }
      }

      await tx.recurringSeries.update({ where: { id: series.id }, data: ruleUpdate });

      // Update pivot occurrence
      const pivotData = buildJobUpdateData(changes, derivedTotals);
      pivotData.generatedFromRuleVersion = nextRuleVersion;
      pivotData.isExceptionInstance = false;

      // When the recurrence rule changes but no explicit date was provided, realign the pivot
      // to the first occurrence of the new rule. E.g. if user changes TUE→WED without touching
      // the date field, the Tue Mar 12 occurrence must move to Wed Mar 13, not stay behind.
      if (hasNewRule && !changes.scheduledStartAt && body.recurrenceRule) {
        const nr = body.recurrenceRule;
        const newRule: RecurrenceRule = {
          recurrenceFrequency: nr.recurrenceFrequency as RecurrenceRule['recurrenceFrequency'],
          recurrenceInterval: nr.recurrenceInterval,
          recurrenceEndMode: nr.recurrenceEndMode as RecurrenceRule['recurrenceEndMode'],
          recurrenceOccurrenceCount: nr.recurrenceOccurrenceCount ?? null,
          recurrenceEndDate: nr.recurrenceEndDate ?? null,
          recurrenceDayOfWeek: (nr.recurrenceDayOfWeek?.length
            ? nr.recurrenceDayOfWeek
            : null) as RecurrenceRule['recurrenceDayOfWeek'],
          recurrenceDayOfMonth: nr.recurrenceDayOfMonth ?? null,
          recurrenceOrdinal: nr.recurrenceOrdinal as RecurrenceRule['recurrenceOrdinal'],
          recurrenceMonthOfYear:
            nr.recurrenceMonthOfYear as RecurrenceRule['recurrenceMonthOfYear'],
        };
        const pivotLocalDate = new Date(
          job.scheduledStartAt.getFullYear(),
          job.scheduledStartAt.getMonth(),
          job.scheduledStartAt.getDate(),
        );
        const firstOccurrences = generateOccurrenceDates(
          newRule,
          pivotLocalDate,
          1,
          computeHorizonDate(newRule),
          0,
        );
        const firstDate = firstOccurrences[0];
        if (firstDate && firstDate.getTime() !== pivotLocalDate.getTime()) {
          const durationMs =
            (job.scheduledEndAt?.getTime() ?? 0) - job.scheduledStartAt.getTime();
          const newStart = new Date(firstDate);
          newStart.setHours(
            job.scheduledStartAt.getHours(),
            job.scheduledStartAt.getMinutes(),
            job.scheduledStartAt.getSeconds(),
            job.scheduledStartAt.getMilliseconds(),
          );
          pivotData.scheduledStartAt = newStart;
          pivotData.scheduledEndAt = new Date(newStart.getTime() + durationMs);
        }
      }

      const tags = changes.tags ? dedupeTags(changes.tags) : undefined;
      const updatedPivot = await tx.job.update({
        where: { id },
        data: {
          ...pivotData,
          ...(tags ? { tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) } } : {}),
          ...(servicesWrite ?? {}),
        },
        include: {
          tags: true,
          serviceItems: { orderBy: { orderIndex: 'asc' } },
        },
      });

      // Note: processNoteOps runs AFTER any tail archive/rematerialization below,
      // so replicated notes attach to the freshly regenerated occurrences rather
      // than to rows that are about to be soft-deleted.
      const runNoteOps = async () =>
        body.noteOps && body.noteOps.length > 0
          ? await processNoteOps({
              tx,
              orgId,
              jobId: id,
              customerId: job.customerId,
              authorUserId: req.auth!.sub,
              recurringSeriesId: job.recurringSeriesId,
              occurrenceIndex: job.occurrenceIndex,
              scope: 'this_and_future',
              noteOps: body.noteOps,
            })
          : [];

      if (requiresRematerialization) {
        // Capture tail job IDs BEFORE archival so materializeTail can still
        // find and carry forward notes that live on soon-to-be-tombstoned
        // rows (which its default pivot-only lookup would miss).
        const oldTailJobs = await tx.job.findMany({
          where: {
            recurringSeriesId: series.id,
            occurrenceIndex: { gt: job.occurrenceIndex ?? 0 },
            deletedFromSeriesAt: null,
          },
          select: { id: true },
        });

        // Archive tail (soft-delete occurrences after pivot)
        await tx.job.updateMany({
          where: {
            recurringSeriesId: series.id,
            occurrenceIndex: { gt: job.occurrenceIndex ?? 0 },
            deletedFromSeriesAt: null,
          },
          data: { deletedFromSeriesAt: new Date(), isExceptionInstance: false },
        });

        // Re-fetch the updated series for correct rule
        const updatedSeries = await tx.recurringSeries.findUniqueOrThrow({
          where: { id: series.id },
        });

        const pivot: PivotJob = {
          id: updatedPivot.id,
          customerId: updatedPivot.customerId,
          customerAddressId: updatedPivot.customerAddressId,
          serviceId: updatedPivot.serviceId,
          titleOrSummary: updatedPivot.titleOrSummary,
          priceCents: updatedPivot.priceCents,
          leadSource: updatedPivot.leadSource,
          privateNotes: updatedPivot.privateNotes,
          assigneeTeamMemberId: updatedPivot.assigneeTeamMemberId,
          scheduledStartAt: updatedPivot.scheduledStartAt as Date,
          scheduledEndAt: updatedPivot.scheduledEndAt as Date,
          tags: updatedPivot.tags,
          serviceItems: updatedPivot.serviceItems.map((it) => ({
            serviceId: it.serviceId,
            priceCents: it.priceCents,
            nameSnapshot: it.nameSnapshot,
            orderIndex: it.orderIndex,
          })),
        };

        const generatedCount = await materializeTail(
          tx,
          orgId,
          updatedSeries,
          pivot,
          (job.occurrenceIndex ?? 1) + 1,
          nextRuleVersion,
          undefined,
          [pivot.id, ...oldTailJobs.map((j) => j.id)],
        );

        const noteMappings = await runNoteOps();
        return { regeneratedCount: generatedCount, noteMappings };
      }

      // Non-schedule change: copy changes to all future non-exception occurrences
      const futureData = buildJobUpdateData(changes, derivedTotals);
      futureData.generatedFromRuleVersion = nextRuleVersion;
      futureData.isExceptionInstance = false;

      // For tags or services replacement, need per-row updates (relation writes)
      if (tags || servicesChanging) {
        const futureJobs = await tx.job.findMany({
          where: {
            recurringSeriesId: series.id,
            occurrenceIndex: { gt: job.occurrenceIndex ?? 0 },
            deletedFromSeriesAt: null,
          },
          select: { id: true },
        });

        for (const fj of futureJobs) {
          await tx.job.update({
            where: { id: fj.id },
            data: {
              ...futureData,
              ...(tags
                ? { tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) } }
                : {}),
              ...(servicesWrite ?? {}),
            },
          });
        }

        const noteMappings = await runNoteOps();
        return { updatedFutureCount: futureJobs.length, noteMappings };
      }

      const updateResult = await tx.job.updateMany({
        where: {
          recurringSeriesId: series.id,
          occurrenceIndex: { gt: job.occurrenceIndex ?? 0 },
          deletedFromSeriesAt: null,
        },
        data: futureData,
      });

      const noteMappings = await runNoteOps();
      return { updatedFutureCount: updateResult.count, noteMappings };
    });

    return reply.send({ item: { id, scope: 'this_and_future', ...result } });
  });

  // ── Occurrence delete ────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/occurrence-delete', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = occurrenceDeleteRequestSchema.parse(req.body);

    const job = await prisma.job.findFirst({
      where: { id, organizationId: orgId },
      include: { invoice: { select: { id: true } } },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (!job.recurringSeriesId) {
      throw new ApiError(ERROR_CODES.NOT_RECURRING, 400, 'Job is not part of a recurring series');
    }
    if (job.deletedFromSeriesAt) {
      throw new ApiError(ERROR_CODES.OCCURRENCE_DELETED, 400, 'Occurrence already deleted');
    }

    if (body.scope === 'this') {
      if (job.jobStage === 'job_done' && job.invoice) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          400,
          `Job #${job.jobNumber} cannot be deleted because it is marked as done`,
        );
      }
      await prisma.job.update({
        where: { id },
        data: { deletedFromSeriesAt: new Date(), isExceptionInstance: false },
      });
      return reply.send({ item: { id, scope: 'this', deletedCount: 1, skippedJobs: [] } });
    }

    // scope=this_and_future
    const result = await prisma.$transaction(async (tx) => {
      const rangeJobs = await tx.job.findMany({
        where: {
          recurringSeriesId: job.recurringSeriesId,
          occurrenceIndex: { gte: job.occurrenceIndex ?? 0 },
          deletedFromSeriesAt: null,
        },
        select: {
          id: true,
          jobNumber: true,
          jobStage: true,
          invoice: { select: { id: true } },
        },
      });

      const skippedJobs = rangeJobs
        .filter((j) => j.jobStage === 'job_done' && j.invoice)
        .map((j) => ({ id: j.id, jobNumber: j.jobNumber }));
      const deletableIds = rangeJobs
        .filter((j) => !(j.jobStage === 'job_done' && j.invoice))
        .map((j) => j.id);

      const updateResult = await tx.job.updateMany({
        where: { id: { in: deletableIds } },
        data: { deletedFromSeriesAt: new Date(), isExceptionInstance: false },
      });

      await tx.recurringSeries.update({
        where: { id: job.recurringSeriesId as string },
        data: { recurrenceEnabled: false },
      });

      return { deletedCount: updateResult.count, skippedJobs };
    });

    return reply.send({
      item: {
        id,
        scope: 'this_and_future',
        deletedCount: result.deletedCount,
        skippedJobs: result.skippedJobs,
      },
    });
  });

  // ── Extend horizons (cron endpoint) ──────────────────────────────────
  fastify.post('/api/recurring-series/extend-horizons', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;

    const activeSeries = await prisma.recurringSeries.findMany({
      where: { organizationId: orgId, recurrenceEnabled: true },
    });

    let totalGenerated = 0;

    for (const series of activeSeries) {
      const rule = seriesToRule(series);
      const newHorizon = computeHorizonDate(rule);

      // Skip if current horizon is still ahead
      if (series.materializationHorizonUntil && series.materializationHorizonUntil >= newHorizon) {
        continue;
      }

      // Find the last non-deleted occurrence to use as the reference
      const lastOccurrence = await prisma.job.findFirst({
        where: {
          recurringSeriesId: series.id,
          deletedFromSeriesAt: null,
        },
        orderBy: { occurrenceIndex: 'desc' },
        include: {
          tags: true,
          serviceItems: { orderBy: { orderIndex: 'asc' } },
        },
      });
      if (!lastOccurrence || !lastOccurrence.scheduledStartAt || !lastOccurrence.scheduledEndAt) {
        continue;
      }

      const generated = await prisma.$transaction(async (tx) => {
        const pivot: PivotJob = {
          id: lastOccurrence.id,
          customerId: lastOccurrence.customerId,
          customerAddressId: lastOccurrence.customerAddressId,
          serviceId: lastOccurrence.serviceId,
          titleOrSummary: lastOccurrence.titleOrSummary,
          priceCents: lastOccurrence.priceCents,
          leadSource: lastOccurrence.leadSource,
          privateNotes: lastOccurrence.privateNotes,
          assigneeTeamMemberId: lastOccurrence.assigneeTeamMemberId,
          scheduledStartAt: lastOccurrence.scheduledStartAt as Date,
          scheduledEndAt: lastOccurrence.scheduledEndAt as Date,
          tags: lastOccurrence.tags,
          serviceItems: lastOccurrence.serviceItems.map((it) => ({
            serviceId: it.serviceId,
            priceCents: it.priceCents,
            nameSnapshot: it.nameSnapshot,
            orderIndex: it.orderIndex,
          })),
        };

        return materializeTail(
          tx,
          orgId,
          series,
          pivot,
          (lastOccurrence.occurrenceIndex ?? 1) + 1,
          series.recurrenceRuleVersion,
        );
      });

      totalGenerated += generated;
    }

    return reply.send({ item: { extended: activeSeries.length, generated: totalGenerated } });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildJobUpdateData(
  changes: Record<string, unknown>,
  servicesOverride?: { totalCents: number; primaryServiceId: string | null } | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (changes.customerAddressId !== undefined) data.customerAddressId = changes.customerAddressId;
  if (changes.titleOrSummary !== undefined) data.titleOrSummary = changes.titleOrSummary;
  if (changes.leadSource !== undefined) data.leadSource = changes.leadSource;
  if (changes.privateNotes !== undefined) data.privateNotes = changes.privateNotes;
  if (changes.scheduledStartAt !== undefined) {
    data.scheduledStartAt = new Date(changes.scheduledStartAt as string);
  }
  if (changes.scheduledEndAt !== undefined) {
    data.scheduledEndAt = new Date(changes.scheduledEndAt as string);
  }
  if (changes.assigneeTeamMemberId !== undefined) {
    data.assigneeTeamMemberId = changes.assigneeTeamMemberId;
  }
  if (servicesOverride) {
    data.serviceId = servicesOverride.primaryServiceId;
    data.priceCents = servicesOverride.totalCents;
  } else {
    if (changes.serviceId !== undefined) data.serviceId = changes.serviceId;
    if (changes.priceCents !== undefined) data.priceCents = changes.priceCents;
  }
  return data;
}
