/**
 * Demo seed — adds realistic sample data on top of the base seed.
 * Run: pnpm seed:demo  (from monorepo root)
 *
 * Creates: 5 customers, 8 jobs, 2 recurring series,
 * and a week of events so the scheduler looks alive on first open.
 */

import { prisma } from './index.js';
import {
  type Prisma,
  CustomerType,
  InvoiceStatus,
  RecurrenceFrequency,
  RecurrenceEndMode,
  DayOfWeek,
  JobStage,
} from '@prisma/client';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

// ── helpers ────────────────────────────────────────────────────────────

function todayAt(hour: number, min = 0): Date {
  const d = new Date();
  d.setUTCHours(hour, min, 0, 0);
  return d;
}

function dayOffset(days: number, hour: number, min = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, min, 0, 0);
  return d;
}

async function nextJobNumber(): Promise<string> {
  const counter = await prisma.organizationCounter.update({
    where: { organizationId_name: { organizationId: ORG_ID, name: 'job_number' } },
    data: { nextValue: { increment: 1 } },
  });
  return String(counter.nextValue - 1);
}

async function nextInvoiceNumber(): Promise<string> {
  const counter = await prisma.organizationCounter.update({
    where: { organizationId_name: { organizationId: ORG_ID, name: 'invoice_number' } },
    data: { nextValue: { increment: 1 } },
  });
  return String(counter.nextValue - 1);
}

// ── main ───────────────────────────────────────────────────────────────

