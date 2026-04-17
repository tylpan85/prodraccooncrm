import { prisma } from '@openclaw/db';
import { ERROR_CODES } from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

// ---------------------------------------------------------------------------
// Shared lane type
// ---------------------------------------------------------------------------

interface LaneDto {
  teamMemberId: string | null;
  displayName: string;
  color: string;
  jobs: JobBlock[];
  events: EventBlock[];
}

interface JobBlock {
  id: string;
  jobNumber: string;
  customerId: string;
  customerDisplayName: string;
  titleOrSummary: string | null;
  priceCents: number;
  scheduledStartAt: string;
  scheduledEndAt: string;
  jobStatus: string;
  assigneeTeamMemberId: string | null;
  recurringSeriesId: string | null;
}

interface EventBlock {
  id: string;
  name: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  assigneeTeamMemberId: string | null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function scheduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── Day view ──────────────────────────────────────────────────────────
  fastify.get('/api/schedule/day', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const query = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD') })
      .parse(req.query);

    const orgId = req.auth.orgId;
    const dayStart = new Date(`${query.date}T00:00:00.000Z`);
    const dayEnd = new Date(`${query.date}T23:59:59.999Z`);

    // Fetch all active team members for lanes
    const teamMembers = await prisma.teamMember.findMany({
      where: { organizationId: orgId, activeOnSchedule: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, color: true },
    });

    // Fetch jobs scheduled on this day (not soft-deleted)
    const jobs = await prisma.job.findMany({
      where: {
        organizationId: orgId,
        scheduleState: 'scheduled',
        scheduledStartAt: { lte: dayEnd },
        scheduledEndAt: { gte: dayStart },
        deletedFromSeriesAt: null,
      },
      include: {
        customer: { select: { displayName: true } },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });

    // Fetch events on this day
    const events = await prisma.event.findMany({
      where: {
        organizationId: orgId,
        scheduledStartAt: { lte: dayEnd },
        scheduledEndAt: { gte: dayStart },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });

    // Build lane map
    const laneMap = new Map<string | null, LaneDto>();

    // Unassigned lane first
    laneMap.set(null, {
      teamMemberId: null,
      displayName: 'Unassigned',
      color: '#6b7280',
      jobs: [],
      events: [],
    });

    // Team member lanes
    for (const tm of teamMembers) {
      laneMap.set(tm.id, {
        teamMemberId: tm.id,
        displayName: tm.displayName,
        color: tm.color,
        jobs: [],
        events: [],
      });
    }

    // Place jobs into lanes
    for (const j of jobs) {
      const laneKey = j.assigneeTeamMemberId;
      let lane = laneMap.get(laneKey);
      if (!lane) {
        // Assigned to an inactive member — put in unassigned
        lane = laneMap.get(null);
      }
      lane?.jobs.push({
        id: j.id,
        jobNumber: j.jobNumber,
        customerId: j.customerId,
        customerDisplayName: j.customer.displayName,
        titleOrSummary: j.titleOrSummary,
        priceCents: j.priceCents,
        scheduledStartAt: j.scheduledStartAt!.toISOString(),
        scheduledEndAt: j.scheduledEndAt!.toISOString(),
        jobStatus: j.jobStatus,
        assigneeTeamMemberId: j.assigneeTeamMemberId,
        recurringSeriesId: j.recurringSeriesId,
      });
    }

    // Place events into lanes
    for (const e of events) {
      const laneKey = e.assigneeTeamMemberId;
      let lane = laneMap.get(laneKey);
      if (!lane) {
        lane = laneMap.get(null);
      }
      lane?.events.push({
        id: e.id,
        name: e.name,
        scheduledStartAt: e.scheduledStartAt.toISOString(),
        scheduledEndAt: e.scheduledEndAt.toISOString(),
        assigneeTeamMemberId: e.assigneeTeamMemberId,
      });
    }

    // Build ordered lanes array: Unassigned first, then alphabetical
    const lanes: LaneDto[] = [];
    const unassigned = laneMap.get(null);
    if (unassigned) lanes.push(unassigned);
    for (const tm of teamMembers) {
      const lane = laneMap.get(tm.id);
      if (lane) lanes.push(lane);
    }

    return reply.send({ date: query.date, lanes });
  });

  // ── Range view (month) ────────────────────────────────────────────────
  fastify.get('/api/schedule/range', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const query = z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);

    const orgId = req.auth.orgId;
    const rangeStart = new Date(`${query.startDate}T00:00:00.000Z`);
    const rangeEnd = new Date(`${query.endDate}T23:59:59.999Z`);

    // Validate range ≤ 42 days
    const daysDiff = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 42) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'Range must be ≤ 42 days');
    }

    const teamMembers = await prisma.teamMember.findMany({
      where: { organizationId: orgId, activeOnSchedule: true },
      select: { id: true, displayName: true, color: true },
    });

    const jobs = await prisma.job.findMany({
      where: {
        organizationId: orgId,
        scheduleState: 'scheduled',
        scheduledStartAt: { lte: rangeEnd },
        scheduledEndAt: { gte: rangeStart },
        deletedFromSeriesAt: null,
      },
      include: { customer: { select: { displayName: true } } },
      orderBy: { scheduledStartAt: 'asc' },
    });

    const events = await prisma.event.findMany({
      where: {
        organizationId: orgId,
        scheduledStartAt: { lte: rangeEnd },
        scheduledEndAt: { gte: rangeStart },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });

    // Build a color map for team members
    const tmColorMap = new Map<string, { displayName: string; color: string }>();
    for (const tm of teamMembers) {
      tmColorMap.set(tm.id, { displayName: tm.displayName, color: tm.color });
    }

    // Bucket by date (YYYY-MM-DD of scheduledStartAt)
    const days = new Map<
      string,
      {
        jobs: Array<JobBlock & { assigneeColor: string }>;
        events: EventBlock[];
      }
    >();

    for (const j of jobs) {
      const dateKey = j.scheduledStartAt!.toISOString().slice(0, 10);
      if (!days.has(dateKey)) days.set(dateKey, { jobs: [], events: [] });
      const tm = j.assigneeTeamMemberId ? tmColorMap.get(j.assigneeTeamMemberId) : null;
      days.get(dateKey)!.jobs.push({
        id: j.id,
        jobNumber: j.jobNumber,
        customerId: j.customerId,
        customerDisplayName: j.customer.displayName,
        titleOrSummary: j.titleOrSummary,
        priceCents: j.priceCents,
        scheduledStartAt: j.scheduledStartAt!.toISOString(),
        scheduledEndAt: j.scheduledEndAt!.toISOString(),
        jobStatus: j.jobStatus,
        assigneeTeamMemberId: j.assigneeTeamMemberId,
        recurringSeriesId: j.recurringSeriesId,
        assigneeColor: tm?.color ?? '#6b7280',
      });
    }

    for (const e of events) {
      const dateKey = e.scheduledStartAt.toISOString().slice(0, 10);
      if (!days.has(dateKey)) days.set(dateKey, { jobs: [], events: [] });
      days.get(dateKey)!.events.push({
        id: e.id,
        name: e.name,
        scheduledStartAt: e.scheduledStartAt.toISOString(),
        scheduledEndAt: e.scheduledEndAt.toISOString(),
        assigneeTeamMemberId: e.assigneeTeamMemberId,
      });
    }

    return reply.send({
      startDate: query.startDate,
      endDate: query.endDate,
      days: Object.fromEntries(days),
    });
  });
}
