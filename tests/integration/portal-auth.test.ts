import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';

describe('Developer Portal Auth Integration (tests/integration/portal-auth.test.ts)', () => {
  const testId = `portal-auth-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  const registeredUserEmail = `${testId}-dev@example.com`;
  const registeredPassword = 'StrongPassword123!';
  let devSessionToken: string;
  let devUserId: string;
  let devPlatformId: string;
  let devTestApiKey: string;

  const suspendedEmail = `${testId}-suspended@example.com`;

  afterAll(async () => {
    // Clean up test data
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [registeredUserEmail, suspendedEmail, `${testId}-race@example.com`],
        },
      },
      select: { id: true },
    });

    for (const u of users) {
      await prisma.session.deleteMany({ where: { userId: u.id } });
      const plat = await prisma.platform.findUnique({ where: { ownerUserId: u.id } });
      if (plat) {
        await prisma.platformApiKey.deleteMany({ where: { platformId: plat.id } });
        await prisma.platform.delete({ where: { id: plat.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it('1. POST /portal/auth/register creates user, platform, and initial test key, returning 201', async () => {
    const res = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: registeredUserEmail,
        password: registeredPassword,
        fullName: 'Jane Developer',
        platformName: 'Jane Logistics Platform',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.sessionToken).toBeDefined();
    expect(res.body.data.sessionToken).toHaveLength(43);

    // Verify user object in response
    expect(res.body.data.user.email).toBe(registeredUserEmail);
    expect(res.body.data.user.fullName).toBe('Jane Developer');
    devUserId = res.body.data.user.id;

    // Verify platform object in response
    expect(res.body.data.platform.name).toBe('Jane Logistics Platform');
    expect(res.body.data.platform.approvalStatus).toBe('PENDING');
    devPlatformId = res.body.data.platform.id;

    // Verify test API key shown once
    devTestApiKey = res.body.data.testApiKey;
    expect(devTestApiKey).toBeDefined();
    expect(devTestApiKey.startsWith('sk_ext_test_')).toBe(true);

    // VERIFY NO SECRET LEAKAGE IN RESPONSE
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('passwordHash');
    expect(bodyStr).not.toContain('tokenHash');
    expect(bodyStr).not.toContain('keyHash');

    // Verify DB state
    const userInDb = await prisma.user.findUnique({ where: { id: devUserId } });
    expect(userInDb).not.toBeNull();
    expect(userInDb!.passwordHash).toMatch(/^scrypt\$/);

    const platformInDb = await prisma.platform.findUnique({ where: { id: devPlatformId } });
    expect(platformInDb).not.toBeNull();
    expect(platformInDb!.ownerUserId).toBe(devUserId);

    const keysInDb = await prisma.platformApiKey.findMany({ where: { platformId: devPlatformId } });
    expect(keysInDb).toHaveLength(1);
    expect(keysInDb[0]!.prefix).toBe(devTestApiKey.slice(0, 16));

    // Save session token for later tests
    devSessionToken = res.body.data.sessionToken;
  });

  it('2. POST /portal/auth/register with duplicate email returns 409 EMAIL_IN_USE', async () => {
    const res = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: registeredUserEmail,
        password: 'AnotherPassword999!',
        platformName: 'Duplicate Inc',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('3. POST /portal/auth/register rejects invalid email or short password with 400', async () => {
    const res = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: 'not-an-email',
        password: 'short',
        platformName: 'P',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('4. POST /portal/auth/login succeeds with valid credentials', async () => {
    const res = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({
        email: registeredUserEmail,
        password: registeredPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.sessionToken).toBeDefined();
    expect(res.body.data.user.email).toBe(registeredUserEmail);
    expect(res.body.data.platform.id).toBe(devPlatformId);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('passwordHash');
    expect(bodyStr).not.toContain('tokenHash');
  });

  it('5. POST /portal/auth/login returns 401 INVALID_CREDENTIALS on bad password or unknown email', async () => {
    const wrongPwRes = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({
        email: registeredUserEmail,
        password: 'WrongPassword!',
      });
    expect(wrongPwRes.status).toBe(401);
    expect(wrongPwRes.body.error.code).toBe('INVALID_CREDENTIALS');

    const wrongEmailRes = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({
        email: 'nobody-exists@example.com',
        password: 'AnyPassword123!',
      });
    expect(wrongEmailRes.status).toBe(401);
    expect(wrongEmailRes.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('6. POST /portal/auth/login returns 403 ACCOUNT_SUSPENDED when platform is suspended', async () => {
    // Register and suspend a platform
    const regRes = await request(app)
      .post('/api/external/v1/portal/auth/register')
      .send({
        email: suspendedEmail,
        password: 'SuspendedPass123!',
        platformName: 'Suspended Platform',
      });
    expect(regRes.status).toBe(201);
    const suspendedPlatId = regRes.body.data.platform.id;

    // Suspend platform in DB
    await prisma.platform.update({
      where: { id: suspendedPlatId },
      data: {
        isActive: false,
        suspendedAt: new Date(),
        suspendedReason: 'Terms of service violation',
      },
    });

    const loginRes = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({
        email: suspendedEmail,
        password: 'SuspendedPass123!',
      });

    expect(loginRes.status).toBe(403);
    expect(loginRes.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(loginRes.body.error.message).toContain('Terms of service violation');
  });

  it('7. GET /portal/me returns profile for authenticated developer session', async () => {
    const res = await request(app)
      .get('/api/external/v1/portal/me')
      .set('Authorization', `Bearer ${devSessionToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.email).toBe(registeredUserEmail);
    expect(res.body.data.platform.id).toBe(devPlatformId);
  });

  it('8. GET /portal/me rejects requests without token or with invalid token', async () => {
    const noTokenRes = await request(app).get('/api/external/v1/portal/me');
    expect(noTokenRes.status).toBe(401);

    const badTokenRes = await request(app)
      .get('/api/external/v1/portal/me')
      .set('Authorization', 'Bearer invalid-session-token-xyz');
    expect(badTokenRes.status).toBe(401);
  });

  it('9. POST /portal/auth/password changes user password and requires new password on login', async () => {
    const newPassword = 'BrandNewPassword456!';

    // Fails with wrong current password
    const failRes = await request(app)
      .post('/api/external/v1/portal/auth/password')
      .set('Authorization', `Bearer ${devSessionToken}`)
      .send({
        currentPassword: 'WrongCurrentPassword!',
        newPassword,
      });
    expect(failRes.status).toBe(401);

    // Succeeds with correct current password
    const passRes = await request(app)
      .post('/api/external/v1/portal/auth/password')
      .set('Authorization', `Bearer ${devSessionToken}`)
      .send({
        currentPassword: registeredPassword,
        newPassword,
      });
    expect(passRes.status).toBe(200);

    // Old password fails login
    const oldLogin = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({ email: registeredUserEmail, password: registeredPassword });
    expect(oldLogin.status).toBe(401);

    // New password succeeds login
    const newLogin = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({ email: registeredUserEmail, password: newPassword });
    expect(newLogin.status).toBe(200);
  });

  it('10. POST /portal/auth/logout revokes session, preventing further access', async () => {
    // Verify session works before logout
    const preCheck = await request(app)
      .get('/api/external/v1/portal/me')
      .set('Authorization', `Bearer ${devSessionToken}`);
    expect(preCheck.status).toBe(200);

    // Logout
    const logoutRes = await request(app)
      .post('/api/external/v1/portal/auth/logout')
      .set('Authorization', `Bearer ${devSessionToken}`);
    expect(logoutRes.status).toBe(204);

    // Subsequent call returns 401
    const postCheck = await request(app)
      .get('/api/external/v1/portal/me')
      .set('Authorization', `Bearer ${devSessionToken}`);
    expect(postCheck.status).toBe(401);
  });
});
