import { type Prisma, prisma } from '@openclaw/db';
import {
  ERROR_CODES,
  type PublicCardRequestDto,
  type PublicInvoiceDto,
  stripeIntegrationConfigSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../../lib/env.js';
import { ApiError } from '../../lib/error-envelope.js';
import { buildInvoicePdf } from '../../lib/invoice-pdf.js';
import {
  createSetupIntent,
  getOrCreateStripeCustomer,
  loadStripeConfig,
} from '../../lib/stripe.js';

const tokenParam = z.object({ token: z.string().min(8).max(128) });

const PUBLIC_INVOICE_INCLUDE = {
  customer: { select: { displayName: true } },
  lineItems: { orderBy: { orderIndex: 'asc' } },
  payments: {
    orderBy: { paidAt: 'desc' },
    include: { paymentMethod: { select: { name: true } } },
  },
} as const satisfies Prisma.InvoiceInclude;

type PublicInvoiceRecord = Prisma.InvoiceGetPayload<{
  include: typeof PUBLIC_INVOICE_INCLUDE;
}>;

function deriveStatus(inv: {
  status: string;
  dueDate: Date | null;
  amountDueCents: number;
}): string {
  if (inv.status === 'sent' && inv.dueDate && inv.dueDate < new Date() && inv.amountDueCents > 0) {
    return 'past_due';
  }
  return inv.status;
}

async function resolveCompanyHeader(
  inv: PublicInvoiceRecord,
): Promise<{
  companyName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
}> {
  if (inv.companyNameSnapshot) {
    return {
      companyName: inv.companyNameSnapshot,
      companyAddress: inv.companyAddressSnapshot,
      companyPhone: inv.companyPhoneSnapshot,
      companyWebsite: inv.companyWebsiteSnapshot,
    };
  }
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: inv.organizationId },
    select: { name: true, address: true, phone: true, website: true },
  });
  return {
    companyName: org.name,
    companyAddress: org.address,
    companyPhone: org.phone,
    companyWebsite: org.website,
  };
}

async function resolveServiceDate(inv: PublicInvoiceRecord): Promise<string | null> {
  if (inv.serviceDateSnapshot) return inv.serviceDateSnapshot.toISOString();
  const job = await prisma.job.findUnique({
    where: { id: inv.jobId },
    select: { scheduledStartAt: true },
  });
  return job?.scheduledStartAt.toISOString() ?? null;
}

async function isStripeEnabled(orgId: string): Promise<boolean> {
  const integration = await prisma.orgIntegration.findUnique({
    where: { organizationId_kind: { organizationId: orgId, kind: 'stripe' } },
  });
  if (!integration || !integration.enabled) return false;
  const cfg = stripeIntegrationConfigSchema.safeParse(integration.config ?? {});
  if (!cfg.success) return false;
  return Boolean(cfg.data.secretKey);
}

async function publicInvoiceDto(inv: PublicInvoiceRecord): Promise<PublicInvoiceDto> {
  const header = await resolveCompanyHeader(inv);
  const stripeEnabled = await isStripeEnabled(inv.organizationId);
  return {
    invoiceNumber: inv.invoiceNumber,
    status: deriveStatus(inv),
    totalCents: inv.totalCents,
    amountDueCents: inv.amountDueCents,
    paidCents: inv.paidCents,
    paidAt: inv.paidAt?.toISOString() ?? null,
    dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
    createdAt: inv.createdAt.toISOString(),
    serviceNameSnapshot: inv.serviceNameSnapshot,
    lineItems: inv.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      priceCents: li.priceCents,
      orderIndex: li.orderIndex,
    })),
    customerDisplayName: inv.customer?.displayName ?? null,
    companyName: header.companyName,
    companyAddress: header.companyAddress,
    companyPhone: header.companyPhone,
    companyWebsite: header.companyWebsite,
    stripeEnabled,
  };
}

