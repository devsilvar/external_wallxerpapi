import type { Business, Platform } from '@prisma/client';
import { prisma, type DbClient } from './client.js';

export async function findPlatformEntitlement(
  platformId: string,
  db: DbClient = prisma
): Promise<Pick<Platform, 'isActive' | 'suspendedAt' | 'suspendedReason' | 'subscriptionExpiresAt'> | null> {
  return db.platform.findUnique({
    where: { id: platformId },
    select: {
      isActive: true,
      suspendedAt: true,
      suspendedReason: true,
      subscriptionExpiresAt: true,
    },
  });
}

export async function findAccountEntitlement(
  businessId: string,
  db: DbClient = prisma
): Promise<Pick<Business, 'isActive' | 'subscriptionExpiresAt'> | null> {
  return db.business.findUnique({
    where: { id: businessId },
    select: {
      isActive: true,
      subscriptionExpiresAt: true,
    },
  });
}
