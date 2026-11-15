import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { hashToken } from '../../src/lib/token.js';
import { issueActivationCode } from '../../src/cli/admin.js';

describe('Rotate grace window (tests/integration/rotate-grace.test.ts)', () => {
  const testId = `rotate-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    EXTERNAL_ROTATE_GRACE_MINUTES: '10',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Rotate Grace Test Owner',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'Rotate Grace Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Rotate Test Business',
        ownerName: 'Rotate Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId } });
    await prisma.externalDevice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rotates atomically: both old and new tokens resolve within grace window, old token fails after grace expires', async () => {
    // 1. Activate initial device (Token 1)
    const { code } = await issueActivationCode(businessId);
    const act = await request(app).post('/api/external/v1/auth/activate').send({ code });
    const token1 = act.body.data.token;

    // Verify token 1 works
    const ping1 = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/ping`)
      .set('Authorization', `Bearer ${token1}`);
    expect(ping1.status).toBe(200);

    // 2. Rotate token (Token 1 -> Token 2)
    const rotateRes = await request(app)
      .post('/api/external/v1/auth/rotate')
      .set('Authorization', `Bearer ${token1}`);

    expect(rotateRes.status).toBe(200);
    const token2 = rotateRes.body.data.token;
    expect(token2).toBeDefined();
    expect(token2).not.toBe(token1);

    // 3. Both tokens must work inside the grace window!
    // New token works:
    const newRes = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/ping`)
      .set('Authorization', `Bearer ${token2}`);
    expect(newRes.status).toBe(200);

    // Old token works during the grace window:
    const oldGraceRes = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/ping`)
      .set('Authorization', `Bearer ${token1}`);
    expect(oldGraceRes.status).toBe(200);

    // 4. Simulate grace window expiration by advancing old device row's revokedAt to the past
    const token1Hash = hashToken(token1);
    await prisma.externalDevice.update({
      where: { tokenHash: token1Hash },
      data: { revokedAt: new Date(Date.now() - 5000) },
    });

    // 5. Old token now fails outside the grace window (401 TOKEN_INVALID)
    const oldExpiredRes = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/ping`)
      .set('Authorization', `Bearer ${token1}`);
    expect(oldExpiredRes.status).toBe(401);
    expect(oldExpiredRes.body.error.code).toBe('TOKEN_INVALID');

    // 6. New token still works!
    const newStillOk = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/ping`)
      .set('Authorization', `Bearer ${token2}`);
    expect(newStillOk.status).toBe(200);
  });
});
