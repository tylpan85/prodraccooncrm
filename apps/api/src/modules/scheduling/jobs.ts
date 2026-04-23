import { type Prisma, type PrismaClient, prisma } from '@openclaw/db';
import {
  type CreateJobRequest,
  ERROR_CODES,
  type JobServiceItemInput,
  assignJobRequestSchema,
  createJobRequestSchema,
  jobListQuerySchema,
  scheduleJobRequestSchema,
  updateJobRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { newInvoicePublicToken } from '../../lib/invoice-token.js';
import { requireAuth } from '../auth/guard.js';
import { buildCompanySnapshot } from '../billing/invoices.js';
import { processNoteOps } from './notes.js';
import { ensureMaterializedUntil } from './recurring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

async function nextJobNumber(orgId: string, tx: Tx): Promise<string> {
  const counter = await tx.organizationCounter.upsert({
    where: { organizationId_name: { organizationId: orgId, name: 'job_number' } },
    create: { organizationId: orgId, name: 'job_number', nextValue: 1002 },
    update: { nextValue: { increment: 1 } },
  });
  return `J-${counter.nextValue - 1}`;
}

async function nextInvoiceNumber(orgId: string, tx: Tx): Promise<string> {
  const counter = await tx.organizationCounter.upsert({
    where: { organizationId_name: { organizationId: orgId, name: 'invoice_number' } },
    create: { organizationId: orgId, name: 'invoice_number', nextValue: 1002 },
    update: { nextValue: { increment: 1 } },
  });
  return String(counter.nextValue - 1);
}

const JOB_INCLUDE = {
  customer: { select: { displayName: true } },
  service: { select: { name: true } },
  assignee: { select: { displayName: true } },
  tags: true,
  serviceItems: {
    include: { service: { select: { name: true } } },
    orderBy: { orderIndex: 'asc' },
  },
  invoice: {
    select: { id: true, invoiceNumber: true, status: true, totalCents: true },
  },
} as const;

type JobRecord = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;

function jobDto(j: JobRecord) {
  return {
    id: j.id,
    organizationId: j.organizationId,
    jobNumber: j.jobNumber,
    customerId: j.customerId,
    customerDisplayName: j.customer.displayName,
    customerAddressId: j.customerAddressId,
    serviceId: j.serviceId,
    serviceName: j.service?.name ?? null,
    titleOrSummary: j.titleOrSummary,
    priceCents: j.priceCents,
    leadSource: j.leadSource,
    privateNotes: j.privateNotes,
    scheduledStartAt: j.scheduledStartAt.toISOString(),
    scheduledEndAt: j.scheduledEndAt.toISOString(),
    assigneeTeamMemberId: j.assigneeTeamMemberId,
    assigneeDisplayName: j.assignee?.displayName ?? null,
    jobStage: j.jobStage,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    tags: j.tags.map((t) => t.tag),
    services: j.serviceItems.map((item) => ({
      id: item.id,
      serviceId: item.serviceId,
      serviceName: item.service?.name ?? null,
      nameSnapshot: item.nameSnapshot,
      priceCents: item.priceCents,
      orderIndex: item.orderIndex,
    })),
    recurringSeriesId: j.recurringSeriesId,
    invoice: j.invoice
      ? {
          id: j.invoice.id,
          invoiceNumber: j.invoice.invoiceNumber,
          status: j.invoice.status,
          totalCents: j.invoice.totalCents,
        }
      : null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

const idParam = z.object({ id: z.string().uuid() });
const customerIdParam = z.object({ customerId: z.string().uuid() });

const customerJobsQuerySchema = z.object({
  anchor: z.string().optional(),
  direction: z.enum(['before', 'after']).optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const n = Number.parseInt(v, 10);
      if (Number.isNaN(n) || n < 1) return undefined;
      return Math.min(n, 200);
    }),
});

function encodeJobsCursor(startAt: Date, id: string): string {
  return `${startAt.getTime()}:${id}`;
}

function parseJobsCursor(raw?: string): { startAt: Date; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const tsStr = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  const ts = Number.parseInt(tsStr, 10);
  if (!id || Number.isNaN(ts)) return null;
  return { startAt: new Date(ts), id };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

async function validateAddressOwnership(customerId: string, addressId: string, orgId: string) {
  const addr = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId, customer: { organizationId: orgId } },
    select: { id: true },
  });
  if (!addr) {
    throw new ApiError(
      ERROR_CODES.ADDRESS_NOT_OWNED_BY_CUSTOMER,
      400,
      'Address does not belong to this customer',
    );
  }
}

