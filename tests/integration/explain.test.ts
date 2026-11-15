import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';

interface ExplainPlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: ExplainPlanNode[];
}

function findIndexNames(plan: ExplainPlanNode): string[] {
  const indexes: string[] = [];
  if (plan['Index Name']) {
    indexes.push(plan['Index Name']);
  }
  if (plan.Plans) {
    for (const child of plan.Plans) {
      indexes.push(...findIndexNames(child));
    }
  }
  return indexes;
}

function hasSeqScan(plan: ExplainPlanNode): boolean {
  if (plan['Node Type'] === 'Seq Scan') {
    return true;
  }
  if (plan.Plans) {
    return plan.Plans.some(hasSeqScan);
  }
  return false;
}

describe('EXPLAIN change query plan verification (tests/integration/explain.test.ts)', () => {
  const testId = `explain-${Date.now()}`;
  let businessId: string;
  let platformId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Explain Plan Tester',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'Explain Plan Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Explain Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;

    // Seed rows across both tables
    const now = new Date();
    await prisma.salesTransaction.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        businessId,
        referenceId: `sale-exp-${testId}-${i}`,
        amount: '1000.00',
        source: 'api',
        transactionDate: now,
      })),
    });

    await prisma.externalTombstone.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        businessId,
        entityType: 'sale',
        entityId: `tomb-exp-${testId}-${i}`,
        createdAt: now,
      })),
    });
  });

  afterAll(async () => {
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('proves sales_transactions updatedSince query utilizes (business_id, updated_at, id) composite index', async () => {
    const sinceDate = new Date('2026-01-01T00:00:00.000Z');

    const rawResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
      return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: ExplainPlanNode }> }>>(
        `
        EXPLAIN (FORMAT JSON)
        SELECT id, business_id, updated_at, reference_id, amount
        FROM sales_transactions
        WHERE business_id = $1 AND updated_at >= $2
        ORDER BY updated_at ASC, id ASC
        LIMIT 51;
        `,
        businessId,
        sinceDate
      );
    });

    const explainRow = rawResult[0];
    expect(explainRow).toBeDefined();
    if (!explainRow || !explainRow['QUERY PLAN'][0]) {
      throw new Error('Expected explainRow and QUERY PLAN to be defined');
    }
    const plan = explainRow['QUERY PLAN'][0].Plan;

    // 1. Seq scan must NOT be chosen
    expect(hasSeqScan(plan)).toBe(false);

    // 2. Composite index sales_transactions_business_id_updated_at_id_idx must be used
    const usedIndexes = findIndexNames(plan);
    expect(usedIndexes).toContain('sales_transactions_business_id_updated_at_id_idx');
  });

  it('proves external_tombstones deletions query utilizes (business_id, created_at, id) composite index', async () => {
    const sinceDate = new Date('2026-01-01T00:00:00.000Z');

    const rawResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
      return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: ExplainPlanNode }> }>>(
        `
        EXPLAIN (FORMAT JSON)
        SELECT id, business_id, created_at, entity_type, entity_id
        FROM external_tombstones
        WHERE business_id = $1 AND created_at >= $2
        ORDER BY created_at ASC, id ASC
        LIMIT 51;
        `,
        businessId,
        sinceDate
      );
    });

    const explainRow = rawResult[0];
    expect(explainRow).toBeDefined();
    if (!explainRow || !explainRow['QUERY PLAN'][0]) {
      throw new Error('Expected explainRow and QUERY PLAN to be defined');
    }
    const plan = explainRow['QUERY PLAN'][0].Plan;

    expect(hasSeqScan(plan)).toBe(false);
    const usedIndexes = findIndexNames(plan);
    expect(usedIndexes).toContain('external_tombstones_business_id_created_at_id_idx');
  });
});
