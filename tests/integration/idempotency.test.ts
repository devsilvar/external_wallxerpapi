import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

describe('Idempotency integration (tests/integration/idempotency.test.ts)', () => {
  const testId = `idempotency-${Date.now()}`;
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
        fullName: 'Idempotency Tester',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'Idempotency Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Idempotent Biz',
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
    await prisma.saleLineItem.deleteMany({ where: { sale: { businessId } } });
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.expense.deleteMany({ where: { businessId } });
    await prisma.customer.deleteMany({ where: { businessId } });
    await prisma.externalDevice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('replayed sale create returns original row with 200 OK; different payload returns 409', async () => {
    const referenceId = `ref-sale-${testId}`;
    const payload1 = {
      referenceId,
      amount: '15000.00',
      source: 'api',
      transactionDate: '2026-11-10',
      description: 'First attempt',
    };

    // 1. Initial creation -> 201 Created
    const res1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/sales`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(payload1);

    expect(res1.status).toBe(201);
    expect(res1.body.data.id).toBeDefined();
    expect(res1.body.data.referenceId).toBe(referenceId);
    const saleId = res1.body.data.id;

    // 2. Exact replay -> 200 OK with identical sale id
    const res2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/sales`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(payload1);

    expect(res2.status).toBe(200);
    expect(res2.body.data.id).toBe(saleId);

    // 3. Replay with money normalization difference ("15000" vs "15000.00") -> 200 OK
    const res3 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/sales`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        ...payload1,
        amount: 15000, // as number instead of string
      });

    expect(res3.status).toBe(200);
    expect(res3.body.data.id).toBe(saleId);

    // 4. Same referenceId with DIFFERENT amount -> 409 DUPLICATE_REFERENCE
    const res4 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/sales`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        ...payload1,
        amount: '20000.00', // Conflict!
      });

    expect(res4.status).toBe(409);
    expect(res4.body.error.code).toBe('DUPLICATE_REFERENCE');
  });

  it('replayed expense create returns original row with 200 OK; different payload returns 409', async () => {
    const externalRef = `ref-exp-${testId}`;
    const payload = {
      externalRef,
      category: 'office_supplies',
      description: 'Printer ink',
      amount: '4500.00',
      expenseDate: '2026-11-10',
    };

    // 1. First creation -> 201 Created
    const res1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(payload);

    expect(res1.status).toBe(201);
    const expenseId = res1.body.data.id;

    // 2. Exact replay -> 200 OK
    const res2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.data.id).toBe(expenseId);

    // 3. Same externalRef with different description -> 409 DUPLICATE_REFERENCE
    const res3 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        ...payload,
        description: 'Totally different item',
      });

    expect(res3.status).toBe(409);
    expect(res3.body.error.code).toBe('DUPLICATE_REFERENCE');
  });
});
