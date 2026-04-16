import argon2 from 'argon2';
import { prisma } from './index.js';

async function seed() {
  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { name: 'Raccoon Cleaning Inc', timezone: 'UTC' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Raccoon Cleaning Inc',
      timezone: 'UTC',
    },
  });

  const passwordHash = await argon2.hash('admin', { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email: 'admin@raccooncrm.local' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@raccooncrm.local',
      passwordHash,
      role: 'admin',
      mustResetPassword: true,
    },
  });

  const teamMembers: Array<{ displayName: string; initials: string; color: string }> = [
    { displayName: 'Alex', initials: 'AL', color: '#06b6d4' },
    { displayName: 'Jordan', initials: 'JO', color: '#8b5cf6' },
  ];
  for (const tm of teamMembers) {
    const existing = await prisma.teamMember.findFirst({
      where: { organizationId: org.id, displayName: tm.displayName },
    });
    if (!existing) {
      await prisma.teamMember.create({
        data: { organizationId: org.id, ...tm },
      });
    }
  }

  const services = ['Move-out Cleaning', 'Deep Cleaning', 'Window Cleaning'];
  for (const name of services) {
    const existing = await prisma.service.findFirst({
      where: { organizationId: org.id, name },
    });
    if (!existing) {
      await prisma.service.create({
        data: { organizationId: org.id, name },
      });
    }
  }

  for (const name of ['job_number', 'invoice_number']) {
    await prisma.organizationCounter.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name, nextValue: 1001 },
    });
  }

  console.log(`[seed] ok — org=${org.name} admin=admin@raccooncrm.local`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
