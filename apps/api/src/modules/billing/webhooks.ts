import crypto from 'node:crypto';
import { prisma } from '@openclaw/db';
import { ERROR_CODES, stripeIntegrationConfigSchema } from '@openclaw/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { getPaymentMethod } from '../../lib/stripe.js';

// Minimal shape of the Stripe events we react to. We only validate the fields
// we read so the webhook stays resilient to unrelated schema changes.
const stripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string(),
      amount: z.number().int().nonnegative().optional(),
      amount_received: z.number().int().nonnegative().optional(),
      payment_intent: z.string().nullish(),
      payment_method: z.string().nullish(),
      customer: z.string().nullish(),
      metadata: z
        .object({
          invoiceId: z.string().uuid().optional(),
          organizationId: z.string().uuid().optional(),
          customerId: z.string().uuid().optional(),
          cardRequestId: z.string().uuid().optional(),
        })
        .partial()
        .optional(),
    }),
  }),
});

type StripeEvent = z.infer<typeof stripeEventSchema>;

const INVOICE_SUCCESS_EVENTS = new Set(['charge.succeeded', 'payment_intent.succeeded']);
const SETUP_INTENT_EVENTS = new Set(['setup_intent.succeeded']);
const STRIPE_TIMESTAMP_TOLERANCE_SEC = 300;

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: 'missing_header' };

  let timestamp: string | undefined;
  const sigs: string[] = [];
  for (const pair of header.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') sigs.push(v);
  }
  if (!timestamp || sigs.length === 0) return { ok: false, reason: 'malformed_header' };

  const tNum = Number(timestamp);
  if (!Number.isFinite(tNum)) return { ok: false, reason: 'malformed_header' };
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tNum);
  if (ageSec > STRIPE_TIMESTAMP_TOLERANCE_SEC) return { ok: false, reason: 'timestamp_outside_tolerance' };

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  for (const sig of sigs) {
    let sigBuf: Buffer;
    try {
      sigBuf = Buffer.from(sig, 'hex');
    } catch {
      continue;
    }
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'signature_mismatch' };
}

async function loadVerifiedConfig(
  fastify: FastifyInstance,
  orgId: string,
  rawBody: Buffer,
  headerStr: string | undefined,
  eventId: string,
): Promise<{ secretKey: string }> {
  const integration = await prisma.orgIntegration.findUnique({
    where: { organizationId_kind: { organizationId: orgId, kind: 'stripe' } },
  });
  if (!integration || !integration.enabled) {
    fastify.log.warn(
      { organizationId: orgId, eventId },
      'stripe.webhook.integration_disabled',
    );
    throw new ApiError(
      ERROR_CODES.INTEGRATION_DISABLED,
      400,
      'Stripe integration is not enabled for this organization',
    );
  }
  const cfg = stripeIntegrationConfigSchema.parse(integration.config ?? {});
  if (!cfg.webhookSecret || !cfg.secretKey) {
    fastify.log.warn(
      { organizationId: orgId, eventId },
      'stripe.webhook.missing_webhook_secret',
    );
    throw new ApiError(
      ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
      400,
      'Stripe webhook secret is not configured',
    );
  }
  const verdict = verifyStripeSignature(rawBody, headerStr, cfg.webhookSecret);
  if (!verdict.ok) {
    fastify.log.warn(
      { organizationId: orgId, eventId, reason: verdict.reason },
      'stripe.webhook.signature_verification_failed',
    );
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      400,
      `Stripe signature verification failed: ${verdict.reason}`,
    );
  }
  return { secretKey: cfg.secretKey };
}