async function seedDemo() {
  // Grab team members seeded by base seed
  const teamMembers = await prisma.teamMember.findMany({
    where: { organizationId: ORG_ID },
    orderBy: { displayName: 'asc' },
  });
  if (teamMembers.length < 2) {
    throw new Error('Base seed must run first (need at least 2 team members)');
  }
  const [alex, jordan] = teamMembers;

  // Grab services
  const services = await prisma.service.findMany({
    where: { organizationId: ORG_ID },
    orderBy: { name: 'asc' },
  });
  const deepCleaning = services.find((s) => s.name === 'Deep Cleaning')!;
  const moveOut = services.find((s) => s.name === 'Move-out Cleaning')!;
  const windowCleaning = services.find((s) => s.name === 'Window Cleaning')!;

  // ── Customers ──────────────────────────────────────────────────────

  const customers = await Promise.all([
    upsertCustomer({
      firstName: 'Maria', lastName: 'Gonzalez', customerType: CustomerType.Homeowner,
      phone: '5125551001', email: 'maria.g@example.com',
      street: '1204 Elm St', city: 'Austin', state: 'TX', zip: '78701',
    }),
    upsertCustomer({
      firstName: 'James', lastName: 'Chen', customerType: CustomerType.Homeowner,
      phone: '5125551002', email: 'jchen@example.com',
      street: '789 Oak Ave', city: 'Austin', state: 'TX', zip: '78704',
    }),
    upsertCustomer({
      firstName: 'Sarah', lastName: 'Williams', customerType: CustomerType.Homeowner,
      phone: '5125551003', email: 'swilliams@example.com',
      street: '2310 Pine Ln', city: 'Round Rock', state: 'TX', zip: '78664',
    }),
    upsertCustomer({
      firstName: null, lastName: null, companyName: 'Downtown Office Park',
      customerType: CustomerType.Business,
      phone: '5125551004', email: 'facilities@downtownop.com',
      street: '100 Congress Ave, Suite 400', city: 'Austin', state: 'TX', zip: '78701',
    }),
    upsertCustomer({
      firstName: 'Pat', lastName: 'Nguyen', customerType: CustomerType.Homeowner,
      phone: '5125551005', email: 'pat.n@example.com',
      street: '456 Maple Dr', city: 'Cedar Park', state: 'TX', zip: '78613',
      doNotService: true,
    }),
  ]);

  const [maria, james, sarah, downtown, pat] = customers;

  // ── Jobs ───────────────────────────────────────────────────────────

  // 1. Finished job yesterday (Maria — Deep Cleaning) + invoice paid
  const job1 = await createJob({
    customerId: maria.id, addressId: maria.addressId, serviceId: deepCleaning.id,
    title: 'Deep clean — move-in prep', priceCents: 25000,
    start: dayOffset(-1, 9), end: dayOffset(-1, 12),
    assigneeId: alex.id, stage: JobStage.job_done, finishedAt: dayOffset(-1, 12),
  });
  await createInvoice(job1.id, maria.id, 25000, deepCleaning.name, InvoiceStatus.paid);

  // 2. Finished job 2 days ago (James — Window) + invoice sent
  const job2 = await createJob({
    customerId: james.id, addressId: james.addressId, serviceId: windowCleaning.id,
    title: 'Exterior windows', priceCents: 15000,
    start: dayOffset(-2, 10), end: dayOffset(-2, 12),
    assigneeId: jordan.id, stage: JobStage.job_done, finishedAt: dayOffset(-2, 12),
  });
  await createInvoice(job2.id, james.id, 15000, windowCleaning.name, InvoiceStatus.sent);

  // 3. Scheduled today (Sarah — Move-out, assigned to Alex)
  await createJob({
    customerId: sarah.id, addressId: sarah.addressId, serviceId: moveOut.id,
    title: 'Move-out cleaning', priceCents: 35000,
    start: todayAt(9), end: todayAt(13),
    assigneeId: alex.id, stage: JobStage.scheduled,
  });

  // 4. Scheduled today (Downtown — Deep Cleaning, assigned to Jordan)
  await createJob({
    customerId: downtown.id, addressId: downtown.addressId, serviceId: deepCleaning.id,
    title: 'Office deep clean — 4th floor', priceCents: 45000,
    start: todayAt(8), end: todayAt(11),
    assigneeId: jordan.id, stage: JobStage.scheduled,
  });

  // 5. Scheduled tomorrow (Maria — Window, assigned to Jordan)
  await createJob({
    customerId: maria.id, addressId: maria.addressId, serviceId: windowCleaning.id,
    title: 'Interior windows', priceCents: 12000,
    start: dayOffset(1, 10), end: dayOffset(1, 12),
    assigneeId: jordan.id, stage: JobStage.scheduled,
  });

  // 6. Scheduled day after tomorrow (James — Deep, assigned to Alex)
  await createJob({
    customerId: james.id, addressId: james.addressId, serviceId: deepCleaning.id,
    title: 'Kitchen + bathroom deep', priceCents: 20000,
    start: dayOffset(2, 14), end: dayOffset(2, 17),
    assigneeId: alex.id, stage: JobStage.scheduled,
  });

  // ── Recurring series ───────────────────────────────────────────────

  // 7. Weekly recurring for Maria (every Monday, Deep Cleaning, Alex)
  const recurJob1 = await createJob({
    customerId: maria.id, addressId: maria.addressId, serviceId: deepCleaning.id,
    title: 'Weekly clean — Maria', priceCents: 18000,
    start: dayOffset(getNextDayOfWeek(1), 9), end: dayOffset(getNextDayOfWeek(1), 11),
    assigneeId: alex.id, stage: JobStage.scheduled,
  });
  await prisma.recurringSeries.create({
    data: {
      organizationId: ORG_ID,
      sourceJobId: recurJob1.id,
      recurrenceFrequency: RecurrenceFrequency.weekly,
      recurrenceInterval: 1,
      recurrenceEndMode: RecurrenceEndMode.never,
      recurrenceDayOfWeek: [DayOfWeek.MON],
      materializationHorizonUntil: dayOffset(28, 0),
      lastExtendedAt: new Date(),
    },
  });
  await prisma.job.update({
    where: { id: recurJob1.id },
    data: { recurringSeriesId: (await prisma.recurringSeries.findFirst({ where: { sourceJobId: recurJob1.id } }))!.id, occurrenceIndex: 0 },
  });

  // 8. Biweekly recurring for Downtown (every other Wednesday, Window, Jordan)
  const recurJob2 = await createJob({
    customerId: downtown.id, addressId: downtown.addressId, serviceId: windowCleaning.id,
    title: 'Biweekly windows — Downtown', priceCents: 30000,
    start: dayOffset(getNextDayOfWeek(3), 8), end: dayOffset(getNextDayOfWeek(3), 12),
    assigneeId: jordan.id, stage: JobStage.scheduled,
  });
  await prisma.recurringSeries.create({
    data: {
      organizationId: ORG_ID,
      sourceJobId: recurJob2.id,
      recurrenceFrequency: RecurrenceFrequency.weekly,
      recurrenceInterval: 2,
      recurrenceEndMode: RecurrenceEndMode.never,
      recurrenceDayOfWeek: [DayOfWeek.WED],
      materializationHorizonUntil: dayOffset(56, 0),
      lastExtendedAt: new Date(),
    },
  });
  await prisma.job.update({
    where: { id: recurJob2.id },
    data: { recurringSeriesId: (await prisma.recurringSeries.findFirst({ where: { sourceJobId: recurJob2.id } }))!.id, occurrenceIndex: 0 },
  });

  // ── Events ─────────────────────────────────────────────────────────

  const eventData: Array<{ name: string; dayOff: number; start: number; end: number; assigneeId: string | null; note?: string }> = [
    { name: 'Team standup', dayOff: 0, start: 8, end: 8.5, assigneeId: null, note: 'Daily morning huddle' },
    { name: 'Supply run', dayOff: 0, start: 14, end: 15, assigneeId: alex.id },
    { name: 'Equipment maintenance', dayOff: 1, start: 16, end: 17, assigneeId: jordan.id },
    { name: 'Client walkthrough — new contract', dayOff: 2, start: 10, end: 11, assigneeId: alex.id },
    { name: 'Team standup', dayOff: 1, start: 8, end: 8.5, assigneeId: null, note: 'Daily morning huddle' },
    { name: 'Team standup', dayOff: 2, start: 8, end: 8.5, assigneeId: null, note: 'Daily morning huddle' },
    { name: 'Training — new products', dayOff: 3, start: 13, end: 15, assigneeId: null, note: 'Whole team training session' },
  ];

  for (const ev of eventData) {
    const startH = Math.floor(ev.start);
    const startM = Math.round((ev.start - startH) * 60);
    const endH = Math.floor(ev.end);
    const endM = Math.round((ev.end - endH) * 60);

    await prisma.event.create({
      data: {
        organizationId: ORG_ID,
        name: ev.name,
        note: ev.note ?? null,
        scheduledStartAt: dayOffset(ev.dayOff, startH, startM),
        scheduledEndAt: dayOffset(ev.dayOff, endH, endM),
        assigneeTeamMemberId: ev.assigneeId,
      },
    });
  }

  console.log('[seed:demo] ok — 5 customers, 8 jobs, 2 recurring series, 7 events');
}

