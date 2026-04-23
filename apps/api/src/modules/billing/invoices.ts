import { type Prisma, type PrismaClient, prisma } from '@openclaw/db';
import {
  chargeSavedCardRequestSchema,
  ERROR_CODES,
  editInvoiceRequestSchema,
  invoiceListQuerySchema,
  markInvoicePaidRequestSchema,
  ringcentralIntegrationConfigSchema,
  sendInvoiceReceiptRequestSchema,
  sendInvoiceSmsRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { buildInvoicePdf } from '../../lib/invoice-pdf.js';
import { newInvoicePublicToken } from '../../lib/invoice-token.js';
import {
  createOffSessionPaymentIntent,
  getOrCreateStripeCustomer,
  loadStripeConfig,
} from '../../lib/stripe.js';
import { requireAuth } from '../auth/guard.js';
import { buildInvoiceDataFromJob } from '../scheduling/jobs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const idParam = z.object({ id: z.string().uuid() });

function encodeInvoicesCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}:${id}`;
}

function parseInvoicesCursor(raw?: string): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const tsStr = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  const ts = Number.parseInt(tsStr, 10);
  if (!id || Number.isNaN(ts)) return null;
  return { createdAt: new Date(ts), id };
}

async function nextInvoiceNumber(orgId: string, tx: Tx): Promise<string> {
  const counter = await tx.organizationCounter.upsert({
    where: { organizationId_name: { organizationId: orgId, name: 'invoice_number' } },
    create: { organizationId: orgId, name: 'invoice_number', nextValue: 1002 },
    update: { nextValue: { increment: 1 } },
  });
  return String(counter.nextValue - 1);
}

const INVOICE_INCLUDE = {
  job: { select: { jobNumber: true } },
  customer: { select: { displayName: true } },
  lineItems: { orderBy: { orderIndex: 'asc' } },
  payments: {
    orderBy: { paidAt: 'desc' },
    include: { paymentMethod: { select: { name: true } } },
  },
} as const satisfies Prisma.InvoiceInclude;

type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;
type InvoicePaymentRecord = InvoiceRecord['payments'][number];

/**
 * Derive the effective status for the client. The DB stores `sent` but
 * the client sees `past_due` when conditions apply.
 */
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

function invoicePaymentDto(p: InvoicePaymentRecord) {
  return {
    id: p.id,
    paymentMethodId: p.paymentMethodId,
    paymentMethodName: p.paymentMethod?.name ?? p.paymentMethodNameSnapshot,
    source: p.source,
    amountCents: p.amountCents,
    reference: p.reference,
    paidAt: p.paidAt.toISOString(),
    recordedByUserId: p.recordedByUserId,
    stripeChargeId: p.stripeChargeId,
    stripePaymentIntentId: p.stripePaymentIntentId,
    createdAt: p.createdAt.toISOString(),
  };
}

function invoiceDto(inv: InvoiceRecord) {
  return {
    id: inv.id,
    organizationId: inv.organizationId,
    invoiceNumber: inv.invoiceNumber,
    jobId: inv.jobId,
    jobNumber: inv.job?.jobNumber ?? null,
    customerId: inv.customerId,
    customerDisplayName: inv.customer?.displayName ?? null,
    status: deriveStatus(inv),
    subtotalCents: inv.subtotalCents,
    totalCents: inv.totalCents,
    amountDueCents: inv.amountDueCents,
    paidCents: inv.paidCents,
    serviceNameSnapshot: inv.serviceNameSnapshot,
    servicePriceCentsSnapshot: inv.servicePriceCentsSnapshot,
    lineItems: inv.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      priceCents: li.priceCents,
      orderIndex: li.orderIndex,
    })),
    payments: inv.payments.map(invoicePaymentDto),
    dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
    createdAt: inv.createdAt.toISOString(),
    sentAt: inv.sentAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    voidedAt: inv.voidedAt?.toISOString() ?? null,
    updatedAt: inv.updatedAt.toISOString(),
    publicToken: inv.publicToken,
    lastSentVia: inv.lastSentVia,
    lastSentAt: inv.lastSentAt?.toISOString() ?? null,
    lockedAt: inv.lockedAt?.toISOString() ?? null,
    companyNameSnapshot: inv.companyNameSnapshot,
    companyAddressSnapshot: inv.companyAddressSnapshot,
    companyPhoneSnapshot: inv.companyPhoneSnapshot,
    companyWebsiteSnapshot: inv.companyWebsiteSnapshot,
    serviceDateSnapshot: inv.serviceDateSnapshot?.toISOString() ?? null,
  };
}

/**
 * Build a company-details snapshot from the organization record.
 * Only used when the invoice is first sent or marked paid; the snapshot
 * is preserved on the invoice so historical/public views remain stable
 * even if org details are later edited.
 */
export async function buildCompanySnapshot(
  tx: Tx,
  orgId: string,
): Promise<{
  companyNameSnapshot: string;
  companyAddressSnapshot: string | null;
  companyPhoneSnapshot: string | null;
  companyWebsiteSnapshot: string | null;
}> {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { name: true, address: true, phone: true, website: true },
  });
  return {
    companyNameSnapshot: org.name,
    companyAddressSnapshot: org.address,
    companyPhoneSnapshot: org.phone,
    companyWebsiteSnapshot: org.website,
  };
}

function ensureUnlocked(inv: { lockedAt: Date | null }) {
  if (inv.lockedAt) {
    throw new ApiError(
      ERROR_CODES.INVOICE_LOCKED,
      400,
      'Invoice is locked (paid via Stripe) and cannot be modified',
    );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function invoicesRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── List invoices (bidirectional pagination + filters) ───────────────
  fastify.get('/api/invoices', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const query = invoiceListQuerySchema.parse(req.query);

    const DEFAULT_BEFORE = 15;
    const DEFAULT_AFTER = 25;
    const DEFAULT_PAGE = 15;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filters: Prisma.InvoiceWhereInput = { organizationId: orgId };
    const andClauses: Prisma.InvoiceWhereInput[] = [];

    switch (query.status) {
      case 'unsent':
        filters.status = 'draft';
        break;
      case 'open':
        filters.status = 'sent';
        filters.amountDueCents = { gt: 0 };
        andClauses.push({ OR: [{ dueDate: null }, { dueDate: { gte: today } }] });
        break;
      case 'past_due':
        filters.status = 'sent';
        filters.dueDate = { lt: today, not: null };
        filters.amountDueCents = { gt: 0 };
        break;
      case 'paid':
        filters.status = 'paid';
        break;
      case 'void':
        filters.status = 'void';
        break;
    }

    if (query.customerId) filters.customerId = query.customerId;

    if (query.dateFrom || query.dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (query.dateFrom) range.gte = new Date(query.dateFrom);
      if (query.dateTo) range.lte = new Date(query.dateTo);
      filters.createdAt = range;
    }

    if (query.amountMinCents !== undefined || query.amountMaxCents !== undefined) {
      const range: Prisma.IntFilter = {};
      if (query.amountMinCents !== undefined) range.gte = query.amountMinCents;
      if (query.amountMaxCents !== undefined) range.lte = query.amountMaxCents;
      filters.totalCents = range;
    }

    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      andClauses.push({
        OR: [
          { invoiceNumber: { contains: q, mode: 'insensitive' } },
          { customer: { displayName: { contains: q, mode: 'insensitive' } } },
          { serviceNameSnapshot: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    const baseWhere: Prisma.InvoiceWhereInput =
      andClauses.length > 0 ? { AND: [filters, ...andClauses] } : filters;

    const invoiceInclude = {
      customer: { select: { displayName: true } },
    } as const;
    type InvWithRel = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

    const mapInvoice = (inv: InvWithRel) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerDisplayName: inv.customer?.displayName ?? null,
      serviceNameSnapshot: inv.serviceNameSnapshot,
      totalCents: inv.totalCents,
      amountDueCents: inv.amountDueCents,
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      status: deriveStatus(inv),
      createdAt: inv.createdAt.toISOString(),
    });

    const fetchBefore = async (pivot: Date, pivotId: string | null, limit: number) => {
      const where: Prisma.InvoiceWhereInput = pivotId
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { createdAt: { lt: pivot } },
                  { createdAt: pivot, id: { lt: pivotId } },
                ],
              },
            ],
          }
        : { AND: [baseWhere, { createdAt: { lt: pivot } }] };
      const rows = await prisma.invoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: invoiceInclude,
      });
      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit);
      const tail = sliced[sliced.length - 1];
      const nextCursor = hasMore && tail ? encodeInvoicesCursor(tail.createdAt, tail.id) : null;
      return { rows: sliced, hasMore, nextCursor };
    };

    const fetchAfter = async (
      pivot: Date,
      pivotId: string | null,
      limit: number,
      inclusive: boolean,
    ) => {
      const where: Prisma.InvoiceWhereInput = pivotId
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { createdAt: { gt: pivot } },
                  { createdAt: pivot, id: { gt: pivotId } },
                ],
              },
            ],
          }
        : {
            AND: [baseWhere, { createdAt: inclusive ? { gte: pivot } : { gt: pivot } }],
          };
      const rows = await prisma.invoice.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        include: invoiceInclude,
      });
      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit);
      const tail = sliced[sliced.length - 1];
      const nextCursor = hasMore && tail ? encodeInvoicesCursor(tail.createdAt, tail.id) : null;
      return { rows: sliced, hasMore, nextCursor };
    };

    const cursor = parseInvoicesCursor(query.cursor);

    // Paged request: one-directional fetch from a cursor.
    if (query.direction && cursor) {
      const limit = query.limit ?? DEFAULT_PAGE;
      if (query.direction === 'after') {
        const { rows, hasMore, nextCursor } = await fetchAfter(
          cursor.createdAt,
          cursor.id,
          limit,
          false,
        );
        return reply.send({
          items: rows.map(mapInvoice),
          nextCursor: null,
          nextCursorAfter: nextCursor,
          hasMoreAfter: hasMore,
        });
      }
      const { rows, hasMore, nextCursor } = await fetchBefore(
        cursor.createdAt,
        cursor.id,
        limit,
      );
      return reply.send({
        items: rows.reverse().map(mapInvoice),
        nextCursor: null,
        nextCursorBefore: nextCursor,
        hasMoreBefore: hasMore,
      });
    }

    // Initial window around the anchor (default: today).
    const anchor = query.anchor
      ? new Date(query.anchor)
      : query.dateFrom
        ? new Date(query.dateFrom)
        : new Date();

    const [beforeRes, afterRes] = await Promise.all([
      fetchBefore(anchor, null, DEFAULT_BEFORE),
      fetchAfter(anchor, null, DEFAULT_AFTER, true),
    ]);

    const items = [...beforeRes.rows.slice().reverse(), ...afterRes.rows].map(mapInvoice);

    return reply.send({
      items,
      nextCursor: null,
      nextCursorBefore: beforeRes.nextCursor,
      hasMoreBefore: beforeRes.hasMore,
      nextCursorAfter: afterRes.nextCursor,
      hasMoreAfter: afterRes.hasMore,
    });
  });

  // ── Get invoice detail ───────────────────────────────────────────────
  fastify.get('/api/invoices/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const inv = await prisma.invoice.findFirst({
      where: { id, organizationId: req.auth.orgId },
      include: INVOICE_INCLUDE,
    });
    if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    return reply.send({ item: invoiceDto(inv) });
  });

  // ── Download PDF (auth'd) ────────────────────────────────────────────
  fastify.get('/api/invoices/:id/pdf', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const inv = await prisma.invoice.findFirst({
      where: { id, organizationId: req.auth.orgId },
      include: INVOICE_INCLUDE,
    });
    if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');

    const dto = invoiceDto(inv);

    // Live fallback for legacy invoices with null snapshots: read org + job
    // at render time so existing invoices display company details + service
    // date without requiring a backfill migration.
    let companyNameSnapshot = dto.companyNameSnapshot;
    let companyAddressSnapshot = dto.companyAddressSnapshot;
    let companyPhoneSnapshot = dto.companyPhoneSnapshot;
    let companyWebsiteSnapshot = dto.companyWebsiteSnapshot;
    let serviceDate: string | null = dto.serviceDateSnapshot;
    if (!companyNameSnapshot) {
      const org = await prisma.organization.findUnique({
        where: { id: inv.organizationId },
        select: { name: true, address: true, phone: true, website: true },
      });
      if (org) {
        companyNameSnapshot = org.name;
        companyAddressSnapshot = org.address;
        companyPhoneSnapshot = org.phone;
        companyWebsiteSnapshot = org.website;
      }
    }
    if (!serviceDate) {
      const job = await prisma.job.findUnique({
        where: { id: inv.jobId },
        select: { scheduledStartAt: true },
      });
      if (job) serviceDate = job.scheduledStartAt.toISOString();
    }

    const buf = await buildInvoicePdf({
      invoiceNumber: dto.invoiceNumber,
      status: dto.status,
      createdAt: dto.createdAt,
      dueDate: dto.dueDate,
      paidAt: dto.paidAt,
      customerDisplayName: dto.customerDisplayName,
      serviceNameSnapshot: dto.serviceNameSnapshot,
      serviceDate,
      subtotalCents: dto.subtotalCents,
      totalCents: dto.totalCents,
      paidCents: dto.paidCents,
      amountDueCents: dto.amountDueCents,
      lineItems: dto.lineItems.map((li) => ({
        description: li.description,
        priceCents: li.priceCents,
      })),
      payments: dto.payments.map((p) => ({
        paymentMethodName: p.paymentMethodName,
        amountCents: p.amountCents,
        reference: p.reference,
        paidAt: p.paidAt,
      })),
      companyNameSnapshot,
      companyAddressSnapshot,
      companyPhoneSnapshot,
      companyWebsiteSnapshot,
    });

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="invoice-${dto.invoiceNumber}.pdf"`)
      .send(buf);
  });

  // ── Manual create (fallback) ─────────────────────────────────────────
  fastify.post('/api/jobs/:id/invoice', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id: jobId } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    const job = await prisma.job.findFirst({
      where: { id: jobId, organizationId: orgId },
      select: {
        id: true,
        customerId: true,
        titleOrSummary: true,
        priceCents: true,
        scheduledStartAt: true,
        invoice: { select: { id: true } },
        serviceItems: {
          select: {
            priceCents: true,
            orderIndex: true,
            nameSnapshot: true,
            service: { select: { name: true } },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (job.invoice) {
      throw new ApiError(
        ERROR_CODES.INVOICE_ALREADY_EXISTS,
        409,
        'Invoice already exists for this job',
      );
    }

    const snap = buildInvoiceDataFromJob(job);

    const inv = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(orgId, tx);
      const companySnap = await buildCompanySnapshot(tx, orgId);
      const created = await tx.invoice.create({
        data: {
          organizationId: orgId,
          invoiceNumber,
          jobId,
          customerId: job.customerId,
          status: 'draft',
          subtotalCents: job.priceCents,
          totalCents: job.priceCents,
          amountDueCents: job.priceCents,
          paidCents: 0,
          serviceNameSnapshot: snap.serviceNameSnapshot,
          servicePriceCentsSnapshot: snap.servicePriceCentsSnapshot,
          serviceDateSnapshot: snap.serviceDateSnapshot,
          ...companySnap,
          dueDate: null,
          publicToken: newInvoicePublicToken(),
          lineItems: { create: snap.lineItems },
        },
        include: INVOICE_INCLUDE,
      });
      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'invoice',
        entityId: created.id,
        action: 'create',
        payload: { jobId, invoiceNumber },
      });
      return created;
    });

    return reply.status(201).send({ item: invoiceDto(inv) });
  });

  // ── Edit (draft only) ────────────────────────────────────────────────
  fastify.patch('/api/invoices/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = editInvoiceRequestSchema.parse(req.body);

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true, paidCents: true, lockedAt: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status !== 'draft') {
      throw new ApiError(ERROR_CODES.INVOICE_NOT_DRAFT, 400, 'Only draft invoices can be edited');
    }

    const data: Prisma.InvoiceUpdateInput = {};
    if (body.serviceNameSnapshot !== undefined) data.serviceNameSnapshot = body.serviceNameSnapshot;
    if (body.servicePriceCentsSnapshot !== undefined) {
      data.servicePriceCentsSnapshot = body.servicePriceCentsSnapshot;
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }

    if (body.lineItems !== undefined) {
      const total = body.lineItems.reduce((sum, li) => sum + li.priceCents, 0);
      data.subtotalCents = total;
      data.totalCents = total;
      data.amountDueCents = Math.max(0, total - existing.paidCents);
      // Keep scalar snapshots in sync with the first line item so list
      // views and PDF stay coherent. Only override when the caller did not
      // pass them explicitly.
      const first = body.lineItems[0];
      if (body.serviceNameSnapshot === undefined) {
        data.serviceNameSnapshot = first?.description ?? null;
      }
      if (body.servicePriceCentsSnapshot === undefined) {
        data.servicePriceCentsSnapshot = first?.priceCents ?? null;
      }
    } else if (body.servicePriceCentsSnapshot !== undefined) {
      data.subtotalCents = body.servicePriceCentsSnapshot;
      data.totalCents = body.servicePriceCentsSnapshot;
      data.amountDueCents = Math.max(0, body.servicePriceCentsSnapshot - existing.paidCents);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.lineItems !== undefined) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        if (body.lineItems.length > 0) {
          await tx.invoiceLineItem.createMany({
            data: body.lineItems.map((li, idx) => ({
              invoiceId: id,
              description: li.description,
              priceCents: li.priceCents,
              orderIndex: idx,
            })),
          });
        }
      }
      return tx.invoice.update({
        where: { id },
        data,
        include: INVOICE_INCLUDE,
      });
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'update',
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Resync from job (draft only) ──────────────────────────────────────
  // Refills line items + scalar snapshots from the source job. Useful for
  // invoices created before the job's service items were finalized.
  fastify.post('/api/invoices/:id/resync-from-job', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        status: true,
        paidCents: true,
        lockedAt: true,
        jobId: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status !== 'draft') {
      throw new ApiError(ERROR_CODES.INVOICE_NOT_DRAFT, 400, 'Only draft invoices can be resynced');
    }

    const job = await prisma.job.findFirst({
      where: { id: existing.jobId, organizationId: orgId },
      select: {
        titleOrSummary: true,
        priceCents: true,
        scheduledStartAt: true,
        serviceItems: {
          select: {
            priceCents: true,
            orderIndex: true,
            nameSnapshot: true,
            service: { select: { name: true } },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Source job not found');

    const snap = buildInvoiceDataFromJob(job);
    const total = snap.lineItems.reduce((sum, li) => sum + li.priceCents, 0);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      if (snap.lineItems.length > 0) {
        await tx.invoiceLineItem.createMany({
          data: snap.lineItems.map((li) => ({
            invoiceId: id,
            description: li.description,
            priceCents: li.priceCents,
            orderIndex: li.orderIndex,
          })),
        });
      }
      return tx.invoice.update({
        where: { id },
        data: {
          serviceNameSnapshot: snap.serviceNameSnapshot,
          servicePriceCentsSnapshot: snap.servicePriceCentsSnapshot,
          serviceDateSnapshot: snap.serviceDateSnapshot,
          subtotalCents: total,
          totalCents: total,
          amountDueCents: Math.max(0, total - existing.paidCents),
        },
        include: INVOICE_INCLUDE,
      });
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'resync_from_job',
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Send via SMS (draft → sent, or re-send while sent) ────────────────
  // Requires the RingCentral integration to be enabled and configured
  // (jwt + fromNumber). Snapshots company details on first send so the
  // public pay page and PDF stay stable if org settings are later edited.
  fastify.post('/api/invoices/:id/send-sms', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = sendInvoiceSmsRequestSchema.parse(req.body);

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        status: true,
        sentAt: true,
        lockedAt: true,
        invoiceNumber: true,
        publicToken: true,
        companyNameSnapshot: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status !== 'draft' && existing.status !== 'sent') {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_PAYABLE,
        400,
        'Only draft or sent invoices can be sent via SMS',
      );
    }

    const integration = await prisma.orgIntegration.findUnique({
      where: { organizationId_kind: { organizationId: orgId, kind: 'ringcentral' } },
    });
    if (!integration || !integration.enabled) {
      throw new ApiError(
        ERROR_CODES.INTEGRATION_DISABLED,
        400,
        'RingCentral integration is disabled. Enable it in Settings to send SMS.',
      );
    }
    const cfg = ringcentralIntegrationConfigSchema.parse(integration.config ?? {});
    if (!cfg.jwt || !cfg.fromNumber) {
      throw new ApiError(
        ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
        400,
        'RingCentral integration is missing JWT or fromNumber. Configure it in Settings.',
      );
    }

    // TODO(ringcentral): wire the actual RingCentral SMS dispatch here.
    // For now we log the intent so the rest of the flow is testable
    // without the third-party dependency.
    fastify.log.info(
      {
        invoiceId: id,
        invoiceNumber: existing.invoiceNumber,
        toPhone: body.toPhone,
        fromNumber: cfg.fromNumber,
      },
      'invoice.sms.dispatch (stub)',
    );

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const snapshot = existing.companyNameSnapshot
        ? null
        : await buildCompanySnapshot(tx, orgId);
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: existing.sentAt ?? now,
          lastSentVia: 'sms',
          lastSentAt: now,
          ...(snapshot ?? {}),
        },
        include: INVOICE_INCLUDE,
      });
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'send_sms',
      payload: { toPhone: body.toPhone },
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Mark paid (manual; sent → paid) ──────────────────────────────────
  // Stripe-source payment methods are rejected here — those are recorded
  // only via the Stripe webhook. Reference is required for methods that
  // declare a referenceLabel (e.g. Zelle confirmation #).
  fastify.post('/api/invoices/:id/mark-paid', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = markInvoicePaidRequestSchema.parse(req.body);

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        status: true,
        totalCents: true,
        lockedAt: true,
        sentAt: true,
        companyNameSnapshot: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status === 'paid') {
      throw new ApiError(ERROR_CODES.INVOICE_ALREADY_PAID, 400, 'Invoice is already paid');
    }
    if (existing.status !== 'draft' && existing.status !== 'sent' && existing.status !== 'past_due') {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_PAYABLE,
        400,
        'Only draft, sent, or past-due invoices can be marked as paid',
      );
    }

    const method = await prisma.paymentMethod.findFirst({
      where: { id: body.paymentMethodId, organizationId: orgId },
    });
    if (!method) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Payment method not found');
    if (!method.active) {
      throw new ApiError(
        ERROR_CODES.PAYMENT_METHOD_INACTIVE,
        400,
        'Payment method is inactive',
      );
    }
    if (method.source === 'stripe') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        400,
        'Stripe payments are recorded automatically. Use a manual method here.',
      );
    }
    if (method.referenceLabel && !body.reference) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        400,
        `${method.referenceLabel} is required for ${method.name} payments`,
      );
    }

    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const snapshot = existing.companyNameSnapshot
        ? null
        : await buildCompanySnapshot(tx, orgId);
      await tx.invoicePayment.create({
        data: {
          organizationId: orgId,
          invoiceId: id,
          paymentMethodId: method.id,
          paymentMethodNameSnapshot: method.name,
          source: 'manual',
          amountCents: existing.totalCents,
          reference: body.reference ?? null,
          paidAt,
          recordedByUserId: req.auth?.sub ?? null,
        },
      });
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'paid',
          paidAt,
          paidCents: existing.totalCents,
          amountDueCents: 0,
          ...(snapshot ?? {}),
        },
        include: INVOICE_INCLUDE,
      });
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'mark_paid',
      payload: {
        paymentMethodId: method.id,
        paymentMethodName: method.name,
        amountCents: existing.totalCents,
        reference: body.reference ?? null,
      },
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Charge a saved card off-session ──────────────────────────────────
  // Fires a Stripe PaymentIntent against a saved CustomerPaymentMethod.
  // The payment_intent.succeeded webhook records the InvoicePayment row
  // and locks the invoice — this endpoint only initiates the charge and
  // persists stripePaymentIntentId for correlation.
  fastify.post('/api/invoices/:id/charge-saved-card', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = chargeSavedCardRequestSchema.parse(req.body);

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        status: true,
        customerId: true,
        amountDueCents: true,
        lockedAt: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status === 'paid') {
      throw new ApiError(ERROR_CODES.INVOICE_ALREADY_PAID, 400, 'Invoice is already paid');
    }
    if (existing.status !== 'draft' && existing.status !== 'sent' && existing.status !== 'past_due') {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_PAYABLE,
        400,
        'Only draft, sent, or past-due invoices can be charged',
      );
    }
    if (existing.amountDueCents <= 0) {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_PAYABLE,
        400,
        'Invoice has no outstanding balance',
      );
    }

    const pm = await prisma.customerPaymentMethod.findFirst({
      where: {
        id: body.paymentMethodId,
        organizationId: orgId,
        customerId: existing.customerId,
      },
    });
    if (!pm) throw new ApiError(ERROR_CODES.CARD_NOT_FOUND, 404, 'Card not found');

    const cfg = await loadStripeConfig(orgId);
    const stripeCustomerId = await getOrCreateStripeCustomer({
      secretKey: cfg.secretKey,
      organizationId: orgId,
      customerId: existing.customerId,
    });
    const intent = await createOffSessionPaymentIntent({
      secretKey: cfg.secretKey,
      amountCents: existing.amountDueCents,
      stripeCustomerId,
      paymentMethodId: pm.stripePaymentMethodId,
      metadata: {
        organizationId: orgId,
        invoiceId: id,
        customerId: existing.customerId,
        flow: 'charge_saved_card',
      },
    });

    const updated = await prisma.invoice.update({
      where: { id },
      data: { stripePaymentIntentId: intent.id },
      include: INVOICE_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'stripe_charge_initiated',
      payload: {
        paymentMethodId: pm.id,
        stripePaymentMethodId: pm.stripePaymentMethodId,
        stripePaymentIntentId: intent.id,
        amountCents: existing.amountDueCents,
        status: intent.status,
      },
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Reopen (paid → sent or draft) ────────────────────────────────────
  // Paid-via-Stripe invoices are locked and cannot be reopened.
  // If the invoice was ever sent (lastSentAt is set), reopen to `sent`;
  // otherwise back to `draft`. All recorded payments are removed.
  fastify.post('/api/invoices/:id/reopen', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        status: true,
        totalCents: true,
        lockedAt: true,
        lastSentAt: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status !== 'paid') {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_PAID_CANNOT_REOPEN,
        400,
        'Only paid invoices can be reopened',
      );
    }

    const newStatus = existing.lastSentAt ? 'sent' : 'draft';

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoicePayment.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: {
          status: newStatus,
          paidAt: null,
          paidCents: 0,
          amountDueCents: existing.totalCents,
        },
        include: INVOICE_INCLUDE,
      });
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'reopen',
      payload: { newStatus },
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Send receipt (paid only) ─────────────────────────────────────────
  // Stub: actual email dispatch is wired separately. We log the intent
  // and audit the action so the UI flow is fully testable.
  fastify.post('/api/invoices/:id/send-receipt', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;
    const body = sendInvoiceReceiptRequestSchema.parse(req.body);

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true, invoiceNumber: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    if (existing.status !== 'paid') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        400,
        'Receipts can only be sent for paid invoices',
      );
    }

    fastify.log.info(
      {
        invoiceId: id,
        invoiceNumber: existing.invoiceNumber,
        toEmail: body.toEmail,
      },
      'invoice.receipt.send (stub)',
    );

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'send_receipt',
      payload: { toEmail: body.toEmail },
    });

    return reply.send({ ok: true });
  });

  // ── Void (admin only; any non-paid → void) ──────────────────────────
  fastify.post('/api/invoices/:id/void', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true, lockedAt: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    ensureUnlocked(existing);
    if (existing.status === 'paid') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'Cannot void a paid invoice');
    }
    if (existing.status === 'void') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'Invoice is already voided');
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'void', voidedAt: new Date() },
      include: INVOICE_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'void',
    });

    return reply.send({ item: invoiceDto(updated) });
  });
}