export async function webhooksRoutes(fastify: FastifyInstance) {
  await fastify.register(async (instance) => {
    instance.removeContentTypeParser('application/json');
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req, body, done) => {
        try {
          const buf = body as Buffer;
          (req as RawBodyRequest).rawBody = buf;
          const json = buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'));
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    instance.post('/api/webhooks/stripe', async (req, reply) => {
      const rawBody = (req as RawBodyRequest).rawBody;
      if (!rawBody) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'Missing request body');
      }

      const parsed = stripeEventSchema.safeParse(req.body);
      if (!parsed.success) {
        fastify.log.warn({ issues: parsed.error.issues }, 'stripe.webhook.invalid_payload');
        return reply.code(200).send({ received: true, ignored: 'invalid_payload' });
      }
      const event = parsed.data;
      const sigHeader = req.headers['stripe-signature'];
      const headerStr = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

      if (INVOICE_SUCCESS_EVENTS.has(event.type)) {
        return handleInvoiceSuccess(fastify, event, rawBody, headerStr, reply);
      }
      if (SETUP_INTENT_EVENTS.has(event.type)) {
        return handleSetupIntentSucceeded(fastify, event, rawBody, headerStr, reply);
      }
      return reply.code(200).send({ received: true, ignored: event.type });
    });
  });
}

async function handleInvoiceSuccess(
  fastify: FastifyInstance,
  event: StripeEvent,
  rawBody: Buffer,
  headerStr: string | undefined,
  reply: FastifyReply,
) {
  const obj = event.data.object;
  const invoiceId = obj.metadata?.invoiceId;
  if (!invoiceId) {
    fastify.log.warn({ eventId: event.id }, 'stripe.webhook.missing_invoice_metadata');
    return reply.code(200).send({ received: true, ignored: 'no_invoice_metadata' });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      totalCents: true,
      lockedAt: true,
      companyNameSnapshot: true,
    },
  });
  if (!inv) {
    fastify.log.warn({ invoiceId, eventId: event.id }, 'stripe.webhook.invoice_not_found');
    return reply.code(200).send({ received: true, ignored: 'invoice_not_found' });
  }

  await loadVerifiedConfig(fastify, inv.organizationId, rawBody, headerStr, event.id);

  if (inv.lockedAt || inv.status === 'paid') {
    return reply.code(200).send({ received: true, ignored: 'already_paid' });
  }

  const stripeMethod = await prisma.paymentMethod.findFirst({
    where: { organizationId: inv.organizationId, source: 'stripe' },
    orderBy: [{ active: 'desc' }, { orderIndex: 'asc' }],
  });

  const amount = obj.amount_received ?? obj.amount ?? inv.totalCents;
  const isCharge = event.type === 'charge.succeeded';
  const chargeId = isCharge ? obj.id : null;
  const paymentIntentId = isCharge ? (obj.payment_intent ?? null) : obj.id;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    let snapshot: {
      companyNameSnapshot: string;
      companyAddressSnapshot: string | null;
      companyPhoneSnapshot: string | null;
      companyWebsiteSnapshot: string | null;
    } | null = null;
    if (!inv.companyNameSnapshot) {
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: inv.organizationId },
        select: { name: true, address: true, phone: true, website: true },
      });
      snapshot = {
        companyNameSnapshot: org.name,
        companyAddressSnapshot: org.address,
        companyPhoneSnapshot: org.phone,
        companyWebsiteSnapshot: org.website,
      };
    }

    await tx.invoicePayment.create({
      data: {
        organizationId: inv.organizationId,
        invoiceId: inv.id,
        paymentMethodId: stripeMethod?.id ?? null,
        paymentMethodNameSnapshot: stripeMethod?.name ?? 'Credit Card',
        source: 'stripe',
        amountCents: amount,
        reference: paymentIntentId ?? chargeId,
        paidAt: now,
        recordedByUserId: null,
        stripeChargeId: chargeId,
        stripePaymentIntentId: paymentIntentId,
      },
    });

    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'paid',
        paidAt: now,
        paidCents: inv.totalCents,
        amountDueCents: 0,
        lockedAt: now,
        stripePaymentIntentId: paymentIntentId,
        ...(snapshot ?? {}),
      },
    });

    await auditLog(tx, {
      organizationId: inv.organizationId,
      actorUserId: null,
      entityType: 'invoice',
      entityId: inv.id,
      action: 'stripe_paid',
      payload: {
        eventId: event.id,
        eventType: event.type,
        stripeChargeId: chargeId,
        stripePaymentIntentId: paymentIntentId,
        amountCents: amount,
      },
    });
  });

  return reply.code(200).send({ received: true });
}

