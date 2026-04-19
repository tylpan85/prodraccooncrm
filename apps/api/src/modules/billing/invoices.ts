import { type Prisma, type PrismaClient, prisma } from '@openclaw/db';
import { ERROR_CODES, editInvoiceRequestSchema, invoiceListQuerySchema } from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const idParam = z.object({ id: z.string().uuid() });

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
} as const;

type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

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
    dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
    createdAt: inv.createdAt.toISOString(),
    sentAt: inv.sentAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    voidedAt: inv.voidedAt?.toISOString() ?? null,
    updatedAt: inv.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function invoicesRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── List invoices ────────────────────────────────────────────────────
  fastify.get('/api/invoices', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const orgId = req.auth.orgId;
    const query = invoiceListQuerySchema.parse(req.query);

    const where: Prisma.InvoiceWhereInput = { organizationId: orgId };

    // Tab filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (query.status) {
      case 'unsent':
        where.status = 'draft';
        break;
      case 'open':
        where.status = 'sent';
        where.amountDueCents = { gt: 0 };
        where.OR = [{ dueDate: null }, { dueDate: { gte: today } }];
        break;
      case 'past_due':
        where.status = 'sent';
        where.dueDate = { lt: today, not: null };
        where.amountDueCents = { gt: 0 };
        break;
      case 'paid':
        where.status = 'paid';
        break;
      case 'void':
        where.status = 'void';
        break;
    }

    if (query.customerId) where.customerId = query.customerId;
    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      where.AND = [
        (where.AND as Prisma.InvoiceWhereInput) ?? {},
        {
          OR: [
            { invoiceNumber: { contains: q, mode: 'insensitive' } },
            { customer: { displayName: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const limit = query.limit;
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        customer: { select: { displayName: true } },
      },
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerDisplayName: inv.customer?.displayName ?? null,
      serviceNameSnapshot: inv.serviceNameSnapshot,
      totalCents: inv.totalCents,
      amountDueCents: inv.amountDueCents,
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      status: deriveStatus(inv),
    }));

    return reply.send({
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
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
        invoice: { select: { id: true } },
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

    const inv = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(orgId, tx);
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
          serviceNameSnapshot: job.titleOrSummary,
          servicePriceCentsSnapshot: job.priceCents,
          dueDate: null,
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
      select: { id: true, status: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    if (existing.status !== 'draft') {
      throw new ApiError(ERROR_CODES.INVOICE_NOT_DRAFT, 400, 'Only draft invoices can be edited');
    }

    const data: Prisma.InvoiceUpdateInput = {};
    if (body.serviceNameSnapshot !== undefined) data.serviceNameSnapshot = body.serviceNameSnapshot;
    if (body.servicePriceCentsSnapshot !== undefined) {
      data.servicePriceCentsSnapshot = body.servicePriceCentsSnapshot;
      data.subtotalCents = body.servicePriceCentsSnapshot;
      data.totalCents = body.servicePriceCentsSnapshot;
      data.amountDueCents = body.servicePriceCentsSnapshot;
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data,
      include: INVOICE_INCLUDE,
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

  // ── Send (draft → sent) ──────────────────────────────────────────────
  fastify.post('/api/invoices/:id/send', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    if (existing.status !== 'draft') {
      throw new ApiError(ERROR_CODES.INVOICE_NOT_DRAFT, 400, 'Only draft invoices can be sent');
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
      include: INVOICE_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'send',
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Mark paid (sent → paid) ──────────────────────────────────────────
  fastify.post('/api/invoices/:id/mark-paid', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true, totalCents: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
    if (existing.status !== 'sent') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        400,
        'Only sent invoices can be marked as paid',
      );
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paidCents: existing.totalCents,
        amountDueCents: 0,
      },
      include: INVOICE_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: orgId,
      actorUserId: req.auth.sub,
      entityType: 'invoice',
      entityId: id,
      action: 'mark_paid',
      payload: { paidCents: existing.totalCents },
    });

    return reply.send({ item: invoiceDto(updated) });
  });

  // ── Void (admin only; any non-paid → void) ──────────────────────────
  fastify.post('/api/invoices/:id/void', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, status: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
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
