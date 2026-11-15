import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Reference namespace reservation (tests/integration/reference-namespace.test.ts)', () => {
  const testId = `ref-ns-${Date.now()}`;
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
        fullName: 'Namespace Tester',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Namespace Test Platform',
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
        businessName: 'Namespace Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rejects sale creation with referenceId starting with WX- with 400 INVALID_REFERENCE', async () => {
    const prohibitedReferences = [
      'WX-2026-001',
      'wx-2026-002',
      'WX-POS-SALE',
      'Wx-my-sale',
    ];

    for (const ref of prohibitedReferences) {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${businessId}/sales`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          referenceId: ref,
          amount: '1000.00',
          source: 'api',
          transactionDate: '2026-11-10',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REFERENCE');
    }
  });

  it('allows valid external referenceIds not matching ^WX-', async () => {
    const validReferences = [
      `POS-${testId}-1`,
      `order_9981_${testId}`,
      `tx_abc_123`,
      `wowo-tx-${testId}`,
    ];

    for (const ref of validReferences) {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${businessId}/sales`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          referenceId: ref,
          amount: '1000.00',
          source: 'api',
          transactionDate: '2026-11-10',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.referenceId).toBe(ref);
    }
  });
});