async function handleSetupIntentSucceeded(
  fastify: FastifyInstance,
  event: StripeEvent,
  rawBody: Buffer,
  headerStr: string | undefined,
  reply: FastifyReply,
) {
  const obj = event.data.object;
  const orgId = obj.metadata?.organizationId;
  const customerId = obj.metadata?.customerId;
  const paymentMethodId = obj.payment_method;
  if (!orgId || !customerId || !paymentMethodId) {
    fastify.log.warn(
      { eventId: event.id, hasOrg: !!orgId, hasCustomer: !!customerId, hasPm: !!paymentMethodId },
      'stripe.webhook.setup_intent.missing_metadata',
    );
    return reply.code(200).send({ received: true, ignored: 'missing_metadata' });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: orgId },
    select: { id: true },
  });
  if (!customer) {
    fastify.log.warn(
      { eventId: event.id, customerId, orgId },
      'stripe.webhook.setup_intent.customer_not_found',
    );
    return reply.code(200).send({ received: true, ignored: 'customer_not_found' });
  }

  const { secretKey } = await loadVerifiedConfig(fastify, orgId, rawBody, headerStr, event.id);

  // Idempotency: if we already saved this PM, just mark the request completed.
  const existing = await prisma.customerPaymentMethod.findUnique({
    where: { stripePaymentMethodId: paymentMethodId },
  });
  const cardRequestId = obj.metadata?.cardRequestId;

  if (existing) {
    if (cardRequestId) {
      await prisma.customerCardRequest.updateMany({
        where: { id: cardRequestId, status: { not: 'completed' } },
        data: {
          status: 'completed',
          completedAt: new Date(),
          stripePaymentMethodId: paymentMethodId,
          stripeSetupIntentId: obj.id,
        },
      });
    }
    return reply.code(200).send({ received: true, ignored: 'already_saved' });
  }

  const pm = await getPaymentMethod({ secretKey, paymentMethodId });
  const card = pm.card ?? {};
  const existingDefault = await prisma.customerPaymentMethod.findFirst({
    where: { organizationId: orgId, customerId, isDefault: true },
    select: { id: true },
  });
  const shouldBeDefault = !existingDefault;

  await prisma.$transaction(async (tx) => {
    const created = await tx.customerPaymentMethod.create({
      data: {
        organizationId: orgId,
        customerId,
        stripePaymentMethodId: paymentMethodId,
        brand: card.brand ?? null,
        last4: card.last4 ?? null,
        expMonth: card.exp_month ?? null,
        expYear: card.exp_year ?? null,
        isDefault: shouldBeDefault,
      },
    });

    if (cardRequestId) {
      await tx.customerCardRequest.updateMany({
        where: { id: cardRequestId, status: { not: 'completed' } },
        data: {
          status: 'completed',
          completedAt: new Date(),
          stripePaymentMethodId: paymentMethodId,
          stripeSetupIntentId: obj.id,
        },
      });
    }

    await auditLog(tx, {
      organizationId: orgId,
      actorUserId: null,
      entityType: 'customer_payment_method',
      entityId: created.id,
      action: 'create',
      payload: {
        eventId: event.id,
        eventType: event.type,
        setupIntentId: obj.id,
        stripePaymentMethodId: paymentMethodId,
        cardRequestId: cardRequestId ?? null,
        flow: cardRequestId ? 'public_card_request' : 'admin_add_card',
      },
    });
  });

  return reply.code(200).send({ received: true });
}
