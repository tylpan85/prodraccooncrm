import { type Prisma, prisma } from '@openclaw/db';
import {
  type AddressInput,
  type CreateCustomerRequest,
  ERROR_CODES,
  type EmailInput,
  type PhoneInput,
  createCustomerRequestSchema,
  customerListQuerySchema,
  customerStatementQuerySchema,
  deriveDisplayName,
  digitsOnly,
  saveCustomerNotesRequestSchema,
  searchDuplicatesQuerySchema,
  updateCustomerRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { ApiError } from '../../lib/error-envelope.js';
import { buildCustomerStatementPdf } from '../../lib/statement-pdf.js';
import { requireAuth } from '../auth/guard.js';
import { processCustomerNoteOps } from '../scheduling/notes.js';

type CustomerRecord = Prisma.CustomerGetPayload<{
  include: {
    addresses: { orderBy: { createdAt: 'asc' } };
    phones: { orderBy: { createdAt: 'asc' } };
    emails: { orderBy: { createdAt: 'asc' } };
    tags: true;
  };
}>;

const CUSTOMER_INCLUDE = {
  addresses: { orderBy: { createdAt: 'asc' as const } },
  phones: { orderBy: { createdAt: 'asc' as const } },
  emails: { orderBy: { createdAt: 'asc' as const } },
  tags: true,
} as const;

function customerDto(c: CustomerRecord) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    displayName: c.displayName,
    role: c.role,
    customerType: c.customerType,
    subcontractor: c.subcontractor,
    doNotService: c.doNotService,
    archived: c.archived,
    sendNotifications: c.sendNotifications,
    leadSource: c.leadSource,
    referredBy: c.referredBy,
    billingAddress: c.billingAddress,
    addresses: c.addresses.map((a) => ({
      id: a.id,
      street: a.street,
      unit: a.unit,
      city: a.city,
      state: a.state,
      zip: a.zip,
      notes: a.notes,
    })),
    phones: c.phones.map((p) => ({
      id: p.id,
      value: p.value,
      type: p.type,
      note: p.note,
    })),
    emails: c.emails.map((e) => ({
      id: e.id,
      value: e.value,
    })),
    tags: c.tags.map((t) => t.tag),
  };
}

function normalizeSendNotifications(input: {
  doNotService?: boolean;
  sendNotifications?: boolean;
}): boolean | undefined {
  if (input.doNotService === true) return false;
  return input.sendNotifications;
}

async function findDuplicateConflict(
  orgId: string,
  phones: PhoneInput[] | undefined,
  emails: EmailInput[] | undefined,
  excludeCustomerId?: string,
): Promise<{
  conflictType: 'phone' | 'email';
  existingCustomerId: string;
  matchedValue: string;
} | null> {
  const phoneDigits = (phones ?? []).map((p) => digitsOnly(p.value)).filter((d) => d.length > 0);

  if (phoneDigits.length > 0) {
    const phoneHit = await prisma.customerPhone.findFirst({
      where: {
        digitsOnly: { in: phoneDigits },
        customer: {
          organizationId: orgId,
          ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
        },
      },
      select: { customerId: true, digitsOnly: true },
    });
    if (phoneHit) {
      return {
        conflictType: 'phone',
        existingCustomerId: phoneHit.customerId,
        matchedValue: phoneHit.digitsOnly,
      };
    }
  }

  const emailValues = (emails ?? []).map((e) => e.value).filter((v) => v.length > 0);
  if (emailValues.length > 0) {
    const emailHit = await prisma.customerEmail.findFirst({
      where: {
        value: { in: emailValues, mode: 'insensitive' },
        customer: {
          organizationId: orgId,
          ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
        },
      },
      select: { customerId: true, value: true },
    });
    if (emailHit) {
      return {
        conflictType: 'email',
        existingCustomerId: emailHit.customerId,
        matchedValue: emailHit.value,
      };
    }
  }

  return null;
}

