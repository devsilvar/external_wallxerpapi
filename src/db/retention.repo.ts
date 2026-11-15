import { prisma, type DbClient } from './client.js';

export interface PurgeResult {
  count: number;
}

/**
 * Purges external tombstones older than the specified cutoff timestamp.
 */
export async function purgeTombstonesBefore(
  cutoff: Date,
  db: DbClient = prisma
): Promise<PurgeResult> {
  const result = await db.externalTombstone.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });
  return { count: result.count };
}

/**
 * Purges audit logs older than the specified cutoff timestamp.
 */
export async function purgeAuditLogsBefore(
  cutoff: Date,
  db: DbClient = prisma
): Promise<PurgeResult> {
  const result = await db.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });
  return { count: result.count };
}
