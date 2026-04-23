import { randomBytes } from 'node:crypto';
import { type Prisma, prisma } from '@openclaw/db';
import {
  type CustomerCardRequestDto,
  type CustomerPaymentMethodDto,
  ERROR_CODES,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { loadEnv } from '../../lib/env.js';
import { ApiError } from '../../lib/error-envelope.js';
import {
  createSetupIntent,
  detachPaymentMethod,
  getOrCreateStripeCustomer,
  loadStripeConfig,
} from '../../lib/stripe.js';
import { requireAuth } from '../auth/guard.js';

// ---------------------------------------------------------------------------
// Routes for saved cards (admin-side)
//   - List / Add (SetupIntent) / Delete / Set default
//   - Card requests (tokenized self-serve link)
// ---------------------------------------------------------------------------

const customerIdParam = z.object({ customerId: z.string().uuid() });
const customerAndPmParam = z.object({
  customerId: z.string().uuid(),
  pmId: z.string().uuid(),
});

const CARD_REQUEST_TTL_DAYS = 7;

function newCardRequestToken(): string {
  return randomBytes(24).toString('base64url');
}

function publicCardRequestUrl(token: string): string {
  const env = loadEnv();
  const base = env.APP_URL.replace(/\/$/, '');
  return `${base}/cards/${token}`;
}

function toPaymentMethodDto(pm: {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  createdAt: Date;
}): CustomerPaymentMethodDto {
  return {
    id: pm.id,
    brand: pm.brand,
    last4: pm.last4,
    expMonth: pm.expMonth,
    expYear: pm.expYear,
    isDefault: pm.isDefault,
    createdAt: pm.createdAt.toISOString(),
  };
}

function toCardRequestDto(cr: {
  id: string;
  token: string;
  status: string;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}): CustomerCardRequestDto {
  return {
    id: cr.id,
    token: cr.token,
    status: cr.status as CustomerCardRequestDto['status'],
    expiresAt: cr.expiresAt.toISOString(),
    completedAt: cr.completedAt?.toISOString() ?? null,
    createdAt: cr.createdAt.toISOString(),
    publicUrl: publicCardRequestUrl(cr.token),
  };
}

async function assertCustomerInOrg(orgId: string, customerId: string): Promise<void> {
  const found = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: orgId },
    select: { id: true },
  });
  if (!found) {
    throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
  }
}

export async function cardsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── List saved cards ───────────────────────────────────────────────────
  fastify.get('/api/customers/:customerId/payment-methods', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId } = customerIdParam.parse(req.params);
    await assertCustomerInOrg(req.auth.orgId, customerId);

    const rows = await prisma.customerPaymentMethod.findMany({
      where: { organizationId: req.auth.orgId, customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return reply.send({ items: rows.map(toPaymentMethodDto) });
  });

  // ── Admin Add-card: create SetupIntent ─────────────────────────────────
  fastify.post(
    '/api/customers/:customerId/payment-methods/setup-intent',
    async (req, reply) => {
      if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
      const { customerId } = customerIdParam.parse(req.params);
      const orgId = req.auth.orgId;
      await assertCustomerInOrg(orgId, customerId);

      const cfg = await loadStripeConfig(orgId);
      const stripeCustomerId = await getOrCreateStripeCustomer({
        secretKey: cfg.secretKey,
        organizationId: orgId,
        customerId,
      });
      const setupIntent = await createSetupIntent({
        secretKey: cfg.secretKey,
        stripeCustomerId,
        metadata: {
          organizationId: orgId,
          customerId,
          flow: 'admin_add_card',
        },
      });

      return reply.send({
        item: {
          publishableKey: cfg.publishableKey,
          clientSecret: setupIntent.client_secret,
          setupIntentId: setupIntent.id,
        },
      });
    },
  );

  // ── Delete (detach) a saved card ───────────────────────────────────────
  fastify.delete('/api/customers/:customerId/payment-methods/:pmId', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId, pmId } = customerAndPmParam.parse(req.params);
    const orgId = req.auth.orgId;

    const pm = await prisma.customerPaymentMethod.findFirst({
      where: { id: pmId, organizationId: orgId, customerId },
    });
    if (!pm) {
      throw new ApiError(ERROR_CODES.CARD_NOT_FOUND, 404, 'Card not found');
    }

    const cfg = await loadStripeConfig(orgId);
    await detachPaymentMethod({
      secretKey: cfg.secretKey,
      paymentMethodId: pm.stripePaymentMethodId,
    });

    await prisma.$transaction(async (tx) => {
      await tx.customerPaymentMethod.delete({ where: { id: pm.id } });
      await auditLog(tx, {
        organizationId: orgId,
        actorUserId: req.auth!.sub,
        entityType: 'customer_payment_method',
        entityId: pm.id,
        action: 'delete',
        payload: { customerId, stripePaymentMethodId: pm.stripePaymentMethodId },
      });
    });

    return reply.send({ ok: true });
  });

  // ── Set default card ───────────────────────────────────────────────────
  fastify.post(
    '/api/customers/:customerId/payment-methods/:pmId/default',
    async (req, reply) => {
      if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
      const { customerId, pmId } = customerAndPmParam.parse(req.params);
      const orgId = req.auth.orgId;

      const pm = await prisma.customerPaymentMethod.findFirst({
        where: { id: pmId, organizationId: orgId, customerId },
      });
      if (!pm) {
        throw new ApiError(ERROR_CODES.CARD_NOT_FOUND, 404, 'Card not found');
      }

      await prisma.$transaction(async (tx) => {
        await tx.customerPaymentMethod.updateMany({
          where: { organizationId: orgId, customerId, isDefault: true },
          data: { isDefault: false },
        });
        await tx.customerPaymentMethod.update({
          where: { id: pm.id },
          data: { isDefault: true },
        });
        await auditLog(tx, {
          organizationId: orgId,
          actorUserId: req.auth!.sub,
          entityType: 'customer_payment_method',
          entityId: pm.id,
          action: 'set_default',
          payload: { customerId },
        });
      });

      return reply.send({ ok: true });
    },
  );

  // ── List card requests for a customer ──────────────────────────────────
  fastify.get('/api/customers/:customerId/card-requests', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId } = customerIdParam.parse(req.params);
    const orgId = req.auth.orgId;
    await assertCustomerInOrg(orgId, customerId);

    const rows = await prisma.customerCardRequest.findMany({
      where: { organizationId: orgId, customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reply.send({ items: rows.map(toCardRequestDto) });
  });

  // ── Create a new card request (tokenized self-serve link) ──────────────
  fastify.post('/api/customers/:customerId/card-requests', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId } = customerIdParam.parse(req.params);
    const orgId = req.auth.orgId;
    await assertCustomerInOrg(orgId, customerId);

    // Verify Stripe is configured up-front so the link is usable.
    await loadStripeConfig(orgId);

    const token = newCardRequestToken();
    const expiresAt = new Date(Date.now() + CARD_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.customerCardRequest.create({
        data: {
          organizationId: orgId,
          customerId,
          token,
          status: 'pending',
          expiresAt,
        },
      });
      await auditLog(tx, {
        organizationId: orgId,
        actorUserId: req.auth!.sub,
        entityType: 'customer_card_request',
        entityId: row.id,
        action: 'create',
        payload: { customerId, expiresAt: expiresAt.toISOString() } satisfies Prisma.InputJsonValue,
      });
      return row;
    });

    return reply.code(201).send({ item: toCardRequestDto(created) });
  });
}
