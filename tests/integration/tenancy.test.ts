import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import {
  findCustomer,
  findCustomerByExternalId,
  updateCustomer,
  deleteCustomer,
  findSale,
  deleteSale,
  findExpense,
  deleteExpense,
  findInvoice,
  updateInvoice,
  deleteInvoice,
  cancelInvoice,
  markInvoiceSent,
  markInvoicePaid,
  createCustomer,
  createSale,
  createExpense,
  createInvoice,
  createTombstone,
} from '../../src/db/scoped.js';
import { generateToken, hashToken } from '../../src/lib/token.js';
import { AppError } from '../../src/lib/errors.js';

describe('Phase 3: Tenant isolation gate (tests/integration/tenancy.test.ts)', () => {
  const testId = `tenancy-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let ownerUserId: string;

  // Account A (Attacker context)
  let businessAId: string;
  let tokenA: string;

  // Account B (Victim context)
  let businessBId: string;
  let tokenB: string;

  // Account B's resources
  let customerBId: string;
  const customerBExternalId = `ext-cust-b-${testId}`;
  let saleBId: string;
  const saleBReferenceId = `sale-b-ref-${testId}`;
  let expenseBId: string;
  const expenseBExternalRef = `exp-b-ref-${testId}`;
  let invoiceBId: string;
  const invoiceBExternalRef = `inv-b-ref-${testId}`;
  let tombstoneBId: string;

  // Account A's resources (for positive baseline & cross-reference attacks)
  let customerAId: string;
  let saleAId: string;
  let invoiceAId: string;

  beforeAll(async () => {
    // 1. Platform owner user
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Tenancy Test Platform Owner',
      },
    });
    ownerUserId = user.id;

    // 2. Platform
    const platform = await prisma.platform.create({
      data: {
        name: 'Tenancy Test Platform',
        ownerUserId,
      },
    });
    platformId = platform.id;

    // 3. Business A
    const bizA = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-a-${testId}`,
        userId: ownerUserId,
        businessName: 'Business A (Attacker)',
        ownerName: 'Alice Attacker',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessAId = bizA.id;

    tokenA = generateToken();
    await prisma.externalDevice.create({
      data: {
        platformId,
        businessId: businessAId,
        tokenHash: hashToken(tokenA),
        activatedAt: new Date(),
      },
    });

    // 4. Business B
    const bizB = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-b-${testId}`,
        userId: ownerUserId,
        businessName: 'Business B (Victim)',
        ownerName: 'Bob Victim',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessBId = bizB.id;

    tokenB = generateToken();
    await prisma.externalDevice.create({
      data: {
        platformId,
        businessId: businessBId,
        tokenHash: hashToken(tokenB),
        activatedAt: new Date(),
      },
    });

    // 5. Seed resources under Account B
    const custB = await createCustomer(businessBId, {
      externalId: customerBExternalId,
      name: 'Victim Customer B',
      email: 'custb@victim.com',
    });
    customerBId = custB.id;

    const saleB = await createSale(businessBId, {
      referenceId: saleBReferenceId,
      amount: '5000.00',
      source: 'api',
      transactionDate: new Date('2026-11-10'),
      customerId: customerBId,
      items: [
        {
          name: 'Item B',
          quantity: 1,
          unitPrice: '5000.00',
          lineTotal: '5000.00',
        },
      ],
    });
    saleBId = saleB.id;

    const expB = await createExpense(businessBId, {
      externalRef: expenseBExternalRef,
      category: 'office_supplies',
      description: 'Paper B',
      amount: '1200.00',
      expenseDate: new Date('2026-11-10'),
    });
    expenseBId = expB.id;

    const invB = await createInvoice(businessBId, {
      externalRef: invoiceBExternalRef,
      invoiceNumber: `WX-2026-${Math.floor(100 + Math.random() * 899)}`,
      issueDate: new Date('2026-11-10'),
      dueDate: new Date('2026-11-20'),
      customerName: 'Victim Customer B',
      customerId: customerBId,
      subtotal: '5000.00',
      total: '5000.00',
      lines: [
        {
          description: 'Consulting B',
          quantity: 1,
          unitPrice: '5000.00',
          lineTotal: '5000.00',
        },
      ],
    });
    invoiceBId = invB.id;

    const tombB = await createTombstone(businessBId, 'customer', 'tomb-cust-b-id');
    tombstoneBId = tombB.id;

    // 6. Seed baseline resources under Account A
    const custA = await createCustomer(businessAId, {
      externalId: `ext-cust-a-${testId}`,
      name: 'Attacker Customer A',
    });
    customerAId = custA.id;

    const saleA = await createSale(businessAId, {
      referenceId: `sale-a-ref-${testId}`,
      amount: '1000.00',
      source: 'api',
      transactionDate: new Date('2026-11-10'),
      customerId: customerAId,
      items: [
        {
          name: 'Item A',
          quantity: 1,
          unitPrice: '1000.00',
          lineTotal: '1000.00',
        },
      ],
    });
    saleAId = saleA.id;

    const invA = await createInvoice(businessAId, {
      externalRef: `inv-a-ref-${testId}`,
      invoiceNumber: `WX-2026-${Math.floor(100 + Math.random() * 899)}`,
      issueDate: new Date('2026-11-10'),
      dueDate: new Date('2026-11-20'),
      customerName: 'Attacker Customer A',
      customerId: customerAId,
      subtotal: '1000.00',
      total: '1000.00',
      lines: [
        {
          description: 'Consulting A',
          quantity: 1,
          unitPrice: '1000.00',
          lineTotal: '1000.00',
        },
      ],
    });
    invoiceAId = invA.id;
  });

  afterAll(async () => {
    const bizIds = [businessAId, businessBId];
    await prisma.externalTombstone.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId: { in: bizIds } } } });
    await prisma.invoice.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.saleLineItem.deleteMany({ where: { sale: { businessId: { in: bizIds } } } });
    await prisma.salesTransaction.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.expense.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.customer.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.auditLog.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.externalDevice.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: ownerUserId } });
  });

  // ===========================================================================
  // MATRIX 1: CROSS-ACCOUNT PATH ATTACK (Account A Token -> /accounts/:accountB/*)
  // Must return 404 NOT_FOUND, NEVER 403 (Rule 6 / D15)
  // ===========================================================================
  describe('Matrix Part 1: Path scoping isolation (/accounts/:accountB/* with Token A)', () => {
    const endpoints: Array<{ method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; body?: object }> = [
      // Account self-service
      { method: 'get', path: '' },
      { method: 'patch', path: '', body: { businessName: 'Hacked Name' } },
      // Customers
      { method: 'get', path: '/customers' },
      { method: 'post', path: '/customers', body: { externalId: 'hack-cust', name: 'Hacker' } },
      { method: 'get', path: `/customers/${customerBId}` },
      { method: 'get', path: `/customers/by-external-id/${customerBExternalId}` },
      { method: 'patch', path: `/customers/${customerBId}`, body: { name: 'Hacked' } },
      { method: 'delete', path: `/customers/${customerBId}` },
      // Sales
      { method: 'get', path: '/sales' },
      { method: 'post', path: '/sales', body: { referenceId: 'hack-sale', amount: '100.00', source: 'api' } },
      { method: 'get', path: `/sales/${saleBId}` },
      { method: 'delete', path: `/sales/${saleBId}` },
      // Expenses
      { method: 'get', path: '/expenses' },
      { method: 'post', path: '/expenses', body: { externalRef: 'hack-exp', category: 'other', description: 'hack', amount: '50.00' } },
      { method: 'get', path: `/expenses/${expenseBId}` },
      { method: 'delete', path: `/expenses/${expenseBId}` },
      // Invoices
      { method: 'get', path: '/invoices' },
      { method: 'post', path: '/invoices', body: { externalRef: 'hack-inv' } },
      { method: 'get', path: `/invoices/${invoiceBId}` },
      { method: 'put', path: `/invoices/${invoiceBId}`, body: { customerName: 'Hacked' } },
      { method: 'delete', path: `/invoices/${invoiceBId}` },
      { method: 'post', path: `/invoices/${invoiceBId}/send` },
      { method: 'post', path: `/invoices/${invoiceBId}/cancel` },
      { method: 'post', path: `/invoices/${invoiceBId}/mark-paid`, body: { linkedSaleId: saleAId } },
      { method: 'get', path: `/invoices/${invoiceBId}/pdf` },
      { method: 'get', path: `/invoices/${invoiceBId}/pdf-link` },
      // Deletions
      { method: 'get', path: '/deletions' },
    ];

    for (const ep of endpoints) {
      it(`rejects ${ep.method.toUpperCase()} /accounts/:accountB${ep.path} with 404 NOT_FOUND (never 403)`, async () => {
        const fullUrl = `/api/external/v1/accounts/${businessBId}${ep.path}`;
        const req = request(app)[ep.method](fullUrl).set('Authorization', `Bearer ${tokenA}`);

        if (ep.body) {
          req.send(ep.body);
        }

        const res = await req;
        expect(res.status).toBe(404);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(res.status).not.toBe(403);
      });
    }
  });

  // ===========================================================================
  // MATRIX 2: NESTED RESOURCE ATTACK (/accounts/:accountA/<resource>/<idB> with Token A)
  // Account in path matches Token A, but resource ID belongs to Account B.
  // Must return 404 NOT_FOUND, NEVER 403.
  // ===========================================================================
  describe('Matrix Part 2: Nested resource cross-tenant attack (/accounts/:accountA/<resource>/<idB>)', () => {
    // 1. Customers
    it('returns 404 when getting Account B customer via GET /accounts/:accountA/customers/:customerBId', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/customers/${customerBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when getting Account B customer via GET /accounts/:accountA/customers/by-external-id/:customerBExternalId', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/customers/by-external-id/${customerBExternalId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when updating Account B customer via PATCH /accounts/:accountA/customers/:customerBId', async () => {
      const res = await request(app)
        .patch(`/api/external/v1/accounts/${businessAId}/customers/${customerBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Cross-Tenant Update Attempt' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when deleting Account B customer via DELETE /accounts/:accountA/customers/:customerBId', async () => {
      const res = await request(app)
        .delete(`/api/external/v1/accounts/${businessAId}/customers/${customerBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    // 2. Sales
    it('returns 404 when getting Account B sale via GET /accounts/:accountA/sales/:saleBId', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/sales/${saleBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when deleting Account B sale via DELETE /accounts/:accountA/sales/:saleBId', async () => {
      const res = await request(app)
        .delete(`/api/external/v1/accounts/${businessAId}/sales/${saleBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    // 3. Expenses
    it('returns 404 when getting Account B expense via GET /accounts/:accountA/expenses/:expenseBId', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/expenses/${expenseBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when deleting Account B expense via DELETE /accounts/:accountA/expenses/:expenseBId', async () => {
      const res = await request(app)
        .delete(`/api/external/v1/accounts/${businessAId}/expenses/${expenseBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    // 4. Invoices
    it('returns 404 when getting Account B invoice via GET /accounts/:accountA/invoices/:invoiceBId', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when updating Account B invoice via PUT /accounts/:accountA/invoices/:invoiceBId', async () => {
      const res = await request(app)
        .put(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ customerName: 'Cross-Tenant Invoice Update' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when deleting Account B invoice via DELETE /accounts/:accountA/invoices/:invoiceBId', async () => {
      const res = await request(app)
        .delete(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when triggering send action on Account B invoice via POST /accounts/:accountA/invoices/:invoiceBId/send', async () => {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}/send`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when triggering cancel action on Account B invoice via POST /accounts/:accountA/invoices/:invoiceBId/cancel', async () => {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}/cancel`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when attempting mark-paid on Account B invoice via POST /accounts/:accountA/invoices/:invoiceBId/mark-paid', async () => {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}/mark-paid`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ paymentMethod: 'cash' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when attempting to create invoice in Account A with Account B customerId', async () => {
      const res = await request(app)
        .post(`/api/external/v1/accounts/${businessAId}/invoices`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          externalRef: `inv-cross-${Date.now()}`,
          customerName: 'Cross Customer',
          customerId: customerBId,
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date().toISOString().slice(0, 10),
          lines: [{ description: 'Item 1', quantity: '1', unitPrice: '100.00' }],
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when fetching PDF for Account B invoice via GET /accounts/:accountA/invoices/:invoiceBId/pdf', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}/pdf`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });

    it('returns 404 when fetching PDF link for Account B invoice via GET /accounts/:accountA/invoices/:invoiceBId/pdf-link', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/invoices/${invoiceBId}/pdf-link`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.status).not.toBe(403);
    });
  });

  // ===========================================================================
  // MATRIX 3: LIST ISOLATION (Collections must never leak other accounts' rows)
  // ===========================================================================
  describe('Matrix Part 3: List isolation (no row leakage)', () => {
    it('GET /accounts/:accountA/customers never returns Account B customer', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/customers`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((c: { id: string }) => c.id);
      expect(ids).toContain(customerAId);
      expect(ids).not.toContain(customerBId);
    });

    it('GET /accounts/:accountA/sales never returns Account B sale', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/sales`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).toContain(saleAId);
      expect(ids).not.toContain(saleBId);
    });

    it('GET /accounts/:accountA/expenses never returns Account B expense', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/expenses`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((e: { id: string }) => e.id);
      expect(ids).not.toContain(expenseBId);
    });

    it('GET /accounts/:accountA/invoices never returns Account B invoice', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/invoices`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((i: { id: string }) => i.id);
      expect(ids).toContain(invoiceAId);
      expect(ids).not.toContain(invoiceBId);
    });

    it('GET /accounts/:accountA/deletions never returns Account B tombstone', async () => {
      const res = await request(app)
        .get(`/api/external/v1/accounts/${businessAId}/deletions`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((t: { id: string }) => t.id);
      expect(ids).not.toContain(tombstoneBId);
    });
  });

  // ===========================================================================
  // MATRIX 4: DIRECT SCOPED REPOSITORY LAYER ISOLATION
  // ===========================================================================
  describe('Matrix Part 4: Direct scoped query layer isolation', () => {
    it('proves findCustomer(businessAId, customerBId) returns null', async () => {
      const res = await findCustomer(businessAId, customerBId);
      expect(res).toBeNull();
    });

    it('proves findCustomerByExternalId(businessAId, customerBExternalId) returns null', async () => {
      const res = await findCustomerByExternalId(businessAId, customerBExternalId);
      expect(res).toBeNull();
    });

    it('proves updateCustomer(businessAId, customerBId) throws AppError 404', async () => {
      await expect(
        updateCustomer(businessAId, customerBId, { name: 'Attempt' })
      ).rejects.toThrow(AppError);
    });

    it('proves deleteCustomer(businessAId, customerBId) throws AppError 404', async () => {
      await expect(deleteCustomer(businessAId, customerBId)).rejects.toThrow(AppError);
    });

    it('proves findSale(businessAId, saleBId) returns null', async () => {
      const res = await findSale(businessAId, saleBId);
      expect(res).toBeNull();
    });

    it('proves deleteSale(businessAId, saleBId) throws AppError 404', async () => {
      await expect(deleteSale(businessAId, saleBId)).rejects.toThrow(AppError);
    });

    it('proves findExpense(businessAId, expenseBId) returns null', async () => {
      const res = await findExpense(businessAId, expenseBId);
      expect(res).toBeNull();
    });

    it('proves deleteExpense(businessAId, expenseBId) throws AppError 404', async () => {
      await expect(deleteExpense(businessAId, expenseBId)).rejects.toThrow(AppError);
    });

    it('proves findInvoice(businessAId, invoiceBId) returns null', async () => {
      const res = await findInvoice(businessAId, invoiceBId);
      expect(res).toBeNull();
    });

    it('proves updateInvoice(businessAId, invoiceBId) throws AppError 404', async () => {
      await expect(
        updateInvoice(businessAId, invoiceBId, { customerName: 'Attempt' })
      ).rejects.toThrow(AppError);
    });

    it('proves deleteInvoice(businessAId, invoiceBId) throws AppError 404', async () => {
      await expect(deleteInvoice(businessAId, invoiceBId)).rejects.toThrow(AppError);
    });

    it('proves cancelInvoice(businessAId, invoiceBId) throws AppError 404', async () => {
      await expect(cancelInvoice(businessAId, invoiceBId)).rejects.toThrow(AppError);
    });

    it('proves markInvoiceSent(businessAId, invoiceBId) throws AppError 404', async () => {
      await expect(markInvoiceSent(businessAId, invoiceBId)).rejects.toThrow(AppError);
    });

    it('proves markInvoicePaid(businessAId, invoiceBId) throws AppError 404', async () => {
      await expect(
        markInvoicePaid(businessAId, invoiceBId, saleAId)
      ).rejects.toThrow(AppError);
    });

    it('proves markInvoicePaid(businessAId, invoiceAId, saleBId) throws AppError 404', async () => {
      await expect(
        markInvoicePaid(businessAId, invoiceAId, saleBId)
      ).rejects.toThrow(AppError);
    });
  });
});