// ── Customer helper ────────────────────────────────────────────────────

interface CustomerInput {
  firstName: string | null;
  lastName: string | null;
  companyName?: string;
  customerType: CustomerType;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  doNotService?: boolean;
}

async function upsertCustomer(input: CustomerInput) {
  const displayName = input.companyName
    ? input.companyName
    : `${input.firstName} ${input.lastName}`;

  // Check if customer already exists by email
  const existingEmail = await prisma.customerEmail.findFirst({
    where: { value: input.email },
    include: { customer: { include: { addresses: true } } },
  });
  if (existingEmail) {
    return {
      id: existingEmail.customer.id,
      addressId: existingEmail.customer.addresses[0]?.id ?? '',
    };
  }

  const customer = await prisma.customer.create({
    data: {
      organizationId: ORG_ID,
      firstName: input.firstName,
      lastName: input.lastName,
      companyName: input.companyName ?? null,
      displayName,
      customerType: input.customerType,
      doNotService: input.doNotService ?? false,
      addresses: {
        create: {
          street: input.street,
          city: input.city,
          state: input.state,
          zip: input.zip,
        },
      },
      phones: {
        create: {
          value: input.phone,
          digitsOnly: input.phone.replace(/\D/g, ''),
          type: 'mobile',
        },
      },
      emails: {
        create: { value: input.email },
      },
    },
    include: { addresses: true },
  });

  return { id: customer.id, addressId: customer.addresses[0].id };
}

// ── Job helper ─────────────────────────────────────────────────────────

interface JobInput {
  customerId: string;
  addressId: string;
  serviceId: string;
  title: string;
  priceCents: number;
  start: Date;
  end: Date;
  assigneeId: string | null;
  stage: JobStage;
  finishedAt?: Date;
}

async function createJob(input: JobInput) {
  const jobNumber = await nextJobNumber();
  return prisma.job.create({
    data: {
      organizationId: ORG_ID,
      jobNumber,
      customerId: input.customerId,
      customerAddressId: input.addressId,
      serviceId: input.serviceId,
      titleOrSummary: input.title,
      priceCents: input.priceCents,
      scheduledStartAt: input.start,
      scheduledEndAt: input.end,
      assigneeTeamMemberId: input.assigneeId,
      jobStage: input.stage,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

// ── Invoice helper ─────────────────────────────────────────────────────

async function createInvoice(
  jobId: string, customerId: string, totalCents: number,
  serviceName: string, status: InvoiceStatus,
) {
  const invoiceNumber = await nextInvoiceNumber();
  return prisma.invoice.create({
    data: {
      organizationId: ORG_ID,
      invoiceNumber,
      jobId,
      customerId,
      status,
      subtotalCents: totalCents,
      totalCents,
      amountDueCents: status === InvoiceStatus.paid ? 0 : totalCents,
      paidCents: status === InvoiceStatus.paid ? totalCents : 0,
      serviceNameSnapshot: serviceName,
      servicePriceCentsSnapshot: totalCents,
      sentAt: [InvoiceStatus.sent, InvoiceStatus.paid].includes(status) ? new Date() : null,
      paidAt: status === InvoiceStatus.paid ? new Date() : null,
    },
  });
}

// ── Day-of-week offset helper ──────────────────────────────────────────

/** Returns days until the next given weekday (0=Sun … 6=Sat). Returns 7 if today is that day. */
function getNextDayOfWeek(targetDay: number): number {
  const today = new Date().getUTCDay();
  const diff = (targetDay - today + 7) % 7;
  return diff === 0 ? 7 : diff;
}

// ── Run ────────────────────────────────────────────────────────────────

seedDemo()
  .catch((err) => {
    console.error('[seed:demo] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
