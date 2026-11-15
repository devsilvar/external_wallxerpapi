import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { logger } from '../../src/lib/logger.js';
import { issueActivationCode } from '../../src/cli/admin.js';

describe('Auth integration (tests/integration/auth.test.ts)', () => {
  const testId = `auth-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessAId: string;
  let businessBId: string;

  beforeAll(async () => {
    // Platform owner user
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Auth Test Platform Owner',
      },
    });
    userId = user.id;

    // Platform
    const platform = await prisma.platform.create({
      data: {
        name: 'Auth Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    // Business A
    const bizA = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-a-${testId}`,
        userId,
        businessName: 'Business A',
        ownerName: 'Owner A',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessAId = bizA.id;

    // Business B
    const bizB = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-b-${testId}`,
        userId,
        businessName: 'Business B',
        ownerName: 'Owner B',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessBId = bizB.id;
  });

  afterAll(async () => {
    const bizIds = [businessAId, businessBId];
    await prisma.auditLog.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.externalDevice.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('activates a device, issues token once, and rejects code reuse', async () => {
    // Spy on logger to ensure no credential is leaked
    const loggedMessages: string[] = [];
    const logSpy = vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      loggedMessages.push(JSON.stringify(args));
    });

    // 1. Issue an activation code for Business A
    const { code } = await issueActivationCode(businessAId);
    expect(code).toHaveLength(10);

    // 2. Activate device
    const res = await request(app)
      .post('/api/external/v1/auth/activate')
      .send({
        code,
        deviceName: 'Warehouse Scanner 1',
        devicePlatform: 'android',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    const token = res.body.data.token;
    expect(typeof token).toBe('string');
    expect(res.body.data.accountId).toBe(businessAId);

    // 3. Second activation with the SAME code must fail (401 CODE_INVALID)
    const reuseRes = await request(app)
      .post('/api/external/v1/auth/activate')
      .send({ code });

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe('CODE_INVALID');

    // 4. Assert token and code never appear in any log output
    for (const msg of loggedMessages) {
      expect(msg).not.toContain(token);
      expect(msg).not.toContain(code);
    }

    logSpy.mockRestore();
  });

  it('rejects activation with unknown fields with 400 UNKNOWN_FIELD', async () => {
    const res = await request(app)
      .post('/api/external/v1/auth/activate')
      .send({
        code: '1234567890',
        hackerField: 'exploit',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('rejects expired activation codes', async () => {
    // Issue code with -1 hour TTL (already expired)
    const { code } = await issueActivationCode(businessAId, -1);

    const res = await request(app)
      .post('/api/external/v1/auth/activate')
      .send({ code });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CODE_INVALID');
  });

  it('authenticates valid token on data route and returns 404 for wrong account (never 403)', async () => {
    // Activate a token for Business A
    const { code } = await issueActivationCode(businessAId);
    const actRes = await request(app)
      .post('/api/external/v1/auth/activate')
      .send({ code });
    const tokenA = actRes.body.data.token;

    // 1. Calling Business A route with Business A's token -> 200
    const okRes = await request(app)
      .get(`/api/external/v1/accounts/${businessAId}/ping`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.ok).toBe(true);

    // 2. Calling Business B route with Business A's token -> 404 NOT_FOUND (Rule 6: never 403!)
    const crossRes = await request(app)
      .get(`/api/external/v1/accounts/${businessBId}/ping`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossRes.status).toBe(404);
    expect(crossRes.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects requests with missing, malformed, or expired token', async () => {
    // 1. Missing header
    const noAuth = await request(app).get(`/api/external/v1/accounts/${businessAId}/ping`);
    expect(noAuth.status).toBe(401);
    expect(noAuth.body.error.code).toBe('TOKEN_INVALID');

    // 2. Malformed token
    const badToken = await request(app)
      .get(`/api/external/v1/accounts/${businessAId}/ping`)
      .set('Authorization', 'Bearer invalid-dummy-token-xyz');
    expect(badToken.status).toBe(401);
    expect(badToken.body.error.code).toBe('TOKEN_INVALID');

    // 3. Expired token
    const { code } = await issueActivationCode(businessAId);
    const act = await request(app).post('/api/external/v1/auth/activate').send({ code });
    const token = act.body.data.token;

    // Set expiresAt to the past
    await prisma.externalDevice.updateMany({
      where: { businessId: businessAId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expiredRes = await request(app)
      .get(`/api/external/v1/accounts/${businessAId}/ping`)
      .set('Authorization', `Bearer ${token}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('supports self-revocation via POST /auth/revoke', async () => {
    // Reset expiresAt back to null
    await prisma.externalDevice.updateMany({
      where: { businessId: businessAId },
      data: { expiresAt: null },
    });

    const { code } = await issueActivationCode(businessAId);
    const act = await request(app).post('/api/external/v1/auth/activate').send({ code });
    const token = act.body.data.token;

    // Revoke
    const revokeRes = await request(app)
      .post('/api/external/v1/auth/revoke')
      .set('Authorization', `Bearer ${token}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.data.revoked).toBe(true);

    // Subsequent request with the revoked token must fail
    const blockedRes = await request(app)
      .get(`/api/external/v1/accounts/${businessAId}/ping`)
      .set('Authorization', `Bearer ${token}`);
    expect(blockedRes.status).toBe(401);
    expect(blockedRes.body.error.code).toBe('TOKEN_INVALID');
  });

  it('throttles lastSeenAt updates to at most once per 5 minutes', async () => {
    const { code } = await issueActivationCode(businessAId);
    const act = await request(app).post('/api/external/v1/auth/activate').send({ code });
    const token = act.body.data.token;

    // First request
    await request(app)
      .get(`/api/external/v1/accounts/${businessAId}/ping`)
      .set('Authorization', `Bearer ${token}`);

    const dev1 = await prisma.externalDevice.findFirst({
      where: { businessId: businessAId, revokedAt: null },
    });
    expect(dev1?.lastSeenAt).toBeDefined();
    const firstSeenTime = dev1?.lastSeenAt?.getTime();

    // Immediate second request
    await request(app)
      .get(`/api/external/v1/accounts/${businessAId}/ping`)
      .set('Authorization', `Bearer ${token}`);

    const dev2 = await prisma.externalDevice.findFirst({
      where: { businessId: businessAId, revokedAt: null },
    });
    const secondSeenTime = dev2?.lastSeenAt?.getTime();

    // Must be identical because update was throttled within 5 minutes
    expect(secondSeenTime).toBe(firstSeenTime);
  });
});
