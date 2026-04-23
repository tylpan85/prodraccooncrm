import argon2 from 'argon2';
import { prisma } from '@openclaw/db';
import {
  ERROR_CODES,
  createLeadSourceRequestSchema,
  createServiceRequestSchema,
  createTeamMemberRequestSchema,
  createUserRequestSchema,
  isValidTimezone,
  updateLeadSourceRequestSchema,
  updateOrganizationProfileRequestSchema,
  updateServiceRequestSchema,
  updateTeamMemberRequestSchema,
  updateUserRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

function computeInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) {
    const word = parts[0] ?? '';
    return word.slice(0, 2).toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

function normalizeNullableInitials(
  initials: string | null | undefined,
  displayName: string,
): string {
  const trimmed = initials?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed.toUpperCase();
  }
  return computeInitials(displayName);
}

function serviceDto(service: {
  id: string;
  name: string;
  active: boolean;
  _count: { jobs: number };
}) {
  return {
    id: service.id,
    name: service.name,
    active: service.active,
    usedByJobCount: service._count.jobs,
  };
}

function isUniqueConstraintError(err: unknown, target?: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: string; meta?: { target?: unknown }; message?: string };
  return (
    candidate.code === 'P2002' &&
    (target === undefined ||
      (Array.isArray(candidate.meta?.target) && candidate.meta.target.includes(target)) ||
      candidate.message?.includes(target) === true)
  );
}

