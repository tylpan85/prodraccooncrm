import { type Prisma, prisma } from '@openclaw/db';
import {
  type AddressInput,
  type CreateCustomerRequest,
  ERROR_CODES,
  type EmailInput,
  type PhoneInput,
  createCustomerRequestSchema,
  customerListQuerySchema,
  deriveDisplayName,
  digitsOnly,
  searchDuplicatesQuerySchema,
  updateCustomerRequestSchema,
} from '@openclaw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/error-envelope.js';
import { requireAuth } from '../auth/guard.js';

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
    sendNotifications: c.sendNotifications,
    customerNotes: c.customerNotes,
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
    const { q, cursor, limit } = customerListQuerySchema.parse(req.query);

    const where: Prisma.CustomerWhereInput = { organizationId: req.auth.orgId };
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

    const rows = await prisma.customer.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        phones: { orderBy: { createdAt: 'asc' }, take: 1 },
        emails: { orderBy: { createdAt: 'asc' }, take: 1 },
        addresses: { orderBy: { createdAt: 'asc' }, take: 1 },
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
      primaryPhone: c.phones[0]?.value ?? null,
      primaryEmail: c.emails[0]?.value ?? null,
      city: c.addresses[0]?.city ?? null,
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
          customerNotes: body.customerNotes ?? null,
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
        customerNotes: body.customerNotes !== undefined ? body.customerNotes : undefined,
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

    return reply.send({ item: customerDto(updated) });
  });

  fastify.get('/api/customers/:id/jobs', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const exists = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    return reply.send({ items: [], nextCursor: null });
  });

  fastify.get('/api/customers/:id/invoices', async (req, reply) => {
    if (!req.auth) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Not authenticated');
    const { id } = idParam.parse(req.params);
    const exists = await prisma.customer.findFirst({
      where: { id, organizationId: req.auth.orgId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
    return reply.send({ items: [], nextCursor: null });
  });
}
