import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Invoice lifecycle state machine (tests/integration/invoice-lifecycle.test.ts)', () => {
  const testId = `inv-life-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
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
        fullName: 'Invoice Lifecycle Tester',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Invoice Lifecycle Test Platform',
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
        businessName: 'Lifecycle Test Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.saleLineItem.deleteMany({ where: { sale: { businessId } } });
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('creates an invoice with safe defaults (vatRate=0, vatAmount=0, total=subtotal-discount) and mints invoiceNumber', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-create-${testId}`,
        customerName: 'Amina Bello',
        customerEmail: 'amina@example.com',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        discount: '1000.00',
        currency: 'NGN',
        lines: [
          {
            description: 'Consulting Session',
            quantity: '2',
            unitPrice: '15000.00',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.subtotal).toBe('30000.00');
    expect(res.body.data.discount).toBe('1000.00');
    expect(res.body.data.total).toBe('29000.00');
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.invoiceNumber).toMatch(/^WX-\d{4}-\d{3,}$/);

    // Verify stored DB record has vatRate=0 and vatAmount=0
    const stored = await prisma.invoice.findUnique({
      where: { id: res.body.data.id },
    });
    expect(stored).not.toBeNull();
    expect(Number(stored!.vatRate)).toBe(0);
    expect(Number(stored!.vatAmount)).toBe(0);
  });

  it('rejects vatRate if sent in create body with 400 UNKNOWN_FIELD', async () => {
    const res = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-vat-attempt-${testId}`,
        customerName: 'Amina Bello',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        vatRate: '7.5', // forbidden on external API
        lines: [
          {
            description: 'Item',
            quantity: '1',
            unitPrice: '1000.00',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('allows PUT only on draft invoices and rejects PUT once issued/sent with 409 INVOICE_NOT_EDITABLE', async () => {
    // 1. Create draft invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-put-test-${testId}`,
        customerName: 'Editable Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        discount: '500.00',
        lines: [
          {
            description: 'Initial Line',
            quantity: '1',
            unitPrice: '5000.00',
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;

    // 2. PUT from draft succeeds
    const putRes = await request(app)
      .put(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        customerName: 'Updated Customer Name',
        lines: [
          {
            description: 'Updated Line 1',
            quantity: '2',
            unitPrice: '4000.00',
          },
        ],
      });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.customerName).toBe('Updated Customer Name');
    expect(putRes.body.data.subtotal).toBe('8000.00');
    expect(putRes.body.data.total).toBe('7500.00');

    // 3. Issue invoice (draft -> sent)
    const issueRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(issueRes.status).toBe(200);
    expect(issueRes.body.data.status).toBe('sent');

    // 4. PUT now fails with 409 INVOICE_NOT_EDITABLE
    const putFailRes = await request(app)
      .put(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        customerName: 'Forbidden Edit',
      });
    expect(putFailRes.status).toBe(409);
    expect(putFailRes.body.error.code).toBe('INVOICE_NOT_EDITABLE');
  });

  it('calling issue on already-sent invoice returns 200 (idempotent)', async () => {
    // 1. Create and issue invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-issue-replay-${testId}`,
        customerName: 'Replay Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Item', quantity: '1', unitPrice: '1000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    const issue1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(issue1.status).toBe(200);
    const sentAt1 = issue1.body.data.sentAt;

    // 2. Issue again -> 200 OK, same sentAt
    const issue2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(issue2.status).toBe(200);
    expect(issue2.body.data.sentAt).toBe(sentAt1);
  });

  it('mark-paid enforces guard: draft -> 409, future date -> 400, before issueDate -> 400', async () => {
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pay-guards-${testId}`,
        customerName: 'Guard Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Item', quantity: '1', unitPrice: '2000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    // 1. Calling mark-paid on draft returns 409 INVOICE_NOT_SENT
    const draftPayRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ paymentMethod: 'cash' });
    expect(draftPayRes.status).toBe(409);
    expect(draftPayRes.body.error.code).toBe('INVOICE_NOT_SENT');

    // Issue invoice
    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);

    // 2. Future payment date returns 400 INVALID_DATE
    const futureDateRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        paymentDate: '2035-01-01',
        paymentMethod: 'cash',
      });
    expect(futureDateRes.status).toBe(400);
    expect(futureDateRes.body.error.code).toBe('INVALID_DATE');

    // 3. Payment date before issue date (2026-11-01 < 2026-11-10) returns 400 INVALID_DATE
    const pastDateRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        paymentDate: '2026-11-01',
        paymentMethod: 'cash',
      });
    expect(pastDateRes.status).toBe(400);
    expect(pastDateRes.body.error.code).toBe('INVALID_DATE');
  });

  it('mark-paid creates linked sale atomically, setting source=api, status=confirmed, isTaxable=false; replay yields exactly 1 sale', async () => {
    // 1. Create and issue invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-pay-success-${testId}`,
        customerName: 'Successful Payer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        discount: '200.00',
        lines: [{ description: 'Goods', quantity: '3', unitPrice: '1000.00' }],
      });
    const invoice = createRes.body.data;
    const invoiceId = invoice.id;

    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);

    // 2. Mark as paid
    const payRes1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        paymentDate: '2026-11-12',
        paymentMethod: 'bank_transfer',
      });

    expect(payRes1.status).toBe(200);
    expect(payRes1.body.data.status).toBe('paid');
    const linkedSaleId = payRes1.body.data.linkedSaleId;
    expect(linkedSaleId).toBeTruthy();

    // Verify linked sale properties in DB
    const sale = await prisma.salesTransaction.findUnique({
      where: { id: linkedSaleId },
      include: { items: true },
    });
    expect(sale).not.toBeNull();
    expect(sale!.source).toBe('api');
    expect(sale!.status).toBe('confirmed');
    expect(sale!.isTaxable).toBe(false);
    expect(sale!.referenceId).toBe(invoice.invoiceNumber);
    expect(Number(sale!.amount)).toBe(2800.00); // 3000 - 200

    // 3. Mark paid again (replay) returns 200 OK and DOES NOT create a second sale
    const payRes2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        paymentDate: '2026-11-12',
        paymentMethod: 'bank_transfer',
      });

    expect(payRes2.status).toBe(200);
    expect(payRes2.body.data.linkedSaleId).toBe(linkedSaleId);

    const totalSalesForInvoice = await prisma.salesTransaction.count({
      where: { businessId, referenceId: invoice.invoiceNumber },
    });
    expect(totalSalesForInvoice).toBe(1);
  });

  it('cancel refuses paid invoice with 409 INVOICE_PAID; cancel replay is idempotent 200', async () => {
    // 1. Create and cancel invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-cancel-test-${testId}`,
        customerName: 'Cancel Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const invoiceId = createRes.body.data.id;

    // Issue invoice
    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);

    // Cancel invoice
    const cancelRes1 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(cancelRes1.status).toBe(200);
    expect(cancelRes1.body.data.status).toBe('cancelled');

    // Replay cancel -> 200 OK
    const cancelRes2 = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(cancelRes2.status).toBe(200);

    // 2. Try cancelling paid invoice -> 409 INVOICE_PAID
    const paidInvRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-paid-cannot-cancel-${testId}`,
        customerName: 'Paid Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const paidInvId = paidInvRes.body.data.id;

    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${paidInvId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);

    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${paidInvId}/mark-paid`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ paymentMethod: 'cash' });

    const cancelPaidRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${paidInvId}/cancel`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(cancelPaidRes.status).toBe(409);
    expect(cancelPaidRes.body.error.code).toBe('INVOICE_PAID');
  });

  it('DELETE is draft-only: non-draft -> 409 INVOICE_NOT_DELETABLE; draft delete leaves tombstone', async () => {
    // 1. Create draft invoice
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-delete-draft-${testId}`,
        customerName: 'Delete Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const draftId = createRes.body.data.id;

    // Delete draft -> 200 OK
    const delDraftRes = await request(app)
      .delete(`/api/external/v1/accounts/${businessId}/invoices/${draftId}`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(delDraftRes.status).toBe(200);

    // Verify invoice is gone
    const checkDeleted = await prisma.invoice.findUnique({ where: { id: draftId } });
    expect(checkDeleted).toBeNull();

    // Verify tombstone was created
    const tombstone = await prisma.externalTombstone.findFirst({
      where: { businessId, entityType: 'invoice', entityId: draftId },
    });
    expect(tombstone).not.toBeNull();

    // 2. Non-draft invoice (issued) cannot be deleted -> 409 INVOICE_NOT_DELETABLE
    const issuedInvRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalRef: `inv-delete-issued-${testId}`,
        customerName: 'Issued Customer',
        issueDate: '2026-11-10',
        dueDate: '2026-11-24',
        lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000.00' }],
      });
    const issuedId = issuedInvRes.body.data.id;

    await request(app)
      .post(`/api/external/v1/accounts/${businessId}/invoices/${issuedId}/issue`)
      .set('Authorization', `Bearer ${apiKey}`);

    const delIssuedRes = await request(app)
      .delete(`/api/external/v1/accounts/${businessId}/invoices/${issuedId}`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(delIssuedRes.status).toBe(409);
    expect(delIssuedRes.body.error.code).toBe('INVOICE_NOT_DELETABLE');
  });
});
