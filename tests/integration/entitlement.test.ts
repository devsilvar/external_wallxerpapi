import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import {
  buildExpiryDetails,
  isAccountExpired,
  isPlatformExpired,
} from '../../src/services/entitlement.service.js';
import { issueActivationCode } from '../../src/cli/admin.js';

describe('Entitlement & Kill-switch integration (tests/integration/entitlement.test.ts)', () => {
  const testId = `entitle-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let token: string;

  beforeAll(async () => {
    // 1. Create User
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Entitlement Test Platform Owner',
      },
    });
    userId = user.id;

    // 2. Create Platform
    const platform = await prisma.platform.create({
      data: {
        name: 'Entitlement Test Platform',
        ownerUserId: userId,
        isActive: true,
      },
    });
    platformId = platform.id;

    // 3. Create Business
    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Entitlement Test Business',
        ownerName: 'Entitlement Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        isActive: true,
      },
    });
    businessId = biz.id;

    // 4. Activate token
    const { code } = await issueActivationCode(businessId);
    const act = await request(app).post('/api/external/v1/auth/activate').send({ code });
    token = act.body.data.token;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId } });
    await prisma.externalDevice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe('Pure entitlement helpers (P2-07)', () => {
    it('treats null as not expired (correct for pilot accounts)', () => {
      expect(isPlatformExpired({ subscriptionExpiresAt: null })).toBe(false);
      expect(isAccountExpired({ subscriptionExpiresAt: null })).toBe(false);
    });

    it('treats a future date as not expired', () => {
      const future = new Date(Date.now() + 86400000);
      expect(isPlatformExpired({ subscriptionExpiresAt: future })).toBe(false);
      expect(isAccountExpired({ subscriptionExpiresAt: future })).toBe(false);
    });

    it('treats a past date as expired', () => {
      const past = new Date(Date.now() - 5000);
      expect(isPlatformExpired({ subscriptionExpiresAt: past })).toBe(true);
      expect(isAccountExpired({ subscriptionExpiresAt: past })).toBe(true);
    });

    it('builds ISO-8601 expiry details object', () => {
      const date = new Date('2026-12-31T23:59:59.000Z');
      expect(buildExpiryDetails(date)).toEqual({
        expiresAt: '2026-12-31T23:59:59.000Z',
      });
    });
  });

  describe('Middleware entitlement gates (P2-05 & P2-08)', () => {
    it('allows access to data routes and /me when active and unexpired', async () => {
      const ping = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/ping`)
        .set('Authorization', `Bearer ${token}`);
      expect(ping.status).toBe(200);

      const me = await request(app)
        .get('/api/external/v1/me')
        .set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.data.accountId).toBe(businessId);
    });

    it('returns 402 on data routes and 200 on /me when account subscription is expired', async () => {
      const past = new Date(Date.now() - 10000);
      await prisma.business.update({
        where: { id: businessId },
        data: { subscriptionExpiresAt: past },
      });

      // Data route must return 402 SUBSCRIPTION_EXPIRED
      const dataRes = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/ping`)
        .set('Authorization', `Bearer ${token}`);
      expect(dataRes.status).toBe(402);
      expect(dataRes.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(dataRes.body.error.details.expiresAt).toBeDefined();

      // /me is exempt and answers 200
      const meRes = await request(app)
        .get('/api/external/v1/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.subscriptionExpiresAt).toBeDefined();

      // Restore account subscription
      await prisma.business.update({
        where: { id: businessId },
        data: { subscriptionExpiresAt: null },
      });
    });

    it('returns 403 ACCOUNT_INACTIVE on data routes and 200 on /me when account is inactive', async () => {
      await prisma.business.update({
        where: { id: businessId },
        data: { isActive: false },
      });

      // Data route returns 403 ACCOUNT_INACTIVE
      const dataRes = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/ping`)
        .set('Authorization', `Bearer ${token}`);
      expect(dataRes.status).toBe(403);
      expect(dataRes.body.error.code).toBe('ACCOUNT_INACTIVE');

      // /me is exempt and answers 200
      const meRes = await request(app)
        .get('/api/external/v1/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.isActive).toBe(false);

      // Restore account active status
      await prisma.business.update({
        where: { id: businessId },
        data: { isActive: true },
      });
    });

    it('returns 403 PLATFORM_SUSPENDED on data routes and 200 on /me when platform is suspended', async () => {
      await prisma.platform.update({
        where: { id: platformId },
        data: {
          suspendedAt: new Date(),
          suspendedReason: 'Regulatory compliance audit in progress',
        },
      });

      // Data route returns 403 PLATFORM_SUSPENDED
      const dataRes = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/ping`)
        .set('Authorization', `Bearer ${token}`);
      expect(dataRes.status).toBe(403);
      expect(dataRes.body.error.code).toBe('PLATFORM_SUSPENDED');
      expect(dataRes.body.error.message).toContain('Regulatory compliance');

      // /me is exempt and answers 200
      const meRes = await request(app)
        .get('/api/external/v1/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);

      // Restore platform
      await prisma.platform.update({
        where: { id: platformId },
        data: { suspendedAt: null, suspendedReason: null },
      });
    });

    it('confirms account data is preserved across expiry and suspension without loss', async () => {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
      });
      expect(biz).not.toBeNull();
      expect(biz?.id).toBe(businessId);
    });
  });
});
