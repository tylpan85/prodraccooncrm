import { type Prisma, type PrismaClient, prisma } from '@openclaw/db';
import {
  type CreateJobRequest,
  ERROR_CODES,
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
import { requireAuth } from '../auth/guard.js';

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
    scheduleState: j.scheduleState,
    scheduledStartAt: j.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: j.scheduledEndAt?.toISOString() ?? null,
    assigneeTeamMemberId: j.assigneeTeamMemberId,
    assigneeDisplayName: j.assignee?.displayName ?? null,
    jobStatus: j.jobStatus,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    tags: j.tags.map((t) => t.tag),
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

async function checkDnsBlock(customerId: string, orgId: string, isScheduled: boolean) {
  if (!isScheduled) return;
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

    const isScheduled = body.scheduledStartAt != null && body.scheduledEndAt != null;

    if (isScheduled && customer.doNotService) {
      throw new ApiError(
        ERROR_CODES.DO_NOT_SERVICE_BLOCK,
        400,
        'Cannot schedule a job for a Do Not Service customer',
      );
    }

    if (body.assigneeTeamMemberId) {
      await validateAssignee(body.assigneeTeamMemberId, req.auth.orgId);
    }

    if (body.serviceId) {
      const svc = await prisma.service.findFirst({
        where: { id: body.serviceId, organizationId: req.auth.orgId },
        select: { name: true },
      });
      if (!svc) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 400, 'Service not found');
      }
    }

    const tags = body.tags ? dedupeTags(body.tags) : [];
    const orgId = req.auth.orgId;
    const actorUserId = req.auth.sub;

    const job = await prisma.$transaction(async (tx) => {
      const jobNumber = await nextJobNumber(orgId, tx);

      const created = await tx.job.create({
        data: {
          organizationId: orgId,
          jobNumber,
          customerId,
          customerAddressId: body.customerAddressId,
          serviceId: body.serviceId ?? null,
          titleOrSummary: body.titleOrSummary ?? null,
          priceCents: body.priceCents ?? 0,
          leadSource: body.leadSource ?? null,
          privateNotes: body.privateNotes ?? null,
          scheduleState: isScheduled ? 'scheduled' : 'unscheduled',
          scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
          scheduledEndAt: body.scheduledEndAt ? new Date(body.scheduledEndAt) : null,
          assigneeTeamMemberId: body.assigneeTeamMemberId ?? null,
          tags: tags.length > 0 ? { create: tags.map((tag) => ({ tag })) } : undefined,
        },
        include: JOB_INCLUDE,
      });
      await auditLog(tx, {
        organizationId: orgId,
        actorUserId,
        entityType: 'job',
        entityId: created.id,
        action: 'create',
        payload: { jobNumber: created.jobNumber, customerId },
      });
      return created;
    });

    return reply.code(201).send({ item: jobDto(job) });
  });

  // ── List ──────────────────────────────────────────────────────────────
  fastify.get('/api/jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const query = jobListQuerySchema.parse(req.query);

    const where: Prisma.JobWhereInput = {
      organizationId: req.auth.orgId,
      deletedFromSeriesAt: null,
    };
    if (query.customerId) where.customerId = query.customerId;
    if (query.scheduleState) where.scheduleState = query.scheduleState;
    if (query.jobStatus) where.jobStatus = query.jobStatus;
    if (query.assigneeTeamMemberId) where.assigneeTeamMemberId = query.assigneeTeamMemberId;
    if (query.dateFrom || query.dateTo) {
      where.scheduledStartAt = {};
      if (query.dateFrom) where.scheduledStartAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.scheduledStartAt.lte = new Date(query.dateTo);
    }
    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      where.OR = [
        { titleOrSummary: { contains: q, mode: 'insensitive' } },
        { jobNumber: { contains: q, mode: 'insensitive' } },
        { customer: { displayName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const limit = query.limit;
    const rows = await prisma.job.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        customer: { select: { displayName: true } },
        assignee: { select: { displayName: true } },
      },
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      customerId: j.customerId,
      customerDisplayName: j.customer.displayName,
      titleOrSummary: j.titleOrSummary,
      priceCents: j.priceCents,
      scheduleState: j.scheduleState,
      scheduledStartAt: j.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: j.scheduledEndAt?.toISOString() ?? null,
      assigneeTeamMemberId: j.assigneeTeamMemberId,
      assigneeDisplayName: j.assignee?.displayName ?? null,
      jobStatus: j.jobStatus,
      finishedAt: j.finishedAt?.toISOString() ?? null,
    }));

    return reply.send({
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
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

    const updated = await prisma.job.update({
      where: { id },
      data: {
        customerAddressId: body.customerAddressId ?? undefined,
        serviceId: body.serviceId !== undefined ? body.serviceId : undefined,
        titleOrSummary: body.titleOrSummary !== undefined ? body.titleOrSummary : undefined,
        priceCents: body.priceCents ?? undefined,
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
      },
      include: JOB_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'job',
      entityId: id,
      action: 'update',
    });

    return reply.send({ item: jobDto(updated) });
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

    await checkDnsBlock(existing.customerId, req.auth.orgId, true);

    if (body.assigneeTeamMemberId) {
      await validateAssignee(body.assigneeTeamMemberId, req.auth.orgId);
    }

    const updated = await prisma.job.update({
      where: { id },
      data: {
        scheduleState: 'scheduled',
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

  // ── Unschedule ────────────────────────────────────────────────────────
  fastify.post('/api/jobs/:id/unschedule', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.job.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(ERROR_CODES.JOB_NOT_FOUND, 404, 'Job not found');

    const updated = await prisma.job.update({
      where: { id },
      data: {
        scheduleState: 'unscheduled',
        scheduledStartAt: null,
        scheduledEndAt: null,
      },
      include: JOB_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'job',
      entityId: id,
      action: 'unschedule',
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
        jobStatus: true,
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
          jobStatus: 'finished',
          finishedAt: new Date(),
        },
        include: JOB_INCLUDE,
      });

      const invoiceNumber = await nextInvoiceNumber(orgId, tx);
      const priceCents = job.priceCents;

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
          serviceNameSnapshot: job.titleOrSummary,
          servicePriceCentsSnapshot: priceCents,
          dueDate: null,
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

    if (existing.invoice && existing.invoice.status !== 'draft') {
      throw new ApiError(
        ERROR_CODES.INVOICE_NOT_DRAFT_CANNOT_REOPEN,
        400,
        'Cannot reopen — invoice is no longer a draft',
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
          jobStatus: 'open',
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

  // ── Customer jobs list (replaces the Phase 4 stub) ────────────────────
  fastify.get('/api/customers/:customerId/jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { customerId } = customerIdParam.parse(req.params);

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!customer) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const jobs = await prisma.job.findMany({
      where: {
        customerId,
        organizationId: req.auth.orgId,
        deletedFromSeriesAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 50,
      include: {
        customer: { select: { displayName: true } },
        assignee: { select: { displayName: true } },
      },
    });

    return reply.send({
      items: jobs.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        customerId: j.customerId,
        customerDisplayName: j.customer.displayName,
        titleOrSummary: j.titleOrSummary,
        priceCents: j.priceCents,
        scheduleState: j.scheduleState,
        scheduledStartAt: j.scheduledStartAt?.toISOString() ?? null,
        scheduledEndAt: j.scheduledEndAt?.toISOString() ?? null,
        assigneeTeamMemberId: j.assigneeTeamMemberId,
        assigneeDisplayName: j.assignee?.displayName ?? null,
        jobStatus: j.jobStatus,
        finishedAt: j.finishedAt?.toISOString() ?? null,
      })),
      nextCursor: null,
    });
  });
}
