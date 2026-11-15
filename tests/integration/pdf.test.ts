import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateToken, hashToken } from '../../src/lib/token.js';
import { generateCommercialInvoicePdf } from '../../src/pdf/commercial-invoice.pdf.js';
import { COMMERCIAL_INVOICE_DISCLAIMER } from '../../src/pdf/pdf-common.js';

function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const textChunks: string[] = [];
  const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btBlocks) {
    const tjMatches = block.match(/\[([\s\S]*?)\]\s*TJ/g) || [];
    for (const tj of tjMatches) {
      const hexMatches = tj.match(/<([0-9a-fA-F]+)>/g) || [];
      const decoded = hexMatches
        .map((h: string) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
        .join('');
      if (decoded.trim()) textChunks.push(decoded.trim());
    }
  }
  return textChunks.join(' ');
}

describe('Commercial invoice PDF generation and route (tests/integration/pdf.test.ts)', () => {
  const testId = `pdf-test-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let deviceToken: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'PDF Tester',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'PDF Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'PDF Biz Ltd',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        address: '100 Marina Road',
        city: 'Lagos',
        state: 'Lagos',
        contactEmail: 'billing@pdfbiz.ng',
        contactPhone: '+2348000000000',
      },
    });
    businessId = biz.id;

    deviceToken = generateToken();
    await prisma.externalDevice.create({
      data: {
        platformId,
        businessId,
        tokenHash: hashToken(deviceToken),
        activatedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.externalDevice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('generates a commercial invoice PDF buffer with exact title, verbatim disclaimer, and no VAT line', async () => {
    const pdfBuffer = await generateCommercialInvoicePdf(
      {
        invoiceNumber: 'WX-2026-001',
        externalRef: 'inv-ref-001',
        issueDate: new Date('2026-11-10'),
        dueDate: new Date('2026-11-24'),
        status: 'draft',
        customerName: 'Chidi Nwosu',
        customerAddress: '5 Broad Street, Lagos',
        subtotal: '25000.00',
        discount: '1000.00',
        total: '24000.00',
        currency: 'NGN',
        notes: 'Thank you for your business.',
        paymentTerms: 'Due upon receipt',
        lines: [
          {
            description: 'Item 1',
            quantity: '1',
            unitPrice: '15000.00',
            lineTotal: '15000.00',
          },
          {
            description: 'Item 2',
            quantity: '2',
            unitPrice: '5000.00',
            lineTotal: '10000.00',
          },
        ],
      },
      {
        businessName: 'PDF Biz Ltd',
        ownerName: 'Owner',
        address: '100 Marina Road',
        city: 'Lagos',
        state: 'Lagos',
        contactEmail: 'billing@pdfbiz.ng',
        contactPhone: '+2348000000000',
      }
    );

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(500);

    // Verify it is a valid PDF
    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');

    const pdfText = extractPdfText(pdfBuffer);

    // Title must be COMMERCIAL INVOICE
    expect(pdfText).toContain('COMMERCIAL INVOICE');
    // Title must NEVER be TAX INVOICE, VAT INVOICE, or FIRS INVOICE
    expect(pdfText).not.toContain('TAX INVOICE');
    expect(pdfText).not.toContain('VAT INVOICE');
    expect(pdfText).not.toContain('FIRS INVOICE');

    // NO VAT row rendered at all
    expect(pdfText).not.toContain('VAT:');
    expect(pdfText).not.toContain('VAT Rate');
    expect(pdfText).not.toContain('vatRate');

    // Disclaimer must appear in full verbatim
    expect(pdfText).toContain('statutory FIRS Tax Invoice, VAT receipt or tax return filing');
    expect(pdfText).toContain('This is a commercial billing document generated via Wowo');
    expect(pdfText).toContain(COMMERCIAL_INVOICE_DISCLAIMER);
  });

  it('creates continuation page when line items exceed 12', async () => {
    const lines = Array.from({ length: 15 }, (_, i) => ({
      description: `Line Item Number ${i + 1}`,
      quantity: '1',
      unitPrice: '1000.00',
      lineTotal: '1000.00',
      sortOrder: i,
    }));

    const pdfBuffer = await generateCommercialInvoicePdf(
      {
        invoiceNumber: 'WX-2026-002',
        externalRef: 'inv-ref-multi',
        issueDate: new Date('2026-11-10'),
        dueDate: new Date('2026-11-24'),
        status: 'draft',
        customerName: 'Multi Page Customer',
        subtotal: '15000.00',
        discount: '0.00',
        total: '15000.00',
        currency: 'NGN',
        lines,
      },
      {
        businessName: 'PDF Biz Ltd',
        ownerName: 'Owner',
      }
    );

    const pdfText = extractPdfText(pdfBuffer);
    expect(pdfText).toContain('DESCRIPTION (Cont.)');
  });

  it('GET /accounts/:accountId/invoices/:id/pdf serves PDF with required security headers', async () => {
    // 1. Create invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        externalRef: `inv-pdf-route-${testId}`,
        customerName: 'Route Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Item 1', quantity: '1', unitPrice: '5000.00' }],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;
    const invoiceNumber = createRes.body.data.invoiceNumber;

    // 2. Fetch PDF
    const res = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${deviceToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${invoiceNumber}.pdf"`);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');

    expect(res.body.length).toBeGreaterThan(500);
  });

  it('GET /accounts/:accountId/invoices/:id/pdf returns 410 INVOICE_CANCELLED if invoice is cancelled', async () => {
    // 1. Create and cancel invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({
        externalRef: `inv-pdf-cancelled-${testId}`,
        customerName: 'Cancel Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Item 1', quantity: '1', unitPrice: '5000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${deviceToken}`);

    // 2. Attempt to fetch PDF
    const res = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${deviceToken}`);

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVOICE_CANCELLED');
  });

  it('GET /accounts/:accountId/invoices/:id/pdf returns 404 NOT_FOUND for non-existent invoice', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/invoices/00000000-0000-0000-0000-000000000000/pdf`)
      .set('Authorization', `Bearer ${deviceToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
