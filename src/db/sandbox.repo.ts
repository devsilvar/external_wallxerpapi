import { prisma, type DbClient } from './client.js';
import { hashToken } from '../lib/token.js';
import { logger } from '../lib/logger.js';

export const SANDBOX_PLATFORM_NAME = 'Wowo Sandbox Platform';
export const SANDBOX_EXTERNAL_CUSTOMER_ID = 'WOWO-SANDBOX-MERCHANT-01';
export const SANDBOX_TEST_TOKEN = 'wowo_sandbox_token_7a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a';

export interface SandboxSeedResult {
  platformId: string;
  businessId: string;
  merchantId: string;
  externalCustomerId: string;
  deviceToken: string;
  isNew: boolean;
}

/**
 * Seeds or retrieves the persistent staging/sandbox tenant for partner testing.
 * Completely isolated from pilot and production merchant accounts.
 */
export async function seedSandboxTenant(db: DbClient = prisma): Promise<SandboxSeedResult> {
  // 1. Ensure sandbox owner user exists
  const user = await db.user.upsert({
    where: { email: 'sandbox-owner@wowo.staging' },
    update: {},
    create: {
      email: 'sandbox-owner@wowo.staging',
      fullName: 'Wowo Sandbox Operator',
      isActive: true,
    },
  });

  // 2. Ensure sandbox platform exists with active entitlement
  const futureExpiry = new Date(Date.now() + 365 * 86_400_000); // 1 year active
  let platform = await db.platform.findFirst({
    where: { name: SANDBOX_PLATFORM_NAME },
  });

  if (!platform) {
    platform = await db.platform.create({
      data: {
        name: SANDBOX_PLATFORM_NAME,
        ownerUserId: user.id,
        isActive: true,
        flatFeeNgn: '100.00',
        subscriptionExpiresAt: futureExpiry,
      },
    });
  }

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
        businessName: 'Wowo Demo Superstore (Sandbox)',
        ownerName: 'Wowo Integration Tester',
        merchantId: 'WOWO-SBX-0001',
        isActive: true,
        address: '100 Innovation Drive, Sandbox City',
        city: 'Lagos',
        state: 'Lagos',
      },
    });
  }

  // 4. Ensure persistent sandbox device and test token exists
  const tokenHash = hashToken(SANDBOX_TEST_TOKEN);
  const existingDevice = await db.externalDevice.findFirst({
    where: {
      platformId: platform.id,
      businessId: business.id,
      tokenHash,
    },
  });

  if (!existingDevice) {
    await db.externalDevice.create({
      data: {
        platformId: platform.id,
        businessId: business.id,
        tokenHash,
        activatedAt: new Date(),
        lastSeenAt: new Date(),
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
    merchantId: business.merchantId ?? 'WOWO-SBX-0001',
    externalCustomerId: business.externalCustomerId,
    deviceToken: SANDBOX_TEST_TOKEN,
    isNew,
  };
}
