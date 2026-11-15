import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { createAdmin } from '../../src/db/admin.repo.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

describe('Admin surface (Phase 8: tests/integration/admin.test.ts)', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    TRUST_PROXY: '1',
  });
  const app = createApp(config);

  const testId = `admin-test-${Date.now()}`;
  let platformId: string;
  let userId: string;
  let businessId: string;
  let platformApiKey: string;

  // Admin tokens
  let normalAdminToken: string;
  let normalAdminId: string;

  let perpetualAdminToken: string;
  let perpetualAdminId: string;

  let expiredAdminToken: string;
  let expiredAdminId: string;

  let revokedAdminToken: string;
  let revokedAdminId: string;

  let ipRestrictedAdminToken: string;
  let ipRestrictedAdminId: string;

  beforeAll(async () => {
    // 1. Seed user, platform, business and device for target tests
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Admin Test Owner',
      },
    });
    userId = user.id;

    platformApiKey = generateToken();
    const platform = await prisma.platform.create({
      data: {
        name: `Admin Test Platform ${testId}`,
        ownerUserId: userId,
        apiKeyHash: hashToken(platformApiKey),
        isActive: true,
        flatFeeNgn: '50.00',
        subscriptionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Admin Managed Store',
        ownerName: 'Store Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        isActive: true,
      },
    });
    businessId = biz.id;

    // Seed sample sales and invoice
    await prisma.salesTransaction.create({
      data: {
        businessId,
        referenceId: `sale-adm-${testId}`,
        amount: '10000.00',
        source: 'api',
        transactionDate: new Date(),
        status: 'confirmed',
      },
    });

    await prisma.invoice.create({
      data: {
        businessId,
        externalRef: `inv-adm-${testId}`,
        invoiceNumber: `WX-202611-${testId.slice(-7)}`,
        customerName: 'Sample Customer',
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: '10000.00',
        discount: '0.00',
        total: '10000.00',
        vatRate: '0.00',
        vatAmount: '0.00',
        status: 'draft',
      },
    });

    // 2. Seed normal admin token (with future expiry)
    normalAdminToken = generateToken();
    const normalAdmin = await createAdmin({
      name: 'Normal Admin',
      tokenHash: hashToken(normalAdminToken),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    normalAdminId = normalAdmin.id;

    // 3. Seed perpetual admin token (expiresAt: null) for P8-04 warning test
    perpetualAdminToken = generateToken();
    const perpAdmin = await createAdmin({
      name: 'Perpetual Superadmin',
      tokenHash: hashToken(perpetualAdminToken),
      expiresAt: null,
    });
    perpetualAdminId = perpAdmin.id;

    // 4. Seed expired admin token
    expiredAdminToken = generateToken();
    const expAdmin = await createAdmin({
      name: 'Expired Admin',
      tokenHash: hashToken(expiredAdminToken),
      expiresAt: new Date(Date.now() - 3600_000), // expired 1h ago
    });
    expiredAdminId = expAdmin.id;

    // 5. Seed revoked admin token
    revokedAdminToken = generateToken();
    const revAdmin = await createAdmin({
      name: 'Revoked Admin',
      tokenHash: hashToken(revokedAdminToken),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    await prisma.externalAdmin.update({
      where: { id: revAdmin.id },
      data: { revokedAt: new Date() },
    });
    revokedAdminId = revAdmin.id;

    // 6. Seed IP-restricted admin token (allowed only from 198.51.100.42)
    ipRestrictedAdminToken = generateToken();
    const ipAdmin = await createAdmin({
      name: 'IP Restricted Admin',
      tokenHash: hashToken(ipRestrictedAdminToken),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      allowedIps: ['198.51.100.42'],
    });
    ipRestrictedAdminId = ipAdmin.id;
  });

  afterAll(async () => {
    await prisma.externalAdmin.deleteMany({
      where: {
        id: {
          in: [
            normalAdminId,
            perpetualAdminId,
            expiredAdminId,
            revokedAdminId,
            ipRestrictedAdminId,
          ],
        },
      },
    });

    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe('P8-02: Admin auth middleware security gate', () => {
    it('rejects unauthenticated requests to /admin/* with 401 TOKEN_INVALID', async () => {
      const res = await request(app).get('/api/external/v1/admin/usage');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects malformed or invalid admin tokens with 401 TOKEN_INVALID', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', 'Bearer invalid-admin-token-12345');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('CRITICAL GATE: strictly rejects valid partner tokens on /admin/* with 401 TOKEN_INVALID', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', `Bearer ${platformApiKey}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects expired admin tokens with 401 TOKEN_EXPIRED', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', `Bearer ${expiredAdminToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects revoked admin tokens with 401 TOKEN_REVOKED', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', `Bearer ${revokedAdminToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_REVOKED');
    });

    it('enforces IP allowlist: rejects caller IP not in allowedIps with 403 IP_NOT_ALLOWED', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', `Bearer ${ipRestrictedAdminToken}`)
        .set('X-Forwarded-For', '203.0.113.99'); // Disallowed IP

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('IP_NOT_ALLOWED');
    });

    it('enforces IP allowlist: accepts caller IP present in allowedIps with 200 OK', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', `Bearer ${ipRestrictedAdminToken}`)
        .set('X-Forwarded-For', '198.51.100.42'); // Whitelisted IP

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('P8-03: Platform endpoints', () => {
    it('GET /admin/platforms lists platforms with account counts', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/platforms')
        .set('Authorization', `Bearer ${normalAdminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      const target = (res.body.data as Array<{ id: string; name: string; totalAccounts: number; activeAccounts: number }>).find((p) => p.id === platformId);
      expect(target).toBeDefined();
      expect(target?.name).toContain('Admin Test Platform');
      expect(target?.totalAccounts).toBeGreaterThanOrEqual(1);
      expect(target?.activeAccounts).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /admin/platforms/:id updates fee and extends subscription', async () => {
      const newExpiry = new Date(Date.now() + 60 * 86_400_000).toISOString();
      const res = await request(app)
        .patch(`/api/external/v1/admin/platforms/${platformId}`)
        .set('Authorization', `Bearer ${normalAdminToken}`)
        .send({
          flatFeeNgn: '150.00',
          subscriptionExpiresAt: newExpiry,
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.flatFeeNgn)).toBe(150);

      const dbPlatform = await prisma.platform.findUnique({ where: { id: platformId } });
      expect(dbPlatform?.flatFeeNgn?.toString()).toBe('150');
    });

    it('PATCH /admin/platforms/:id supports platform-level suspension and resumption', async () => {
      // Suspend
      const suspendRes = await request(app)
        .patch(`/api/external/v1/admin/platforms/${platformId}`)
        .set('Authorization', `Bearer ${normalAdminToken}`)
        .send({
          isActive: false,
          suspendedReason: 'Administrative investigation',
        });

      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.data.isActive).toBe(false);
      expect(suspendRes.body.data.suspendedReason).toBe('Administrative investigation');

      // Verify partner platform now receives 403 PLATFORM_SUSPENDED
      const platformCheck = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/sales`)
        .set('Authorization', `Bearer ${platformApiKey}`);
      expect(platformCheck.status).toBe(403);
      expect(platformCheck.body.error.code).toBe('PLATFORM_SUSPENDED');

      // Resume
      const resumeRes = await request(app)
        .patch(`/api/external/v1/admin/platforms/${platformId}`)
        .set('Authorization', `Bearer ${normalAdminToken}`)
        .send({ isActive: true });

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.data.isActive).toBe(true);

      // Verify platform access restored
      const platformRestored = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/sales`)
        .set('Authorization', `Bearer ${platformApiKey}`);
      expect(platformRestored.status).toBe(200);
    });
  });

  describe('P8-03: Account management and live detail', () => {
    it('GET /admin/accounts lists accounts with search and pagination', async () => {
      const res = await request(app)
        .get(`/api/external/v1/admin/accounts?platformId=${platformId}&search=Admin+Managed`)
        .set('Authorization', `Bearer ${normalAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(businessId);
      expect(res.body.page.limit).toBe(50);
    });

    it('GET /admin/accounts/:id returns live entity counts', async () => {
      const res = await request(app)
        .get(`/api/external/v1/admin/accounts/${businessId}`)
        .set('Authorization', `Bearer ${normalAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(businessId);
      expect(res.body.data.businessName).toBe('Admin Managed Store');
      expect(res.body.data.stats.salesCount).toBeGreaterThanOrEqual(1);
      expect(res.body.data.stats.invoicesCount).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /admin/accounts/:id suspends and resumes merchant account', async () => {
      // 1. Suspend account
      const suspRes = await request(app)
        .patch(`/api/external/v1/admin/accounts/${businessId}`)
        .set('Authorization', `Bearer ${normalAdminToken}`)
        .send({ isActive: false });

      expect(suspRes.status).toBe(200);
      expect(suspRes.body.data.isActive).toBe(false);

      // Verify merchant traffic is rejected with 403 ACCOUNT_INACTIVE
      const devRes = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/sales`)
        .set('Authorization', `Bearer ${platformApiKey}`);
      expect(devRes.status).toBe(403);
      expect(devRes.body.error.code).toBe('ACCOUNT_INACTIVE');

      // 2. Resume account
      const resumeRes = await request(app)
        .patch(`/api/external/v1/admin/accounts/${businessId}`)
        .set('Authorization', `Bearer ${normalAdminToken}`)
        .send({ isActive: true });

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.data.isActive).toBe(true);

      // Verify traffic flows again
      const devResumeRes = await request(app)
        .get(`/api/external/v1/accounts/${businessId}/sales`)
        .set('Authorization', `Bearer ${platformApiKey}`);
      expect(devResumeRes.status).toBe(200);
    });
  });

  describe('P8-04: Admin usage warning and credential audit', () => {
    it('GET /admin/usage returns system stats and flags non-expiring perpetual admin tokens', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/usage')
        .set('Authorization', `Bearer ${normalAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.platforms.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.accounts.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.entities.sales).toBeGreaterThanOrEqual(1);
      expect(res.body.data.entities.invoices).toBeGreaterThanOrEqual(1);

      // P8-04: Admin credential warnings
      const warnings = res.body.data.adminCredentials.warnings;
      expect(Array.isArray(warnings)).toBe(true);
      expect(warnings.some((w: string) => w.includes('Perpetual Superadmin'))).toBe(true);
      expect(warnings.some((w: string) => w.includes('has no expiration date'))).toBe(true);

      // Detailed token audit list
      const tokens = res.body.data.adminCredentials.tokens as Array<{ id: string; hasExpiry: boolean; expiresAt: string | null }>;
      const perp = tokens.find((t) => t.id === perpetualAdminId);
      expect(perp).toBeDefined();
      expect(perp?.hasExpiry).toBe(false);
      expect(perp?.expiresAt).toBeNull();

      const normal = tokens.find((t) => t.id === normalAdminId);
      expect(normal).toBeDefined();
      expect(normal?.hasExpiry).toBe(true);
      expect(normal?.expiresAt).not.toBeNull();
    });
  });
});
