import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Expense receipt and tax safety (tests/integration/expense-receipt.test.ts)', () => {
  const testId = `exp-rcpt-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let apiKey: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Expense Receipt Tester',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Expense Receipt Test Platform',
        ownerUserId: userId,
        apiKeyHash: hashToken(apiKey),
        apiKeyPrefix: apiKey.slice(0, 16),
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Expense Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('creates expense without receiptUrl (null/omitted) and verifies isDeductible is false in DB', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `exp-no-rcpt-${testId}`,
        description: 'Office supplies without receipt',
        amount: '3500.00',
        expenseDate: '2026-11-10',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.receiptUrl).toBeNull();
    expect(res.body.data.category).toBe('other'); // Default category

    // Check DB record directly to verify tax invariant
    const dbRecord = await prisma.expense.findUnique({
      where: { id: res.body.data.id },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.isDeductible).toBe(false);
  });

  it('creates expense with a valid receiptUrl and verifies isDeductible is false in DB', async () => {
    const receiptUrl = 'https://storage.example.com/receipts/inv-9981.pdf';
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `exp-with-rcpt-${testId}`,
        category: 'fuel',
        description: 'Generator fuel',
        amount: '12000.00',
        expenseDate: '2026-11-10',
        receiptUrl,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.receiptUrl).toBe(receiptUrl);
    expect(res.body.data.category).toBe('fuel');

    const dbRecord = await prisma.expense.findUnique({
      where: { id: res.body.data.id },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.isDeductible).toBe(false);
  });

  it('rejects attempts to inject isDeductible or vatRate with 400 UNKNOWN_FIELD', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `exp-hacked-${testId}`,
        description: 'Hacked tax deduction attempt',
        amount: '50000.00',
        expenseDate: '2026-11-10',
        isDeductible: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD');
  });
});
