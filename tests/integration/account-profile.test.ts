import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Account profile self-service (tests/integration/account-profile.test.ts)', () => {
  const testId = `profile-${Date.now()}`;
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
        fullName: 'Profile Tester',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Profile Test Platform',
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
        businessName: 'Original Business Name',
        ownerName: 'Original Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        contactPhone: '+2348011111111',
        contactEmail: 'original@example.com',
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('allows merchant to read their profile via GET /accounts/:accountId', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${businessId}`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(businessId);
    expect(res.body.data.businessName).toBe('Original Business Name');
    expect(res.body.data.ownerName).toBe('Original Owner');
    expect(res.body.data.contactEmail).toBe('original@example.com');
  });

  it('allows merchant to update allowed fields via PATCH /accounts/:accountId', async () => {
    const res = await request(app)
      .patch(`/api/external/v1/accounts/${businessId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        businessName: 'Ada Obi Supermarket',
        ownerName: 'Ada Obi',
        address: '12 Marina Road',
        city: 'Lagos',
        state: 'Lagos',
        contactPhone: '+2348099999999',
        contactEmail: 'ada@example.com',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.businessName).toBe('Ada Obi Supermarket');
    expect(res.body.data.ownerName).toBe('Ada Obi');
    expect(res.body.data.address).toBe('12 Marina Road');
    expect(res.body.data.contactPhone).toBe('+2348099999999');
    expect(res.body.data.contactEmail).toBe('ada@example.com');
  });

  it('strictly rejects modifications to read-only fields with 400 UNKNOWN_FIELD', async () => {
    const forbiddenPayloads = [
      { merchantId: 'WOWO9999999' },
      { taxId: 'NEW_TAX_ID' },
      { subscriptionExpiresAt: new Date(Date.now() + 10000000).toISOString() },
      { isActive: false },
      { platformId: 'hacked-platform-id' },
      { externalCustomerId: 'hacked-customer-id' },
    ];

    for (const payload of forbiddenPayloads) {
      const res = await request(app)
        .patch(`/api/external/v1/accounts/${businessId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNKNOWN_FIELD');
    }
  });
});