async function findInvoiceByToken(token: string): Promise<PublicInvoiceRecord> {
  const inv = await prisma.invoice.findUnique({
    where: { publicToken: token },
    include: PUBLIC_INVOICE_INCLUDE,
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
  return inv;
}

export async function publicRoutes(fastify: FastifyInstance) {
  // ── Public invoice (anonymous, by token) ─────────────────────────────
  fastify.get('/api/public/invoices/:token', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const inv = await findInvoiceByToken(token);
    const dto = await publicInvoiceDto(inv);
    return reply.send({ item: dto });
  });

  // ── Public PDF (anonymous, by token) ─────────────────────────────────
  fastify.get('/api/public/invoices/:token/pdf', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const inv = await findInvoiceByToken(token);
    const header = await resolveCompanyHeader(inv);
    const serviceDate = await resolveServiceDate(inv);
    const status = deriveStatus(inv);
    const buf = await buildInvoicePdf({
      invoiceNumber: inv.invoiceNumber,
      status,
      createdAt: inv.createdAt.toISOString(),
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
      customerDisplayName: inv.customer?.displayName ?? null,
      serviceNameSnapshot: inv.serviceNameSnapshot,
      serviceDate,
      subtotalCents: inv.subtotalCents,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      amountDueCents: inv.amountDueCents,
      lineItems: inv.lineItems.map((li) => ({
        description: li.description,
        priceCents: li.priceCents,
      })),
      payments: inv.payments.map((p) => ({
        paymentMethodName: p.paymentMethod?.name ?? p.paymentMethodNameSnapshot,
        amountCents: p.amountCents,
        reference: p.reference,
        paidAt: p.paidAt.toISOString(),
      })),
      companyNameSnapshot: header.companyName,
      companyAddressSnapshot: header.companyAddress,
      companyPhoneSnapshot: header.companyPhone,
      companyWebsiteSnapshot: header.companyWebsite,
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="invoice-${inv.invoiceNumber}.pdf"`)
      .send(buf);
  });

  // ── Stripe Checkout (anonymous; creates a session for amount due) ────
  fastify.post('/api/public/invoices/:token/stripe-checkout', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const inv = await findInvoiceByToken(token);

    if (inv.status === 'paid' || inv.lockedAt) {
      throw new ApiError(ERROR_CODES.INVOICE_ALREADY_PAID, 400, 'Invoice is already paid');
    }
    if (inv.amountDueCents <= 0) {
      throw new ApiError(ERROR_CODES.INVOICE_ALREADY_PAID, 400, 'Nothing to pay');
    }

    const integration = await prisma.orgIntegration.findUnique({
      where: { organizationId_kind: { organizationId: inv.organizationId, kind: 'stripe' } },
    });
    if (!integration || !integration.enabled) {
      throw new ApiError(
        ERROR_CODES.INTEGRATION_DISABLED,
        400,
        'Stripe payments are not enabled for this invoice',
      );
    }
    const cfg = stripeIntegrationConfigSchema.parse(integration.config ?? {});
    if (!cfg.secretKey) {
      throw new ApiError(
        ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
        400,
        'Stripe integration is missing a secret key',
      );
    }

    const env = loadEnv();
    const baseUrl = env.APP_URL.replace(/\/$/, '');
    const successUrl = `${baseUrl}/pay/${token}?paid=1`;
    const cancelUrl = `${baseUrl}/pay/${token}`;

    const productName = `Invoice ${inv.invoiceNumber}`;
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(inv.amountDueCents));
    params.set('line_items[0][price_data][product_data][name]', productName);
    params.set('metadata[invoiceId]', inv.id);
    params.set('metadata[organizationId]', inv.organizationId);
    params.set('payment_intent_data[metadata][invoiceId]', inv.id);
    params.set('payment_intent_data[metadata][organizationId]', inv.organizationId);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      fastify.log.error({ status: res.status, body: text }, 'stripe.checkout.create_failed');
      throw new ApiError(
        ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
        502,
        'Stripe checkout session could not be created',
      );
    }

    const session = (await res.json()) as { id?: string; url?: string };
    if (!session.url || !session.id) {
      fastify.log.error({ session }, 'stripe.checkout.malformed_response');
      throw new ApiError(
        ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
        502,
        'Stripe checkout session response was malformed',
      );
    }

    await prisma.invoice.update({
      where: { id: inv.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    return reply.send({ url: session.url });
  });

  // ── Public card request: read by token ───────────────────────────────
  fastify.get('/api/public/card-requests/:token', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const cr = await prisma.customerCardRequest.findUnique({
      where: { token },
      include: {
        customer: { select: { displayName: true } },
        organization: { select: { name: true, phone: true, website: true } },
      },
    });
    if (!cr) throw new ApiError(ERROR_CODES.CARD_REQUEST_NOT_FOUND, 404, 'Card request not found');

    const status = cr.status === 'pending' && cr.expiresAt < new Date() ? 'expired' : cr.status;
    const dto: PublicCardRequestDto = {
      status: status as PublicCardRequestDto['status'],
      expiresAt: cr.expiresAt.toISOString(),
      customerDisplayName: cr.customer?.displayName ?? null,
      companyName: cr.organization.name,
      companyPhone: cr.organization.phone,
      companyWebsite: cr.organization.website,
    };
    return reply.send({ item: dto });
  });

  // ── Public card request: create SetupIntent for self-serve add ───────
  fastify.post('/api/public/card-requests/:token/setup-intent', async (req, reply) => {
    const { token } = tokenParam.parse(req.params);
    const cr = await prisma.customerCardRequest.findUnique({ where: { token } });
    if (!cr) throw new ApiError(ERROR_CODES.CARD_REQUEST_NOT_FOUND, 404, 'Card request not found');

    if (cr.status === 'completed') {
      throw new ApiError(
        ERROR_CODES.CARD_REQUEST_ALREADY_COMPLETED,
        400,
        'Card has already been added',
      );
    }
    if (cr.status === 'expired' || cr.expiresAt < new Date()) {
      if (cr.status !== 'expired') {
        await prisma.customerCardRequest.update({
          where: { id: cr.id },
          data: { status: 'expired' },
        });
      }
      throw new ApiError(ERROR_CODES.CARD_REQUEST_EXPIRED, 400, 'Card request has expired');
    }

    const cfg = await loadStripeConfig(cr.organizationId);
    const stripeCustomerId = await getOrCreateStripeCustomer({
      secretKey: cfg.secretKey,
      organizationId: cr.organizationId,
      customerId: cr.customerId,
    });
    const setupIntent = await createSetupIntent({
      secretKey: cfg.secretKey,
      stripeCustomerId,
      metadata: {
        organizationId: cr.organizationId,
        customerId: cr.customerId,
        cardRequestId: cr.id,
        flow: 'public_card_request',
      },
    });

    await prisma.customerCardRequest.update({
      where: { id: cr.id },
      data: { stripeSetupIntentId: setupIntent.id },
    });

    return reply.send({
      item: {
        publishableKey: cfg.publishableKey,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      },
    });
  });
}
