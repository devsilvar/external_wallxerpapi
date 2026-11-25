import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { hashToken } from '../../src/lib/token.js';

describe('Admin Developer Management & Readonly Guard (tests/integration/portal-admin.test.ts)', () => {
  const testId = `portal-admin-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  const adminToken = `adm_token_${testId}`;
  const readonlyAdminToken = `adm_ro_token_${testId}`;
  let adminId: string;
  let readonlyAdminId: string;

  let testDevUserId: string;
  let testDevPlatformId: string;
  let testDevKeyId: string;

  beforeAll(async () => {
    // Purge any legacy service key row from database to ensure D11 rejection
    await prisma.externalAdmin.deleteMany({
      where: {
        tokenHash: hashToken('wallx_ext_service_adm_f9b3f86_2026_sec'),
      },
    });

    // 1. Create full admin
    const admin = await prisma.externalAdmin.create({
      data: {
        name: 'Super Admin',
        tokenHash: hashToken(adminToken),
        role: 'admin',
      },
    });
    adminId = admin.id;

    // 2. Create readonly admin
    const roAdmin = await prisma.externalAdmin.create({
      data: {
        name: 'Readonly Auditor',
        tokenHash: hashToken(readonlyAdminToken),
        role: 'readonly',
      },
    });
    readonlyAdminId = roAdmin.id;

    // 3. Register a developer
    const regRes = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: `${testId}-dev@example.com`,
        password: 'Password123!@#',
        fullName: 'Admin Test Developer',
        platformName: 'Admin Managed Platform',
      });
    expect(regRes.status).toBe(201);
    testDevUserId = regRes.body.data.user.id;
    testDevPlatformId = regRes.body.data.platform.id;

    const key = await prisma.platformApiKey.findFirst({
      where: { platformId: testDevPlatformId },
    });
    expect(key).not.toBeNull();
    testDevKeyId = key!.id;
  });

  afterAll(async () => {
    if (adminId) {
      await prisma.externalAdmin.delete({ where: { id: adminId } });
    }
    if (readonlyAdminId) {
      await prisma.externalAdmin.delete({ where: { id: readonlyAdminId } });
    }
    if (testDevPlatformId) {
      await prisma.session.deleteMany({ where: { platformId: testDevPlatformId } });
      await prisma.auditLog.deleteMany({ where: { platformId: testDevPlatformId } });
      await prisma.platformApiKey.deleteMany({ where: { platformId: testDevPlatformId } });
      await prisma.platform.delete({ where: { id: testDevPlatformId } });
      await prisma.user.delete({ where: { id: testDevUserId } });
    }
  });

  it('1. GET /api/external/v1/admin/developers returns paged list of developers', async () => {
    const res = await request(app)
      .get('/api/external/v1/admin/developers')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();

    const dev = res.body.data.find((d: any) => d.id === testDevUserId);
    expect(dev).toBeDefined();
    expect(dev.email).toBe(`${testId}-dev@example.com`);
    expect(dev.platform).toBeDefined();
    expect(dev.platform.name).toBe('Admin Managed Platform');
  });

  it('2. GET /api/external/v1/admin/developers/:id returns developer detail with key metadata (no hashes)', async () => {
    const res = await request(app)
      .get(`/api/external/v1/admin/developers/${testDevUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(`${testId}-dev@example.com`);
    expect(res.body.data.platform.keys).toBeDefined();
    expect(res.body.data.platform.keys.length).toBeGreaterThanOrEqual(1);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('keyHash');
    expect(bodyStr).not.toContain('passwordHash');
  });

  it('3. Readonly admin can read (GET) but is rejected on PATCH with 403 READONLY_ADMIN', async () => {
    // Read succeeds
    const getRes = await request(app)
      .get(`/api/external/v1/admin/developers/${testDevUserId}`)
      .set('Authorization', `Bearer ${readonlyAdminToken}`);
    expect(getRes.status).toBe(200);

    // Write fails with 403
    const patchRes = await request(app)
      .patch(`/api/external/v1/admin/developers/${testDevUserId}`)
      .set('Authorization', `Bearer ${readonlyAdminToken}`)
      .send({
        approvalStatus: 'LIVE',
      });
    expect(patchRes.status).toBe(403);
    expect(patchRes.body.error.code).toBe('READONLY_ADMIN');
  });

  it('4. Full admin PATCH /admin/developers/:id approves developer and writes audit log', async () => {
    const patchRes = await request(app)
      .patch(`/api/external/v1/admin/developers/${testDevUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        approvalStatus: 'LIVE',
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.platform.approvalStatus).toBe('LIVE');

    // Verify AuditLog record in DB
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        platformId: testDevPlatformId,
        action: 'DEVELOPER_APPROVED',
      },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    const log = auditLogs[0]!;
    expect(log.actor).toBe('Super Admin');
    expect(log.action).toBe('DEVELOPER_APPROVED');
  });

  it('5. Readonly admin is rejected on key revoke with 403 READONLY_ADMIN', async () => {
    const res = await request(app)
      .post(`/api/external/v1/admin/developers/${testDevUserId}/keys/${testDevKeyId}/revoke`)
      .set('Authorization', `Bearer ${readonlyAdminToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('READONLY_ADMIN');
  });

  it('6. Full admin can revoke key on developer behalf and audit log is written', async () => {
    const res = await request(app)
      .post(`/api/external/v1/admin/developers/${testDevUserId}/keys/${testDevKeyId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('revoked');

    // Verify key is marked revoked
    const keyInDb = await prisma.platformApiKey.findUnique({ where: { id: testDevKeyId } });
    expect(keyInDb?.revokedAt).toBeInstanceOf(Date);

    // Verify AuditLog
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        platformId: testDevPlatformId,
        action: 'DEVELOPER_KEY_REVOKED',
      },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('7. Service key authentication attempt is rejected with 401 TOKEN_INVALID (D11)', async () => {
    const res = await request(app)
      .get('/api/external/v1/admin/developers')
      .set('Authorization', 'Bearer wallx_ext_service_adm_f9b3f86_2026_sec');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('8. Full admin can suspend and reactivate developer via PATCH /admin/developers/:id and filter by SUSPENDED', async () => {
    const suspendRes = await request(app)
      .patch(`/api/external/v1/admin/developers/${testDevUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        approvalStatus: 'SUSPENDED',
        isActive: false,
        suspendedReason: 'Policy check',
      });

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.data.platform.isActive).toBe(false);
    expect(suspendRes.body.data.platform.suspendedReason).toBe('Policy check');

    const listSuspended = await request(app)
      .get('/api/external/v1/admin/developers?status=SUSPENDED')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listSuspended.status).toBe(200);
    expect(listSuspended.body.data.some((d: any) => d.id === testDevUserId)).toBe(true);

    const reactivateRes = await request(app)
      .patch(`/api/external/v1/admin/developers/${testDevUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        isActive: true,
        approvalStatus: 'LIVE',
      });

    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.data.platform.isActive).toBe(true);
    expect(reactivateRes.body.data.platform.suspendedAt).toBeNull();
  });
});