async function validateAssignee(teamMemberId: string, orgId: string) {
  const tm = await prisma.teamMember.findFirst({
    where: { id: teamMemberId, organizationId: orgId },
    select: { activeOnSchedule: true },
  });
  if (!tm) {
    throw new ApiError(ERROR_CODES.INVALID_ASSIGNEE, 400, 'Team member not found');
  }
  if (!tm.activeOnSchedule) {
    throw new ApiError(
      ERROR_CODES.INVALID_ASSIGNEE,
      400,
      'Team member is not active on the schedule',
    );
  }
}

async function checkDnsBlock(customerId: string, orgId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: orgId },
    select: { doNotService: true },
  });
  if (customer?.doNotService) {
    throw new ApiError(
      ERROR_CODES.DO_NOT_SERVICE_BLOCK,
      400,
      'Cannot schedule a job for a Do Not Service customer',
    );
  }
}

// ---------------------------------------------------------------------------
// Service item helpers
// ---------------------------------------------------------------------------

export function normalizeServiceItems(body: {
  services?: JobServiceItemInput[] | null;
  serviceId?: string | null;
  priceCents?: number;
}): JobServiceItemInput[] {
  if (body.services && body.services.length > 0) {
    return body.services.map((item) => ({
      serviceId: item.serviceId ?? null,
      priceCents: item.priceCents,
      nameSnapshot: item.nameSnapshot ?? null,
    }));
  }
  return [
    {
      serviceId: body.serviceId ?? null,
      priceCents: body.priceCents ?? 0,
      nameSnapshot: null,
    },
  ];
}

export async function validateServiceIds(
  items: JobServiceItemInput[],
  orgId: string,
): Promise<void> {
  const ids = Array.from(
    new Set(items.map((i) => i.serviceId).filter((id): id is string => !!id)),
  );
  if (ids.length === 0) return;
  const found = await prisma.service.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'One or more services not found');
  }
}

export function deriveJobTotals(items: JobServiceItemInput[]): {
  totalCents: number;
  primaryServiceId: string | null;
} {
  return {
    totalCents: items.reduce((sum, i) => sum + i.priceCents, 0),
    primaryServiceId: items[0]?.serviceId ?? null,
  };
}

export type InvoiceSourceJob = {
  titleOrSummary: string | null;
  priceCents: number;
  scheduledStartAt: Date;
  serviceItems: Array<{
    priceCents: number;
    orderIndex: number;
    nameSnapshot: string | null;
    service: { name: string } | null;
  }>;
};

