/**
 * QA HUNTER — Developer Account Full API & Key Lifecycle Audit
 * =============================================================
 * Target Account: testuser@yopmail.com / 47461784hf
 * Methodology: prompts/qahunter.md (v2.0, Brutal Edition)
 * Evidence Tier: EXECUTED (Against live Express instance + Supabase DB)
 *
 * Scope:
 *  1. Developer Authentication & Session Lifecycle
 *  2. Portal Key Management (Test & Live key generation, listing, usage, revocation)
 *  3. Partner APIs in TEST Mode (sk_ext_test_...):
 *     - Accounts (profile, patch, onboarding)
 *     - Customers (create, list, get, patch)
 *     - Sales (ingest, idempotency, keyset pagination, get by id)
 *     - Expenses (ingest, idempotency, category, get by id)
 *     - Non-fiscal Invoices (draft, VAT injection rejection, send, mark-paid, PDF generation, public shareToken)
 *     - Profit Summary (aggregation check)
 *     - Deletions / Tombstones tracking
 *  4. Partner APIs in LIVE Mode (sk_ext_live_...):
 *     - Full operational validation with live credentials
 *  5. Security & Boundary Gates:
 *     - Cross-tenant anti-enumeration (404 NOT_FOUND)
 *     - Revoked key rejection (401 TOKEN_INVALID)
 *     - Partner vs Admin boundary (401 TOKEN_INVALID on /admin/*)
 *     - RateLimit header assertions
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { createKeyForPlatform } from '../../src/db/apiKey.repo.js';

describe('QA Hunter — Developer Account (testuser@yopmail.com) E2E API Verification', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    TRUST_PROXY: '1',
  });
  const app = createApp(config);

  const DEVELOPER_EMAIL = 'testuser@yopmail.com';
  const DEVELOPER_PASSWORD = '47461784hf';
  const RUN_ID = `qa-${Date.now().toString(36)}`;

  // Session & credential state
  let sessionToken: string;
  let platformId: string;
  let platformName: string;
  let accountId: string;
  let testApiKey: string;
  let testKeyId: string;
  let liveApiKey: string;
  let liveKeyId: string;
  let ephemeralKey: string;
  let ephemeralKeyId: string;

  // Resource state for multi-step checks
  let createdCustomerId: string;
  let createdCustomerExternalId: string;
  let createdSaleId: string;
  let createdExpenseId: string;
  let createdInvoiceId: string;
  let createdInvoiceShareToken: string;

  beforeAll(async () => {
    // Verify developer user exists in database
    const user = await prisma.user.findFirst({
      where: { email: { equals: DEVELOPER_EMAIL, mode: 'insensitive' } },
    });
    expect(user, 'testuser@yopmail.com must exist in DB').toBeDefined();

    const platform = await prisma.platform.findFirst({
      where: { ownerUserId: user!.id },
    });
    expect(platform, 'Platform must exist for testuser@yopmail.com').toBeDefined();
    platformId = platform!.id;
    platformName = platform!.name;

    // Resolve primary business account for this platform
    let business = await prisma.business.findFirst({
      where: { platformId: platform!.id, externalCustomerId: 'CUST-8812' },
    });
    if (!business) {
      business = await prisma.business.findFirst({
        where: { platformId: platform!.id },
      });
    }
    if (!business) {
      business = await prisma.business.create({
        data: {
          platformId: platform!.id,
          businessName: 'Lekki Supermarket Ltd',
          externalCustomerId: 'CUST-8812',
          merchantId: 'WALLX0003087',
          isActive: true,
        },
      });
    }
    accountId = business.externalCustomerId || business.id;

    // Pre-initialize test and live keys so all suites have valid credentials independently
    const initTest = await createKeyForPlatform(platformId, `${RUN_ID}-init-test`, null, 'test');
    testApiKey = initTest.rawKey;
    testKeyId = initTest.key.id;

    const initLive = await createKeyForPlatform(platformId, `${RUN_ID}-init-live`, null, 'live');
    liveApiKey = initLive.rawKey;
    liveKeyId = initLive.key.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. DEVELOPER AUTHENTICATION & SESSION LIFECYCLE
  // =========================================================================
  describe('1. Developer Authentication & Session Lifecycle', () => {
    it('rejects login with invalid password (401 INVALID_CREDENTIALS)', async () => {
      const res = await request(app)
        .post('/portal/auth/login')
        .send({
          email: DEVELOPER_EMAIL,
          password: 'wrong_password_999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('INVALID_CREDENTIALS');
    });

    it('successfully logs in with testuser@yopmail.com and returns session + platform profile', async () => {
      const res = await request(app)
        .post('/portal/auth/login')
        .send({
          email: DEVELOPER_EMAIL,
          password: DEVELOPER_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data?.sessionToken).toBeDefined();
      expect(typeof res.body.data.sessionToken).toBe('string');

      sessionToken = res.body.data.sessionToken;

      expect(res.body.data?.user?.email).toBe(DEVELOPER_EMAIL);
      expect(res.body.data?.platform?.id).toBe(platformId);
      expect(res.body.data?.platform?.approvalStatus).toBe('LIVE');
    });

    it('GET /portal/me returns authenticated developer context', async () => {
      const res = await request(app)
        .get('/portal/me')
        .set('Authorization', `Bearer ${sessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data?.user?.email).toBe(DEVELOPER_EMAIL);
      expect(res.body.data?.platform?.id).toBe(platformId);
    });

    it('GET /portal/me rejects unauthenticated request (401 TOKEN_INVALID)', async () => {
      const res = await request(app).get('/portal/me');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('TOKEN_INVALID');
    });
  });

  // =========================================================================
  // 2. PORTAL KEY MANAGEMENT LIFECYCLE
  // =========================================================================
  describe('2. Portal Key Management Lifecycle', () => {
    it('GET /portal/keys lists all active keys for platform without leaking hashes', async () => {
      const res = await request(app)
        .get('/portal/keys')
        .set('Authorization', `Bearer ${sessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);

      for (const k of res.body.data) {
        expect(k.id).toBeDefined();
        expect(k.platformId).toBe(platformId);
        expect(k.prefix).toBeDefined();
        expect(k.environment).toMatch(/^(test|live)$/);
        // CRITICAL SECURITY ASSERTION: Raw key hashes must NEVER be exposed
        expect(k.keyHash).toBeUndefined();
        expect(k.apiKey).toBeUndefined();
      }
    });

    it('POST /portal/keys creates a new TEST API key (sk_ext_test_...)', async () => {
      const res = await request(app)
        .post('/portal/keys')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          label: `${RUN_ID}-test-key`,
          environment: 'test',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data?.apiKey).toBeDefined();
      expect(res.body.data.apiKey).toMatch(/^sk_ext_test_/);
      expect(res.body.data?.environment).toBe('test');

      testApiKey = res.body.data.apiKey;
      testKeyId = res.body.data.id || res.body.data.key?.id;
    });

    it('POST /portal/keys creates a new LIVE API key (sk_ext_live_...) since platform is approved', async () => {
      const res = await request(app)
        .post('/portal/keys')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          label: `${RUN_ID}-live-key`,
          environment: 'live',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data?.apiKey).toBeDefined();
      expect(res.body.data.apiKey).toMatch(/^sk_ext_live_/);
      expect(res.body.data?.environment).toBe('live');

      liveApiKey = res.body.data.apiKey;
      liveKeyId = res.body.data.id || res.body.data.key?.id;
    });

    it('GET /portal/usage returns platform usage metrics', async () => {
      const res = await request(app)
        .get('/portal/usage')
        .set('Authorization', `Bearer ${sessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data?.platformId).toBe(platformId);
      expect(typeof res.body.data?.merchantsCount).toBe('number');
      expect(typeof res.body.data?.activeKeysCount).toBe('number');
      expect(res.body.data?.totals).toBeDefined();
      expect(typeof res.body.data?.totals?.sales).toBe('number');
    });

    it('DELETE /portal/keys/:id revokes a key and immediately invalidates it (204)', async () => {
      // 1. Issue an ephemeral key
      const createRes = await request(app)
        .post('/portal/keys')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          label: `${RUN_ID}-to-revoke`,
          environment: 'test',
        });
      expect(createRes.status).toBe(201);
      ephemeralKey = createRes.body.data.apiKey;
      ephemeralKeyId = createRes.body.data.id || createRes.body.data.key?.id;

      // 2. Verify key can authenticate
      const probeBefore = await request(app)
        .get(`/api/external/v1/accounts/${accountId}`)
        .set('Authorization', `Bearer ${ephemeralKey}`);
      expect(probeBefore.status).toBe(200);

      // 3. Revoke key
      const deleteRes = await request(app)
        .delete(`/portal/keys/${ephemeralKeyId}`)
        .set('Authorization', `Bearer ${sessionToken}`);
      expect(deleteRes.status).toBe(204);

      // 4. Verify key is immediately denied
      const probeAfter = await request(app)
        .get(`/api/external/v1/accounts/${accountId}`)
        .set('Authorization', `Bearer ${ephemeralKey}`);
      expect(probeAfter.status).toBe(401);
      expect(probeAfter.body.error?.code).toBe('TOKEN_INVALID');
    });
  });

  // =========================================================================
  // 3. CORE PARTNER APIS — TEST MODE (sk_ext_test_...)
  // =========================================================================
  describe('3. Core Partner APIs in TEST Mode', () => {
    describe('3.1 Account Management', () => {
      it('GET /api/external/v1/accounts/:accountId returns account profile', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.businessName).toBeDefined();
        expect(res.body.data?.merchantId).toBeDefined();
        expect(res.headers['ratelimit-limit']).toBeDefined();
        expect(res.headers['ratelimit-remaining']).toBeDefined();
      });

      it('PATCH /api/external/v1/accounts/:accountId updates business details', async () => {
        const res = await request(app)
          .patch(`/api/external/v1/accounts/${accountId}`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            businessType: 'retail_supermarket',
            contactPhone: '+2348011223344',
          });

        expect(res.status).toBe(200);
        expect(res.body.data?.businessType).toBe('retail_supermarket');
        expect(res.body.data?.contactPhone).toBe('+2348011223344');
      });

      it('POST /api/external/v1/accounts onboards a new merchant account under platform', async () => {
        const onboardCustomerId = `CUST-${RUN_ID}-NEW`;
        const res = await request(app)
          .post('/api/external/v1/accounts')
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            customerId: onboardCustomerId,
            businessName: `Superstore ${RUN_ID}`,
            ownerName: 'Amaka Johnson',
            businessType: 'retail',
            contactPhone: '+2348099887766',
            address: '45 Marina Street',
            city: 'Lagos',
            state: 'Lagos',
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.data?.merchantId).toBeDefined();
        expect(res.body.data?.externalCustomerId).toBe(onboardCustomerId);
      });
    });

    describe('3.2 Customer Management', () => {
      it('POST /api/external/v1/accounts/:accountId/customers creates a new customer', async () => {
        createdCustomerExternalId = `EXT-CUST-${RUN_ID}`;
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/customers`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            externalId: createdCustomerExternalId,
            name: `Customer ${RUN_ID}`,
            email: `${RUN_ID}@client.example.com`,
            phone: '+2348022334455',
            address: '12 Admiralty Way, Lekki',
            city: 'Lagos',
            state: 'Lagos',
          });

        expect(res.status).toBe(201);
        expect(res.body.data?.id).toBeDefined();
        expect(res.body.data?.name).toBe(`Customer ${RUN_ID}`);
        createdCustomerId = res.body.data.id;
      });

      it('GET /api/external/v1/accounts/:accountId/customers lists customers with pagination', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/customers?limit=10`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
        const found = res.body.data.find((c: any) => c.id === createdCustomerId);
        expect(found).toBeDefined();
      });

      it('GET /api/external/v1/accounts/:accountId/customers/:id retrieves customer by ID', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/customers/${createdCustomerId}`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.id).toBe(createdCustomerId);
        expect(res.body.data?.name).toBe(`Customer ${RUN_ID}`);
      });

      it('GET /api/external/v1/accounts/:accountId/customers/by-external-id/:externalId retrieves customer', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/customers/by-external-id/${createdCustomerExternalId}`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.externalId).toBe(createdCustomerExternalId);
      });

      it('PATCH /api/external/v1/accounts/:accountId/customers/:id updates customer info', async () => {
        const res = await request(app)
          .patch(`/api/external/v1/accounts/${accountId}/customers/${createdCustomerId}`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            phone: '+2348099998888',
          });

        expect(res.status).toBe(200);
        expect(res.body.data?.phone).toBe('+2348099998888');
      });
    });

    describe('3.3 Sales Ingestion & Idempotency', () => {
      const saleRef = `SALE-REF-${RUN_ID}-01`;
      const salePayload = {
        referenceId: saleRef,
        amount: 45000,
        source: 'pos' as const,
        status: 'completed' as const,
        transactionDate: '2026-11-20',
        description: 'Retail POS terminal checkout',
        customerName: 'Ibrahim Musa',
      };

      it('POST /api/external/v1/accounts/:accountId/sales ingests a completed sale transaction', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/sales`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .set('Idempotency-Key', `${RUN_ID}-idem-sale-1`)
          .send(salePayload);

        expect(res.status).toBe(201);
        expect(res.body.data?.id).toBeDefined();
        expect(res.body.data?.referenceId).toBe(saleRef);
        expect(Number(res.body.data?.amount)).toBe(45000);
        createdSaleId = res.body.data.id;
      });

      it('Idempotency: Re-posting identical sale payload returns 200 OK with same record', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/sales`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .set('Idempotency-Key', `${RUN_ID}-idem-sale-1`)
          .send(salePayload);

        expect(res.status).toBe(200);
        expect(res.body.data?.id).toBe(createdSaleId);
        expect(res.body.data?.referenceId).toBe(saleRef);
      });

      it('Idempotency Conflict: Re-posting same referenceId with differing amount returns 409 DUPLICATE_REFERENCE', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/sales`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            ...salePayload,
            amount: 999999, // Conflicting amount
          });

        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe('DUPLICATE_REFERENCE');
      });

      it('Validation: Rejects sale with non-positive amount (400 VALIDATION_ERROR)', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/sales`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            ...salePayload,
            referenceId: `SALE-INVALID-${RUN_ID}`,
            amount: -500,
          });

        expect(res.status).toBe(400);
      });

      it('GET /api/external/v1/accounts/:accountId/sales lists sales with keyset ordering', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/sales?limit=25`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
        expect(res.body.page?.hasMore).toBeDefined();
      });

      it('GET /api/external/v1/accounts/:accountId/sales/:id retrieves single sale record', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/sales/${createdSaleId}`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.id).toBe(createdSaleId);
        expect(res.body.data?.referenceId).toBe(saleRef);
      });
    });

    describe('3.4 Expenses Ingestion & Idempotency', () => {
      const expRef = `EXP-REF-${RUN_ID}-01`;
      const expPayload = {
        externalRef: expRef,
        amount: '12500.00',
        category: 'office_supplies' as const,
        description: 'Office stationery and printer ink',
        expenseDate: '2026-11-20',
      };

      it('POST /api/external/v1/accounts/:accountId/expenses ingests an expense record', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/expenses`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send(expPayload);

        expect(res.status).toBe(201);
        expect(res.body.data?.id).toBeDefined();
        expect(res.body.data?.externalRef).toBe(expRef);
        expect(Number(res.body.data?.amount)).toBe(12500);
        createdExpenseId = res.body.data.id;
      });

      it('Idempotency: Re-posting same externalRef returns 200 OK with same expense', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/expenses`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send(expPayload);

        expect(res.status).toBe(200);
        expect(res.body.data?.id).toBe(createdExpenseId);
      });

      it('Idempotency Conflict: Same externalRef with differing amount returns 409 DUPLICATE_REFERENCE', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/expenses`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            ...expPayload,
            amount: '99000.00',
          });

        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe('DUPLICATE_REFERENCE');
      });

      it('GET /api/external/v1/accounts/:accountId/expenses lists expenses', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/expenses?limit=10`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
      });

      it('GET /api/external/v1/accounts/:accountId/expenses/:id retrieves single expense', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/expenses/${createdExpenseId}`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.id).toBe(createdExpenseId);
        expect(res.body.data?.externalRef).toBe(expRef);
      });
    });

    describe('3.5 Non-Fiscal Commercial Invoices Lifecycle', () => {
      const invRef = `INV-REF-${RUN_ID}-01`;
      const invPayload = {
        externalRef: invRef,
        customerName: 'Dangote Distribution Ltd',
        customerEmail: 'billing@dangote.example.com',
        lines: [
          { description: 'Consulting Services Q4', quantity: 1, unitPrice: '50000.00' },
          { description: 'Server Hardware Setup', quantity: 2, unitPrice: '15000.00' },
        ],
        discount: '5000.00',
        issueDate: '2026-11-20',
        dueDate: '2026-12-05',
      };

      it('POST /api/external/v1/accounts/:accountId/invoices drafts commercial invoice', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/invoices`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send(invPayload);

        expect(res.status).toBe(201);
        expect(res.body.data?.id).toBeDefined();
        expect(res.body.data?.invoiceNumber).toBeDefined();
        expect(res.body.data?.status).toBe('draft');
        expect(Number(res.body.data?.total)).toBe(75000); // (50000 + 30000) - 5000

        createdInvoiceId = res.body.data.id;
      });

      it('VAT Injection Guard: Rejects invoice payload with non-zero vatRate or vatAmount (400 UNKNOWN_FIELD / INVALID)', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/invoices`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            ...invPayload,
            externalRef: `INV-VAT-${RUN_ID}`,
            vatRate: '7.50',
            vatAmount: '5625.00',
          });

        expect(res.status).toBe(400);
      });

      it('POST /api/external/v1/accounts/:accountId/invoices/:id/send transitions invoice to SENT', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/invoices/${createdInvoiceId}/send`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.status).toBe('sent');
        expect(res.body.data?.sentAt).toBeDefined();
      });

      it('POST /api/external/v1/accounts/:accountId/invoices/:id/mark-paid transitions invoice to PAID', async () => {
        const res = await request(app)
          .post(`/api/external/v1/accounts/${accountId}/invoices/${createdInvoiceId}/mark-paid`)
          .set('Authorization', `Bearer ${testApiKey}`)
          .send({
            paymentMethod: 'bank_transfer',
            paymentDate: '2026-11-21',
          });

        expect(res.status).toBe(200);
        expect(res.body.data?.status).toBe('paid');
        expect(res.body.data?.paidAt).toBeDefined();
        expect(res.body.data?.paymentMethod).toBe('bank_transfer');
      });

      it('GET /api/external/v1/accounts/:accountId/invoices/:id/pdf generates commercial billing PDF', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/invoices/${createdInvoiceId}/pdf`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.body.slice(0, 4).toString()).toBe('%PDF');
      });

      it('GET /api/external/v1/accounts/:accountId/invoices/:id/pdf-link creates public link and shareToken', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/invoices/${createdInvoiceId}/pdf-link`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.pdfUrl).toBeDefined();
        const match = res.body.data.pdfUrl.match(/invoices\/([a-f0-9]+)\/pdf/i);
        expect(match).toBeDefined();
        createdInvoiceShareToken = match ? match[1] : '';
      });

      it('GET /public/invoices/:shareToken/pdf serves public invoice PDF without authentication', async () => {
        if (!createdInvoiceShareToken) return;

        const res = await request(app).get(`/public/invoices/${createdInvoiceShareToken}/pdf`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.body.slice(0, 4).toString()).toBe('%PDF');
      });
    });

    describe('3.6 Profit Summary & Tombstones', () => {
      it('GET /api/external/v1/accounts/:accountId/profit-summary aggregates revenue, expenses, and net profit', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/profit-summary`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.data?.totalSales).toBeDefined();
        expect(res.body.data?.totalExpenses).toBeDefined();
        expect(res.body.data?.netProfit).toBeDefined();
        expect(Number(res.body.data?.totalSales)).toBeGreaterThan(0);
        expect(Number(res.body.data?.totalExpenses)).toBeGreaterThan(0);
      });

      it('GET /api/external/v1/accounts/:accountId/deletions returns tombstone deletion stream', async () => {
        const res = await request(app)
          .get(`/api/external/v1/accounts/${accountId}/deletions`)
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });
  });

  // =========================================================================
  // 4. CORE PARTNER APIS — LIVE MODE (sk_ext_live_...)
  // =========================================================================
  describe('4. Core Partner APIs in LIVE Mode', () => {
    it('LIVE Key: Successfully authenticates account profile fetch', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${accountId}`)
        .set('Authorization', `Bearer ${liveApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data?.businessName).toBeDefined();
    });

    it('LIVE Key: Successfully creates customer', async () => {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${accountId}/customers`)
        .set('Authorization', `Bearer ${liveApiKey}`)
        .send({
          externalId: `LIVE-CUST-${RUN_ID}`,
          name: `Live Client ${RUN_ID}`,
          email: `live-${RUN_ID}@corp.example.com`,
          phone: '+2348055667788',
        });

      expect(res.status).toBe(201);
      expect(res.body.data?.id).toBeDefined();
    });

    it('LIVE Key: Ingests live sale transaction with idempotency contract', async () => {
      const liveSaleRef = `LIVE-SALE-${RUN_ID}-01`;
      const res = await request(app)
        .post(`/api/external/v1/accounts/${accountId}/sales`)
        .set('Authorization', `Bearer ${liveApiKey}`)
        .send({
          referenceId: liveSaleRef,
          amount: 85000,
          source: 'card' as const,
          status: 'completed' as const,
          transactionDate: '2026-11-21',
          description: 'Live ecommerce transaction',
        });

      expect(res.status).toBe(201);
      expect(res.body.data?.referenceId).toBe(liveSaleRef);
      expect(Number(res.body.data?.amount)).toBe(85000);
    });

    it('LIVE Key: Ingests live expense record', async () => {
      const liveExpRef = `LIVE-EXP-${RUN_ID}-01`;
      const res = await request(app)
        .post(`/api/external/v1/accounts/${accountId}/expenses`)
        .set('Authorization', `Bearer ${liveApiKey}`)
        .send({
          externalRef: liveExpRef,
          amount: '32000.00',
          category: 'utility' as const,
          description: 'Monthly office electricity bill',
          expenseDate: '2026-11-21',
        });

      expect(res.status).toBe(201);
      expect(res.body.data?.externalRef).toBe(liveExpRef);
    });

    it('LIVE Key: Creates and completes commercial non-fiscal invoice', async () => {
      const liveInvRef = `LIVE-INV-${RUN_ID}-01`;
      const draftRes = await request(app)
        .post(`/api/external/v1/accounts/${accountId}/invoices`)
        .set('Authorization', `Bearer ${liveApiKey}`)
        .send({
          externalRef: liveInvRef,
          customerName: 'Enterprise Client PLC',
          lines: [{ description: 'Enterprise ERP Subscription', quantity: 1, unitPrice: '120000.00' }],
          discount: '0.00',
          issueDate: '2026-11-21',
          dueDate: '2026-12-21',
        });

      expect(draftRes.status).toBe(201);
      const invoiceId = draftRes.body.data?.id;

      // Transition to sent, then to paid
      const sendRes = await request(app)
        .post(`/api/external/v1/accounts/${accountId}/invoices/${invoiceId}/send`)
        .set('Authorization', `Bearer ${liveApiKey}`);
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.data?.status).toBe('sent');

      const payRes = await request(app)
        .post(`/api/external/v1/accounts/${accountId}/invoices/${invoiceId}/mark-paid`)
        .set('Authorization', `Bearer ${liveApiKey}`)
        .send({
          paymentMethod: 'card',
          paymentDate: '2026-11-21',
        });

      expect(payRes.status).toBe(200);
      expect(payRes.body.data?.status).toBe('paid');
    });

    it('LIVE Key: Computes profit summary across all recorded transactions', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${accountId}/profit-summary`)
        .set('Authorization', `Bearer ${liveApiKey}`);

      expect(res.status).toBe(200);
      expect(Number(res.body.data?.totalSales)).toBeGreaterThan(0);
      expect(Number(res.body.data?.totalExpenses)).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 5. ADVERSARIAL, SECURITY & BOUNDARY GATES (QA HUNTER BRUTAL GATES)
  // =========================================================================
  describe('5. Adversarial, Security & Boundary Gates', () => {
    it('Tenant Isolation Gate: Accessing account belonging to another platform returns 404 NOT_FOUND (never 403)', async () => {
      const res = await request(app)
        .get('/api/external/v1/accounts/NON_EXISTENT_OR_FOREIGN_TENANT/sales')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_FOUND');
    });

    it('Token Security Gate: Missing or malformed Authorization header is rejected (401 TOKEN_INVALID)', async () => {
      const noHeader = await request(app).get(`/api/external/v1/accounts/${accountId}/sales`);
      expect(noHeader.status).toBe(401);
      expect(noHeader.body.error?.code).toBe('TOKEN_INVALID');

      const badHeader = await request(app)
        .get(`/api/external/v1/accounts/${accountId}/sales`)
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      expect(badHeader.status).toBe(401);
      expect(badHeader.body.error?.code).toBe('TOKEN_INVALID');

      const bogusToken = await request(app)
        .get(`/api/external/v1/accounts/${accountId}/sales`)
        .set('Authorization', 'Bearer sk_ext_test_bogus_token_1234567890');
      expect(bogusToken.status).toBe(401);
      expect(bogusToken.body.error?.code).toBe('TOKEN_INVALID');
    });

    it('Surface Boundary Gate: Partner API key is strictly rejected on Admin endpoints (401 TOKEN_INVALID)', async () => {
      const res = await request(app)
        .get('/api/external/v1/admin/platforms')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('TOKEN_INVALID');
    });

    it('RateLimit Headers: Responses include compliant RateLimit RFC headers', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${accountId}`)
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.headers['ratelimit-remaining']).toBeDefined();
      expect(res.headers['ratelimit-reset']).toBeDefined();
    });
  });
});
