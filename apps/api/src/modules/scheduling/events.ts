import { prisma } from '@openclaw/db';
import { ERROR_CODES, createEventRequestSchema, updateEventRequestSchema } from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventDto(e: {
  id: string;
  organizationId: string;
  name: string | null;
  note: string | null;
  location: string | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  assigneeTeamMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignee?: { displayName: string } | null;
}) {
  return {
    id: e.id,
    organizationId: e.organizationId,
    name: e.name,
    note: e.note,
    location: e.location,
    scheduledStartAt: e.scheduledStartAt.toISOString(),
    scheduledEndAt: e.scheduledEndAt.toISOString(),
    assigneeTeamMemberId: e.assigneeTeamMemberId,
    assigneeDisplayName: e.assignee?.displayName ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function eventsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── Create event ────────────────────────────────────────────────────
  fastify.post('/api/events', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const body = createEventRequestSchema.parse(req.body);

    // Validate assignee if provided
    if (body.assigneeTeamMemberId) {
      const tm = await prisma.teamMember.findFirst({
        where: {
          id: body.assigneeTeamMemberId,
          organizationId: orgId,
          activeOnSchedule: true,
        },
      });
      if (!tm) throw new ApiError(ERROR_CODES.INVALID_ASSIGNEE, 400, 'Assignee not active');
    }

    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: body.name ?? null,
        note: body.note ?? null,
        location: body.location ?? null,
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        assigneeTeamMemberId: body.assigneeTeamMemberId ?? null,
      },
      include: { assignee: { select: { displayName: true } } },
    });

    return reply.status(201).send({ item: eventDto(event) });
  });

  // ── List events ─────────────────────────────────────────────────────
  fastify.get('/api/events', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;

    const events = await prisma.event.findMany({
      where: { organizationId: orgId },
      include: { assignee: { select: { displayName: true } } },
      orderBy: { scheduledStartAt: 'desc' },
      take: 100,
    });

    return reply.send({ items: events.map(eventDto) });
  });

  // ── Get event ───────────────────────────────────────────────────────
  fastify.get('/api/events/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const { id } = req.params as { id: string };

    const event = await prisma.event.findFirst({
      where: { id, organizationId: orgId },
      include: { assignee: { select: { displayName: true } } },
    });

    if (!event) throw new ApiError(ERROR_CODES.EVENT_NOT_FOUND, 404, 'Event not found');
    return reply.send({ item: eventDto(event) });
  });

  // ── Update event ────────────────────────────────────────────────────
  fastify.patch('/api/events/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const { id } = req.params as { id: string };
    const body = updateEventRequestSchema.parse(req.body);

    const existing = await prisma.event.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.EVENT_NOT_FOUND, 404, 'Event not found');

    // Validate assignee if changing
    if (body.assigneeTeamMemberId !== undefined && body.assigneeTeamMemberId !== null) {
      const tm = await prisma.teamMember.findFirst({
        where: {
          id: body.assigneeTeamMemberId,
          organizationId: orgId,
          activeOnSchedule: true,
        },
      });
      if (!tm) throw new ApiError(ERROR_CODES.INVALID_ASSIGNEE, 400, 'Assignee not active');
    }

    // Cross-validate start/end
    const newStart = body.scheduledStartAt
      ? new Date(body.scheduledStartAt)
      : existing.scheduledStartAt;
    const newEnd = body.scheduledEndAt ? new Date(body.scheduledEndAt) : existing.scheduledEndAt;
    if (newEnd.getTime() <= newStart.getTime()) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'End must be after start');
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.note !== undefined) data.note = body.note;
    if (body.location !== undefined) data.location = body.location;
    if (body.scheduledStartAt) data.scheduledStartAt = newStart;
    if (body.scheduledEndAt) data.scheduledEndAt = newEnd;
    if (body.assigneeTeamMemberId !== undefined) {
      data.assigneeTeamMemberId = body.assigneeTeamMemberId;
    }

    const event = await prisma.event.update({
      where: { id },
      data,
      include: { assignee: { select: { displayName: true } } },
    });

    return reply.send({ item: eventDto(event) });
  });

  // ── Delete event ────────────────────────────────────────────────────
  fastify.delete('/api/events/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const { id } = req.params as { id: string };

    const existing = await prisma.event.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.EVENT_NOT_FOUND, 404, 'Event not found');

    await prisma.event.delete({ where: { id } });
    return reply.send({ item: { id } });
  });
}
