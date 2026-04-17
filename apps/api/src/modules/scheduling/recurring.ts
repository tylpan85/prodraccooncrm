import { type Prisma, type PrismaClient, prisma } from '@openclaw/db';
import {
  type RecurrenceRule,
  computeHorizonDate,
  generateOccurrenceDates,
} from '@openclaw/recurrence';
import {
  ERROR_CODES,
  attachRecurrenceRequestSchema,
  createRecurringJobRequestSchema,
  occurrenceDeleteRequestSchema,
  occurrenceEditRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

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
}

async function materializeTail(
  tx: Tx,
  orgId: string,
  series: SeriesRow,
  pivot: PivotJob,
  startingIndex: number,
  ruleVersion: number,
): Promise<number> {
  const rule = seriesToRule(series);
  const anchorDate = new Date(
    pivot.scheduledStartAt.getFullYear(),
    pivot.scheduledStartAt.getMonth(),
    pivot.scheduledStartAt.getDate(),
  );
  const durationMs = pivot.scheduledEndAt.getTime() - pivot.scheduledStartAt.getTime();
  const horizon = computeHorizonDate(rule);

  // startIndex=1 skips the anchor date itself (occurrence 1 is the pivot)
  const dates = generateOccurrenceDates(rule, anchorDate, 1000, horizon, 1);

  let occurrenceIndex = startingIndex;
  const pivotTags = pivot.tags.map((t) => t.tag);

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

    await tx.job.create({
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
        scheduleState: 'scheduled',
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        assigneeTeamMemberId: pivot.assigneeTeamMemberId,
        recurringSeriesId: series.id,
        occurrenceIndex,
        generatedFromRuleVersion: ruleVersion,
        isExceptionInstance: false,
        tags: pivotTags.length > 0 ? { create: pivotTags.map((tag) => ({ tag })) } : undefined,
      },
    });

    occurrenceIndex++;
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
    const body = attachRecurrenceRequestSchema.parse(req.body);

    const job = await prisma.job.findFirst({
      where: { id, organizationId: orgId },
      include: { tags: true },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (job.recurringSeriesId) {
      throw new ApiError(
        ERROR_CODES.ALREADY_RECURRING,
        400,
        'Job is already part of a recurring series',
      );
    }
    if (job.scheduleState !== 'scheduled' || !job.scheduledStartAt || !job.scheduledEndAt) {
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
      };

      const generatedCount = await materializeTail(tx, orgId, series, pivot, 2, 1);

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

    const result = await prisma.$transaction(async (tx) => {
      const jobNumber = await nextJobNumber(orgId, tx);

      const sourceJob = await tx.job.create({
        data: {
          organizationId: orgId,
          jobNumber,
          customerId: body.customerId,
          customerAddressId: body.job.customerAddressId,
          serviceId: body.job.serviceId ?? null,
          titleOrSummary: body.job.titleOrSummary ?? null,
          priceCents: body.job.priceCents ?? 0,
          leadSource: body.job.leadSource ?? null,
          privateNotes: body.job.privateNotes ?? null,
          scheduleState: 'scheduled',
          scheduledStartAt: new Date(body.schedule.scheduledStartAt),
          scheduledEndAt: new Date(body.schedule.scheduledEndAt),
          assigneeTeamMemberId: body.schedule.assigneeTeamMemberId ?? null,
          tags: tags.length > 0 ? { create: tags.map((tag) => ({ tag })) } : undefined,
        },
        include: { tags: true },
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
      };

      const generatedCount = await materializeTail(tx, orgId, series, pivot, 2, 1);

      return { sourceJobId: sourceJob.id, seriesId: series.id, generatedCount };
    });

    return reply.status(201).send({
      item: {
        sourceJobId: result.sourceJobId,
        seriesId: result.seriesId,
        generatedCount: result.generatedCount,
      },
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
        jobStatus: true,
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
          jobStatus: o.jobStatus,
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
    if (job.jobStatus === 'finished' && job.invoice) {
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

    if (body.scope === 'this') {
      // scope=this: update only this occurrence, mark as exception
      const data = buildJobUpdateData(changes);
      data.isExceptionInstance = true;

      const tags = changes.tags ? dedupeTags(changes.tags) : undefined;
      const updated = await prisma.job.update({
        where: { id },
        data: {
          ...data,
          ...(tags ? { tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) } } : {}),
        },
      });

      return reply.send({ item: { id: updated.id, scope: 'this' } });
    }

    // scope=this_and_future
    const series = await prisma.recurringSeries.findUnique({
      where: { id: job.recurringSeriesId },
    });
    if (!series) throw new ApiError(ERROR_CODES.SERIES_NOT_FOUND, 404, 'Series not found');

    const nextRuleVersion = series.recurrenceRuleVersion + 1;
    const hasNewRule = !!body.recurrenceRule;
    const hasScheduleMutation =
      changes.scheduledStartAt !== undefined || changes.scheduledEndAt !== undefined;
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
      const pivotData = buildJobUpdateData(changes);
      pivotData.generatedFromRuleVersion = nextRuleVersion;
      pivotData.isExceptionInstance = false;

      const tags = changes.tags ? dedupeTags(changes.tags) : undefined;
      const updatedPivot = await tx.job.update({
        where: { id },
        data: {
          ...pivotData,
          ...(tags ? { tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) } } : {}),
        },
        include: { tags: true },
      });

      if (requiresRematerialization) {
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
        };

        const generatedCount = await materializeTail(
          tx,
          orgId,
          updatedSeries,
          pivot,
          (job.occurrenceIndex ?? 1) + 1,
          nextRuleVersion,
        );

        return { regeneratedCount: generatedCount };
      }

      // Non-schedule change: copy changes to all future non-exception occurrences
      const futureData = buildJobUpdateData(changes);
      futureData.generatedFromRuleVersion = nextRuleVersion;
      futureData.isExceptionInstance = false;

      // For tags, need per-row updates
      if (tags) {
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
              tags: { deleteMany: {}, create: tags.map((tag) => ({ tag })) },
            },
          });
        }

        return { updatedFutureCount: futureJobs.length };
      }

      const updateResult = await tx.job.updateMany({
        where: {
          recurringSeriesId: series.id,
          occurrenceIndex: { gt: job.occurrenceIndex ?? 0 },
          deletedFromSeriesAt: null,
        },
        data: futureData,
      });

      return { updatedFutureCount: updateResult.count };
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
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (!job.recurringSeriesId) {
      throw new ApiError(ERROR_CODES.NOT_RECURRING, 400, 'Job is not part of a recurring series');
    }
    if (job.deletedFromSeriesAt) {
      throw new ApiError(ERROR_CODES.OCCURRENCE_DELETED, 400, 'Occurrence already deleted');
    }

    if (body.scope === 'this') {
      await prisma.job.update({
        where: { id },
        data: { deletedFromSeriesAt: new Date(), isExceptionInstance: false },
      });
      return reply.send({ item: { id, scope: 'this', deletedCount: 1 } });
    }

    // scope=this_and_future
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.job.updateMany({
        where: {
          recurringSeriesId: job.recurringSeriesId,
          occurrenceIndex: { gte: job.occurrenceIndex ?? 0 },
          deletedFromSeriesAt: null,
        },
        data: { deletedFromSeriesAt: new Date(), isExceptionInstance: false },
      });

      await tx.recurringSeries.update({
        where: { id: job.recurringSeriesId as string },
        data: { recurrenceEnabled: false },
      });

      return { deletedCount: updateResult.count };
    });

    return reply.send({
      item: { id, scope: 'this_and_future', deletedCount: result.deletedCount },
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
        include: { tags: true },
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

function buildJobUpdateData(changes: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (changes.customerAddressId !== undefined) data.customerAddressId = changes.customerAddressId;
  if (changes.serviceId !== undefined) data.serviceId = changes.serviceId;
  if (changes.titleOrSummary !== undefined) data.titleOrSummary = changes.titleOrSummary;
  if (changes.priceCents !== undefined) data.priceCents = changes.priceCents;
  if (changes.leadSource !== undefined) data.leadSource = changes.leadSource;
  if (changes.privateNotes !== undefined) data.privateNotes = changes.privateNotes;
  if (changes.scheduledStartAt !== undefined) {
    data.scheduledStartAt = changes.scheduledStartAt
      ? new Date(changes.scheduledStartAt as string)
      : null;
    data.scheduleState = changes.scheduledStartAt ? 'scheduled' : 'unscheduled';
  }
  if (changes.scheduledEndAt !== undefined) {
    data.scheduledEndAt = changes.scheduledEndAt
      ? new Date(changes.scheduledEndAt as string)
      : null;
  }
  if (changes.assigneeTeamMemberId !== undefined) {
    data.assigneeTeamMemberId = changes.assigneeTeamMemberId;
  }
  return data;
}
