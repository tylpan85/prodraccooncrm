import type { Prisma, PrismaClient } from '@openclaw/db';

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function auditLog(
  tx: Tx,
  opts: {
    organizationId: string;
    actorUserId: string;
    entityType: string;
    entityId: string;
    action: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      organizationId: opts.organizationId,
      actorUserId: opts.actorUserId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      payloadJson: opts.payload ?? {},
    },
  });
}
