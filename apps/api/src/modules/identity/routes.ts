import { prisma } from '@openclaw/db';
import {
  ERROR_CODES,
  createTeamMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateTeamMemberRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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

export async function identityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/organizations/current', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const org = await prisma.organization.findUnique({ where: { id: req.auth.orgId } });
    if (!org) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Organization not found');
    return reply.send({
      item: { id: org.id, name: org.name, timezone: org.timezone },
    });
  });

  fastify.patch('/api/organizations/current', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = updateOrganizationRequestSchema.parse(req.body);
    const org = await prisma.organization.update({
      where: { id: req.auth.orgId },
      data: body,
    });
    return reply.send({
      item: { id: org.id, name: org.name, timezone: org.timezone },
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

  fastify.post('/api/team-members', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createTeamMemberRequestSchema.parse(req.body);
    const initials = body.initials ?? computeInitials(body.displayName);
    const m = await prisma.teamMember.create({
      data: {
        organizationId: req.auth.orgId,
        displayName: body.displayName,
        initials,
        color: body.color,
        activeOnSchedule: body.activeOnSchedule ?? true,
      },
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
      data: body,
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

  fastify.get('/api/users', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const users = await prisma.user.findMany({
      where: { organizationId: req.auth.orgId },
      orderBy: { email: 'asc' },
    });
    return reply.send({
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        mustResetPassword: u.mustResetPassword,
      })),
    });
  });
}