export function buildInvoiceDataFromJob(job: InvoiceSourceJob): {
  lineItems: Array<{ description: string; priceCents: number; orderIndex: number }>;
  serviceNameSnapshot: string | null;
  servicePriceCentsSnapshot: number;
  serviceDateSnapshot: Date;
} {
  if (job.serviceItems.length > 0) {
    const first = job.serviceItems[0]!;
    const firstName = first.service?.name ?? first.nameSnapshot;
    return {
      lineItems: job.serviceItems.map((item) => ({
        description: item.service?.name ?? item.nameSnapshot ?? 'Service',
        priceCents: item.priceCents,
        orderIndex: item.orderIndex,
      })),
      serviceNameSnapshot: firstName ?? job.titleOrSummary,
      servicePriceCentsSnapshot: first.priceCents,
      serviceDateSnapshot: job.scheduledStartAt,
    };
  }
  return {
    lineItems: [
      {
        description: job.titleOrSummary ?? 'Service',
        priceCents: job.priceCents,
        orderIndex: 0,
      },
    ],
    serviceNameSnapshot: job.titleOrSummary,
    servicePriceCentsSnapshot: job.priceCents,
    serviceDateSnapshot: job.scheduledStartAt,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function jobsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // ── Create ────────────────────────────────────────────────────────────
  fastify.post('/api/customers/:customerId/jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId } = customerIdParam.parse(req.params);
    const body = createJobRequestSchema.parse(req.body) as CreateJobRequest;

    // Verify customer exists and belongs to org
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: req.auth.orgId },
      select: { id: true, doNotService: true },
    });
    if (!customer) {
      throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    }

    await validateAddressOwnership(customerId, body.customerAddressId, req.auth.orgId);

    if (customer.doNotService) {
      throw new ApiError(
        ERROR_CODES.DO_NOT_SERVICE_BLOCK,
        400,
        'Cannot schedule a job for a Do Not Service customer',
      );
    }

    if (body.assigneeTeamMemberId) {
      await validateAssignee(body.assigneeTeamMemberId, req.auth.orgId);
    }

    const serviceItems = normalizeServiceItems(body);
    await validateServiceIds(serviceItems, req.auth.orgId);
    const { totalCents, primaryServiceId } = deriveJobTotals(serviceItems);

    const tags = body.tags ? dedupeTags(body.tags) : [];
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    const result = await prisma.$transaction(async (tx) => {
      const jobNumber = await nextJobNumber(orgId, tx);

      const created = await tx.job.create({
        data: {
          organizationId: orgId,
          jobNumber,
          customerId,
          customerAddressId: body.customerAddressId,
          serviceId: primaryServiceId,
          titleOrSummary: body.titleOrSummary ?? null,
          priceCents: totalCents,
          leadSource: body.leadSource ?? null,
          privateNotes: body.privateNotes ?? null,
          scheduledStartAt: new Date(body.scheduledStartAt),
          scheduledEndAt: new Date(body.scheduledEndAt),
          assigneeTeamMemberId: body.assigneeTeamMemberId ?? null,
          tags: tags.length > 0 ? { create: tags.map((tag) => ({ tag })) } : undefined,
          serviceItems: {
            create: serviceItems.map((item, idx) => ({
              serviceId: item.serviceId ?? null,
              priceCents: item.priceCents,
              nameSnapshot: item.nameSnapshot ?? null,
              orderIndex: idx,
            })),
          },
        },
        include: JOB_INCLUDE,
      });

      const noteMappings = body.noteOps && body.noteOps.length > 0
        ? await processNoteOps({
            tx,
            orgId,
            jobId: created.id,
            customerId,
            authorUserId: actorUserId,
            recurringSeriesId: null,
            occurrenceIndex: null,
            scope: 'this',
            noteOps: body.noteOps,
          })
        : [];

      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'job',
        entityId: created.id,
        action: 'create',
        payload: { jobNumber: created.jobNumber, customerId },
      });
      return { job: created, noteMappings };
    });

    return reply.code(201).send({ item: jobDto(result.job), noteMappings: result.noteMappings });
  });

  // ── List (with bidirectional pagination + filters) ────────────────────
  fastify.get('/api/jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const query = jobListQuerySchema.parse(req.query);
    const orgId = req.auth.orgId;

    const DEFAULT_BEFORE = 15;
    const DEFAULT_AFTER = 25;
    const DEFAULT_PAGE = 15;

    // Build base filter from query params (applies to all branches).
    const filters: Prisma.JobWhereInput = {
      organizationId: orgId,
      deletedFromSeriesAt: null,
    };
    if (query.customerId) filters.customerId = query.customerId;
    if (query.assigneeTeamMemberId) filters.assigneeTeamMemberId = query.assigneeTeamMemberId;
    if (query.serviceId) filters.serviceId = query.serviceId;
    if (query.stage) filters.jobStage = query.stage;
    if (query.tag) {
      filters.tags = { some: { tag: { equals: query.tag, mode: 'insensitive' } } };
    }
    if (query.dateFrom || query.dateTo) {
      filters.scheduledStartAt = {};
      if (query.dateFrom) filters.scheduledStartAt.gte = new Date(query.dateFrom);
      if (query.dateTo) filters.scheduledStartAt.lte = new Date(query.dateTo);
    }
    if (query.priceMinCents !== undefined || query.priceMaxCents !== undefined) {
      filters.priceCents = {};
      if (query.priceMinCents !== undefined) filters.priceCents.gte = query.priceMinCents;
      if (query.priceMaxCents !== undefined) filters.priceCents.lte = query.priceMaxCents;
    }
    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      filters.OR = [
        { titleOrSummary: { contains: q, mode: 'insensitive' } },
        { jobNumber: { contains: q, mode: 'insensitive' } },
        { customer: { displayName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Lazily materialize recurring jobs up to the furthest point we may show.
    const materializeTarget = query.dateTo
      ? new Date(query.dateTo)
      : (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() + 2);
          return d;
        })();
    await ensureMaterializedUntil(orgId, materializeTarget, {
      customerId: query.customerId,
    });

    const jobInclude = {
      customer: { select: { displayName: true } },
      assignee: { select: { displayName: true } },
    } as const;
    type JobWithRel = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

    const mapJob = (j: JobWithRel) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      customerId: j.customerId,
      customerDisplayName: j.customer.displayName,
      titleOrSummary: j.titleOrSummary,
      priceCents: j.priceCents,
      scheduledStartAt: j.scheduledStartAt.toISOString(),
      scheduledEndAt: j.scheduledEndAt.toISOString(),
      assigneeTeamMemberId: j.assigneeTeamMemberId,
      assigneeDisplayName: j.assignee?.displayName ?? null,
      jobStage: j.jobStage,
      finishedAt: j.finishedAt?.toISOString() ?? null,
    });

    const fetchBefore = async (pivot: Date, pivotId: string | null, limit: number) => {
      const where: Prisma.JobWhereInput = pivotId
        ? {
            AND: [
              filters,
              {
                OR: [
                  { scheduledStartAt: { lt: pivot } },
                  { scheduledStartAt: pivot, id: { lt: pivotId } },
                ],
              },
            ],
          }
        : { AND: [filters, { scheduledStartAt: { lt: pivot } }] };
      const rows = await prisma.job.findMany({
        where,
        orderBy: [{ scheduledStartAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: jobInclude,
      });
      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit);
      const tail = sliced[sliced.length - 1];
      const nextCursor = hasMore && tail ? encodeJobsCursor(tail.scheduledStartAt, tail.id) : null;
      return { rows: sliced, hasMore, nextCursor };
    };

    const fetchAfter = async (
      pivot: Date,
      pivotId: string | null,
      limit: number,
      inclusive: boolean,
    ) => {
      const where: Prisma.JobWhereInput = pivotId
        ? {
            AND: [
              filters,
              {
                OR: [
                  { scheduledStartAt: { gt: pivot } },
                  { scheduledStartAt: pivot, id: { gt: pivotId } },
                ],
              },
            ],
          }
        : {
            AND: [
              filters,
              { scheduledStartAt: inclusive ? { gte: pivot } : { gt: pivot } },
            ],
          };
      const rows = await prisma.job.findMany({
        where,
        orderBy: [{ scheduledStartAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        include: jobInclude,
      });
      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit);
      const tail = sliced[sliced.length - 1];
      const nextCursor = hasMore && tail ? encodeJobsCursor(tail.scheduledStartAt, tail.id) : null;
      return { rows: sliced, hasMore, nextCursor };
    };

    const cursor = parseJobsCursor(query.cursor);

    // Paged request: one-directional fetch from a cursor.
    if (query.direction && cursor) {
      const limit = query.limit ?? DEFAULT_PAGE;
      if (query.direction === 'after') {
        const { rows, hasMore, nextCursor } = await fetchAfter(
          cursor.startAt,
          cursor.id,
          limit,
          false,
        );
        return reply.send({
          items: rows.map(mapJob),
          nextCursor: null,
          nextCursorAfter: nextCursor,
          hasMoreAfter: hasMore,
        });
      }
      const { rows, hasMore, nextCursor } = await fetchBefore(cursor.startAt, cursor.id, limit);
      return reply.send({
        items: rows.reverse().map(mapJob),
        nextCursor: null,
        nextCursorBefore: nextCursor,
        hasMoreBefore: hasMore,
      });
    }

    // Initial window around the anchor (default: today).
    const anchor = query.anchor ? new Date(query.anchor) : new Date();

    const [beforeRes, afterRes] = await Promise.all([
      fetchBefore(anchor, null, DEFAULT_BEFORE),
      fetchAfter(anchor, null, DEFAULT_AFTER, true),
    ]);

    const items = [...beforeRes.rows.slice().reverse(), ...afterRes.rows].map(mapJob);

    return reply.send({
      items,
      nextCursor: null,
      nextCursorBefore: beforeRes.nextCursor,
      hasMoreBefore: beforeRes.hasMore,
      nextCursorAfter: afterRes.nextCursor,
      hasMoreAfter: afterRes.hasMore,
    });
  });

  // ── Detail ────────────────────────────────────────────────────────────
  fastify.get('/api/jobs/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const job = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      include: JOB_INCLUDE,
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    return reply.send({ item: jobDto(job) });
  });

  // ── Notes for a job ──────────────────────────────────────────────────
  fastify.get('/api/jobs/:id/notes', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const job = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true, customerId: true },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    // Return both notes scoped to this job AND customer-level notes
    // (jobId=null) so the centralized notes panel shows everything.
    const notes = await prisma.customerNote.findMany({
      where: {
        organizationId: req.auth.orgId,
        customerId: job.customerId,
        OR: [{ jobId: id }, { jobId: null }],
      },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { email: true } } },
    });

    return reply.send({
      notes: notes.map((n) => ({
        id: n.id,
        noteGroupId: n.noteGroupId,
        jobId: n.jobId,
        customerId: n.customerId,
        content: n.content,
        authorUserId: n.authorUserId,
        authorEmail: n.author?.email ?? null,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  });

  // ── Edit (basic fields) ──────────────────────────────────────────────
  fastify.patch('/api/jobs/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true, customerId: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    const body = updateJobRequestSchema.parse(req.body);

    if (body.customerAddressId) {
      await validateAddressOwnership(existing.customerId, body.customerAddressId, req.auth.orgId);
    }

    const tags = body.tags ? dedupeTags(body.tags) : undefined;
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    let replaceItems: JobServiceItemInput[] | null = null;
    let totalCentsOverride: number | undefined;
    let primaryServiceIdOverride: string | null | undefined;
    if (body.services !== undefined) {
      replaceItems = normalizeServiceItems({ services: body.services });
      await validateServiceIds(replaceItems, orgId);
      const derived = deriveJobTotals(replaceItems);
      totalCentsOverride = derived.totalCents;
      primaryServiceIdOverride = derived.primaryServiceId;
    }

    const result = await prisma.$transaction(async (tx) => {
      if (replaceItems) {
        await tx.jobServiceItem.deleteMany({ where: { jobId: id } });
      }
      const updated = await tx.job.update({
        where: { id },
        data: {
          customerAddressId: body.customerAddressId ?? undefined,
          serviceId:
            primaryServiceIdOverride !== undefined
              ? primaryServiceIdOverride
              : body.serviceId !== undefined
                ? body.serviceId
                : undefined,
          titleOrSummary: body.titleOrSummary !== undefined ? body.titleOrSummary : undefined,
          priceCents:
            totalCentsOverride !== undefined ? totalCentsOverride : (body.priceCents ?? undefined),
          leadSource: body.leadSource !== undefined ? body.leadSource : undefined,
          privateNotes: body.privateNotes !== undefined ? body.privateNotes : undefined,
          ...(tags
            ? {
                tags: {
                  deleteMany: {},
                  create: tags.map((tag) => ({ tag })),
                },
              }
            : {}),
          ...(replaceItems
            ? {
                serviceItems: {
                  create: replaceItems.map((item, idx) => ({
                    serviceId: item.serviceId ?? null,
                    priceCents: item.priceCents,
                    nameSnapshot: item.nameSnapshot ?? null,
                    orderIndex: idx,
                  })),
                },
              }
            : {}),
        },
        include: JOB_INCLUDE,
      });

      const noteMappings = body.noteOps && body.noteOps.length > 0
        ? await processNoteOps({
            tx,
            orgId,
            jobId: id,
            customerId: existing.customerId,
            authorUserId: actorUserId,
            recurringSeriesId: null,
            occurrenceIndex: null,
            scope: 'this',
            noteOps: body.noteOps,
          })
        : [];

      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'job',
        entityId: id,
        action: 'update',
      });

      return { updated, noteMappings };
    });

    return reply.send({ item: jobDto(result.updated), noteMappings: result.noteMappings });
  });

  // ── Schedule ──────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/schedule', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true, customerId: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    const body = scheduleJobRequestSchema.parse(req.body);

    await checkDnsBlock(existing.customerId, req.auth.orgId);

    if (body.assigneeTeamMemberId) {
      await validateAssignee(body.assigneeTeamMemberId, req.auth.orgId);
    }

    const updated = await prisma.job.update({
      where: { id },
      data: {
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        ...(body.assigneeTeamMemberId !== undefined
          ? { assigneeTeamMemberId: body.assigneeTeamMemberId }
          : {}),
      },
      include: JOB_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'job',
      entityId: id,
      action: 'schedule',
    });

    return reply.send({ item: jobDto(updated) });
  });

  // ── Assign ────────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/assign', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    const body = assignJobRequestSchema.parse(req.body);
    await validateAssignee(body.assigneeTeamMemberId, req.auth.orgId);

    const updated = await prisma.job.update({
      where: { id },
      data: { assigneeTeamMemberId: body.assigneeTeamMemberId },
      include: JOB_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'job',
      entityId: id,
      action: 'assign',
      payload: { assigneeTeamMemberId: body.assigneeTeamMemberId },
    });

    return reply.send({ item: jobDto(updated) });
  });

  // ── Unassign ──────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/unassign', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    const updated = await prisma.job.update({
      where: { id },
      data: { assigneeTeamMemberId: null },
      include: JOB_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'job',
      entityId: id,
      action: 'unassign',
    });

    return reply.send({ item: jobDto(updated) });
  });

  // ── Finish ────────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/finish', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: {
        id: true,
        jobStage: true,
        customerId: true,
        titleOrSummary: true,
        priceCents: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id },
        data: {
          jobStage: 'job_done',
          finishedAt: new Date(),
        },
        include: JOB_INCLUDE,
      });

      const invoiceNumber = await nextInvoiceNumber(orgId, tx);
      const priceCents = job.priceCents;
      const snap = buildInvoiceDataFromJob(job);
      const companySnap = await buildCompanySnapshot(tx, orgId);

      const invoice = await tx.invoice.create({
        data: {
          organizationId: orgId,
          invoiceNumber,
          jobId: id,
          customerId: job.customerId,
          status: 'draft',
          subtotalCents: priceCents,
          totalCents: priceCents,
          amountDueCents: priceCents,
          paidCents: 0,
          serviceNameSnapshot: snap.serviceNameSnapshot,
          servicePriceCentsSnapshot: snap.servicePriceCentsSnapshot,
          serviceDateSnapshot: snap.serviceDateSnapshot,
          ...companySnap,
          dueDate: null,
          publicToken: newInvoicePublicToken(),
          lineItems: { create: snap.lineItems },
        },
      });

      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'job',
        entityId: id,
        action: 'finish',
        payload: { invoiceId: invoice.id },
      });

      return {
        job: {
          ...jobDto(job),
          invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            totalCents: invoice.totalCents,
          },
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
        },
      };
    });

    return reply.send({ item: result.job, invoice: result.invoice });
  });

  // ── Reopen ────────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/reopen', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      include: { invoice: { select: { id: true, status: true } } },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    if (existing.invoice && existing.invoice.status === 'paid') {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_DRAFT_CANNOT_REOPEN,
        400,
        'Cannot reopen — invoice has already been paid',
      );
    }

    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    const result = await prisma.$transaction(async (tx) => {
      if (existing.invoice) {
        await tx.invoice.delete({ where: { id: existing.invoice.id } });
      }

      const reopened = await tx.job.update({
        where: { id },
        data: {
          jobStage: 'confirmed',
          finishedAt: null,
        },
        include: JOB_INCLUDE,
      });

      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'job',
        entityId: id,
        action: 'reopen',
      });

      return reopened;
    });

    return reply.send({ item: jobDto(result) });
  });

  // ── Set stage ─────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/stage', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const { stage, scope } = z
      .object({
        stage: z.enum(['scheduled', 'confirmation_sent', 'confirmed', 'job_done', 'cancelled']),
        scope: z.enum(['this', 'this_and_future']).optional(),
      })
      .parse(req.body);

    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: {
        id: true,
        jobStage: true,
        customerId: true,
        titleOrSummary: true,
        priceCents: true,
        recurringSeriesId: true,
        occurrenceIndex: true,
        scheduledStartAt: true,
      },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    if (existing.jobStage === 'job_done') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        400,
        'Cannot change stage of a completed job — use reopen instead',
      );
    }

    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    // cancelled + this_and_future: mark this and all future occurrences in the series
    if (stage === 'cancelled' && scope === 'this_and_future' && existing.recurringSeriesId) {
      const cutoff = existing.occurrenceIndex ?? 0;
      await prisma.$transaction(async (tx) => {
        await tx.job.updateMany({
          where: {
            organizationId: orgId,
            recurringSeriesId: existing.recurringSeriesId,
            occurrenceIndex: { gte: cutoff },
            deletedFromSeriesAt: null,
          },
          data: { jobStage: 'cancelled' },
        });
        await auditLog(tx, {
          organizationId: orgId,
          actorUserId,
          entityType: 'job',
          entityId: id,
          action: 'stage',
          payload: { stage, scope: 'this_and_future' },
        });
      });
      const updated = await prisma.job.findFirstOrThrow({
        where: { id },
        include: JOB_INCLUDE,
      });
      return reply.send({ item: jobDto(updated) });
    }

    // job_done: set stage + finish (auto-invoice) only if not already done
    if (stage === 'job_done') {
      const result = await prisma.$transaction(async (tx) => {
        const updateData: Record<string, unknown> = { jobStage: 'job_done' };
        if (existing.jobStage !== 'job_done') {
          updateData.finishedAt = new Date();
        }
        const job = await tx.job.update({
          where: { id },
          data: updateData,
          include: JOB_INCLUDE,
        });

        // only create invoice if none exists yet
        let invoice = job.invoice;
        if (!invoice) {
          const invoiceNumber = await nextInvoiceNumber(orgId, tx);
          const snap = buildInvoiceDataFromJob(job);
          const companySnap = await buildCompanySnapshot(tx, orgId);
          invoice = await tx.invoice.create({
            data: {
              organizationId: orgId,
              invoiceNumber,
              jobId: id,
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
          });
        }

        await auditLog(tx, {
          organizationId: orgId,
          actorUserId,
          entityType: 'job',
          entityId: id,
          action: 'stage',
          payload: { stage: 'job_done', invoiceId: invoice.id },
        });

        return {
          job: {
            ...jobDto(job),
            invoice: {
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: invoice.status,
              totalCents: invoice.totalCents,
            },
          },
        };
      });
      return reply.send({ item: result.job });
    }

    // all other stages: update this job only
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id },
        data: { jobStage: stage },
        include: JOB_INCLUDE,
      });
      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'job',
        entityId: id,
        action: 'stage',
        payload: { stage },
      });
      return job;
    });

    return reply.send({ item: jobDto(result) });
  });

  // ── Delete (non-recurring only) ──────────────────────────────────────
  fastify.delete('/api/jobs/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const orgId = req.auth.orgId;

    const job = await prisma.job.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        jobNumber: true,
        jobStage: true,
        recurringSeriesId: true,
        invoice: { select: { status: true } },
      },
    });
    if (!job) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');
    if (job.recurringSeriesId) {
      throw new ApiError(ERROR_CODES.NOT_RECURRING, 400, 'Use occurrence-delete for recurring jobs');
    }
    if (job.jobStage === 'job_done' && job.invoice) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        400,
        `Job #${job.jobNumber} cannot be deleted because it is marked as done`,
      );
    }
    if (job.invoice?.status === 'paid') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'Cannot delete a job with a paid invoice');
    }

    await prisma.job.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ── Customer jobs list (bidirectional pagination around an anchor) ────
  fastify.get('/api/customers/:customerId/jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId } = customerIdParam.parse(req.params);
    const q = customerJobsQuerySchema.parse(req.query);
    const orgId = req.auth.orgId;

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      select: { id: true },
    });
    if (!customer) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const DEFAULT_BEFORE = 15;
    const DEFAULT_AFTER = 25;
    const DEFAULT_PAGE = 15;

    const anchor = q.anchor ? new Date(q.anchor) : new Date();
    const cursor = parseJobsCursor(q.cursor);

    const jobInclude = {
      customer: { select: { displayName: true } },
      assignee: { select: { displayName: true } },
    } as const;
    type JobWithRel = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

    const mapJob = (j: JobWithRel) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      customerId: j.customerId,
      customerDisplayName: j.customer.displayName,
      titleOrSummary: j.titleOrSummary,
      priceCents: j.priceCents,
      scheduledStartAt: j.scheduledStartAt.toISOString(),
      scheduledEndAt: j.scheduledEndAt.toISOString(),
      assigneeTeamMemberId: j.assigneeTeamMemberId,
      assigneeDisplayName: j.assignee?.displayName ?? null,
      jobStage: j.jobStage,
      finishedAt: j.finishedAt?.toISOString() ?? null,
    });

    const baseWhere = {
      customerId,
      organizationId: orgId,
      deletedFromSeriesAt: null,
    } as const;

    const fetchBefore = async (pivot: Date, pivotId: string | null, limit: number) => {
      const where: Prisma.JobWhereInput = pivotId
        ? {
            ...baseWhere,
            OR: [
              { scheduledStartAt: { lt: pivot } },
              { scheduledStartAt: pivot, id: { lt: pivotId } },
            ],
          }
        : { ...baseWhere, scheduledStartAt: { lt: pivot } };
      const rows = await prisma.job.findMany({
        where,
        orderBy: [{ scheduledStartAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: jobInclude,
      });
      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit);
      const tail = sliced[sliced.length - 1];
      const nextCursor = hasMore && tail ? encodeJobsCursor(tail.scheduledStartAt, tail.id) : null;
      return { rows: sliced, hasMore, nextCursor };
    };

    const fetchAfter = async (
      pivot: Date,
      pivotId: string | null,
      limit: number,
      inclusive: boolean,
    ) => {
      const where: Prisma.JobWhereInput = pivotId
        ? {
            ...baseWhere,
            OR: [
              { scheduledStartAt: { gt: pivot } },
              { scheduledStartAt: pivot, id: { gt: pivotId } },
            ],
          }
        : {
            ...baseWhere,
            scheduledStartAt: inclusive ? { gte: pivot } : { gt: pivot },
          };
      const rows = await prisma.job.findMany({
        where,
        orderBy: [{ scheduledStartAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        include: jobInclude,
      });
      const hasMore = rows.length > limit;
      const sliced = rows.slice(0, limit);
      const tail = sliced[sliced.length - 1];
      const nextCursor = hasMore && tail ? encodeJobsCursor(tail.scheduledStartAt, tail.id) : null;
      return { rows: sliced, hasMore, nextCursor };
    };

    // Paged request: one-directional fetch from a cursor.
    if (q.direction && cursor) {
      const limit = q.limit ?? DEFAULT_PAGE;
      if (q.direction === 'after') {
        const target = new Date(cursor.startAt.getTime() + 365 * 24 * 60 * 60 * 1000);
        await ensureMaterializedUntil(orgId, target, { customerId });
        const { rows, hasMore, nextCursor } = await fetchAfter(cursor.startAt, cursor.id, limit, false);
        return reply.send({
          items: rows.map(mapJob),
          nextCursor: null,
          nextCursorAfter: nextCursor,
          hasMoreAfter: hasMore,
        });
      }
      const { rows, hasMore, nextCursor } = await fetchBefore(cursor.startAt, cursor.id, limit);
      return reply.send({
        items: rows.reverse().map(mapJob),
        nextCursor: null,
        nextCursorBefore: nextCursor,
        hasMoreBefore: hasMore,
      });
    }

    // Initial window around the anchor.
    const defaultHorizon = new Date();
    defaultHorizon.setFullYear(defaultHorizon.getFullYear() + 2);
    await ensureMaterializedUntil(orgId, defaultHorizon, { customerId });

    const [beforeRes, afterRes] = await Promise.all([
      fetchBefore(anchor, null, DEFAULT_BEFORE),
      fetchAfter(anchor, null, DEFAULT_AFTER, true),
    ]);

    const items = [...beforeRes.rows.slice().reverse(), ...afterRes.rows].map(mapJob);

    return reply.send({
      items,
      nextCursor: null,
      nextCursorBefore: beforeRes.nextCursor,
      hasMoreBefore: beforeRes.hasMore,
      nextCursorAfter: afterRes.nextCursor,
      hasMoreAfter: afterRes.hasMore,
    });
  });
}
