import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';

describe('Developer Portal Key Lifecycle (tests/integration/portal-keys.test.ts)', () => {
  const testId = `keys-test-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let sessionTokenA: string;
  let platformAId: string;
  let userAId: string;

  let sessionTokenB: string;
  let platformBId: string;

  let createdTestKey: string;
  let createdTestKeyId: string;
  let createdLiveKey: string;
  let createdLiveKeyId: string;

  beforeAll(async () => {
    // 1. Create Developer A
    const regResA = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: `${testId}-a@example.com`,
        password: 'Password123!@#',
        platformName: 'Platform A',
      });
    expect(regResA.status).toBe(201);
    sessionTokenA = regResA.body.data.sessionToken;
    platformAId = regResA.body.data.platform.id;
    userAId = regResA.body.data.user.id;

    // 2. Create Developer B
    const regResB = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: `${testId}-b@example.com`,
        password: 'Password123!@#',
        platformName: 'Platform B',
      });
    expect(regResB.status).toBe(201);
    sessionTokenB = regResB.body.data.sessionToken;
    platformBId = regResB.body.data.platform.id;
  });

  afterAll(async () => {
    // Cleanup
    for (const platId of [platformAId, platformBId]) {
      if (platId) {
        await prisma.session.deleteMany({ where: { platformId: platId } });
        await prisma.platformApiKey.deleteMany({ where: { platformId: platId } });
        const plat = await prisma.platform.findUnique({ where: { id: platId } });
        if (plat) {
          await prisma.platform.delete({ where: { id: platId } });
          await prisma.user.delete({ where: { id: plat.ownerUserId } });
        }
      }
    }
  });

  it('1. GET /portal/keys lists keys created for platform (including default test key from signup)', async () => {
    const res = await request(app)
      .get('/api/external/v1/portal/keys')
      .set('Authorization', `Bearer ${sessionTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const firstKey = res.body.data[0];
    expect(firstKey.prefix.startsWith('sk_ext_test_')).toBe(true);
    expect(firstKey.keyHash).toBeUndefined(); // NEVER EXPOSE KEY HASH
  });

  it('2. POST /portal/keys issues a new test key immediately', async () => {
    const res = await request(app)
      .post('/api/external/v1/portal/keys')
      .set('Authorization', `Bearer ${sessionTokenA}`)
      .send({
        label: 'Secondary Test Key',
        environment: 'test',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.apiKey).toBeDefined();
    expect(res.body.data.apiKey.startsWith('sk_ext_test_')).toBe(true);
    expect(res.body.data.label).toBe('Secondary Test Key');

    createdTestKey = res.body.data.apiKey;
    createdTestKeyId = res.body.data.id;
  });

  it('3. POST /portal/keys rejects live key creation when approvalStatus is PENDING', async () => {
    const res = await request(app)
      .post('/api/external/v1/portal/keys')
      .set('Authorization', `Bearer ${sessionTokenA}`)
      .send({
        label: 'Production Live Key',
        environment: 'live',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPROVAL_REQUIRED');
  });

  it('4. POST /portal/keys allows live key creation after platform approval', async () => {
    // Approve platform in DB
    await prisma.platform.update({
      where: { id: platformAId },
      data: { approvalStatus: 'LIVE' },
    });

    const res = await request(app)
      .post('/api/external/v1/portal/keys')
      .set('Authorization', `Bearer ${sessionTokenA}`)
      .send({
        label: 'Production Live Key',
        environment: 'live',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.apiKey).toBeDefined();
    expect(res.body.data.apiKey.startsWith('sk_ext_live_')).toBe(true);

    createdLiveKey = res.body.data.apiKey;
    createdLiveKeyId = res.body.data.id;
  });

  it('5. Live API key successfully authenticates partner endpoints', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${createdLiveKey}`)
      .send({
        customerId: `cust-live-${Date.now()}`,
        businessName: 'Live Partner Store',
        ownerName: 'Alice Owner',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.businessName).toBe('Live Partner Store');
  });

  it('6. DELETE /portal/keys/:id revokes key and prevents further partner API use', async () => {
    const revokeRes = await request(app)
      .delete(`/api/external/v1/portal/keys/${createdLiveKeyId}`)
      .set('Authorization', `Bearer ${sessionTokenA}`);

    expect(revokeRes.status).toBe(204);

    // Calling API with revoked key now fails with 401
    const callRes = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${createdLiveKey}`)
      .send({
        customerId: `cust-fail-${Date.now()}`,
        businessName: 'Failing Store',
        ownerName: 'Alice Owner',
      });

    expect(callRes.status).toBe(401);
    expect(callRes.body.error.code).toBe('TOKEN_INVALID');
  });

  it('7. Developer B cannot revoke Developer A key (tenant isolation)', async () => {
    const crossRevokeRes = await request(app)
      .delete(`/api/external/v1/portal/keys/${createdTestKeyId}`)
      .set('Authorization', `Bearer ${sessionTokenB}`);

    expect(crossRevokeRes.status).toBe(404);
    expect(crossRevokeRes.body.error.code).toBe('KEY_NOT_FOUND');
  });

  it('8. GET /portal/usage returns platform-scoped statistics and key counts', async () => {
    const res = await request(app)
      .get('/api/external/v1/portal/usage')
      .set('Authorization', `Bearer ${sessionTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.platformId).toBe(platformAId);
    expect(res.body.data.merchantsCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totals).toBeDefined();
    expect(res.body.data.totals.sales).toBeDefined();
  });
});
