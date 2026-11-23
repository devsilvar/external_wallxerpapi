import { prisma, type DbClient } from './client.js';
import { hashToken } from '../lib/token.js';
import { logger } from '../lib/logger.js';

export const SANDBOX_PLATFORM_NAME = 'WallxErpApi Sandbox Platform';
export const SANDBOX_EXTERNAL_CUSTOMER_ID = 'WALLX-SANDBOX-MERCHANT-01';
export const SANDBOX_API_KEY = 'wallx_sandbox_key_7a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a';

export interface SandboxSeedResult {
  platformId: string;
  businessId: string;
  merchantId: string;
  externalCustomerId: string;
  apiKey: string;
   isNew: boolean;
}

/**
 * Seeds or retrieves the persistent staging/sandbox tenant for partner testing.
 * Completely isolated from pilot and production merchant accounts.
 */
export async function seedSandboxTenant(db: DbClient = prisma): Promise<SandboxSeedResult> {
  // 1. Ensure sandbox owner user exists
  const user = await db.user.upsert({
    where: { email: 'sandbox-owner@wallxerpapi.staging' },
    update: {},
    create: {
      email: 'sandbox-owner@wallxerpapi.staging',
      fullName: 'WallxErpApi Sandbox Operator',
      isActive: true,
    },
  });

  // 2. Ensure sandbox platform exists with active entitlement and apiKeyHash
  const futureExpiry = new Date(Date.now() + 365 * 86_400_000); // 1 year active
  const apiKeyHash = hashToken(SANDBOX_API_KEY);
  const apiKeyPrefix = SANDBOX_API_KEY.slice(0, 16);

  let platform = await db.platform.findFirst({
    where: { name: SANDBOX_PLATFORM_NAME },
  });

  if (!platform) {
    platform = await db.platform.create({
      data: {
        name: SANDBOX_PLATFORM_NAME,
        ownerUserId: user.id,
        isActive: true,
        approvalStatus: 'ACTIVE',
        flatFeeNgn: '100.00',
        subscriptionExpiresAt: futureExpiry,
        apiKeyHash,
        apiKeyPrefix,
      },
    });
  } else if (!platform.apiKeyHash) {
    platform = await db.platform.update({
      where: { id: platform.id },
      data: { apiKeyHash, apiKeyPrefix },
    });
  }

  // Ensure PlatformApiKey row exists
  await db.platformApiKey.upsert({
    where: { keyHash: apiKeyHash },
    update: {
      platformId: platform.id,
      prefix: apiKeyPrefix,
      revokedAt: null,
    },
    create: {
      platformId: platform.id,
      label: 'Sandbox API Key',
      prefix: apiKeyPrefix,
      keyHash: apiKeyHash,
      createdByUserId: user.id,
    },
  });

  // 3. Ensure sandbox merchant business exists
  let business = await db.business.findFirst({
    where: {
      platformId: platform.id,
      externalCustomerId: SANDBOX_EXTERNAL_CUSTOMER_ID,
    },
  });

  let isNew = false;
  if (!business) {
    isNew = true;
    business = await db.business.create({
      data: {
        platformId: platform.id,
        externalCustomerId: SANDBOX_EXTERNAL_CUSTOMER_ID,
        userId: user.id,
        businessName: 'WallxErpApi Demo Business (Sandbox)',
        ownerName: 'WallxErpApi Integration Tester',
        merchantId: 'WALLX-SBX-0001',
        isActive: true,
        address: '100 Innovation Drive, Sandbox City',
        city: 'Lagos',
        state: 'Lagos',
      },
    });
  }

  logger.info(
    {
      platformId: platform.id,
      businessId: business.id,
      merchantId: business.merchantId,
      externalCustomerId: business.externalCustomerId,
    },
    'Sandbox tenant ready'
  );

  return {
    platformId: platform.id,
    businessId: business.id,
    merchantId: business.merchantId ?? 'WALLX-SBX-0001',
    externalCustomerId: business.externalCustomerId,
    apiKey: SANDBOX_API_KEY,
       isNew,
  };
}
