import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateToken, hashToken } from '../../src/lib/token.js';
import fs from 'fs';
import path from 'path';

interface LatencyStats {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function calculatePercentiles(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avgMs = Math.round((sum / count) * 10) / 10;
  const minMs = Math.round((sorted[0] ?? 0) * 10) / 10;
  const maxMs = Math.round((sorted[count - 1] ?? 0) * 10) / 10;
  const p50Ms = Math.round((sorted[Math.floor(count * 0.5)] ?? 0) * 10) / 10;
  const p95Ms = Math.round((sorted[Math.floor(count * 0.95)] ?? 0) * 10) / 10;
  const p99Ms = Math.round((sorted[Math.min(Math.floor(count * 0.99), count - 1)] ?? 0) * 10) / 10;

  return { count, minMs, maxMs, avgMs, p50Ms, p95Ms, p99Ms };
}

async function main() {
  console.log('=== STARTING 1,000-ACCOUNT CAPACITY & LOAD TEST (P6-05) ===');

  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    EXTERNAL_DATA_RATE_LIMIT: '100000', // high limit to measure raw system performance
  });
  const app = createApp(config);

  const testBatchId = `load-${Date.now()}`;
  const ACCOUNT_TARGET = 1000;

  console.log('Phase 0: Cleaning up any previous interrupted load test runs...');
  const oldPlatforms = await prisma.platform.findMany({
    where: { name: { startsWith: 'Scale Platform' } },
    select: { id: true, ownerUserId: true },
  });
  if (oldPlatforms.length > 0) {
    const pIds = oldPlatforms.map((p) => p.id);
    const uIds = oldPlatforms.map((p) => p.ownerUserId);
    await prisma.salesTransaction.deleteMany({
      where: { business: { platformId: { in: pIds } } },
    });
    await prisma.externalDevice.deleteMany({
      where: { platformId: { in: pIds } },
    });
    await prisma.business.deleteMany({
      where: { platformId: { in: pIds } },
    });
    await prisma.platform.deleteMany({
      where: { id: { in: pIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: uIds } },
    });
  }

  console.log(`Phase 1: Provisioning platform and user for load test [batch: ${testBatchId}]...`);
  const user = await prisma.user.create({
    data: {
      email: `${testBatchId}@loadtest.wallx.com`,
      fullName: 'Scale Load Tester',
    },
  });

  const platform = await prisma.platform.create({
    data: {
      name: `Scale Platform ${testBatchId}`,
      ownerUserId: user.id,
    },
  });

  console.log(`Phase 2: Seeding ${ACCOUNT_TARGET} accounts in batches of 100...`);
  const seededAccounts: Array<{ id: string; token: string }> = [];
  const BATCH_SIZE = 100;

  for (let b = 0; b < ACCOUNT_TARGET / BATCH_SIZE; b++) {
    const bizData = [];
    const tokens: string[] = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = b * BATCH_SIZE + i;
      const rawToken = generateToken();
      tokens.push(rawToken);

      bizData.push({
        platformId: platform.id,
        externalCustomerId: `ext-cust-${testBatchId}-${idx}`,
        userId: user.id,
        businessName: `Load Account ${idx}`,
        ownerName: `Merchant ${idx}`,
        merchantId: `WOWO${String(1000000 + idx).padStart(7, '0')}`,
      });
    }

    await prisma.business.createMany({ data: bizData });

    // Fetch the created businesses to get their IDs
    const createdBizs = await prisma.business.findMany({
      where: {
        platformId: platform.id,
        externalCustomerId: { startsWith: `ext-cust-${testBatchId}-` },
      },
      select: { id: true, externalCustomerId: true },
      orderBy: { createdAt: 'asc' },
      skip: b * BATCH_SIZE,
      take: BATCH_SIZE,
    });

    // Create externalDevice records for each business
    const deviceData = createdBizs.map((biz, i) => ({
      platformId: platform.id,
      businessId: biz.id,
      tokenHash: hashToken(tokens[i] ?? ''),
      activatedAt: new Date(),
    }));

    await prisma.externalDevice.createMany({ data: deviceData });

    for (let i = 0; i < createdBizs.length; i++) {
      const biz = createdBizs[i];
      const tok = tokens[i];
      if (biz && tok) {
        seededAccounts.push({ id: biz.id, token: tok });
      }
    }

    process.stdout.write(`  Seeded ${seededAccounts.length}/${ACCOUNT_TARGET} accounts...\r`);
  }
  console.log(`\nSuccessfully seeded ${seededAccounts.length} accounts.`);

  // Pre-seed 50 sales for 5 sample accounts to test 50-row list queries
  console.log('Phase 3: Seeding 50 rows per account for list query tests...');
  const listTestAccounts = seededAccounts.slice(0, 5);
  for (const acc of listTestAccounts) {
    const salesBatch = Array.from({ length: 50 }, (_, i) => ({
      businessId: acc.id,
      referenceId: `pre-seed-${i}-${Date.now()}`,
      amount: '5000.00',
      source: 'api' as const,
      status: 'confirmed' as const,
      isTaxable: true,
      transactionDate: new Date(),
    }));
    await prisma.salesTransaction.createMany({ data: salesBatch });
  }

  console.log('Phase 4: Executing hot-path benchmark operations...');
  const singleReadLatencies: number[] = [];
  const singleWriteLatencies: number[] = [];
  const list50Latencies: number[] = [];
  let totalErrors = 0;
  let totalRequests = 0;

  // Sample 25 accounts across the 1,000 for write/read tests with concurrency
  const sampleAccounts = seededAccounts.slice(0, 25);
  const CHUNK_SIZE = 5;

  for (let c = 0; c < sampleAccounts.length; c += CHUNK_SIZE) {
    const chunk = sampleAccounts.slice(c, c + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (acc) => {
        totalRequests++;
        const t0 = performance.now();
        const res = await request(app)
          .post(`/api/external/v1/accounts/${acc.id}/sales`)
          .set('Authorization', `Bearer ${acc.token}`)
          .send({
            referenceId: `load-sale-${Date.now()}-${Math.random()}`,
            amount: '12500.00',
            source: 'api',
            transactionDate: '2026-11-15',
            description: 'Load test sale',
          });
        const dur = performance.now() - t0;
        if (res.status === 201) {
          singleWriteLatencies.push(dur);
          const saleId = res.body.data.id;

          // 2. Single reads (Sale get by id)
          totalRequests++;
          const t1 = performance.now();
          const readRes = await request(app)
            .get(`/api/external/v1/accounts/${acc.id}/sales/${saleId}`)
            .set('Authorization', `Bearer ${acc.token}`);
          const readDur = performance.now() - t1;
          if (readRes.status === 200) {
            singleReadLatencies.push(readDur);
          } else {
            totalErrors++;
          }
        } else {
          totalErrors++;
        }
      })
    );
  }

  // 3. 50-row list pages
  for (const acc of listTestAccounts) {
    for (let r = 0; r < 2; r++) {
      totalRequests++;
      const t0 = performance.now();
      const listRes = await request(app)
        .get(`/api/external/v1/accounts/${acc.id}/sales?limit=50&updatedSince=2026-01-01T00:00:00.000Z`)
        .set('Authorization', `Bearer ${acc.token}`);
      const dur = performance.now() - t0;
      if (listRes.status === 200 && listRes.body.data.length === 50) {
        list50Latencies.push(dur);
      } else {
        totalErrors++;
      }
    }
  }

  const writeStats = calculatePercentiles(singleWriteLatencies);
  const readStats = calculatePercentiles(singleReadLatencies);
  const listStats = calculatePercentiles(list50Latencies);
  const errorRate = Math.round((totalErrors / Math.max(totalRequests, 1)) * 10000) / 100;

  const results = {
    testBatchId,
    accountsSeeded: ACCOUNT_TARGET,
    totalRequests,
    totalErrors,
    errorRatePercent: errorRate,
    targets: {
      singleWriteReadP95TargetMs: 300,
      list50P95TargetMs: 800,
      maxErrorRatePercent: 0.1,
    },
    measurements: {
      singleWrite: writeStats,
      singleRead: readStats,
      list50Rows: listStats,
    },
    timestamp: new Date().toISOString(),
  };

  console.log('\n=== LOAD TEST RESULTS ===');
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Total Errors:   ${totalErrors} (${errorRate}%)`);
  console.log(`Single Write (p50 / p95 / p99): ${writeStats.p50Ms}ms / ${writeStats.p95Ms}ms / ${writeStats.p99Ms}ms`);
  console.log(`Single Read  (p50 / p95 / p99): ${readStats.p50Ms}ms / ${readStats.p95Ms}ms / ${readStats.p99Ms}ms`);
  console.log(`50-Row List  (p50 / p95 / p99): ${listStats.p50Ms}ms / ${listStats.p95Ms}ms / ${listStats.p99Ms}ms`);

  const resultsDir = path.join(process.cwd(), 'tests', 'load');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Results saved to ${path.join(resultsDir, 'results.json')}`);

  console.log('\nPhase 5: Cleaning up load test data...');
  const allBizIds = seededAccounts.map((a) => a.id);
  await prisma.salesTransaction.deleteMany({ where: { businessId: { in: allBizIds } } });
  await prisma.externalDevice.deleteMany({ where: { businessId: { in: allBizIds } } });
  await prisma.business.deleteMany({ where: { id: { in: allBizIds } } });
  await prisma.platform.deleteMany({ where: { id: platform.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  console.log('Cleanup complete.');

  console.log('=== LOAD TEST COMPLETED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('LOAD TEST FAILED:', err);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
