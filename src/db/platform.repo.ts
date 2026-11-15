import type { Platform } from '@prisma/client';
import { prisma, type DbClient } from './client.js';

export async function findPlatformByApiKeyHash(
  apiKeyHash: string,
  db: DbClient = prisma
): Promise<Platform | null> {
  return db.platform.findUnique({
    where: { apiKeyHash },
  });
}

export async function updatePlatformApiKeyLastUsed(
  platformId: string,
  at: Date = new Date(),
  db: DbClient = prisma
): Promise<void> {
  await db.platform
    .update({
      where: { id: platformId },
      data: { apiKeyLastUsedAt: at },
    })
    .catch(() => {
      // Fire-and-forget: do not block response if timestamp update fails
    });
}

export async function createPlatform(
  data: {
    name: string;
    ownerUserId: string;
    apiKeyHash?: string | null;
    apiKeyPrefix?: string | null;
    flatFeeNgn?: string | null;
  },
  db: DbClient = prisma
): Promise<Platform> {
  return db.platform.create({
    data: {
      name: data.name,
      ownerUserId: data.ownerUserId,
      apiKeyHash: data.apiKeyHash ?? null,
      apiKeyPrefix: data.apiKeyPrefix ?? null,
      flatFeeNgn: data.flatFeeNgn ?? null,
      isActive: true,
    },
  });
}

export async function regeneratePlatformApiKey(
  platformId: string,
  apiKeyHash: string,
  apiKeyPrefix: string,
  db: DbClient = prisma
): Promise<Platform> {
  return db.platform.update({
    where: { id: platformId },
    data: {
      apiKeyHash,
      apiKeyPrefix,
    },
  });
}

export async function upsertPlatformOwnerUser(
  email: string,
  fullName: string,
  db: DbClient = prisma
) {
  return db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      fullName,
      isActive: true,
    },
  });
}

export async function listPlatforms(db: DbClient = prisma): Promise<Platform[]> {
  return db.platform.findMany({
    orderBy: { createdAt: 'desc' },
  });
}
