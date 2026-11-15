import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

describe('Discount bound validation (tests/integration/discount-bound.test.ts)', () => {
  const testId = `disc-bound-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let deviceToken: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Discount Bound Tester',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'Discount Bound Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Discount Bound Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;

    deviceToken = generateToken();
    await prisma.externalDevice.create({
      data: {
        platformId,
        businessId,
        tokenHash: hashToken(deviceToken),
        activatedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.externalDevice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rejects invoice creation with discount > subtotal with 400 INVALID_DISCOUNT (never clamps)', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        externalRef: `inv-excess-disc-${testId}`,
        customerName: 'Test Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-20',
        discount: '15000.00', // exceeds subtotal (10000)
        lines: [
          {
            description: 'Item 1',
            quantity: '1',
            unitPrice: '10000.00',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DISCOUNT');
  });

  it('accepts invoice creation with discount equal to subtotal (total = 0.00)', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        externalRef: `inv-zero-total-${testId}`,
        customerName: 'Test Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-20',
        discount: '10000.00',
        lines: [
          {
            description: 'Item 1',
            quantity: '1',
            unitPrice: '10000.00',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.subtotal).toBe('10000.00');
    expect(res.body.data.discount).toBe('10000.00');
    expect(res.body.data.total).toBe('0.00');
  });

  it('rejects invoice update with discount > subtotal with 400 INVALID_DISCOUNT', async () => {
    // 1. Create valid draft invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        externalRef: `inv-update-disc-${testId}`,
        customerName: 'Test Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-20',
        discount: '1000.00',
        lines: [
          {
            description: 'Item 1',
            quantity: '1',
            unitPrice: '5000.00',
          },
        ],
      });

    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;

    // 2. Update with discount > subtotal (6000 > 5000)
    const updateRes = await request(app)
      .put(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        discount: '6000.00',
      });

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error.code).toBe('INVALID_DISCOUNT');
  });
});
