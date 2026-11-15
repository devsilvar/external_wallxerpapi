import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { seedSandboxTenant, type SandboxSeedResult } from '../../src/cli/seed-sandbox.js';

describe('Sandbox tenant on staging (tests/integration/sandbox.test.ts)', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let sandbox: SandboxSeedResult;
  const testBatch = `sbx-test-${Date.now()}`;

  beforeAll(async () => {
    // Seed or retrieve the persistent sandbox tenant
    sandbox = await seedSandboxTenant();
    expect(sandbox.businessId).toBeDefined();
    expect(sandbox.deviceToken).toBeDefined();
  });

  it('authenticates against GET /me with the sandbox test token', async () => {
    const res = await request(app)
      .get('/api/external/v1/me')
      .set('Authorization', `Bearer ${sandbox.deviceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.accountId).toBe(sandbox.businessId);
    expect(res.body.data.merchantId).toBe(sandbox.merchantId);
    expect(res.body.data.isActive).toBe(true);
  });

  it('runs complete partner ingestion lifecycle end-to-end on sandbox tenant', async () => {
    // 1. Create a customer
    const custRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/customers`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`)
      .send({
        externalId: `cust-${testBatch}`,
        name: 'Sandbox Customer',
        email: `customer-${testBatch}@test.com`,
        phone: '08099887766',
      });

    expect(custRes.status).toBe(201);
    const customerId = custRes.body.data.id;
    expect(customerId).toBeDefined();

    // 2. Ingest a sale (idempotent)
    const saleRef = `SALE-${testBatch}`;
    const saleRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/sales`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`)
      .send({
        referenceId: saleRef,
        amount: '15000.00',
        source: 'pos',
        transactionDate: '2026-11-15',
        customerId,
        items: [
          {
            name: 'Sandbox Test Item',
            quantity: '1',
            unitPrice: '15000.00',
            lineTotal: '15000.00',
          },
        ],
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.data.id;

    // Idempotent replay with identical payload returns 200 OK
    const saleReplay = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/sales`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`)
      .send({
        referenceId: saleRef,
        amount: '15000.00',
        source: 'pos',
        transactionDate: '2026-11-15',
        customerId,
        items: [
          {
            name: 'Sandbox Test Item',
            quantity: '1',
            unitPrice: '15000.00',
            lineTotal: '15000.00',
          },
        ],
      });
    expect(saleReplay.status).toBe(200);
    expect(saleReplay.body.data.id).toBe(saleId);

    // 3. Ingest an expense
    const expRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/expenses`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`)
      .send({
        externalRef: `EXP-${testBatch}`,
        category: 'office_supplies',
        description: 'Printer ink for sandbox testing',
        amount: '4500.00',
        expenseDate: '2026-11-15',
      });
    expect(expRes.status).toBe(201);
    expect(expRes.body.data.id).toBeDefined();
    expect(expRes.body.data.amount).toBe('4500.00');

    const dbExp = await prisma.expense.findUnique({ where: { id: expRes.body.data.id } });
    expect(dbExp?.isDeductible).toBe(false);

    // 4. Create, send, and mark-paid an invoice
    const invRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/invoices`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`)
      .send({
        externalRef: `INV-${testBatch}`,
        customerId,
        customerName: 'Sandbox Customer',
        issueDate: '2026-11-15',
        dueDate: '2026-11-30',
        lines: [
          {
            description: 'Sandbox Consultation Service',
            quantity: '2',
            unitPrice: '25000.00',
          },
        ],
      });

    expect(invRes.status).toBe(201);
    const invoiceId = invRes.body.data.id;
    const invoiceNumber = invRes.body.data.invoiceNumber;
    expect(invRes.body.data.status).toBe('draft');

    const dbInv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(Number(dbInv?.vatRate)).toBe(0);

    // Send the invoice -> transitions to 'sent'
    const sendRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.data.status).toBe('sent');

    // Mark paid -> creates linked sale
    const payRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`)
      .send({
        paymentDate: '2026-11-15',
        paymentMethod: 'bank_transfer',
      });
    expect(payRes.status).toBe(200);
    expect(payRes.body.data.status).toBe('paid');
    expect(payRes.body.data.linkedSaleId).toBeDefined();

    // 5. Fetch commercial PDF
    const pdfRes = await request(app)
      .get(`/api/external/v1/accounts/${sandbox.businessId}/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');

    // 6. Public capability link
    const linkRes = await request(app)
      .post(`/api/external/v1/accounts/${sandbox.businessId}/invoices/${invoiceId}/pdf-link`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`);
    expect(linkRes.status).toBe(200);
    const publicUrl = linkRes.body.data.pdfUrl;

    const pubRes = await request(app).get(publicUrl);
    expect(pubRes.status).toBe(200);
    expect(pubRes.headers['content-type']).toBe('application/pdf');
    expect(pubRes.headers['content-disposition']).toBe(`attachment; filename="${invoiceNumber}.pdf"`);

    // 7. Polling sync query with updatedSince
    const syncRes = await request(app)
      .get(`/api/external/v1/accounts/${sandbox.businessId}/sales?updatedSince=2026-01-01T00:00:00.000Z&limit=10`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`);
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(syncRes.body.page).toBeDefined();

    // 8. Deletions endpoint check
    const delRes = await request(app)
      .get(`/api/external/v1/accounts/${sandbox.businessId}/deletions?since=2026-01-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${sandbox.deviceToken}`);
    expect(delRes.status).toBe(200);
    expect(Array.isArray(delRes.body.data)).toBe(true);
  });
});