function addressCreateData(input: AddressInput) {
  return {
    street: input.street ?? null,
    unit: input.unit ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    notes: input.notes ?? null,
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

function dedupeEmails(emails: EmailInput[]): EmailInput[] {
  const seen = new Set<string>();
  const result: EmailInput[] = [];
  for (const e of emails) {
    if (seen.has(e.value)) continue;
    seen.add(e.value);
    result.push(e);
  }
  return result;
}

function dedupePhones(phones: PhoneInput[]): PhoneInput[] {
  const seen = new Set<string>();
  const result: PhoneInput[] = [];
  for (const p of phones) {
    const key = digitsOnly(p.value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

export async function customersRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/customers/search-duplicates', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const q = searchDuplicatesQuerySchema.parse(req.query);
    const candidate = deriveDisplayName({
      firstName: q.firstName ?? null,
      lastName: q.lastName ?? null,
      companyName: q.companyName ?? null,
    }).trim();

    if (candidate.length === 0 && !q.city && !q.zip) {
      return reply.send({ items: [] });
    }

    const where: Prisma.CustomerWhereInput = {
      organizationId: req.auth.orgId,
    };
    const conditions: Prisma.CustomerWhereInput[] = [];
    if (candidate.length > 0) {
      conditions.push({ displayName: { contains: candidate, mode: 'insensitive' } });
    }
    if (q.city || q.zip) {
      conditions.push({
        addresses: {
          some: {
            ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
            ...(q.zip ? { zip: q.zip } : {}),
          },
        },
      });
    }
    if (conditions.length > 0) where.AND = conditions;

    const matches = await prisma.customer.findMany({
      where,
      take: 5,
      orderBy: { displayName: 'asc' },
      include: { addresses: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });

    return reply.send({
      items: matches.map((m) => {
        const a = m.addresses[0];
        return {
          id: m.id,
          displayName: m.displayName,
          city: a?.city ?? null,
          zip: a?.zip ?? null,
          street: a?.street ?? null,
        };
      }),
    });
  });

  fastify.get('/api/customers', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const {
      q,
      cursor,
      limit,
      includeArchived,
      customerType,
      subcontractor,
      doNotService,
      sendNotifications,
      tag,
      city,
      state,
      leadSource,
    } = customerListQuerySchema.parse(req.query);

    const where: Prisma.CustomerWhereInput = {
      organizationId: req.auth.orgId,
      archived: includeArchived ? true : false,
    };
    if (q && q.length > 0) {
      const phoneDigits = digitsOnly(q);
      const orClauses: Prisma.CustomerWhereInput[] = [
        { displayName: { contains: q, mode: 'insensitive' } },
        { emails: { some: { value: { contains: q, mode: 'insensitive' } } } },
      ];
      if (phoneDigits.length > 0) {
        orClauses.push({ phones: { some: { digitsOnly: { contains: phoneDigits } } } });
      }
      where.OR = orClauses;
    }
    if (customerType) where.customerType = customerType;
    if (subcontractor !== undefined) where.subcontractor = subcontractor;
    if (doNotService !== undefined) where.doNotService = doNotService;
    if (sendNotifications !== undefined) where.sendNotifications = sendNotifications;
    if (tag) where.tags = { some: { tag } };
    if (leadSource) where.leadSource = { contains: leadSource, mode: 'insensitive' };
    if (city || state) {
      const addressWhere: Prisma.CustomerAddressWhereInput = {};
      if (city) addressWhere.city = { contains: city, mode: 'insensitive' };
      if (state) addressWhere.state = state;
      where.addresses = { some: addressWhere };
    }

    const rows = await prisma.customer.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        phones: { orderBy: { createdAt: 'asc' }, take: 1 },
        emails: { orderBy: { createdAt: 'asc' }, take: 1 },
        addresses: { orderBy: { createdAt: 'asc' } },
        _count: {
          select: {
            jobs: true,
            invoices: { where: { status: { in: ['draft', 'sent', 'past_due'] } } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      customerType: c.customerType,
      doNotService: c.doNotService,
      archived: c.archived,
      primaryPhone: c.phones[0]?.value ?? null,
      primaryEmail: c.emails[0]?.value ?? null,
      city: c.addresses[0]?.city ?? null,
      addresses: c.addresses.map((a) => ({
        id: a.id,
        street: a.street,
        unit: a.unit,
        city: a.city,
        state: a.state,
        zip: a.zip,
      })),
      jobsCount: c._count.jobs,
      openInvoicesCount: c._count.invoices,
    }));

    return reply.send({
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    });
  });

  fastify.post('/api/customers', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const body = createCustomerRequestSchema.parse(req.body) as CreateCustomerRequest;

    const phones = body.phones ? dedupePhones(body.phones) : [];
    const emails = body.emails ? dedupeEmails(body.emails) : [];
    const tags = body.tags ? dedupeTags(body.tags) : [];

    const conflict = await findDuplicateConflict(req.auth.orgId, phones, emails);
    if (conflict) {
      throw new ApiError(
        ERROR_CODES.CUSTOMER_DUPLICATE,
        409,
        'Phone or email already belongs to an existing customer',
        {
          conflictType: conflict.conflictType,
          existingCustomerId: conflict.existingCustomerId,
        },
      );
    }

    const displayName = deriveDisplayName(body);
    const sendNotifications = normalizeSendNotifications(body) ?? true;

    const addressBlocks: AddressInput[] = [
      ...(body.primaryAddress ? [body.primaryAddress] : []),
      ...(body.additionalAddresses ?? []),
    ];

    try {
      const created = await prisma.customer.create({
        data: {
          organizationId: req.auth.orgId,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          companyName: body.companyName ?? null,
          displayName,
          role: body.role ?? null,
          customerType: body.customerType,
          subcontractor: body.subcontractor ?? false,
          doNotService: body.doNotService ?? false,
          sendNotifications,
          leadSource: body.leadSource ?? null,
          referredBy: body.referredBy ?? null,
          billingAddress: body.billingAddress ?? null,
          addresses: addressBlocks.length
            ? { create: addressBlocks.map(addressCreateData) }
            : undefined,
          phones: phones.length
            ? {
                create: phones.map((p) => ({
                  value: p.value.trim(),
                  digitsOnly: digitsOnly(p.value),
                  type: p.type ?? null,
                  note: p.note ?? null,
                })),
              }
            : undefined,
          emails: emails.length ? { create: emails.map((e) => ({ value: e.value })) } : undefined,
          tags: tags.length ? { create: tags.map((tag) => ({ tag })) } : undefined,
        },
        include: CUSTOMER_INCLUDE,
      });
      await auditLog(prisma, {
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        entityType: 'customer',
        entityId: created.id,
        action: 'create',
        payload: { displayName },
      });
      return reply.code(201).send({ item: customerDto(created) });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        (err as { code?: string }).code === 'P2002' &&
        ((err as { meta?: { target?: unknown } }).meta?.target as string[] | undefined)?.includes(
          'value',
        )
      ) {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_DUPLICATE,
          409,
          'Email already belongs to an existing customer',
          { conflictType: 'email' },
        );
      }
      throw err;
    }
  });

  const idParam = z.object({ id: z.string().uuid() });

  fastify.get('/api/customers/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const c = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
      include: CUSTOMER_INCLUDE,
    });
    if (!c) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    return reply.send({ item: customerDto(c) });
  });

  fastify.patch('/api/customers/:id', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const body = updateCustomerRequestSchema.parse(req.body);

    const phones = body.phones ? dedupePhones(body.phones) : undefined;
    const emails = body.emails ? dedupeEmails(body.emails) : undefined;
    const tags = body.tags ? dedupeTags(body.tags) : undefined;

    const conflict = await findDuplicateConflict(req.auth.orgId, phones, emails, id);
    if (conflict) {
      throw new ApiError(
        ERROR_CODES.CUSTOMER_DUPLICATE,
        409,
        'Phone or email already belongs to an existing customer',
        {
          conflictType: conflict.conflictType,
          existingCustomerId: conflict.existingCustomerId,
        },
      );
    }

    const identityNext = {
      firstName: body.firstName !== undefined ? body.firstName : existing.firstName,
      lastName: body.lastName !== undefined ? body.lastName : existing.lastName,
      companyName: body.companyName !== undefined ? body.companyName : existing.companyName,
    };
    const displayName = deriveDisplayName(identityNext);

    const doNotService = body.doNotService ?? existing.doNotService;
    const sendNotifications =
      doNotService === true ? false : (body.sendNotifications ?? existing.sendNotifications);

    const addressOps: Prisma.CustomerAddressUpdateManyWithoutCustomerNestedInput = {};
    if (body.primaryAddress !== undefined || body.additionalAddresses !== undefined) {
      const incoming: AddressInput[] = [
        ...(body.primaryAddress !== undefined ? [body.primaryAddress] : []),
        ...(body.additionalAddresses ?? []),
      ];
      const incomingIds = incoming.filter((a) => a.id).map((a) => a.id as string);
      addressOps.deleteMany = incomingIds.length ? { id: { notIn: incomingIds } } : {};
      addressOps.upsert = incoming.map((a) => ({
        where: { id: a.id ?? '00000000-0000-0000-0000-000000000000' },
        create: addressCreateData(a),
        update: addressCreateData(a),
      }));
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        firstName: body.firstName !== undefined ? body.firstName : undefined,
        lastName: body.lastName !== undefined ? body.lastName : undefined,
        companyName: body.companyName !== undefined ? body.companyName : undefined,
        role: body.role !== undefined ? body.role : undefined,
        customerType: body.customerType ?? undefined,
        subcontractor: body.subcontractor ?? undefined,
        doNotService: body.doNotService ?? undefined,
        sendNotifications,
        leadSource: body.leadSource !== undefined ? body.leadSource : undefined,
        referredBy: body.referredBy !== undefined ? body.referredBy : undefined,
        billingAddress: body.billingAddress !== undefined ? body.billingAddress : undefined,
        displayName,
        ...(Object.keys(addressOps).length > 0 ? { addresses: addressOps } : {}),
        ...(phones
          ? {
              phones: {
                deleteMany: {},
                create: phones.map((p) => ({
                  value: p.value.trim(),
                  digitsOnly: digitsOnly(p.value),
                  type: p.type ?? null,
                  note: p.note ?? null,
                })),
              },
            }
          : {}),
        ...(emails
          ? {
              emails: {
                deleteMany: {},
                create: emails.map((e) => ({ value: e.value })),
              },
            }
          : {}),
        ...(tags
          ? {
              tags: {
                deleteMany: {},
                create: tags.map((tag) => ({ tag })),
              },
            }
          : {}),
      },
      include: CUSTOMER_INCLUDE,
    });

    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'customer',
      entityId: id,
      action: 'update',
    });

    return reply.send({ item: customerDto(updated) });
  });

  fastify.patch('/api/customers/:id/archive', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    const updated = await prisma.customer.update({
      where: { id },
      data: { archived: true },
      include: CUSTOMER_INCLUDE,
    });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'customer',
      entityId: id,
      action: 'archive',
    });
    return reply.send({ item: customerDto(updated) });
  });

  fastify.patch('/api/customers/:id/unarchive', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const existing = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
    });
    if (!existing) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    const updated = await prisma.customer.update({
      where: { id },
      data: { archived: false },
      include: CUSTOMER_INCLUDE,
    });
    await auditLog(prisma, {
      organizationId: req.auth.orgId,
      actorUserId: req.auth.sub,
      entityType: 'customer',
      entityId: id,
      action: 'unarchive',
    });
    return reply.send({ item: customerDto(updated) });
  });

  // /api/customers/:id/jobs moved to scheduling/jobs.ts in Phase 5

  fastify.get('/api/customers/:id/invoices', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const exists = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const invoices = await prisma.invoice.findMany({
      where: { customerId: id, organizationId: req.auth.orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalCents: true,
        amountDueCents: true,
        dueDate: true,
        serviceNameSnapshot: true,
        createdAt: true,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return reply.send({
      items: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        serviceNameSnapshot: inv.serviceNameSnapshot,
        totalCents: inv.totalCents,
        amountDueCents: inv.amountDueCents,
        dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
        status:
          inv.status === 'sent' && inv.dueDate && inv.dueDate < today && inv.amountDueCents > 0
            ? 'past_due'
            : inv.status,
        createdAt: inv.createdAt.toISOString(),
      })),
      nextCursor: null,
    });
  });

  // ── Customer statement (completed jobs + payments in date range) ─────
  async function buildStatementData(
    orgId: string,
    customerId: string,
    dateFrom: string | undefined,
    dateTo: string | undefined,
  ) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      select: { id: true, displayName: true },
    });
    if (!customer) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const dateFromDt = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : undefined;
    const dateToDt = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined;
    const dateFilter: Prisma.DateTimeFilter = {};
    if (dateFromDt) dateFilter.gte = dateFromDt;
    if (dateToDt) dateFilter.lte = dateToDt;
    const hasDateFilter = dateFromDt !== undefined || dateToDt !== undefined;

    const jobs = await prisma.job.findMany({
      where: {
        organizationId: orgId,
        customerId,
        jobStage: 'job_done',
        ...(hasDateFilter ? { finishedAt: dateFilter } : {}),
      },
      include: {
        invoice: true,
        service: { select: { name: true } },
      },
      orderBy: { finishedAt: 'asc' },
    });

    const payments = await prisma.invoicePayment.findMany({
      where: {
        organizationId: orgId,
        invoice: { customerId },
        ...(hasDateFilter ? { paidAt: dateFilter } : {}),
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        paymentMethod: { select: { name: true } },
      },
      orderBy: { paidAt: 'asc' },
    });

    const billed = jobs.reduce((sum, j) => sum + (j.invoice?.totalCents ?? 0), 0);
    const paid = payments.reduce((sum, p) => sum + p.amountCents, 0);
    return {
      customer,
      jobs,
      payments,
      totalsCents: { billed, paid, outstanding: billed - paid },
    };
  }

  fastify.get('/api/customers/:id/statement', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const q = customerStatementQuerySchema.parse({
      customerId: id,
      ...(req.query as Record<string, unknown>),
    });

    const { customer, jobs, payments, totalsCents } = await buildStatementData(
      req.auth.orgId,
      id,
      q.dateFrom,
      q.dateTo,
    );

    return reply.send({
      item: {
        customerId: customer.id,
        customerDisplayName: customer.displayName,
        dateFrom: q.dateFrom ?? null,
        dateTo: q.dateTo ?? null,
        jobs: jobs.map((j) => ({
          jobId: j.id,
          jobNumber: j.jobNumber,
          doneAt: (j.finishedAt ?? j.updatedAt).toISOString(),
          serviceName: j.service?.name ?? j.invoice?.serviceNameSnapshot ?? null,
          invoiceId: j.invoice?.id ?? null,
          invoiceNumber: j.invoice?.invoiceNumber ?? null,
          invoiceStatus: j.invoice?.status ?? null,
          totalCents: j.invoice?.totalCents ?? 0,
          amountDueCents: j.invoice?.amountDueCents ?? 0,
        })),
        payments: payments.map((p) => ({
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
          invoiceId: p.invoice.id,
          invoiceNumber: p.invoice.invoiceNumber,
        })),
        totalsCents,
        generatedAt: new Date().toISOString(),
      },
    });
  });

  fastify.get('/api/customers/:id/statement/pdf', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const q = customerStatementQuerySchema.parse({
      customerId: id,
      ...(req.query as Record<string, unknown>),
    });

    const { customer, jobs, payments, totalsCents } = await buildStatementData(
      req.auth.orgId,
      id,
      q.dateFrom,
      q.dateTo,
    );

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.auth.orgId },
      select: { name: true, address: true, phone: true, website: true },
    });

    const buf = await buildCustomerStatementPdf({
      customerDisplayName: customer.displayName,
      dateFrom: q.dateFrom ?? null,
      dateTo: q.dateTo ?? null,
      generatedAt: new Date().toISOString(),
      jobs: jobs.map((j) => ({
        jobNumber: j.jobNumber,
        doneAt: (j.finishedAt ?? j.updatedAt).toISOString(),
        serviceName: j.service?.name ?? j.invoice?.serviceNameSnapshot ?? null,
        invoiceNumber: j.invoice?.invoiceNumber ?? null,
        invoiceStatus: j.invoice?.status ?? null,
        totalCents: j.invoice?.totalCents ?? 0,
        amountDueCents: j.invoice?.amountDueCents ?? 0,
      })),
      payments: payments.map((p) => ({
        paidAt: p.paidAt.toISOString(),
        invoiceNumber: p.invoice.invoiceNumber,
        paymentMethodName: p.paymentMethod?.name ?? p.paymentMethodNameSnapshot,
        reference: p.reference,
        amountCents: p.amountCents,
      })),
      totalsCents,
      companyName: org.name,
      companyAddress: org.address,
      companyPhone: org.phone,
      companyWebsite: org.website,
    });

    const safeName = (customer.displayName ?? 'customer').replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `statement-${safeName}-${q.dateFrom ?? 'all'}-${q.dateTo ?? 'now'}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .send(buf);
  });

  // ── Customer-level notes (centralized: every note for the customer) ──
  // The customer page shows ONE row per logical note. For series-replicated
  // notes (noteGroupId set on multiple jobs) we collapse to a single
  // representative row (lowest createdAt) so the user sees the note once.
  fastify.get('/api/customers/:id/notes', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const exists = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const rows = await prisma.customerNote.findMany({
      where: { organizationId: req.auth.orgId, customerId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { email: true } } },
    });

    const seenGroups = new Set<string>();
    const deduped = rows.filter((n) => {
      if (n.noteGroupId === null) return true;
      if (seenGroups.has(n.noteGroupId)) return false;
      seenGroups.add(n.noteGroupId);
      return true;
    });

    return reply.send({
      notes: deduped.map((n) => ({
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

  fastify.post('/api/customers/:id/notes/save', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const exists = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');

    const body = saveCustomerNotesRequestSchema.parse(req.body);

    const noteMappings = await prisma.$transaction(async (tx) => {
      return processCustomerNoteOps({
        tx,
        orgId: req.auth!.orgId,
        customerId: id,
        authorUserId: req.auth!.sub,
        noteOps: body.noteOps,
      });
    });

    const rows = await prisma.customerNote.findMany({
      where: { organizationId: req.auth.orgId, customerId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { email: true } } },
    });

    const seenGroups = new Set<string>();
    const deduped = rows.filter((n) => {
      if (n.noteGroupId === null) return true;
      if (seenGroups.has(n.noteGroupId)) return false;
      seenGroups.add(n.noteGroupId);
      return true;
    });

    return reply.send({
      notes: deduped.map((n) => ({
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
      noteMappings,
    });
  });
}
