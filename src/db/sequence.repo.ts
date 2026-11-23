import { prisma, type DbClient } from './client.js';

export async function incrementSequence(key: string, db: DbClient = prisma): Promise<number> {
  // Atomic increment via $queryRaw (fast path when row exists)
  const result = await db.$queryRaw<{ value: number }[]>`
    UPDATE external_sequences
    SET value = value + 1
    WHERE key = ${key}
    RETURNING value
  `;

  const first = result?.[0];
  if (first) {
    return Number(first.value);
  }

  // Row is absent: create the row at 0 if absent, then update atomically
  await db.$executeRaw`
    INSERT INTO external_sequences (key, value)
    VALUES (${key}, 0)
    ON CONFLICT (key) DO NOTHING
  `;

  const retry = await db.$queryRaw<{ value: number }[]>`
    UPDATE external_sequences
    SET value = value + 1
    WHERE key = ${key}
    RETURNING value
  `;

  const retryFirst = retry?.[0];
  if (!retryFirst) {
    throw new Error(`Failed to increment sequence for key: ${key}`);
  }

  return Number(retryFirst.value);
}

export async function nextMerchantId(db: DbClient = prisma): Promise<string> {
  const value = await incrementSequence('merchant', db);
  return `WALLX${String(value).padStart(7, '0')}`;
}

export async function nextInvoiceNumber(
  businessId: string,
  year: number,
  db: DbClient = prisma
): Promise<string> {
  const key = `invoice:${businessId}:${year}`;
  const value = await incrementSequence(key, db);
  return `WX-${year}-${String(value).padStart(3, '0')}`;
}
