import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Profit Summary API (tests/integration/profit-summary.test.ts)', () => {
  const testId = `profit-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let userId: string;
  let platformId: string;
  let apiKey: string;
  let businessId: string;
  const customerId = `cust-profit-${Date.now()}`;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${testId}@example.com`, fullName: 'Profit Tester' },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: `Profit Platform ${testId}`,
        ownerUserId: userId,
        apiKeyHash: hashToken(apiKey),
        apiKeyPrefix: apiKey.slice(0, 16),
        isActive: true,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: customerId,
        userId,
        businessName: 'Profit Retail Store',
        ownerName: 'Profit Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        contactPhone: '+2348022222222',
        contactEmail: `${testId}-biz@example.com`,
      },
    });
    businessId = biz.id;

    // Seed sales (e.g. 50,000 + 30,000 = 80,000)
    await prisma.salesTransaction.createMany({
      data: [
        {
          businessId,
          referenceId: `sale-1-${testId}`,
          amount: 50000,
          status: 'confirmed',
          source: 'pos',
          transactionDate: new Date('2026-06-01T10:00:00Z'),
        },
        {
          businessId,
          referenceId: `sale-2-${testId}`,
          amount: 30000,
          status: 'confirmed',
          source: 'pos',
          transactionDate: new Date('2026-06-15T12:00:00Z'),
        },
      ],
    });

    // Seed expenses (e.g. 20,000 + 5,000 = 25,000)
    await prisma.expense.createMany({
      data: [
        {
          businessId,
          externalRef: `exp-1-${testId}`,
          amount: 20000,
          description: 'Electricity bill',
          category: 'utility',
          expenseDate: new Date('2026-06-05T14:00:00Z'),
        },
        {
          businessId,
          externalRef: `exp-2-${testId}`,
          amount: 5000,
          description: 'Printer ink',
          category: 'office_supplies',
          expenseDate: new Date('2026-06-20T16:00:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    if (businessId) {
      await prisma.invoice.deleteMany({ where: { businessId } });
      await prisma.salesTransaction.deleteMany({ where: { businessId } });
      await prisma.expense.deleteMany({ where: { businessId } });
      await prisma.business.deleteMany({ where: { id: businessId } });
    }
    if (platformId) {
      await prisma.platform.deleteMany({ where: { id: platformId } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it('calculates total sales, total expenses, and net profit', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${customerId}/profit-summary`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.totalSales).toBe('80000.00');
    expect(res.body.data.totalExpenses).toBe('25000.00');
    expect(res.body.data.netProfit).toBe('55000.00');
    expect(res.body.data.isProfitable).toBe(true);
    expect(res.body.data.currency).toBe('NGN');
  });

  it('filters calculations by date window', async () => {
    // Only includes first sale (50,000) and first expense (20,000)
    const res = await request(app)
      .get(`/api/external/v1/accounts/${customerId}/profit-summary?startDate=2026-06-01&endDate=2026-06-10`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalSales).toBe('50000.00');
    expect(res.body.data.totalExpenses).toBe('20000.00');
    expect(res.body.data.netProfit).toBe('30000.00');
    expect(res.body.data.isProfitable).toBe(true);
  });

  it('returns isProfitable = false when net profit is negative', async () => {
    // Date window with only the second expense (5,000) and no sales
    const res = await request(app)
      .get(`/api/external/v1/accounts/${customerId}/profit-summary?startDate=2026-06-18&endDate=2026-06-25`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalSales).toBe('0.00');
    expect(res.body.data.totalExpenses).toBe('5000.00');
    expect(res.body.data.netProfit).toBe('-5000.00');
    expect(res.body.data.isProfitable).toBe(false);
  });

  it('rejects date range exceeding 366 days with 400 DATE_RANGE_TOO_LARGE', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${customerId}/profit-summary?startDate=2025-01-01&endDate=2026-06-01`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DATE_RANGE_TOO_LARGE');
  });

  it('rejects a single-sided startDate older than 366 days with 400 DATE_RANGE_TOO_LARGE', async () => {
 const res = await request(app)
 .get(`/api/external/v1/accounts/${customerId}/profit-summary?startDate=2020-01-01`)
 .set('Authorization', `Bearer ${apiKey}`);

 expect(res.status).toBe(400);
 expect(res.body.error.code).toBe('DATE_RANGE_TOO_LARGE');
});

it('defaults a single-sided endDate to a bounded 366-day window', async () => {
 const res = await request(app)
 .get(`/api/external/v1/accounts/${customerId}/profit-summary?endDate=2026-06-10`)
 .set('Authorization', `Bearer ${apiKey}`);

 expect(res.status).toBe(200);
 expect(res.body.data.period.from).toBe('2025-06-09');
 expect(res.body.data.period.to).toBe('2026-06-10');
});

it('rejects malformed date parameter with 400 INVALID_PARAMETER', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${customerId}/profit-summary?startDate=not-a-date`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMETER');
  });

  it('works using internal account UUID in path', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/profit-summary`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalSales).toBe('80000.00');
  });
});
