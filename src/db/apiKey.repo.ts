import type { PlatformApiKey } from '@prisma/client';
import { prisma, type DbClient } from './client.js';
import { createApiKey } from '../lib/apiKeys.js';
import { hashToken } from '../lib/token.js';

export interface KeySummary {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lists API key metadata for a specific platform. Never returns key hashes.
 */
export async function listKeysForPlatform(
  platformId: string,
  db: DbClient = prisma
): Promise<KeySummary[]> {
  const keys = await db.platformApiKey.findMany({
    where: { platformId },
    select: {
      id: true,
      label: true,
      prefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return keys;
}

/**
 * Creates a new API key for a platform and stores its hash.
 * Returns the created record along with the unhashed raw key (shown once).
 */
export async function createKeyForPlatform(
  platformId: string,
  label = 'default',
  createdByUserId?: string | null,
  environment: 'test' | 'live' = 'live',
  db: DbClient = prisma
): Promise<{ key: PlatformApiKey; rawKey: string }> {
  const { apiKey, prefix, keyHash } = createApiKey(environment);

  const keyRecord = await db.platformApiKey.create({
    data: {
      platformId,
      label,
      prefix,
      keyHash,
      createdByUserId: createdByUserId ?? null,
    },
  });

  return { key: keyRecord, rawKey: apiKey };
}

/**
 * Revokes an API key, strictly scoped to the platform (never cross-platform).
 */
export async function revokeKeyForPlatform(
  platformId: string,
  keyId: string,
  db: DbClient = prisma
): Promise<PlatformApiKey | null> {
  const existing = await db.platformApiKey.findFirst({
    where: { id: keyId, platformId },
  });

  if (!existing) {
    return null;
  }

  return db.platformApiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Finds an active, non-revoked API key by its SHA-256 hash.
 * Includes associated Platform.
 */
export async function findActiveApiKeyByHash(
  keyHash: string,
  db: DbClient = prisma
) {
  const keyRecord = await db.platformApiKey.findUnique({
    where: { keyHash },
    include: {
      platform: true,
    },
  });

  if (!keyRecord) {
    return null;
  }

  // A non-null revokedAt that is in the past means revoked
  if (keyRecord.revokedAt !== null && keyRecord.revokedAt <= new Date()) {
    return null;
  }

  return keyRecord;
}

/**
 * Updates lastUsedAt timestamp on an API key record asynchronously.
 */
export async function updateApiKeyLastUsed(
  keyId: string,
  at: Date = new Date(),
  db: DbClient = prisma
): Promise<void> {
  await db.platformApiKey
    .update({
      where: { id: keyId },
      data: { lastUsedAt: at },
    })
    .catch(() => {});
}
