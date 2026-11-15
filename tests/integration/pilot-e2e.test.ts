import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';
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

describe('Pilot Definition of Done End-to-End Test (tests/integration/pilot-e2e.test.ts)', () => {
  const testId = `pilot-e2e-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let apiKey: string;
  let customerId: string;
  let invoiceId: string;
  let invoiceNumber: string;
  let linkedSaleId: string;

  beforeAll(async () => {
    // 1. Provision Platform and User
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Pilot Merchant',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Pilot E2E Test Platform',
        ownerUserId: userId,
        apiKeyHash: hashToken(apiKey),
        apiKeyPrefix: apiKey.slice(0, 16),
      },
    });
    platformId = platform.id;
  });

  afterAll(async () => {
    if (businessId) {
      await prisma.externalTombstone.deleteMany({ where: { businessId } });
      await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
      await prisma.invoice.deleteMany({ where: { businessId } });
      await prisma.saleLineItem.deleteMany({ where: { sale: { businessId } } });
      await prisma.salesTransaction.deleteMany({ where: { businessId } });
      await prisma.expense.deleteMany({ where: { businessId } });
      await prisma.customer.deleteMany({ where: { businessId } });
      await prisma.auditLog.deleteMany({ where: { businessId } });
      await prisma.businessMember.deleteMany({ where: { businessId } });
      await prisma.business.deleteMany({ where: { id: businessId } });
    }
    if (platformId) {
      await prisma.platform.deleteMany({ where: { id: platformId } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it('Step 1: Onboard merchant via POST /accounts -> yields merchant account', async () => {
    const res = await request(app)
      .post('/api/external/v1/accounts')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        customerId: `pilot-${testId}`,
        businessName: 'Pilot Electronics & Consulting Ltd',
        ownerName: 'Aliko Tester',
        contactEmail: `${testId}-biz@example.com`,
        contactPhone: '+2348030001122',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.externalCustomerId).toBe(`pilot-${testId}`);
    expect(res.body.data.merchantId).toMatch(/^WOWO\d{7}$/);
    businessId = res.body.data.id;
  });

  it('Step 2: Create customer via POST /accounts/:id/customers', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/customers`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalId: `cust-ext-${Date.now()}`,
        name: 'Prime Client Ltd',
        email: 'client@example.com',
        phone: '+2348030001122',
        address: '10 Marina, Lagos Island',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.name).toBe('Prime Client Ltd');
    customerId = res.body.data.id;
  });

  it('Step 3: Create an independent sale via POST /accounts/:id/sales', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/sales`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        referenceId: `POS-SALE-${Date.now()}`,
        amount: '45000.00',
        source: 'pos',
        transactionDate: '2026-11-13',
        description: 'Store counter sale',
        customerId,
        items: [
          {
            name: 'Network Router',
            quantity: '1',
            unitPrice: '45000.00',
            lineTotal: '45000.00',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.amount).toBe('45000.00');
  });

  it('Step 4: Create an expense and verify isDeductible = false safe default', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/expenses`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `EXP-${Date.now()}`,
        category: 'utility',
        description: 'Office power & fuel',
        amount: '18500.00',
        expenseDate: '2026-11-13',
      });

    expect(res.status).toBe(201);
    const expId = res.body.data.id;

    // Verify DB column isDeductible is strictly false
    const expRecord = await prisma.expense.findUnique({
      where: { id: expId },
    });
    expect(expRecord).not.toBeNull();
    expect(expRecord!.isDeductible).toBe(false);
  });

  it('Step 5: Create invoice -> verify vatRate=0, vatAmount=0, total = subtotal - discount', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `INV-PILOT-${Date.now()}`,
        customerId,
        customerName: 'Prime Client Ltd',
        customerEmail: 'client@example.com',
        issueDate: '2026-11-13',
        dueDate: '2026-11-20',
        discount: '5000.00',
        lines: [
          {
            description: 'Enterprise Cloud Deployment',
            quantity: '2',
            unitPrice: '50000.00',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.subtotal).toBe('100000.00');
    expect(res.body.data.discount).toBe('5000.00');
    expect(res.body.data.total).toBe('95000.00');
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.invoiceNumber).toMatch(/^WX-\d{4}-\d{3,}$/);

    invoiceId = res.body.data.id;
    invoiceNumber = res.body.data.invoiceNumber;

    // Verify database record
    const stored = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    expect(stored).not.toBeNull();
    expect(Number(stored!.vatRate)).toBe(0);
    expect(Number(stored!.vatAmount)).toBe(0);
  });

  it('Step 6: Issue invoice -> draft transitions to sent, sentAt set', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('sent');
    expect(res.body.data.sentAt).toBeDefined();
  });

  it('Step 7: Mark-paid creates linked sale atomically; replay is idempotent and yields exactly one sale', async () => {
    const res1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        paymentMethod: 'bank_transfer',
        paymentDate: '2026-11-13',
      });

    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe('paid');
    expect(res1.body.data.linkedSaleId).toBeDefined();
    linkedSaleId = res1.body.data.linkedSaleId;

    // Verify the linked sale created in DB
    const linkedSale = await prisma.salesTransaction.findUnique({
      where: { id: linkedSaleId },
      include: { items: true },
    });
    expect(linkedSale).not.toBeNull();
    expect(linkedSale!.businessId).toBe(businessId);
    expect(linkedSale!.source).toBe('api');
    expect(linkedSale!.status).toBe('confirmed');
    expect(linkedSale!.isTaxable).toBe(false);
    expect(linkedSale!.referenceId).toBe(invoiceNumber);
    expect(Number(linkedSale!.amount)).toBe(95000.0);
    expect(linkedSale!.items.length).toBe(1);

    // Replay mark-paid
    const res2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        paymentMethod: 'bank_transfer',
        paymentDate: '2026-11-13',
      });

    expect(res2.status).toBe(200);
    expect(res2.body.data.id).toBe(invoiceId);
    expect(res2.body.data.status).toBe('paid');
    expect(res2.body.data.linkedSaleId).toBe(linkedSaleId);

    // Proves exactly ONE sale exists for this invoiceNumber referenceId
    const matchingSales = await prisma.salesTransaction.findMany({
      where: { businessId, referenceId: invoiceNumber },
    });
    expect(matchingSales.length).toBe(1);
  });

  it('Step 8: Render commercial PDF -> verified title, headers, no VAT line, disclaimer verbatim', async () => {
    const res = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="WX-.*\.pdf"/);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(res.headers['referrer-policy']).toBe('no-referrer');

    const pdfBuffer = Buffer.from(res.body);
    const pdfText = extractPdfText(pdfBuffer);

    expect(pdfText).toContain('COMMERCIAL INVOICE');
    expect(pdfText).not.toContain('TAX INVOICE');
    expect(pdfText).not.toContain('VAT INVOICE');
    expect(pdfText).not.toContain('VAT:');
    expect(pdfText).not.toContain('VAT Rate');
    expect(pdfText).toContain(COMMERCIAL_INVOICE_DISCLAIMER);
  });

  it('Step 9: Capability link works with no credential, sends security headers', async () => {
    const linkRes = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(linkRes.status).toBe(200);
    expect(linkRes.body.data.pdfUrl).toBeDefined();
    const pdfUrl = linkRes.body.data.pdfUrl;

    // Access via public route without any Authorization header
    const pubRes = await request(app)
      .get(pdfUrl);

    expect(pubRes.status).toBe(200);
    expect(pubRes.headers['content-type']).toBe('application/pdf');
    expect(pubRes.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(pubRes.headers['referrer-policy']).toBe('no-referrer');
  });

  it('Step 10: Final Database Integrity Verification -> Safe tax defaults and entity counts', async () => {
    // 1. Every invoice for this business has vatRate = 0, vatAmount = 0
    const invoices = await prisma.invoice.findMany({
      where: { businessId },
    });
    expect(invoices.length).toBe(1);
    for (const inv of invoices) {
      expect(Number(inv.vatRate)).toBe(0);
      expect(Number(inv.vatAmount)).toBe(0);
      expect(Number(inv.total)).toBe(Number(inv.subtotal) - Number(inv.discount));
    }

    // 2. Every expense has isDeductible = false
    const expenses = await prisma.expense.findMany({
      where: { businessId },
    });
    expect(expenses.length).toBe(1);
    for (const exp of expenses) {
      expect(exp.isDeductible).toBe(false);
    }

    // 3. Exactly one independent sale + one invoice-linked sale
    const sales = await prisma.salesTransaction.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    expect(sales.length).toBe(2);

    const independentSale = sales.find((s) => s.id !== linkedSaleId);
    expect(independentSale).toBeDefined();
    expect(independentSale!.source).toBe('pos');

    const invoiceLinkedSale = sales.find((s) => s.id === linkedSaleId);
    expect(invoiceLinkedSale).toBeDefined();
    expect(invoiceLinkedSale!.source).toBe('api');
    expect(invoiceLinkedSale!.status).toBe('confirmed');
    expect(invoiceLinkedSale!.isTaxable).toBe(false);
    expect(invoiceLinkedSale!.referenceId).toBe(invoiceNumber);
  });
});
