import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Partner API Key Auth & Account Resolution (tests/integration/partner-auth.test.ts)', () => {
  const testId = `partner-auth-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let userIdA: string;
  let platformIdA: string;
  let apiKeyA: string;

  let userIdB: string;
  let platformIdB: string;
  let apiKeyB: string;

  let suspendedUserId: string;
  let suspendedPlatformId: string;
  let suspendedApiKey: string;

  let createdAccountId: string;
  const externalCustomerId = `cust-${testId}`;

  beforeAll(async () => {
    // Platform A
    const userA = await prisma.user.create({
      data: { email: `${testId}-a@example.com`, fullName: 'Partner A Owner' },
    });
    userIdA = userA.id;

    apiKeyA = generateApiKey('sk_ext_live_');
    const platformA = await prisma.platform.create({
      data: {
        name: `Platform A ${testId}`,
        ownerUserId: userIdA,
        apiKeyHash: hashToken(apiKeyA),
        apiKeyPrefix: apiKeyA.slice(0, 16),
        isActive: true,
      },
    });
    platformIdA = platformA.id;

    // Platform B
    const userB = await prisma.user.create({
      data: { email: `${testId}-b@example.com`, fullName: 'Partner B Owner' },
    });
    userIdB = userB.id;

    apiKeyB = generateApiKey('sk_ext_live_');
    const platformB = await prisma.platform.create({
      data: {
        name: `Platform B ${testId}`,
        ownerUserId: userIdB,
        apiKeyHash: hashToken(apiKeyB),
        apiKeyPrefix: apiKeyB.slice(0, 16),
        isActive: true,
      },
    });
    platformIdB = platformB.id;

    // Suspended Platform
    const suspendedUser = await prisma.user.create({
      data: { email: `${testId}-susp@example.com`, fullName: 'Suspended Owner' },
    });
    suspendedUserId = suspendedUser.id;

    suspendedApiKey = generateApiKey('sk_ext_live_');
    const suspendedPlatform = await prisma.platform.create({
      data: {
        name: `Suspended Platform ${testId}`,
        ownerUserId: suspendedUserId,
        apiKeyHash: hashToken(suspendedApiKey),
        apiKeyPrefix: suspendedApiKey.slice(0, 16),
        isActive: false,
        suspendedReason: 'Account past due',
      },
    });
    suspendedPlatformId = suspendedPlatform.id;
  });

  afterAll(async () => {
    if (createdAccountId) {
      await prisma.auditLog.deleteMany({ where: { businessId: createdAccountId } });
      await prisma.businessMember.deleteMany({ where: { businessId: createdAccountId } });
      await prisma.business.deleteMany({ where: { id: createdAccountId } });
    }
    const platIds = [platformIdA, platformIdB, suspendedPlatformId].filter((id): id is string => Boolean(id));
    if (platIds.length > 0) {
      await prisma.platform.deleteMany({ where: { id: { in: platIds } } });
    }
    const userIds = [userIdA, userIdB, suspendedUserId].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it('rejects request with missing Authorization header (401)', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .send({ customerId: 'CUST-1', businessName: 'Test' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects request with malformed Authorization header (401)', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', 'Basic 123456')
      .send({ customerId: 'CUST-1', businessName: 'Test' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects request with invalid or unrecognized API key (401)', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', 'Bearer sk_ext_live_nonexistentkey1234567890')
      .send({ customerId: 'CUST-1', businessName: 'Test' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects request from a suspended platform (403)', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${suspendedApiKey}`)
      .send({ customerId: 'CUST-1', businessName: 'Test' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLATFORM_SUSPENDED');
  });

  it('rejects customerId in UUID format with 400 CUSTOMER_ID_RESERVED', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${apiKeyA}`)
      .send({
        customerId: '123e4567-e89b-12d3-a456-426614174000',
        businessName: 'UUID Cust',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CUSTOMER_ID_RESERVED');
  });

  it('onboards new merchant account with 201 Created', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${apiKeyA}`)
      .send({
        customerId: externalCustomerId,
        businessName: 'Lekki Supermarket Ltd',
        ownerName: 'Ngozi Eze',
        contactEmail: 'ngozi@example.com',
        contactPhone: '+2348033221100',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.externalCustomerId).toBe(externalCustomerId);
    expect(res.body.data.businessName).toBe('Lekki Supermarket Ltd');
    expect(res.body.data.ownerName).toBe('Ngozi Eze');
    expect(res.body.data.merchantId).toMatch(/^WOWO\d{7}$/);
    expect(res.body.data.platformId).toBe(platformIdA);

    createdAccountId = res.body.data.id;
  });

  it('re-onboarding same customerId returns 200 OK with existing account (idempotency)', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${apiKeyA}`)
      .send({
        customerId: externalCustomerId,
        businessName: 'Different Name Attempt',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdAccountId);
    expect(res.body.data.businessName).toBe('Lekki Supermarket Ltd'); // preserved
  });

  it('resolves account via partner externalCustomerId in path', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${externalCustomerId}`)
      .set('Authorization', `Bearer ${apiKeyA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdAccountId);
    expect(res.body.data.businessName).toBe('Lekki Supermarket Ltd');
  });

  it('resolves account via internal UUID in path', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${apiKeyA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdAccountId);
  });

  it('cross-tenant: Platform B cannot access Platform A account (404 NOT_FOUND)', async () => {
    // By externalCustomerId
    const res1 = await request(app)
      .get(`/api/external/v1/accounts/${externalCustomerId}`)
      .set('Authorization', `Bearer ${apiKeyB}`);

    expect(res1.status).toBe(404);
    expect(res1.body.error.code).toBe('NOT_FOUND');

    // By internal UUID
    const res2 = await request(app)
      .get(`/api/external/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${apiKeyB}`);

    expect(res2.status).toBe(404);
    expect(res2.body.error.code).toBe('NOT_FOUND');
  });
});