export async function identityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/organizations/current', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const org = await prisma.organization.findUnique({ where: { id: req.auth.orgId } });
    if (!org) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Organization not found');
    return reply.send({
      item: {
        id: org.id,
        name: org.name,
        timezone: org.timezone,
        address: org.address,
        phone: org.phone,
        website: org.website,
      },
    });
  });

  fastify.patch('/api/organizations/current', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = updateOrganizationProfileRequestSchema.parse(req.body);
    if (body.timezone && !isValidTimezone(body.timezone)) {
      throw new ApiError(ERROR_CODES.INVALID_TIMEZONE, 400, 'Timezone must be a valid IANA zone');
    }
    const data: {
      name?: string;
      timezone?: string;
      address?: string | null;
      phone?: string | null;
      website?: string | null;
    } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.timezone !== undefined) data.timezone = body.timezone;
    if (body.address !== undefined) data.address = body.address === '' ? null : body.address;
    if (body.phone !== undefined) data.phone = body.phone === '' ? null : body.phone;
    if (body.website !== undefined) data.website = body.website === '' ? null : body.website;

    const org = await prisma.organization.update({
      where: { id: req.auth.orgId },
      data,
    });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'organization',
      entityId: org.id,
      action: 'update',
    });
    return reply.send({
      item: {
        id: org.id,
        name: org.name,
        timezone: org.timezone,
        address: org.address,
        phone: org.phone,
        website: org.website,
      },
    });
  });

  fastify.get('/api/team-members', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const members = await prisma.teamMember.findMany({
      where: { organizationId: req.auth.orgId },
      orderBy: { displayName: 'asc' },
    });
    return reply.send({
      items: members.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        initials: m.initials,
        color: m.color,
        activeOnSchedule: m.activeOnSchedule,
      })),
    });
  });

  const includeInactiveQuery = z.object({
    includeInactive: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((value) => value === true || value === 'true'),
  });

  fastify.get('/api/services', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    const services = await prisma.service.findMany({
      where: {
        organizationId: req.auth.orgId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { jobs: true },
        },
      },
    });
    return reply.send({
      items: services.map(serviceDto),
    });
  });

  fastify.post('/api/services', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createServiceRequestSchema.parse(req.body);
    try {
      const service = await prisma.service.create({
        data: {
          organizationId: req.auth.orgId,
          name: body.name,
        },
        include: {
          _count: {
            select: { jobs: true },
          },
        },
      });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'service',
        entityId: service.id,
        action: 'create',
      });
      return reply.code(201).send({ item: serviceDto(service) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(ERROR_CODES.SERVICE_DUPLICATE, 400, 'Service name already exists');
      }
      throw err;
    }
  });

  fastify.post('/api/team-members', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createTeamMemberRequestSchema.parse(req.body);
    const initials = normalizeNullableInitials(body.initials, body.displayName);
    const m = await prisma.teamMember.create({
      data: {
        organizationId: req.auth.orgId,
        displayName: body.displayName,
        initials,
        color: body.color,
        activeOnSchedule: body.activeOnSchedule ?? true,
      },
    });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'team_member',
      entityId: m.id,
      action: 'create',
    });
    return reply.code(201).send({
      item: {
        id: m.id,
        displayName: m.displayName,
        initials: m.initials,
        color: m.color,
        activeOnSchedule: m.activeOnSchedule,
      },
    });
  });

  const idParam = z.object({ id: z.string().uuid() });

  fastify.patch('/api/services/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const body = updateServiceRequestSchema.parse(req.body);
    const existing = await prisma.service.findFirst({
      where: { id, organizationId: req.auth.orgId },
      include: {
        _count: {
          select: { jobs: true },
        },
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Service not found');
    try {
      const service = await prisma.service.update({
        where: { id },
        data: body,
        include: {
          _count: {
            select: { jobs: true },
          },
        },
      });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'service',
        entityId: id,
        action: 'update',
      });
      return reply.send({ item: serviceDto(service) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(ERROR_CODES.SERVICE_DUPLICATE, 400, 'Service name already exists');
      }
      throw err;
    }
  });

  fastify.patch('/api/team-members/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const body = updateTeamMemberRequestSchema.parse(req.body);
    const existing = await prisma.teamMember.findFirst({
      where: { id, organizationId: req.auth.orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Team member not found');
    const m = await prisma.teamMember.update({
      where: { id },
      data: {
        ...body,
        initials:
          body.displayName !== undefined || body.initials !== undefined
            ? normalizeNullableInitials(body.initials, body.displayName ?? existing.displayName)
            : undefined,
      },
    });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'team_member',
      entityId: id,
      action: 'update',
    });
    return reply.send({
      item: {
        id: m.id,
        displayName: m.displayName,
        initials: m.initials,
        color: m.color,
        activeOnSchedule: m.activeOnSchedule,
      },
    });
  });

  fastify.delete('/api/services/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.service.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Service not found');
    const jobsCount = await prisma.job.count({
      where: { organizationId: req.auth.orgId, serviceId: id },
    });
    if (jobsCount > 0) {
      throw new ApiError(
        ERROR_CODES.SERVICE_IN_USE,
        400,
        'Service is in use; deactivate it instead',
      );
    }
    await prisma.service.delete({ where: { id } });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'service',
      entityId: id,
      action: 'delete',
    });
    return reply.send({ item: { id } });
  });

  fastify.delete('/api/team-members/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.teamMember.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Team member not found');

    const [jobCount, eventCount] = await prisma.$transaction([
      prisma.job.count({
        where: { organizationId: req.auth.orgId, assigneeTeamMemberId: id },
      }),
      prisma.event.count({
        where: { organizationId: req.auth.orgId, assigneeTeamMemberId: id },
      }),
    ]);

    if (jobCount > 0 || eventCount > 0) {
      throw new ApiError(
        ERROR_CODES.TEAM_MEMBER_IN_USE,
        400,
        'Team member is assigned to jobs or events; deactivate instead',
      );
    }

    await prisma.teamMember.delete({ where: { id } });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'team_member',
      entityId: id,
      action: 'delete',
    });
    return reply.send({ item: { id } });
  });

  fastify.get('/api/lead-sources', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    const sources = await prisma.leadSource.findMany({
      where: {
        organizationId: req.auth.orgId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return reply.send({ items: sources.map((s) => ({ id: s.id, name: s.name, active: s.active })) });
  });

  fastify.post('/api/lead-sources', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createLeadSourceRequestSchema.parse(req.body);
    try {
      const source = await prisma.leadSource.create({
        data: { organizationId: req.auth.orgId, name: body.name },
      });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'lead_source',
        entityId: source.id,
        action: 'create',
      });
      return reply.code(201).send({ item: { id: source.id, name: source.name, active: source.active } });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(ERROR_CODES.LEAD_SOURCE_DUPLICATE, 400, 'Lead source name already exists');
      }
      throw err;
    }
  });

  fastify.patch('/api/lead-sources/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const body = updateLeadSourceRequestSchema.parse(req.body);
    const existing = await prisma.leadSource.findFirst({ where: { id, organizationId: req.auth.orgId } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Lead source not found');
    try {
      const source = await prisma.leadSource.update({ where: { id }, data: body });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'lead_source',
        entityId: id,
        action: 'update',
      });
      return reply.send({ item: { id: source.id, name: source.name, active: source.active } });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(ERROR_CODES.LEAD_SOURCE_DUPLICATE, 400, 'Lead source name already exists');
      }
      throw err;
    }
  });

  fastify.delete('/api/lead-sources/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.leadSource.findFirst({ where: { id, organizationId: req.auth.orgId }, select: { id: true } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Lead source not found');
    await prisma.leadSource.delete({ where: { id } });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'lead_source',
      entityId: id,
      action: 'delete',
    });
    return reply.send({ item: { id } });
  });

  fastify.get('/api/users', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { includeInactive: showArchived } = includeInactiveQuery.parse(req.query);
    const users = await prisma.user.findMany({
      where: { organizationId: req.auth.orgId, archived: showArchived || false },
      orderBy: { email: 'asc' },
    });
    return reply.send({
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        mustResetPassword: u.mustResetPassword,
        archived: u.archived,
      })),
    });
  });

  fastify.post('/api/users', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createUserRequestSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ApiError(ERROR_CODES.USER_DUPLICATE, 400, 'A user with this email already exists');
    }
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        organizationId: req.auth.orgId,
        email: body.email,
        passwordHash,
        role: body.role,
        mustResetPassword: true,
      },
    });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'user',
      entityId: user.id,
      action: 'create',
    });
    return reply.code(201).send({
      item: { id: user.id, email: user.email, role: user.role, mustResetPassword: user.mustResetPassword, archived: user.archived },
    });
  });

  fastify.patch('/api/users/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const body = updateUserRequestSchema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { id, organizationId: req.auth.orgId } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'User not found');
    if (body.email && body.email !== existing.email) {
      const dup = await prisma.user.findUnique({ where: { email: body.email } });
      if (dup) throw new ApiError(ERROR_CODES.USER_DUPLICATE, 400, 'A user with this email already exists');
    }
    const user = await prisma.user.update({ where: { id }, data: body });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'user',
      entityId: id,
      action: 'update',
    });
    return reply.send({
      item: { id: user.id, email: user.email, role: user.role, mustResetPassword: user.mustResetPassword, archived: user.archived },
    });
  });

  fastify.patch('/api/users/:id/archive', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.user.findFirst({ where: { id, organizationId: req.auth.orgId } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'User not found');
    if (id === req.auth.sub) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 403, 'You cannot archive your own account');
    }
    const user = await prisma.user.update({ where: { id }, data: { archived: true } });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'user',
      entityId: id,
      action: 'archive',
    });
    return reply.send({
      item: { id: user.id, email: user.email, role: user.role, mustResetPassword: user.mustResetPassword, archived: user.archived },
    });
  });

  fastify.patch('/api/users/:id/unarchive', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.user.findFirst({ where: { id, organizationId: req.auth.orgId } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'User not found');
    const user = await prisma.user.update({ where: { id }, data: { archived: false } });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'user',
      entityId: id,
      action: 'unarchive',
    });
    return reply.send({
      item: { id: user.id, email: user.email, role: user.role, mustResetPassword: user.mustResetPassword, archived: user.archived },
    });
  });
}
