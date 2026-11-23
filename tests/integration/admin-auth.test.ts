import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAdmin } from '../../src/db/admin.repo.js';
import { prisma } from '../../src/db/client.js';
import { hashPassword } from '../../src/lib/password.js';
import { issueSession } from '../../src/lib/session.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

const ADMIN_BASE = '/api/external/v1/admin';

describe('Admin identity separation (tests/integration/admin-auth.test.ts)', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    TRUST_PROXY: '1',
  });
  const app = createApp(config);

  const testId = `admin-auth-${Date.now()}`;
  const adminEmail = `${testId}@wallxerpapi.test`;
  const adminPassword = 'AdminPassword123!';
  let adminId: string;
  let operatorToken: string;

  beforeAll(async () => {
    operatorToken = generateToken();
    const admin = await createAdmin({
      name: `${testId}-operator`,
      tokenHash: hashToken(operatorToken),
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: 'admin',
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.externalAdmin.deleteMany({ where: { id: adminId } });
    await prisma.user.deleteMany({ where: { email: { contains: testId } } });
  });

  it('issues an admin session for correct email + password, and it works on /admin/*', async () => {
    const login = await request(app)
      .post(`${ADMIN_BASE}/auth/login`)
      .send({ email: adminEmail, password: adminPassword });

    expect(login.status).toBe(200);
    const { sessionToken, admin } = login.body.data;
    expect(sessionToken).toBeTruthy();
    expect(admin).toMatchObject({ id: adminId, email: adminEmail, role: 'admin' });
    expect(admin).not.toHaveProperty('passwordHash');
    expect(admin).not.toHaveProperty('tokenHash');

    const platforms = await request(app)
      .get(`${ADMIN_BASE}/platforms`)
      .set('Authorization', `Bearer ${sessionToken}`);

    expect(platforms.status).toBe(200);
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post(`${ADMIN_BASE}/auth/login`)
      .send({ email: adminEmail, password: 'definitely-not-the-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post(`${ADMIN_BASE}/auth/login`)
      .send({ email: `nobody-${testId}@wallxerpapi.test`, password: adminPassword });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a developer account on the admin login, and refuses an admin email on the developer login', async () => {
    const developerEmail = `${testId}-developer@wallxerpapi.test`;
    await prisma.user.create({
      data: {
        email: developerEmail,
        fullName: 'Developer Account',
        passwordHash: await hashPassword(adminPassword),
        isVerified: true,
      },
    });

    const asAdmin = await request(app)
      .post(`${ADMIN_BASE}/auth/login`)
      .send({ email: developerEmail, password: adminPassword });
    expect(asAdmin.status).toBe(401);

    const asDeveloper = await request(app)
      .post('/api/external/v1/portal/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(asDeveloper.status).toBe(401);
  });

  it('CRITICAL GATE: a developer portal session cannot reach /admin/*', async () => {
    const user = await prisma.user.findFirst({
      where: { email: { contains: testId } },
    });
    expect(user).not.toBeNull();

    const { rawToken } = await issueSession({
      userId: user!.id,
      platformId: null,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });

    const res = await request(app)
      .get(`${ADMIN_BASE}/platforms`)
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('revokes the session on logout', async () => {
    const login = await request(app)
      .post(`${ADMIN_BASE}/auth/login`)
      .send({ email: adminEmail, password: adminPassword });
    const sessionToken = login.body.data.sessionToken as string;

    const me = await request(app)
      .get(`${ADMIN_BASE}/auth/me`)
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.admin.id).toBe(adminId);

    const logout = await request(app)
      .post(`${ADMIN_BASE}/auth/logout`)
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(logout.status).toBe(200);

    const after = await request(app)
      .get(`${ADMIN_BASE}/auth/me`)
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(after.status).toBe(401);
  });

  it('keeps operator tokens working alongside sessions', async () => {
    const res = await request(app)
      .get(`${ADMIN_BASE}/auth/me`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.credentialType).toBe('token');
    expect(res.body.data.admin.id).toBe(adminId);
  });

  it('rejects login for an admin with no password set', async () => {
    const tokenOnlyEmail = `${testId}-tokenonly@wallxerpapi.test`;
    const admin = await createAdmin({
      name: `${testId}-token-only`,
      tokenHash: hashToken(generateToken()),
      email: tokenOnlyEmail,
      role: 'admin',
    });

    const res = await request(app)
      .post(`${ADMIN_BASE}/auth/login`)
      .send({ email: tokenOnlyEmail, password: 'anything123' });

    expect(res.status).toBe(401);

    await prisma.externalAdmin.delete({ where: { id: admin.id } });
  });
});
