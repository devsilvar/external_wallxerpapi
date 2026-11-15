import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { createInvoice, createSale } from '../../src/db/scoped.js';
import { generateToken, hashToken } from '../../src/lib/token.js';

describe('Sales delete and linked invoice guard (tests/integration/sales-delete.test.ts)', () => {
  const testId = `sales-del-${Date.now()}`;
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
        fullName: 'Sales Delete Tester',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'Sales Delete Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Delete Guard Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
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
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.saleLineItem.deleteMany({ where: { sale: { businessId } } });
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.externalDevice.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('refuses DELETE on a sale that is linked to an invoice with 409 SALE_LINKED_TO_INVOICE', async () => {
    // 1. Create a sale
    const sale = await createSale(businessId, {
      referenceId: `linked-sale-${testId}`,
      amount: '5000.00',
      source: 'api',
      transactionDate: new Date('2026-11-10'),
    });

    // 2. Create an invoice linked to this sale
    await createInvoice(businessId, {
      externalRef: `inv-linked-${testId}`,
      invoiceNumber: `WX-2026-${Math.floor(100 + Math.random() * 899)}`,
      issueDate: new Date('2026-11-10'),
      dueDate: new Date('2026-11-20'),
      customerName: 'Customer',
      subtotal: '5000.00',
      total: '5000.00',
      lines: [{ description: 'Item', quantity: 1, unitPrice: '5000.00', lineTotal: '5000.00' }],
    });

    // Link the invoice to the sale directly in DB
    const inv = await prisma.invoice.findFirst({ where: { externalRef: `inv-linked-${testId}` } });
    await prisma.invoice.update({
      where: { id: inv!.id },
      data: { linkedSaleId: sale.id },
    });

    // 3. Attempt to DELETE the linked sale via API -> 409 SALE_LINKED_TO_INVOICE
    const res = await request(app)
      .delete(`/api/external/v1/accounts/${businessId}/sales/${sale.id}`)
      .set('Authorization', `Bearer ${deviceToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SALE_LINKED_TO_INVOICE');

    // Confirm sale still exists
    const stillThere = await prisma.salesTransaction.findUnique({ where: { id: sale.id } });
    expect(stillThere).not.toBeNull();
  });

  it('deletes an unlinked sale, cascade-deletes items, and creates a tombstone', async () => {
    // 1. Create sale with items
    const sale = await createSale(businessId, {
      referenceId: `unlinked-sale-${testId}`,
      amount: '3000.00',
      source: 'api',
      transactionDate: new Date('2026-11-10'),
      items: [
        { name: 'Item 1', quantity: 1, unitPrice: '1000.00', lineTotal: '1000.00' },
        { name: 'Item 2', quantity: 2, unitPrice: '1000.00', lineTotal: '2000.00' },
      ],
    });

    // 2. Delete sale via API
    const res = await request(app)
      .delete(`/api/external/v1/accounts/${businessId}/sales/${sale.id}`)
      .set('Authorization', `Bearer ${deviceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    // 3. Assert sale and items are gone
    const deletedSale = await prisma.salesTransaction.findUnique({ where: { id: sale.id } });
    expect(deletedSale).toBeNull();

    const items = await prisma.saleLineItem.findMany({ where: { saleId: sale.id } });
    expect(items.length).toBe(0);

    // 4. Assert tombstone was created
    const tombstone = await prisma.externalTombstone.findFirst({
      where: {
        businessId,
        entityType: 'sale',
        entityId: sale.id,
      },
    });
    expect(tombstone).not.toBeNull();
  });
});
