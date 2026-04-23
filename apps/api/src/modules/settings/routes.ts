import { type Prisma, prisma } from '@openclaw/db';
import {
  ERROR_CODES,
  INTEGRATION_KINDS,
  type IntegrationKind,
  createPaymentMethodRequestSchema,
  ringcentralIntegrationConfigSchema,
  stripeIntegrationConfigSchema,
  updateOrgIntegrationRequestSchema,
  updatePaymentMethodRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: string };
  return candidate.code === 'P2002';
}

function paymentMethodDto(pm: {
  id: string;
  name: string;
  source: 'manual' | 'stripe';
  referenceLabel: string | null;
  active: boolean;
  orderIndex: number;
}) {
  return {
    id: pm.id,
    name: pm.name,
    source: pm.source,
    referenceLabel: pm.referenceLabel,
    active: pm.active,
    orderIndex: pm.orderIndex,
  };
}

function integrationDto(row: {
  kind: IntegrationKind;
  enabled: boolean;
  config: unknown;
}) {
  return {
    kind: row.kind,
    enabled: row.enabled,
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

function emptyIntegration(kind: IntegrationKind) {
  return { kind, enabled: false, config: {} as Record<string, unknown> };
}

function validateIntegrationConfig(
  kind: IntegrationKind,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (config === undefined) return {};
  if (kind === 'stripe') return stripeIntegrationConfigSchema.parse(config);
  if (kind === 'ringcentral') return ringcentralIntegrationConfigSchema.parse(config);
  return {};
}

export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  const includeInactiveQuery = z.object({
    includeInactive: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((v) => v === true || v === 'true'),
  });
  const idParam = z.object({ id: z.string().uuid() });
  const kindParam = z.object({ kind: z.enum(INTEGRATION_KINDS) });

  // -----------------------------------------------------------------------
  // Payment methods
  // -----------------------------------------------------------------------

  fastify.get('/api/payment-methods', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { includeInactive } = includeInactiveQuery.parse(req.query);
    const methods = await prisma.paymentMethod.findMany({
      where: {
        organizationId: req.auth.orgId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: 'desc' }, { orderIndex: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ items: methods.map(paymentMethodDto) });
  });

  fastify.post('/api/payment-methods', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createPaymentMethodRequestSchema.parse(req.body);
    const max = await prisma.paymentMethod.aggregate({
      where: { organizationId: req.auth.orgId },
      _max: { orderIndex: true },
    });
    try {
      const pm = await prisma.paymentMethod.create({
        data: {
          organizationId: req.auth.orgId,
          name: body.name,
          source: body.source ?? 'manual',
          referenceLabel:
            body.referenceLabel === '' || body.referenceLabel === undefined
              ? null
              : body.referenceLabel,
          orderIndex: (max._max.orderIndex ?? -1) + 1,
        },
      });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'payment_method',
        entityId: pm.id,
        action: 'create',
      });
      return reply.code(201).send({ item: paymentMethodDto(pm) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(
          ERROR_CODES.PAYMENT_METHOD_DUPLICATE,
          400,
          'A payment method with this name already exists',
        );
      }
      throw err;
    }
  });

  fastify.patch('/api/payment-methods/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const body = updatePaymentMethodRequestSchema.parse(req.body);
    const existing = await prisma.paymentMethod.findFirst({
      where: { id, organizationId: req.auth.orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Payment method not found');

    const data: {
      name?: string;
      referenceLabel?: string | null;
      active?: boolean;
      orderIndex?: number;
    } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.referenceLabel !== undefined) {
      data.referenceLabel = body.referenceLabel === '' ? null : body.referenceLabel;
    }
    if (body.active !== undefined) data.active = body.active;
    if (body.orderIndex !== undefined) data.orderIndex = body.orderIndex;

    try {
      const pm = await prisma.paymentMethod.update({ where: { id }, data });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'payment_method',
        entityId: id,
        action: 'update',
      });
      return reply.send({ item: paymentMethodDto(pm) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(
          ERROR_CODES.PAYMENT_METHOD_DUPLICATE,
          400,
          'A payment method with this name already exists',
        );
      }
      throw err;
    }
  });

  fastify.delete('/api/payment-methods/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.paymentMethod.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Payment method not found');
    const used = await prisma.invoicePayment.count({ where: { paymentMethodId: id } });
    if (used > 0) {
      throw new ApiError(
        ERROR_CODES.PAYMENT_METHOD_IN_USE,
        400,
        'Payment method is referenced by recorded payments; deactivate it instead',
      );
    }
    await prisma.paymentMethod.delete({ where: { id } });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'payment_method',
      entityId: id,
      action: 'delete',
    });
    return reply.send({ item: { id } });
  });

  // -----------------------------------------------------------------------
  // Integrations (Stripe / RingCentral)
  // -----------------------------------------------------------------------

  fastify.get('/api/integrations', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const rows = await prisma.orgIntegration.findMany({
      where: { organizationId: req.auth.orgId },
    });
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    const items = INTEGRATION_KINDS.map((kind) => {
      const row = byKind.get(kind);
      return row ? integrationDto(row) : emptyIntegration(kind);
    });
    return reply.send({ items });
  });

  fastify.get('/api/integrations/:kind', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { kind } = kindParam.parse(req.params);
    const row = await prisma.orgIntegration.findUnique({
      where: { organizationId_kind: { organizationId: req.auth.orgId, kind } },
    });
    return reply.send({ item: row ? integrationDto(row) : emptyIntegration(kind) });
  });

  fastify.put('/api/integrations/:kind', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { kind } = kindParam.parse(req.params);
    const body = updateOrgIntegrationRequestSchema.parse(req.body);
    const validatedConfig = validateIntegrationConfig(
      kind,
      body.config as Record<string, unknown> | undefined,
    );

    const existing = await prisma.orgIntegration.findUnique({
      where: { organizationId_kind: { organizationId: req.auth.orgId, kind } },
    });

    const row = existing
      ? await prisma.orgIntegration.update({
          where: { organizationId_kind: { organizationId: req.auth.orgId, kind } },
          data: {
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
            ...(body.config !== undefined
              ? { config: validatedConfig as Prisma.InputJsonValue }
              : {}),
          },
        })
      : await prisma.orgIntegration.create({
          data: {
            organizationId: req.auth.orgId,
            kind,
            enabled: body.enabled ?? false,
            config: validatedConfig as Prisma.InputJsonValue,
          },
        });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'org_integration',
      entityId: row.id,
      action: existing ? 'update' : 'create',
      payload: { kind, enabled: row.enabled },
    });
    return reply.send({ item: integrationDto(row) });
  });
}
