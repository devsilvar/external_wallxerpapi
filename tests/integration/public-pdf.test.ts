import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Public invoice PDF capability link (tests/integration/public-pdf.test.ts)', () => {
  const testId = `pub-pdf-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
    EXTERNAL_PUBLIC_PDF_RATE_LIMIT: '5', // small limit to easily verify 429 rate limit
    TRUST_PROXY: '1',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let apiKey: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Public PDF Tester',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Public PDF Test Platform',
        ownerUserId: userId,
        apiKeyHash: hashToken(apiKey),
        apiKeyPrefix: apiKey.slice(0, 16),
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Public PDF Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('generates a public capability link and serves PDF without credentials', async () => {
    // 1. Create invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pub-link-${testId}`,
        customerName: 'Public Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Service', quantity: '1', unitPrice: '12000.00' }],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;
    const invoiceNumber = createRes.body.data.invoiceNumber;

    // 2. Generate pdf-link
    const linkRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(linkRes.status).toBe(200);
    const pdfUrl = linkRes.body.data.pdfUrl;
    expect(pdfUrl).toMatch(/^\/api\/external\/v1\/public\/invoices\/[a-f0-9]{64}\/pdf$/);

    // 3. Fetch PDF via public capability URL with NO Authorization header
    const pubRes = await request(app).get(pdfUrl);

    expect(pubRes.status).toBe(200);
    expect(pubRes.headers['content-type']).toBe('application/pdf');
    expect(pubRes.headers['content-disposition']).toBe(`attachment; filename="${invoiceNumber}.pdf"`);
    expect(pubRes.headers['cache-control']).toBe('private, max-age=60');
    expect(pubRes.headers['referrer-policy']).toBe('no-referrer');
    expect(pubRes.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(pubRes.body.length).toBeGreaterThan(500);
  });

  it('regenerating pdf-link invalidates the old shareToken immediately', async () => {
    // 1. Create invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pub-rotate-${testId}`,
        customerName: 'Rotate Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '3000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    // 2. Mint first link
    const link1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);
    const url1 = link1.body.data.pdfUrl;

    // First link works
    const check1 = await request(app).get(url1);
    expect(check1.status).toBe(200);

    // 3. Mint second link (replaces the token)
    const link2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);
    const url2 = link2.body.data.pdfUrl;
    expect(url2).not.toBe(url1);

    // First link must now fail with 404 NOT_FOUND
    const checkOld = await request(app).get(url1);
    expect(checkOld.status).toBe(404);
    expect(checkOld.body.error.code).toBe('NOT_FOUND');

    // Second link works with 200 OK
    const checkNew = await request(app).get(url2);
    expect(checkNew.status).toBe(200);
  });

  it('returns 404 for expired shareToken', async () => {
    // 1. Create invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pub-expired-${testId}`,
        customerName: 'Expired Token Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    // 2. Mint link
    const linkRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);
    const pdfUrl = linkRes.body.data.pdfUrl;

    // 3. Manually expire token in database
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        shareTokenExpiresAt: new Date(Date.now() - 1000), // in the past
      },
    });

    // 4. Request with expired token returns 404
    const res = await request(app).get(pdfUrl);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 410 INVOICE_CANCELLED when accessing public link of cancelled invoice', async () => {
    // 1. Create invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pub-cancelled-${testId}`,
        customerName: 'Cancelled Token Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    // 2. Mint link
    const linkRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);
    const pdfUrl = linkRes.body.data.pdfUrl;

    // 3. Cancel the invoice
    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${apiKey}`);

    // 4. Request returns 410 INVOICE_CANCELLED
    const res = await request(app).get(pdfUrl);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVOICE_CANCELLED');
  });

  it('rate limits public capability requests when limit is exceeded', async () => {
    // 1. Create invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pub-rate-limit-${testId}`,
        customerName: 'Rate Limit Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    // 2. Mint link
    const linkRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);
    const pdfUrl = linkRes.body.data.pdfUrl;

    // 3. Fire requests up to and beyond limit (configured to 5 in this test file)
    const responses = [];
    const testIp = `198.51.100.${Math.floor(10 + Math.random() * 200)}`;
    for (let i = 0; i < 7; i++) {
      responses.push(await request(app).get(pdfUrl).set('X-Forwarded-For', testIp));
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(200);
    expect(statuses).toContain(429);

    const rateLimitedRes = responses.find((r) => r.status === 429);
    expect(rateLimitedRes?.body.error.code).toBe('RATE_LIMITED');
  });
});
