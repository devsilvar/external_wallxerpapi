import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAdmin } from '../../src/db/admin.repo.js';
import { prisma } from '../../src/db/client.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

interface AdminSummaryResponse {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  allowedIpsCount: number;
  revokedAt: string | null;
  tokenHash?: string;
}

interface AuditLogEntryResponse {
  id: string;
  action: string;
  actor: string;
  resourceId?: string;
  metadata?: {
    oldData?: Record<string, unknown>;
    newData?: Record<string, unknown>;
  };
}

describe('Admin Credentials & Audit Logging (Phase B: tests/integration/admin-credentials.test.ts)', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    TRUST_PROXY: '1',
  });
  const app = createApp(config);

  const testId = `cred-test-${Date.now()}`;
  let adminToken: string;
  let adminId: string;
  let platformId: string;
  let businessId: string;
  let userId: string;

  beforeAll(async () => {
    // Purge any legacy service key row from database to ensure D11 rejection
    await prisma.externalAdmin.deleteMany({
      where: {
        tokenHash: hashToken('wallx_ext_service_adm_f9b3f86_2026_sec'),
      },
    });

    // 1. Seed root test admin
    adminToken = generateToken();
    const admin = await createAdmin({
      name: `${testId}-operator`,
      tokenHash: hashToken(adminToken),
      role: 'admin',
    });
    adminId = admin.id;

    // 2. Seed user, platform, business for audit mutation tests
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Admin Credential Test User',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: `${testId}-platform`,
        ownerUserId: user.id,
        isActive: true,
      },
    });
    platformId = platform.id;

    const business = await prisma.business.create({
      data: {
        platformId: platform.id,
        externalCustomerId: `cust-${testId}`,
        userId: user.id,
        businessName: `${testId}-merchant`,
        ownerName: 'Store Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        isActive: true,
      },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    // Clean up created test entities
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ platformId }, { businessId }, { resourceId: adminId }],
      },
    });
    await prisma.business.deleteMany({ where: { platformId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.externalAdmin.deleteMany({
      where: { name: { startsWith: testId } },
    });
  });

  describe('GET /admin/admins', () => {
    it('requires admin authentication', async () => {
      const res = await request(app).get('/api/external/v1/admin/admins');
      expect(res.status).toBe(401);
    });

    it('lists admin credentials without revealing token hashes', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/admins')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const target = res.body.data.find(
        (a: AdminSummaryResponse) => a.id === adminId
      );
      expect(target).toBeDefined();
      expect(target.name).toBe(`${testId}-operator`);
      expect(target.role).toBe('admin');
      expect(target.createdAt).toBeDefined();
      expect(target.allowedIpsCount).toBe(0);
      expect(target.tokenHash).toBeUndefined();
    });
  });

  describe('POST /admin/admins', () => {
    let createdToken: string;
    let createdAdminId: string;

    it('validates input rejecting invalid names and roles', async () => {
      const emptyName = await request(app)
        .post('/api/external/v1/admin/admins')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '' });
      expect(emptyName.status).toBe(400);

      const invalidRole = await request(app)
        .post('/api/external/v1/admin/admins')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Valid Name', role: 'super-admin' });
      expect(invalidRole.status).toBe(400);
    });

    it('mints an admin token, returns the raw token ONCE, and writes an audit log', async () => {
      const res = await request(app)
        .post('/api/external/v1/admin/admins')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `${testId}-sub-admin`,
          role: 'readonly',
          allowedIps: ['127.0.0.1'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.rawToken).toBeDefined();
      expect(typeof res.body.data.rawToken).toBe('string');
      expect(res.body.data.rawToken.length).toBeGreaterThan(20);

      createdToken = res.body.data.rawToken;
      createdAdminId = res.body.data.admin.id;

      expect(res.body.data.admin.name).toBe(`${testId}-sub-admin`);
      expect(res.body.data.admin.role).toBe('readonly');
      expect(res.body.data.admin.allowedIpsCount).toBe(1);

      // Verify the new token can immediately authenticate on an admin endpoint
      const authRes = await request(app)
        .get('/api/external/v1/admin/platforms')
        .set('Authorization', `Bearer ${createdToken}`)
        .set('X-Forwarded-For', '127.0.0.1');
      expect(authRes.status).toBe(200);

      // Verify audit log row was written
      const auditRes = await request(app)
        .get(`/api/external/v1/admin/audit-logs?action=ADMIN_TOKEN_CREATED`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(auditRes.status).toBe(200);
      const auditEntry = auditRes.body.data.find(
        (log: AuditLogEntryResponse) => log.resourceId === createdAdminId
      );
      expect(auditEntry).toBeDefined();
      expect(auditEntry.action).toBe('ADMIN_TOKEN_CREATED');
      expect(auditEntry.actor).toBe(`${testId}-operator`);
    });

    it('revokes the created token, rejecting subsequent requests with 401 TOKEN_REVOKED and auditing', async () => {
      const revokeRes = await request(app)
        .delete(`/api/external/v1/admin/admins/${createdAdminId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.data.id).toBe(createdAdminId);
      expect(revokeRes.body.data.revokedAt).toBeDefined();

      // Revoked token must now be rejected
      const authAfterRevoke = await request(app)
        .get('/api/external/v1/admin/platforms')
        .set('Authorization', `Bearer ${createdToken}`);
      expect(authAfterRevoke.status).toBe(401);
      expect(authAfterRevoke.body.error.code).toBe('TOKEN_REVOKED');

      // Verify revocation was audited
      const auditRes = await request(app)
        .get(`/api/external/v1/admin/audit-logs?action=ADMIN_TOKEN_REVOKED`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(auditRes.status).toBe(200);
      const auditEntry = auditRes.body.data.find(
        (log: AuditLogEntryResponse) => log.resourceId === createdAdminId
      );
      expect(auditEntry).toBeDefined();
    });

    it('returns 404 when attempting to revoke non-existent admin ID', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .delete(`/api/external/v1/admin/admins/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Audit logs for Platform and Account mutations (B5)', () => {
    it('audits platform suspension and resumption', async () => {
      const suspendRes = await request(app)
        .patch(`/api/external/v1/admin/platforms/${platformId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          isActive: false,
          suspendedReason: 'Testing audit trail on suspension',
        });
      expect(suspendRes.status).toBe(200);

      const auditRes = await request(app)
        .get(`/api/external/v1/admin/audit-logs?platformId=${platformId}&action=PLATFORM_UPDATED`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.data.length).toBeGreaterThanOrEqual(1);
      const latest = auditRes.body.data[0];
      expect(latest.action).toBe('PLATFORM_UPDATED');
      expect(latest.actor).toBe(`${testId}-operator`);
      expect(latest.metadata.newData.isActive).toBe(false);
      expect(latest.metadata.newData.suspendedReason).toBe('Testing audit trail on suspension');
    });

    it('audits account active status updates', async () => {
      const patchRes = await request(app)
        .patch(`/api/external/v1/admin/accounts/${businessId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          isActive: false,
        });
      expect(patchRes.status).toBe(200);

      const auditRes = await request(app)
        .get(`/api/external/v1/admin/audit-logs?businessId=${businessId}&action=ACCOUNT_UPDATED`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.data.length).toBeGreaterThanOrEqual(1);
      const latest = auditRes.body.data[0];
      expect(latest.action).toBe('ACCOUNT_UPDATED');
      expect(latest.actor).toBe(`${testId}-operator`);
      expect(latest.metadata.newData.isActive).toBe(false);
    });

    it('rejects server-to-server proxy calls via deprecated service key with 401 (D11)', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/platforms')
        .set('Authorization', 'Bearer wallx_ext_service_adm_f9b3f86_2026_sec')
        .set('x-admin-email', 'superadmin@wallx.com');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });
  });
});
