import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './client.js';
import { nextMerchantId } from './sequence.repo.js';

export interface CsvAccountRow {
  externalCustomerId: string;
  businessName: string;
  ownerName: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
}

export interface ProvisionResult {
  total: number;
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Provisions accounts from parsed CSV rows.
 * Safe, idempotent: running twice yields zero duplicate accounts.
 * Never emits an activation code or credential.
 */
export async function provisionAccounts(
  rows: CsvAccountRow[],
  platformId: string,
  db: PrismaClient = prisma,
  concurrency = 5
): Promise<ProvisionResult> {
  // Find the platform and its owner user
  const platform = await db.platform.findUnique({
    where: { id: platformId },
  });

  if (!platform) {
    throw new Error(`Platform not found: ${platformId}`);
  }

  const ownerUserId = platform.ownerUserId;

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  const processRow = async (row: CsvAccountRow): Promise<void> => {
    try {
      await db.$transaction(
        async (tx) => {
          // 1. Skip if already exists
          const existing = await tx.business.findUnique({
            where: {
              platformId_externalCustomerId: {
                platformId,
                externalCustomerId: row.externalCustomerId,
              },
            },
          });

          if (existing) {
            skipped++;
            return;
          }

          // 2. Mint merchantId
          const merchantId = await nextMerchantId(tx);

          // 3. Create Business
          const business = await tx.business.create({
            data: {
              platformId,
              externalCustomerId: row.externalCustomerId,
              userId: ownerUserId,
              businessName: row.businessName,
              ownerName: row.ownerName,
              merchantId,
              contactPhone: row.phone || null,
              contactEmail: row.email || null,
              address: row.address || null,
              city: row.city || null,
              state: row.state || null,
              isActive: true,
            },
          });

          // 4. Create BusinessMember
          await tx.businessMember.create({
            data: {
              businessId: business.id,
              userId: ownerUserId,
              role: 'owner',
              isActive: true,
            },
          });

          // 5. AuditLog
          await tx.auditLog.create({
            data: {
              platformId,
              businessId: business.id,
              userId: ownerUserId,
              actor: 'cli',
              action: 'account.provisioned',
              resourceType: 'business',
              resourceId: business.id,
              newData: {
                merchantId: business.merchantId,
                externalCustomerId: business.externalCustomerId,
                businessName: business.businessName,
              },
            },
          });

          created++;
        },
        {
          maxWait: 20000,
          timeout: 30000,
        }
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        skipped++;
      } else {
        errors.push(
          `Customer ${row.externalCustomerId} (${row.businessName}): ${(err as Error).message}`
        );
      }
    }
  };

  // Run in chunks
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    await Promise.all(chunk.map((row) => processRow(row)));
  }

  return {
    total: rows.length,
    created,
    skipped,
    errors,
  };
}
