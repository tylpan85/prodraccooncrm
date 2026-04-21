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
} as const satisfies Prisma.InvoiceInclude;

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
    lineItems: inv.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      priceCents: li.priceCents,
      orderIndex: li.orderIndex,
    })),
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

    const lines =
      job.serviceItems.length > 0
        ? job.serviceItems.map((item) => ({
            description: item.service?.name ?? item.nameSnapshot ?? 'Service',
            priceCents: item.priceCents,
            orderIndex: item.orderIndex,
          }))
        : [
            {
              description: job.titleOrSummary ?? 'Service',
              priceCents: job.priceCents,
              orderIndex: 0,
            },
          ];

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
          lineItems: { create: lines },
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
      select: { id: true, status: true, paidCents: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Invoice not found');
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
