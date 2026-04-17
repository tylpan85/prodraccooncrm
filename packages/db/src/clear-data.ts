import { prisma } from './index.js';

async function clearData() {
  await prisma.auditLog.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.jobTag.deleteMany({});
  await prisma.job.updateMany({ data: { recurringSeriesId: null } });
  await prisma.recurringSeries.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.customerTag.deleteMany({});
  await prisma.customerPhone.deleteMany({});
  await prisma.customerEmail.deleteMany({});
  await prisma.customerAddress.deleteMany({});
  await prisma.customer.deleteMany({});

  const orgId = '00000000-0000-0000-0000-000000000001';
  await prisma.organizationCounter.updateMany({
    where: { organizationId: orgId },
    data: { nextValue: 1001 },
  });

  console.log('Done — all customers, jobs, events, invoices, recurring series deleted. Counters reset to 1001.');
  await prisma.$disconnect();
}

clearData();
