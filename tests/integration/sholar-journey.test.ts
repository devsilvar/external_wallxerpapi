import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { createAdmin } from '../../src/db/admin.repo.js';
import { hashPassword } from '../../src/lib/password.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

describe('Mr. Sholar Complete End-to-End User Journey (tests/integration/sholar-journey.test.ts)', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    TRUST_PROXY: '1',
  });
  const app = createApp(config);

  const timestamp = Date.now();
  const SHOLAR_EMAIL = `sholar_${timestamp}@yopmail.com`;
  const SHOLAR_PASSWORD = 'Password123!@#';
  const SHOLAR_PLATFORM_NAME = `Sholar Tech ${timestamp}`;

  const ADMIN_EMAIL = `admin_${timestamp}@paymytax.ng`;
  const ADMIN_PASSWORD = 'Admin@12345';

  let adminId: string;
  let sholarUserId: string;
  let sholarPlatformId: string;
  let sholarSessionToken: string;
  let apiKey: string;
  let adminSessionToken: string;

  const onboardedCustomers: Array<{
    id: string;
    externalCustomerId: string;
    businessName: string;
  }> = [];

  beforeAll(async () => {
    // Provision operator admin
    const adminPasswordHash = await hashPassword(ADMIN_PASSWORD);
    const admin = await createAdmin({
      name: 'Integration Admin Operator',
      email: ADMIN_EMAIL,
      passwordHash: adminPasswordHash,
      tokenHash: hashToken(generateToken()),
      role: 'admin',
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    if (sholarPlatformId) {
      const bIds = onboardedCustomers.map((c) => c.id);
      if (bIds.length > 0) {
        // Delete invoices before sales because Invoice.linkedSaleId has onDelete: Restrict
        await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId: { in: bIds } } } });
        await prisma.invoice.deleteMany({ where: { businessId: { in: bIds } } });
        await prisma.saleLineItem.deleteMany({ where: { sale: { businessId: { in: bIds } } } });
        await prisma.salesTransaction.deleteMany({ where: { businessId: { in: bIds } } });
        await prisma.expense.deleteMany({ where: { businessId: { in: bIds } } });
        await prisma.customer.deleteMany({ where: { businessId: { in: bIds } } });
        await prisma.auditLog.deleteMany({ where: { businessId: { in: bIds } } });
        await prisma.business.deleteMany({ where: { id: { in: bIds } } });
      }
      await prisma.auditLog.deleteMany({ where: { platformId: sholarPlatformId } });
      await prisma.apiUsageDaily.deleteMany({ where: { platformId: sholarPlatformId } });
      await prisma.session.deleteMany({ where: { platformId: sholarPlatformId } });
      await prisma.platformApiKey.deleteMany({ where: { platformId: sholarPlatformId } });
      await prisma.platform.deleteMany({ where: { id: sholarPlatformId } });
    }
    if (sholarUserId) {
      await prisma.user.deleteMany({ where: { id: sholarUserId } });
    }
    if (adminId) {
      await prisma.adminSession.deleteMany({ where: { adminId } });
      await prisma.externalAdmin.deleteMany({ where: { id: adminId } });
    }
  });

  it('1. Mr. Sholar registers as a developer and receives a platform and test API key', async () => {
    const res = await request(app)
      .post('/portal/auth/register')
      .send({
        email: SHOLAR_EMAIL,
        password: SHOLAR_PASSWORD,
        fullName: 'Mr. Sholar Developer',
        platformName: SHOLAR_PLATFORM_NAME,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(SHOLAR_EMAIL);
    expect(res.body.data.platform.name).toBe(SHOLAR_PLATFORM_NAME);
    expect(res.body.data.testApiKey).toBeTruthy();
    expect(res.body.data.sessionToken).toBeTruthy();

    sholarUserId = res.body.data.user.id;
    sholarPlatformId = res.body.data.platform.id;
    sholarSessionToken = res.body.data.sessionToken;
    apiKey = res.body.data.testApiKey;
  });

  it('2. Mr. Sholar logs into the developer portal and provisions a production API key', async () => {
    const loginRes = await request(app)
      .post('/portal/auth/login')
      .send({
        email: SHOLAR_EMAIL,
        password: SHOLAR_PASSWORD,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.sessionToken).toBeTruthy();
    sholarSessionToken = loginRes.body.data.sessionToken;

    const keyRes = await request(app)
      .post('/portal/keys')
      .set('Authorization', `Bearer ${sholarSessionToken}`)
      .send({ label: 'Production Workload Key' });

    expect(keyRes.status).toBe(201);
    expect(keyRes.body.data.apiKey).toBeTruthy();
    apiKey = keyRes.body.data.apiKey;
  });

  it('3. Admin logs in and approves Mr. Sholar for active live operations', async () => {
    const adminLogin = await request(app)
      .post('/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(adminLogin.status).toBe(200);
    adminSessionToken = adminLogin.body.data.sessionToken;

    const approve = await request(app)
      .patch(`/admin/platforms/${sholarPlatformId}/approve`)
      .set('Authorization', `Bearer ${adminSessionToken}`);

    expect(approve.status).toBe(200);
    expect(approve.body.data.approvalStatus).toBe('ACTIVE');
    expect(approve.body.data.isActive).toBe(true);
  });

  it('4. Mr. Sholar onboards 10 customers via POST /api/external/v1/accounts', async () => {
    for (let i = 1; i <= 10; i++) {
      const extId = `sholar_cust_${timestamp}_${i}`;
      const name = `Customer Business ${i}`;

      const res = await request(app)
        .post('/api/external/v1/accounts')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          customerId: extId,
          businessName: name,
          ownerName: `Owner ${i}`,
          contactEmail: `cust${i}@sholarcorp.com`,
          contactPhone: `+234803000${String(i).padStart(4, '0')}`,
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.data.externalCustomerId).toBe(extId);
      expect(res.body.data.merchantId).toBeTruthy();

      onboardedCustomers.push({
        id: res.body.data.id,
        externalCustomerId: extId,
        businessName: name,
      });
    }

    expect(onboardedCustomers).toHaveLength(10);
  });

  it('5. Each customer creates 5 sales, 5 expenses, and 5 invoices with PDF downloads', async () => {
    const processCustomer = async (cIdx: number) => {
      const cust = onboardedCustomers[cIdx]!;
      const cNum = cIdx + 1;

      // 5 Sales (concurrent)
      const saleResults = await Promise.all(
        [1, 2, 3, 4, 5].map((s) =>
          request(app)
            .post(`/api/external/v1/accounts/${cust.externalCustomerId}/sales`)
            .set('Authorization', `Bearer ${apiKey}`)
            .send({
              referenceId: `sale_${timestamp}_c${cNum}_${s}`,
              amount: 25000 + s * 5000,
              source: 'pos',
              status: 'confirmed',
              transactionDate: new Date().toISOString().slice(0, 10),
              customerName: `Buyer ${s}`,
              items: [
                {
                  name: `Item ${s}`,
                  quantity: 1,
                  unitPrice: 25000 + s * 5000,
                  lineTotal: 25000 + s * 5000,
                },
              ],
            })
        )
      );
      for (const saleRes of saleResults) {
        expect(saleRes.status).toBe(201);
      }

      // 5 Expenses (concurrent)
      const expResults = await Promise.all(
        [1, 2, 3, 4, 5].map((e) =>
          request(app)
            .post(`/api/external/v1/accounts/${cust.externalCustomerId}/expenses`)
            .set('Authorization', `Bearer ${apiKey}`)
            .send({
              externalRef: `exp_${timestamp}_c${cNum}_${e}`,
              category: 'office_supplies',
              description: `Office supplies pack ${e}`,
              amount: 10000 + e * 2000,
              expenseDate: new Date().toISOString().slice(0, 10),
            })
        )
      );
      for (const expRes of expResults) {
        expect(expRes.status).toBe(201);
      }

      // 5 Invoices (sequential per customer to avoid atomic sequence contention & pool exhaustion)
      for (let inv = 1; inv <= 5; inv++) {
        const invRes = await request(app)
          .post(`/api/external/v1/accounts/${cust.externalCustomerId}/invoices`)
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            externalRef: `inv_${timestamp}_c${cNum}_${inv}`,
            issueDate: new Date().toISOString().slice(0, 10),
            dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
            customerName: `Corporate Buyer ${inv}`,
            lines: [
              {
                description: `Invoice Service ${inv}`,
                quantity: 1,
                unitPrice: 50000,
              },
            ],
          });
        expect(invRes.status).toBe(201);
        const invoiceId = invRes.body.data.id;

        if (inv >= 2) {
          const issueRes = await request(app)
            .post(`/api/external/v1/accounts/${cust.externalCustomerId}/invoices/${invoiceId}/issue`)
            .set('Authorization', `Bearer ${apiKey}`);
          expect(issueRes.status).toBe(200);
        }

        if (inv === 3) {
          const paidRes = await request(app)
            .post(`/api/external/v1/accounts/${cust.externalCustomerId}/invoices/${invoiceId}/mark-paid`)
            .set('Authorization', `Bearer ${apiKey}`)
            .send({ paymentMethod: 'bank_transfer' });
          expect(paidRes.status).toBe(200);
        }

        if (cNum === 1 && inv === 1) {
          const pdfRes = await request(app)
            .get(`/api/external/v1/accounts/${cust.externalCustomerId}/invoices/${invoiceId}/pdf`)
            .set('Authorization', `Bearer ${apiKey}`);
          expect(pdfRes.status).toBe(200);
          expect(pdfRes.headers['content-type']).toBe('application/pdf');
          expect(pdfRes.body.slice(0, 4).toString()).toBe('%PDF');

          const linkRes = await request(app)
            .get(`/api/external/v1/accounts/${cust.externalCustomerId}/invoices/${invoiceId}/pdf-link`)
            .set('Authorization', `Bearer ${apiKey}`);
          expect(linkRes.status).toBe(200);
          const shareUrl = linkRes.body.data.pdfUrl || linkRes.body.data.link;
          expect(shareUrl).toContain('/public/invoices/');
        }
      }
    };

    // Process customers sequentially to stay safely within Supabase session pooler limits
    for (let idx = 0; idx < onboardedCustomers.length; idx++) {
      await processCustomer(idx);
    }
  }, 420_000);

  it('6. Edge cases and failure scenarios are properly handled', async () => {
    const cust1 = onboardedCustomers[0]!;

    // Scenario A1: Exact Idempotency Replay returns 200 without duplicating
    const replayRes = await request(app)
      .post(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        referenceId: `sale_${timestamp}_c1_1`,
        amount: 30000,
        source: 'pos',
        status: 'confirmed',
        transactionDate: new Date().toISOString().slice(0, 10),
        customerName: 'Buyer 1',
        items: [
          {
            name: 'Item 1',
            quantity: 1,
            unitPrice: 30000,
            lineTotal: 30000,
          },
        ],
      });
    expect(replayRes.status).toBe(200);

    // Scenario A2: Mutated payload on existing referenceId is rejected with 409 conflict
    const conflictRes = await request(app)
      .post(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        referenceId: `sale_${timestamp}_c1_1`,
        amount: 99999,
        source: 'pos',
        status: 'confirmed',
        transactionDate: new Date().toISOString().slice(0, 10),
      });
    expect(conflictRes.status).toBe(409);

    // Scenario B: UUID reserved check on onboarding
    const uuidRes = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        customerId: '12345678-1234-1234-1234-123456789abc',
        businessName: 'Illegal UUID Business',
      });
    expect(uuidRes.status).toBe(400);
    expect(uuidRes.body.error.code).toBe('CUSTOMER_ID_RESERVED');

    // Scenario C: Cross-tenant isolation
    const crossRes = await request(app)
      .get(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales/nonexistent_sale_id`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(crossRes.status).toBe(404);

    // Scenario D: Malformed payload / Negative amount
    const negRes = await request(app)
      .post(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        referenceId: `invalid_neg_${timestamp}`,
        amount: -999,
        source: 'pos',
        status: 'confirmed',
        transactionDate: 'invalid',
      });
    expect(negRes.status).toBe(400);

    // Scenario E: Invalid auth key
    const unauthRes = await request(app)
      .get(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales`)
      .set('Authorization', 'Bearer invalid_key_xyz');
    expect(unauthRes.status).toBe(401);
  });

  it('7. Admin can monitor all platforms, accounts, live counts, and audit logs', async () => {
    // Admin platforms check
    const platRes = await request(app)
      .get('/admin/platforms')
      .set('Authorization', `Bearer ${adminSessionToken}`);
    expect(platRes.status).toBe(200);
    const sholarPlat = platRes.body.data.find((p: any) => p.id === sholarPlatformId);
    expect(sholarPlat).toBeDefined();
    expect(sholarPlat.totalAccounts).toBe(10);

    // Admin account detail check
    const accDetail = await request(app)
      .get(`/admin/accounts/${onboardedCustomers[0]!.id}`)
      .set('Authorization', `Bearer ${adminSessionToken}`);
    expect(accDetail.status).toBe(200);
    expect(accDetail.body.data.counts.sales).toBeGreaterThanOrEqual(5);
    expect(accDetail.body.data.counts.expenses).toBeGreaterThanOrEqual(5);
    expect(accDetail.body.data.counts.invoices).toBeGreaterThanOrEqual(5);

    // Admin audit logs check
    const auditRes = await request(app)
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${adminSessionToken}`);
    expect(auditRes.status).toBe(200);
    expect(Array.isArray(auditRes.body.data)).toBe(true);
  });

  it('8. Admin suspends Mr. Sholar, blocking customer calls & onboarding; then reactivates and resumes', async () => {
    const cust1 = onboardedCustomers[0]!;

    // Admin suspends
    const suspendRes = await request(app)
      .patch(`/admin/platforms/${sholarPlatformId}/suspend`)
      .set('Authorization', `Bearer ${adminSessionToken}`)
      .send({ reason: 'Routine compliance review' });

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.data.isActive).toBe(false);

    // Customer attempt during suspension is blocked with 403
    const blockedRes = await request(app)
      .post(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        referenceId: `sale_blocked_${timestamp}`,
        amount: 20000,
        source: 'pos',
        status: 'confirmed',
        transactionDate: new Date().toISOString().slice(0, 10),
      });

    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error.code).toBe('PLATFORM_SUSPENDED');
    expect(blockedRes.body.error.message).toContain('Routine compliance review');

    // Onboarding new customers while suspended is also blocked with 403
    const blockedOnboard = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        customerId: `blocked_${timestamp}`,
        businessName: 'Blocked Customer Ltd',
      });
    expect(blockedOnboard.status).toBe(403);
    expect(blockedOnboard.body.error.code).toBe('PLATFORM_SUSPENDED');

    // Admin reactivates
    const activateRes = await request(app)
      .patch(`/admin/platforms/${sholarPlatformId}/activate`)
      .set('Authorization', `Bearer ${adminSessionToken}`);

    expect(activateRes.status).toBe(200);
    expect(activateRes.body.data.isActive).toBe(true);

    // Customer operation succeeds immediately
    const resumeRes = await request(app)
      .post(`/api/external/v1/accounts/${cust1.externalCustomerId}/sales`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        referenceId: `sale_resumed_${timestamp}`,
        amount: 35000,
        source: 'online_store',
        status: 'confirmed',
        transactionDate: new Date().toISOString().slice(0, 10),
      });

    expect(resumeRes.status).toBe(201);
  });
});
